use serde::Serialize;
use std::{collections::VecDeque, ffi::OsString, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
pub struct OpenFileRequest {
  id: u64,
  path: String,
}

#[derive(Default)]
struct PendingFiles {
  next_id: u64,
  requests: VecDeque<OpenFileRequest>,
}

#[derive(Default)]
pub struct OpenFiles(Mutex<PendingFiles>);

impl OpenFiles {
  pub fn enqueue(&self, paths: impl IntoIterator<Item = PathBuf>) {
    let mut pending = self.0.lock().unwrap();
    for path in paths {
      // OS input is a file path, never a URL to execute or an application option.
      if !path.is_absolute() || !crate::is_markdown_path(&path) { continue; }
      let path = path.canonicalize().unwrap_or(path);
      let Some(path) = path.to_str() else { continue; };
      if pending.requests.iter().any(|request| request.path == path) { continue; }
      pending.next_id += 1;
      let id = pending.next_id;
      pending.requests.push_back(OpenFileRequest { id, path: path.into() });
    }
  }

  fn pending(&self) -> Vec<OpenFileRequest> {
    self.0.lock().unwrap().requests.iter().cloned().collect()
  }

  fn acknowledge(&self, id: u64) {
    self.0.lock().unwrap().requests.retain(|request| request.id != id);
  }

  fn resolve(&self, id: u64) -> Result<OpenedFile, String> {
    let request = self.pending().into_iter().find(|request| request.id == id)
      .ok_or("The file-open request is no longer pending.")?;
    let path = crate::clean_path(&request.path)?;
    if !path.is_file() || !crate::is_markdown_path(&path) {
      return Err("Only Markdown files can be opened in mdReader.".into());
    }
    let root = path.parent().ok_or("The file has no parent folder.")?;
    Ok(OpenedFile {
      path: path.to_string_lossy().into_owned(),
      root: root.to_string_lossy().into_owned(),
    })
  }
}

// Both initial argv and the single-instance callback include the executable.
pub fn argument_paths(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<PathBuf> {
  args.into_iter().skip(1).filter_map(|arg| {
    if arg.to_string_lossy().starts_with('-') { return None; }
    let path = PathBuf::from(arg);
    let path = if path.is_absolute() { path } else { cwd.join(path) };
    (path.is_absolute() && crate::is_markdown_path(&path)).then_some(path)
  }).collect()
}

#[derive(Serialize)]
pub struct OpenedFile {
  path: String,
  root: String,
}

#[tauri::command]
pub fn pending_open_files(files: tauri::State<'_, OpenFiles>) -> Vec<OpenFileRequest> {
  files.pending()
}

#[tauri::command]
pub fn resolve_open_file(files: tauri::State<'_, OpenFiles>, request_id: u64) -> Result<OpenedFile, String> {
  files.resolve(request_id)
}

#[tauri::command]
pub fn acknowledge_open_file(files: tauri::State<'_, OpenFiles>, request_id: u64) {
  files.acknowledge(request_id);
}

pub fn receive(app: &tauri::AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
  app.state::<OpenFiles>().enqueue(paths);
  // Requests remain queued if the WebView has not subscribed yet. The frontend
  // also reads the queue immediately after subscribing and acknowledges each item.
  let _ = app.emit("open-files-pending", ());
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn fixture() -> PathBuf {
    let root = std::env::temp_dir().join(format!("mdreader-open-{}-{}", std::process::id(),
      std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap()
  }

  #[test]
  fn arguments_preserve_spaces_unicode_and_sender_directory_and_ignore_options() {
    let root = fixture();
    let path = root.join("café #1%.MD");
    let args = ["mdReader".into(), "café #1%.MD".into(), "--option.md".into(), "image.png".into(), path.as_os_str().to_owned()];
    assert_eq!(argument_paths(args, &root), vec![path.clone(), path]);
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn requests_survive_startup_and_reads_until_individually_acknowledged() {
    let root = fixture();
    let first = root.join("first.md");
    let second = root.join("second.markdown");
    fs::write(&first, "# One").unwrap();
    fs::write(&second, "# Two").unwrap();
    let files = OpenFiles::default();
    files.enqueue([first.clone(), first.clone(), second]);
    let pending = files.pending();
    assert_eq!(pending.len(), 2);
    assert_eq!(files.pending().len(), 2);
    let opened = files.resolve(pending[0].id).unwrap();
    assert_eq!(PathBuf::from(opened.path), first);
    assert_eq!(PathBuf::from(opened.root), root);
    files.acknowledge(999);
    assert_eq!(files.pending().len(), 2);
    files.acknowledge(pending[0].id);
    assert!(files.resolve(pending[0].id).is_err());
    files.enqueue([first]);
    assert_eq!(files.pending().len(), 2);
    assert!(files.pending()[1].id > pending[1].id);
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn only_existing_markdown_files_resolve_and_unknown_requests_cannot_read_paths() {
    let root = fixture();
    let files = OpenFiles::default();
    fs::create_dir(root.join("folder.md")).unwrap();
    files.enqueue([root.join("missing.md"), root.join("folder.md"), root.join("image.png"), PathBuf::from("relative.md")]);
    assert_eq!(files.pending().len(), 2);
    for request in files.pending() { assert!(files.resolve(request.id).is_err()); }
    assert!(files.resolve(42).is_err());
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn file_urls_decode_unicode_spaces_and_literal_percent_once() {
    let root = fixture();
    let path = root.join("café #1%20.mkd");
    fs::write(&path, "# URL file").unwrap();
    let url = tauri::Url::from_file_path(&path).unwrap();
    let decoded = url.to_file_path().unwrap();
    assert_eq!(decoded.file_name(), path.file_name());
    let files = OpenFiles::default();
    files.enqueue([decoded]);
    let opened = files.resolve(files.pending()[0].id).unwrap();
    assert_eq!(PathBuf::from(opened.path), path);
    assert!(tauri::Url::parse("https://example.com/file.md").unwrap().to_file_path().is_err());
    fs::remove_dir_all(root).unwrap();
  }
}
