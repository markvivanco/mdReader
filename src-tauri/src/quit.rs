use std::{
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex, MutexGuard,
  },
  time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub(crate) const CLOSE_REQUEST_EVENT: &str = "app-close-requested";
const LISTENER_READY_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_REQUEST_ACK_TIMEOUT: Duration = Duration::from_secs(5);
const CLOSE_REVIEW_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone)]
pub(crate) struct QuitCoordinator {
  inner: Arc<CoordinatorInner>,
}

struct CoordinatorInner {
  state: Mutex<CoordinatorState>,
  watchdog_wake: Condvar,
  watchdog_started: AtomicBool,
}

#[derive(Debug, Default)]
struct CoordinatorState {
  active_listener_id: Option<u64>,
  approved: bool,
  next_listener_id: u64,
  next_request_id: u64,
  active_request: Option<ActiveRequest>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestPhase {
  AwaitingListener,
  AwaitingAck,
  Reviewing,
}

impl RequestPhase {
  fn timeout_description(self) -> &'static str {
    match self {
      Self::AwaitingListener => "waiting for the frontend listener",
      Self::AwaitingAck => "waiting for frontend acknowledgement",
      Self::Reviewing => "waiting for the unsaved-changes review",
    }
  }
}

#[derive(Clone, Copy, Debug)]
struct ActiveRequest {
  id: u64,
  phase: RequestPhase,
  deadline: Instant,
  exit_code: Option<i32>,
  macos_termination_pending: bool,
}

#[derive(Clone, Copy, Debug)]
struct CancelledRequest {
  id: u64,
  phase: RequestPhase,
  macos_termination_pending: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloseRequestPayload {
  request_id: u64,
}

#[derive(Clone, Copy, Debug)]
struct ListenerRegistration {
  listener_id: u64,
  request_id: Option<u64>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloseListenerReadyResponse {
  listener_id: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CloseDecision {
  Allow,
  Prevent,
  PreventAndNotify(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Resolution {
  None,
  Exit(i32),
  ReplyToMacos(bool),
}

impl Default for QuitCoordinator {
  fn default() -> Self {
    Self {
      inner: Arc::new(CoordinatorInner {
        state: Mutex::new(CoordinatorState::default()),
        watchdog_wake: Condvar::new(),
        watchdog_started: AtomicBool::new(false),
      }),
    }
  }
}

impl QuitCoordinator {
  fn next_request_id(state: &mut CoordinatorState) -> u64 {
    state.next_request_id = state
      .next_request_id
      .checked_add(1)
      .expect("close request identifiers were exhausted");
    state.next_request_id
  }

  fn lock(&self) -> MutexGuard<'_, CoordinatorState> {
    // A panic in a test or callback must not leave the native quit path unusable.
    self
      .inner
      .state
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
  }

  pub(crate) fn request_close(&self) -> CloseDecision {
    self.request_close_inner(false, None)
  }

  pub(crate) fn request_exit(&self, exit_code: Option<i32>) -> CloseDecision {
    self.request_close_inner(false, exit_code)
  }

  #[cfg(target_os = "macos")]
  fn request_macos_termination(&self) -> CloseDecision {
    self.request_close_inner(true, None)
  }

  fn request_close_inner(
    &self,
    from_macos_termination: bool,
    exit_code: Option<i32>,
  ) -> CloseDecision {
    let mut state = self.lock();
    if state.approved {
      return CloseDecision::Allow;
    }

    if let Some(active_request) = state.active_request.as_mut() {
      if from_macos_termination {
        active_request.macos_termination_pending = true;
      }
      if active_request.exit_code.is_none() {
        active_request.exit_code = exit_code;
      }
      return CloseDecision::Prevent;
    }

    let request_id = Self::next_request_id(&mut state);
    let listener_ready = state.active_listener_id.is_some();
    let phase = if listener_ready {
      RequestPhase::AwaitingAck
    } else {
      RequestPhase::AwaitingListener
    };
    let timeout = if listener_ready {
      CLOSE_REQUEST_ACK_TIMEOUT
    } else {
      LISTENER_READY_TIMEOUT
    };
    state.active_request = Some(ActiveRequest {
      id: request_id,
      phase,
      deadline: Instant::now() + timeout,
      exit_code,
      macos_termination_pending: from_macos_termination,
    });
    drop(state);
    self.inner.watchdog_wake.notify_all();

    if listener_ready {
      CloseDecision::PreventAndNotify(request_id)
    } else {
      CloseDecision::Prevent
    }
  }

  fn mark_listener_ready(&self) -> ListenerRegistration {
    let mut state = self.lock();
    state.next_listener_id = state
      .next_listener_id
      .checked_add(1)
      .expect("close listener identifiers were exhausted");
    let listener_id = state.next_listener_id;
    state.active_listener_id = Some(listener_id);

    let request_id = match state.active_request.as_mut() {
      Some(active_request) if active_request.phase == RequestPhase::AwaitingListener => {
        active_request.phase = RequestPhase::AwaitingAck;
        active_request.deadline = Instant::now() + CLOSE_REQUEST_ACK_TIMEOUT;
        Some(active_request.id)
      }
      _ => None,
    };
    drop(state);
    if request_id.is_some() {
      self.inner.watchdog_wake.notify_all();
    }
    ListenerRegistration {
      listener_id,
      request_id,
    }
  }

  fn mark_listener_unready(&self, listener_id: u64) -> bool {
    let mut state = self.lock();
    if state.active_listener_id != Some(listener_id) {
      return false;
    }
    state.active_listener_id = None;

    if let Some(mut active_request) = state.active_request {
      if active_request.phase != RequestPhase::AwaitingListener {
        // Give the replacement listener a new request ID so any acknowledgement
        // or resolution still arriving from the disposed listener is stale.
        active_request.id = Self::next_request_id(&mut state);
        active_request.phase = RequestPhase::AwaitingListener;
        active_request.deadline = Instant::now() + LISTENER_READY_TIMEOUT;
        state.active_request = Some(active_request);
      }
    }
    drop(state);
    self.inner.watchdog_wake.notify_all();
    true
  }

  fn acknowledge(&self, request_id: u64) -> bool {
    let mut state = self.lock();
    let acknowledged = match state.active_request.as_mut() {
      Some(active_request)
        if active_request.id == request_id
          && active_request.phase == RequestPhase::AwaitingAck =>
      {
        active_request.phase = RequestPhase::Reviewing;
        active_request.deadline = Instant::now() + CLOSE_REVIEW_TIMEOUT;
        true
      }
      Some(active_request)
        if active_request.id == request_id
          && active_request.phase == RequestPhase::Reviewing =>
      {
        true
      }
      _ => false,
    };
    drop(state);
    if acknowledged {
      self.inner.watchdog_wake.notify_all();
    }
    acknowledged
  }

  fn resolve(&self, request_id: u64, should_close: bool) -> Resolution {
    let mut state = self.lock();
    let Some(active_request) = state.active_request else {
      return Resolution::None;
    };
    if active_request.id != request_id || active_request.phase != RequestPhase::Reviewing {
      return Resolution::None;
    }
    state.active_request = None;

    let resolution = if should_close {
      // This flag is deliberately permanent: a successful resolution is immediately
      // followed by process termination, and every native close/exit callback that it
      // causes must pass without opening a second review.
      state.approved = true;
      if active_request.macos_termination_pending {
        Resolution::ReplyToMacos(true)
      } else {
        Resolution::Exit(active_request.exit_code.unwrap_or(0))
      }
    } else if active_request.macos_termination_pending {
      Resolution::ReplyToMacos(false)
    } else {
      Resolution::None
    };
    drop(state);
    self.inner.watchdog_wake.notify_all();
    resolution
  }

  fn cancel_request(&self, request_id: u64) -> Option<CancelledRequest> {
    let mut state = self.lock();
    let active_request = state.active_request?;
    if active_request.id != request_id {
      return None;
    }
    state.active_request = None;
    drop(state);
    self.inner.watchdog_wake.notify_all();
    Some(CancelledRequest {
      id: active_request.id,
      phase: active_request.phase,
      macos_termination_pending: active_request.macos_termination_pending,
    })
  }

  fn take_timed_out_request(&self) -> CancelledRequest {
    let mut state = self.lock();
    loop {
      let Some(active_request) = state.active_request else {
        state = self
          .inner
          .watchdog_wake
          .wait(state)
          .unwrap_or_else(|poisoned| poisoned.into_inner());
        continue;
      };

      let now = Instant::now();
      if active_request.deadline <= now {
        state.active_request = None;
        return CancelledRequest {
          id: active_request.id,
          phase: active_request.phase,
          macos_termination_pending: active_request.macos_termination_pending,
        };
      }

      let wait = active_request.deadline.saturating_duration_since(now);
      let (next_state, _) = self
        .inner
        .watchdog_wake
        .wait_timeout(state, wait)
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      state = next_state;
    }
  }
}

fn emit_close_request(app: &AppHandle, request_id: u64) -> Result<(), String> {
  app
    .emit(CLOSE_REQUEST_EVENT, CloseRequestPayload { request_id })
    .map_err(|error| {
      format!("Unable to notify the editor about close request {request_id}: {error}")
    })
}

fn cancel_pending_macos_termination(app: &AppHandle, cancelled: CancelledRequest) {
  if !cancelled.macos_termination_pending {
    return;
  }

  #[cfg(target_os = "macos")]
  if let Err(error) = macos::reply_to_application_should_terminate(app, false) {
    log::error!(
      "Unable to cancel timed-out macOS termination request {}: {error}",
      cancelled.id
    );
  }
  #[cfg(not(target_os = "macos"))]
  let _ = app;
}

fn cancel_after_delivery_failure(
  app: &AppHandle,
  coordinator: &QuitCoordinator,
  request_id: u64,
) {
  if let Some(cancelled) = coordinator.cancel_request(request_id) {
    cancel_pending_macos_termination(app, cancelled);
  }
}

pub(crate) fn notify_close_request(
  app: &AppHandle,
  coordinator: &QuitCoordinator,
  request_id: u64,
) {
  if let Err(error) = emit_close_request(app, request_id) {
    // The current native close/exit attempt has already been prevented. Resetting
    // to idle lets the user's next attempt retry instead of becoming permanently
    // stuck behind an event that was never delivered.
    cancel_after_delivery_failure(app, coordinator, request_id);
    log::error!("{error}");
  }
}

pub(crate) fn start_close_watchdog(
  app: &AppHandle,
  coordinator: QuitCoordinator,
) -> Result<(), String> {
  if coordinator
    .inner
    .watchdog_started
    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
    .is_err()
  {
    return Ok(());
  }

  let watchdog_app = app.clone();
  let watchdog_coordinator = coordinator.clone();
  if let Err(error) = std::thread::Builder::new()
    .name("mdreader-close-watchdog".into())
    .spawn(move || loop {
      let cancelled = watchdog_coordinator.take_timed_out_request();
      log::warn!(
        "Close request {} timed out while {}; cancelling the request",
        cancelled.id,
        cancelled.phase.timeout_description()
      );
      cancel_pending_macos_termination(&watchdog_app, cancelled);
    })
  {
    coordinator
      .inner
      .watchdog_started
      .store(false, Ordering::Release);
    return Err(format!("Unable to start the close-request watchdog: {error}"));
  }

  Ok(())
}

#[tauri::command]
pub(crate) fn close_listener_ready(
  app: AppHandle,
  coordinator: tauri::State<'_, QuitCoordinator>,
) -> Result<CloseListenerReadyResponse, String> {
  let registration = coordinator.mark_listener_ready();
  if let Some(request_id) = registration.request_id {
    if let Err(error) = emit_close_request(&app, request_id) {
      cancel_after_delivery_failure(&app, &coordinator, request_id);
      return Err(error);
    }
  }
  Ok(CloseListenerReadyResponse {
    listener_id: registration.listener_id,
  })
}

#[tauri::command]
pub(crate) fn close_listener_unready(
  coordinator: tauri::State<'_, QuitCoordinator>,
  listener_id: u64,
) -> bool {
  coordinator.mark_listener_unready(listener_id)
}

#[tauri::command]
pub(crate) fn ack_close_request(
  coordinator: tauri::State<'_, QuitCoordinator>,
  request_id: u64,
) -> bool {
  coordinator.acknowledge(request_id)
}

#[tauri::command]
pub(crate) fn resolve_close_request(
  app: AppHandle,
  coordinator: tauri::State<'_, QuitCoordinator>,
  request_id: u64,
  should_close: bool,
) -> Result<(), String> {
  match coordinator.resolve(request_id, should_close) {
    Resolution::None => Ok(()),
    Resolution::Exit(exit_code) => {
      app.exit(exit_code);
      Ok(())
    }
    Resolution::ReplyToMacos(should_terminate) => {
      #[cfg(target_os = "macos")]
      {
        macos::reply_to_application_should_terminate(&app, should_terminate)
      }
      #[cfg(not(target_os = "macos"))]
      {
        let _ = should_terminate;
        Ok(())
      }
    }
  }
}

#[cfg(target_os = "macos")]
pub(crate) fn install_macos_termination_hook(
  app: &AppHandle,
  coordinator: QuitCoordinator,
) -> Result<(), String> {
  macos::install(app.clone(), coordinator)
}

#[cfg(target_os = "macos")]
mod macos {
  use std::{
    ffi::CStr,
    panic::{catch_unwind, AssertUnwindSafe},
    ptr::NonNull,
    sync::OnceLock,
  };

  use objc2::{
    msg_send,
    runtime::{AnyObject, ClassBuilder, Sel},
    sel, MainThreadMarker,
  };
  use objc2_app_kit::{NSApplication, NSApplicationTerminateReply};
  use tauri::AppHandle;

  use super::{emit_close_request, CloseDecision, QuitCoordinator};

  struct TerminationBridge {
    app: AppHandle,
    coordinator: QuitCoordinator,
  }

  static TERMINATION_BRIDGE: OnceLock<TerminationBridge> = OnceLock::new();

  pub(super) fn install(app: AppHandle, coordinator: QuitCoordinator) -> Result<(), String> {
    let main_thread = MainThreadMarker::new()
      .ok_or("The macOS application termination hook must be installed on the main thread.")?;
    let application = NSApplication::sharedApplication(main_thread);

    // Tauri/Tao owns and retains this delegate for the event loop. We change only the
    // instance's Objective-C class to an ivar-free subclass, so every existing Tao
    // delegate method continues to be inherited unchanged.
    let delegate: *mut AnyObject = unsafe { msg_send![&application, delegate] };
    let delegate = NonNull::new(delegate)
      .ok_or("The macOS application did not have a delegate to extend.")?;
    let delegate = unsafe { delegate.as_ref() };
    let tao_delegate_class = delegate.class();

    let class_name = CStr::from_bytes_with_nul(b"MdReaderQuitAwareTaoDelegate\0")
      .expect("static Objective-C class name is valid");
    let mut subclass = ClassBuilder::new(class_name, tao_delegate_class)
      .ok_or("The mdReader macOS termination hook was already installed.")?;

    // SAFETY: `applicationShouldTerminate:` takes the delegate and one NSApplication
    // argument and returns NSApplicationTerminateReply. The subclass adds no ivars,
    // and the callback never stores either borrowed Objective-C object.
    unsafe {
      subclass.add_method(
        sel!(applicationShouldTerminate:),
        application_should_terminate as extern "C" fn(_, _, _) -> _,
      );
    }
    let subclass = subclass.register();

    TERMINATION_BRIDGE
      .set(TerminationBridge { app, coordinator })
      .map_err(|_| "The mdReader macOS termination bridge was already configured.".to_string())?;

    // SAFETY: `subclass` was created directly from the delegate's current class, adds
    // no ivars, and overrides a method with the exact Objective-C ABI shown above.
    let previous_class = unsafe { AnyObject::set_class(delegate, subclass) };
    if !std::ptr::eq(previous_class, tao_delegate_class) {
      return Err("The macOS application delegate changed while installing the quit hook.".into());
    }

    Ok(())
  }

  extern "C" fn application_should_terminate(
    _delegate: &AnyObject,
    _selector: Sel,
    _application: &NSApplication,
  ) -> NSApplicationTerminateReply {
    match catch_unwind(AssertUnwindSafe(application_should_terminate_inner)) {
      Ok(reply) => reply,
      Err(_) => {
        // A panic must never unwind through an Objective-C callback. Cancel the
        // active request as well as AppKit termination so the next attempt can retry.
        // Keep the recovery itself behind a second unwind boundary: logging or a
        // poisoned third-party callback must not escape across the extern-C ABI.
        let _ = catch_unwind(AssertUnwindSafe(|| {
          if let Some(bridge) = TERMINATION_BRIDGE.get() {
            let active_request_id = bridge
              .coordinator
              .lock()
              .active_request
              .map(|request| request.id);
            if let Some(request_id) = active_request_id {
              bridge.coordinator.cancel_request(request_id);
            }
          }
          log::error!("A panic occurred while handling the macOS termination request");
        }));
        NSApplicationTerminateReply::TerminateCancel
      }
    }
  }

  fn application_should_terminate_inner() -> NSApplicationTerminateReply {
    let Some(bridge) = TERMINATION_BRIDGE.get() else {
      // There is nobody available to review or acknowledge unsaved work. Fail
      // closed without entering NSTerminateLater, so a later attempt can retry.
      log::error!("The macOS termination bridge was unavailable");
      return NSApplicationTerminateReply::TerminateCancel;
    };

    match bridge.coordinator.request_macos_termination() {
      CloseDecision::Allow => NSApplicationTerminateReply::TerminateNow,
      CloseDecision::Prevent => NSApplicationTerminateReply::TerminateLater,
      CloseDecision::PreventAndNotify(request_id) => {
        if let Err(error) = emit_close_request(&bridge.app, request_id) {
          bridge.coordinator.cancel_request(request_id);
          log::error!("{error}");
          NSApplicationTerminateReply::TerminateCancel
        } else {
          NSApplicationTerminateReply::TerminateLater
        }
      }
    }
  }

  pub(super) fn reply_to_application_should_terminate(
    app: &AppHandle,
    should_terminate: bool,
  ) -> Result<(), String> {
    app
      .run_on_main_thread(move || {
        let Some(main_thread) = MainThreadMarker::new() else {
          log::error!("macOS termination reply was not dispatched on the main thread");
          return;
        };
        let application = NSApplication::sharedApplication(main_thread);
        application.replyToApplicationShouldTerminate(should_terminate);
      })
      .map_err(|error| format!("Unable to answer the macOS termination request: {error}"))
  }
}

#[cfg(test)]
mod tests {
  use std::time::Instant;

  use super::{CloseDecision, QuitCoordinator, RequestPhase, Resolution};

  fn request_id(decision: CloseDecision) -> u64 {
    let CloseDecision::PreventAndNotify(request_id) = decision else {
      panic!("expected a close request that needs frontend notification");
    };
    request_id
  }

  fn expire_active_request(coordinator: &QuitCoordinator) {
    coordinator
      .lock()
      .active_request
      .as_mut()
      .unwrap()
      .deadline = Instant::now();
  }

  #[test]
  fn queues_a_request_until_the_frontend_listener_is_ready() {
    let coordinator = QuitCoordinator::default();

    assert_eq!(coordinator.request_close(), CloseDecision::Prevent);
    let first_listener = coordinator.mark_listener_ready();
    let request_id = first_listener.request_id.unwrap();
    assert_eq!(request_id, 1);
    let second_listener = coordinator.mark_listener_ready();
    assert_eq!(second_listener.request_id, None);
    assert!(!coordinator.mark_listener_unready(first_listener.listener_id));
    assert!(coordinator.acknowledge(request_id));
    assert_eq!(coordinator.resolve(request_id, false), Resolution::None);
    assert!(coordinator.mark_listener_unready(second_listener.listener_id));
  }

  #[test]
  fn emits_immediately_once_ready_and_coalesces_reentrant_requests() {
    let coordinator = QuitCoordinator::default();
    assert_eq!(coordinator.mark_listener_ready().request_id, None);

    let first_request_id = request_id(coordinator.request_close());
    assert_eq!(first_request_id, 1);
    assert_eq!(coordinator.request_close(), CloseDecision::Prevent);
    assert_eq!(
      coordinator.resolve(first_request_id, false),
      Resolution::None
    );
    assert_eq!(coordinator.request_close(), CloseDecision::Prevent);
    assert!(coordinator.acknowledge(first_request_id));
    assert_eq!(
      coordinator.resolve(first_request_id, false),
      Resolution::None
    );
    assert_eq!(request_id(coordinator.request_close()), 2);
  }

  #[test]
  fn approval_bypasses_all_native_interception_during_shutdown() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();
    let request_id = request_id(coordinator.request_close());
    assert!(coordinator.acknowledge(request_id));

    assert_eq!(coordinator.resolve(request_id, true), Resolution::Exit(0));
    assert_eq!(coordinator.request_close(), CloseDecision::Allow);
    assert_eq!(coordinator.resolve(request_id, true), Resolution::None);
  }

  #[test]
  fn failed_event_delivery_resets_to_idle_for_a_real_retry() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();
    let first_request_id = request_id(coordinator.request_close());

    let cancelled = coordinator.cancel_request(first_request_id).unwrap();
    assert_eq!(cancelled.id, first_request_id);
    assert_eq!(cancelled.phase, RequestPhase::AwaitingAck);
    assert!(!cancelled.macos_termination_pending);
    assert_eq!(request_id(coordinator.request_close()), 2);
  }

  #[test]
  fn stale_acknowledgements_and_resolutions_cannot_affect_a_new_request() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();
    let first_request_id = request_id(coordinator.request_close());
    coordinator.cancel_request(first_request_id);
    let second_request_id = request_id(coordinator.request_close());

    assert!(!coordinator.acknowledge(first_request_id));
    assert_eq!(
      coordinator.resolve(first_request_id, true),
      Resolution::None
    );
    assert_eq!(coordinator.request_close(), CloseDecision::Prevent);

    assert!(coordinator.acknowledge(second_request_id));
    assert_eq!(
      coordinator.resolve(second_request_id, false),
      Resolution::None
    );
  }

  #[test]
  fn timeout_resets_only_the_matching_active_request() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();
    let timed_out_request_id = request_id(coordinator.request_close());
    assert!(coordinator.acknowledge(timed_out_request_id));
    expire_active_request(&coordinator);

    let cancelled = coordinator.take_timed_out_request();
    assert_eq!(cancelled.id, timed_out_request_id);
    assert_eq!(cancelled.phase, RequestPhase::Reviewing);
    assert_eq!(
      coordinator.resolve(timed_out_request_id, true),
      Resolution::None
    );
    assert_eq!(request_id(coordinator.request_close()), 2);
  }

  #[test]
  fn acknowledgement_timeout_rejects_late_frontend_messages_and_allows_retry() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();
    let timed_out_request_id = request_id(coordinator.request_close());
    expire_active_request(&coordinator);

    let cancelled = coordinator.take_timed_out_request();
    assert_eq!(cancelled.phase, RequestPhase::AwaitingAck);
    assert!(!coordinator.acknowledge(timed_out_request_id));
    assert_eq!(
      coordinator.resolve(timed_out_request_id, true),
      Resolution::None
    );
    assert_eq!(request_id(coordinator.request_close()), 2);
  }

  #[test]
  fn listener_timeout_allows_a_later_listener_and_request_to_recover() {
    let coordinator = QuitCoordinator::default();
    assert_eq!(coordinator.request_close(), CloseDecision::Prevent);
    expire_active_request(&coordinator);

    let cancelled = coordinator.take_timed_out_request();
    assert_eq!(cancelled.phase, RequestPhase::AwaitingListener);
    assert_eq!(coordinator.mark_listener_ready().request_id, None);
    assert_eq!(request_id(coordinator.request_close()), 2);
  }

  #[test]
  fn listener_replacement_rotates_the_request_id_and_restarts_review() {
    let coordinator = QuitCoordinator::default();
    let first_listener = coordinator.mark_listener_ready();
    let first_request_id = request_id(coordinator.request_close());
    assert!(coordinator.acknowledge(first_request_id));

    assert!(coordinator.mark_listener_unready(first_listener.listener_id));
    assert!(!coordinator.acknowledge(first_request_id));
    assert_eq!(
      coordinator.resolve(first_request_id, true),
      Resolution::None
    );

    let replacement_listener = coordinator.mark_listener_ready();
    let replacement_request_id = replacement_listener.request_id.unwrap();
    assert_eq!(replacement_request_id, 2);
    assert!(coordinator.acknowledge(replacement_request_id));
    assert_eq!(
      coordinator.resolve(replacement_request_id, false),
      Resolution::None
    );
  }

  #[test]
  fn preserves_a_programmatic_exit_code_after_review() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();
    let request_id = request_id(coordinator.request_exit(Some(17)));
    assert!(coordinator.acknowledge(request_id));

    assert_eq!(
      coordinator.resolve(request_id, true),
      Resolution::Exit(17)
    );
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn macos_termination_is_deferred_and_answered_after_review() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();

    let first_request_id = request_id(coordinator.request_macos_termination());
    assert!(coordinator.acknowledge(first_request_id));
    assert_eq!(
      coordinator.resolve(first_request_id, false),
      Resolution::ReplyToMacos(false)
    );

    let second_request_id = request_id(coordinator.request_macos_termination());
    assert!(coordinator.acknowledge(second_request_id));
    assert_eq!(
      coordinator.resolve(second_request_id, true),
      Resolution::ReplyToMacos(true)
    );
    assert_eq!(
      coordinator.request_macos_termination(),
      CloseDecision::Allow
    );
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn macos_quit_coalesces_with_an_active_window_close_review() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();

    let request_id = request_id(coordinator.request_close());
    assert_eq!(
      coordinator.request_macos_termination(),
      CloseDecision::Prevent
    );
    assert!(coordinator.acknowledge(request_id));
    assert_eq!(
      coordinator.resolve(request_id, true),
      Resolution::ReplyToMacos(true)
    );
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn macos_review_timeout_retains_the_information_needed_to_cancel_appkit() {
    let coordinator = QuitCoordinator::default();
    coordinator.mark_listener_ready();
    let request_id = request_id(coordinator.request_macos_termination());
    assert!(coordinator.acknowledge(request_id));
    expire_active_request(&coordinator);

    let cancelled = coordinator.take_timed_out_request();
    assert_eq!(cancelled.id, request_id);
    assert_eq!(cancelled.phase, RequestPhase::Reviewing);
    assert!(cancelled.macos_termination_pending);
    assert_eq!(
      coordinator.resolve(request_id, true),
      Resolution::None
    );
  }
}
