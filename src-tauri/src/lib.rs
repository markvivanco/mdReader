use serde::Serialize;
use std::{
  fs,
  path::{Path, PathBuf},
  time::UNIX_EPOCH,
};
use walkdir::WalkDir;

mod quit;
mod open_files;
#[cfg(test)]
mod filesystem_tests;

use quit::{CloseDecision, QuitCoordinator};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
  path: String,
  relative_path: String,
  name: String,
  is_dir: bool,
}

#[derive(Serialize)]
struct FolderListing {
  root: String,
  entries: Vec<FileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStamp {
  modified_ms: u128,
  size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMatch {
  path: String,
  relative_path: String,
  line: usize,
  column: usize,
  excerpt: String,
}

fn clean_path(value: &str) -> Result<PathBuf, String> {
  PathBuf::from(value)
    .canonicalize()
    .map_err(|error| format!("Unable to access {value}: {error}"))
}

fn ensure_inside(root: &str, path: &str) -> Result<PathBuf, String> {
  let root = clean_path(root)?;
  let path = clean_path(path)?;
  if path == root || path.starts_with(&root) {
    Ok(path)
  } else {
    Err("The requested path is outside the selected folder.".into())
  }
}

fn validate_item_name(name: &str, windows: bool) -> Result<(), String> {
  if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
    return Err("Enter a valid name without path separators.".into());
  }
  if windows {
    let stem = name.split('.').next().unwrap_or("").trim_end().to_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
      || ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|suffix| {
          matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")
        })
      });
    if reserved || name.ends_with(['.', ' '])
      || name.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c)) {
      return Err("Windows names cannot use reserved device names, control characters, <>:\"|?*, or end in a dot or space.".into());
    }
  }
  Ok(())
}

fn copy_recursively(source: &Path, destination: &Path) -> Result<(), String> {
  if source.is_dir() {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
      let entry = entry.map_err(|error| error.to_string())?;
      copy_recursively(&entry.path(), &destination.join(entry.file_name()))?;
    }
  } else {
    fs::copy(source, destination).map_err(|error| error.to_string())?;
  }
  Ok(())
}

fn should_visit(entry: &walkdir::DirEntry) -> bool {
  if entry.depth() == 0 {
    return true;
  }
  let name = entry.file_name().to_string_lossy();
  !name.starts_with('.') && name != "node_modules" && name != "target"
}

fn is_markdown_path(path: &Path) -> bool {
  path.extension().and_then(|value| value.to_str())
    .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown" | "mkd"))
    .unwrap_or(false)
}

#[tauri::command]
fn list_folder(root: String) -> Result<FolderListing, String> {
  let root_path = clean_path(&root)?;
  if !root_path.is_dir() {
    return Err("The selected path must be a folder.".into());
  }
  let mut entries = Vec::new();
  for item in WalkDir::new(&root_path).follow_links(false).into_iter().filter_entry(should_visit).filter_map(Result::ok) {
    if item.path() == root_path || (!item.file_type().is_dir() && !is_markdown_path(item.path())) {
      continue;
    }
    let relative = item.path().strip_prefix(&root_path).map_err(|error| error.to_string())?;
    entries.push(FileEntry {
      path: item.path().to_string_lossy().into_owned(),
      relative_path: relative.to_string_lossy().into_owned(),
      name: item.file_name().to_string_lossy().into_owned(),
      is_dir: item.file_type().is_dir(),
    });
  }
  entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.relative_path.to_lowercase().cmp(&b.relative_path.to_lowercase())));
  Ok(FolderListing { root: root_path.to_string_lossy().into_owned(), entries })
}

#[tauri::command]
fn resolve_document_path(root: String, path: String) -> Result<String, String> {
  let path = ensure_inside(&root, &path)?;
  if !path.is_file() {
    return Err("The selected path must be a file.".into());
  }
  Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_text_file(root: String, path: String) -> Result<String, String> {
  fs::read_to_string(ensure_inside(&root, &path)?).map_err(|error| format!("Unable to read file: {error}"))
}

#[tauri::command]
fn write_text_file(root: String, path: String, contents: String) -> Result<FileStamp, String> {
  let path = ensure_inside(&root, &path)?;
  fs::write(&path, contents).map_err(|error| format!("Unable to save file: {error}"))?;
  file_stamp(root, path.to_string_lossy().into_owned())
}

#[tauri::command]
fn file_stamp(root: String, path: String) -> Result<FileStamp, String> {
  let metadata = fs::metadata(ensure_inside(&root, &path)?).map_err(|error| error.to_string())?;
  let modified_ms = metadata
    .modified()
    .map_err(|error| error.to_string())?
    .duration_since(UNIX_EPOCH)
    .map_err(|error| error.to_string())?
    .as_millis();
  Ok(FileStamp { modified_ms, size: metadata.len() })
}

#[tauri::command]
fn create_item(root: String, parent: String, name: String, directory: bool) -> Result<String, String> {
  validate_item_name(&name, cfg!(windows))?;
  let parent = ensure_inside(&root, &parent)?;
  let path = parent.join(name);
  if directory {
    fs::create_dir(&path).map_err(|error| error.to_string())?;
  } else {
    // Exclusive creation also rejects an existing dangling symlink.
    fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|error| error.to_string())?;
  }
  Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn rename_item(root: String, path: String, new_name: String) -> Result<String, String> {
  validate_item_name(&new_name, cfg!(windows))?;
  let source = ensure_inside(&root, &path)?;
  if source == clean_path(&root)? {
    return Err("The selected root folder cannot be renamed.".into());
  }
  let destination = source.parent().ok_or("Invalid source path.")?.join(new_name);
  if let Ok(metadata) = fs::symlink_metadata(&destination) {
    // Case-only renames on ordinary Windows/macOS volumes address the source
    // itself. Never overwrite a different file, including in case-sensitive dirs.
    if metadata.file_type().is_symlink() || destination.canonicalize().ok().as_ref() != Some(&source) {
      return Err("An item with that name already exists.".into());
    }
  }
  fs::rename(&source, &destination).map_err(|error| error.to_string())?;
  Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn move_item(root: String, path: String, destination_dir: String) -> Result<String, String> {
  let source = ensure_inside(&root, &path)?;
  let destination_dir = ensure_inside(&root, &destination_dir)?;
  if !destination_dir.is_dir() {
    return Err("The destination must be a folder.".into());
  }
  if destination_dir.starts_with(&source) {
    return Err("A folder cannot be moved into itself.".into());
  }
  let destination = destination_dir.join(source.file_name().ok_or("Invalid source path.")?);
  if destination.exists() {
    return Err("An item with that name already exists at the destination.".into());
  }
  fs::rename(&source, &destination).map_err(|error| error.to_string())?;
  Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn duplicate_item(root: String, path: String) -> Result<String, String> {
  let source = ensure_inside(&root, &path)?;
  let parent = source.parent().ok_or("Invalid source path.")?;
  let stem = source.file_stem().and_then(|value| value.to_str()).unwrap_or("copy");
  let extension = source.extension().and_then(|value| value.to_str());
  let mut index = 1;
  let destination = loop {
    let suffix = if index == 1 { " copy".to_string() } else { format!(" copy {index}") };
    let name = match extension {
      Some(ext) if source.is_file() => format!("{stem}{suffix}.{ext}"),
      _ => format!("{stem}{suffix}"),
    };
    let candidate = parent.join(name);
    if !candidate.exists() {
      break candidate;
    }
    index += 1;
  };
  copy_recursively(&source, &destination)?;
  Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn trash_item(root: String, path: String) -> Result<(), String> {
  let path = ensure_inside(&root, &path)?;
  if path == clean_path(&root)? {
    return Err("The selected root folder cannot be moved to Trash.".into());
  }
  #[cfg(windows)]
  {
    use std::path::{Component, Prefix};
    if matches!(path.components().next(), Some(Component::Prefix(prefix))
      if matches!(prefix.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..))) {
      return Err("Network shares do not provide a local Recycle Bin. Manage this item in File Explorer.".into());
    }
  }
  trash::delete(path).map_err(|error| format!("Unable to move item to Trash: {error}"))
}

#[tauri::command]
fn search_folder(root: String, query: String) -> Result<Vec<SearchMatch>, String> {
  if query.trim().is_empty() {
    return Ok(Vec::new());
  }
  let root_path = clean_path(&root)?;
  let needle = query.to_lowercase();
  let mut matches = Vec::new();
  for item in WalkDir::new(&root_path).follow_links(false).into_iter().filter_entry(should_visit).filter_map(Result::ok) {
    let path = item.path();
    if !item.file_type().is_file() || !is_markdown_path(path) {
      continue;
    }
    let Ok(contents) = fs::read_to_string(path) else { continue };
    for (line_index, line) in contents.lines().enumerate() {
      let lowered = line.to_lowercase();
      let mut start = 0;
      while let Some(offset) = lowered[start..].find(&needle) {
        let column = start + offset;
        matches.push(SearchMatch {
          path: path.to_string_lossy().into_owned(),
          relative_path: path.strip_prefix(&root_path).unwrap_or(path).to_string_lossy().into_owned(),
          line: line_index + 1,
          column: column + 1,
          excerpt: line.trim().to_string(),
        });
        start = column + needle.len().max(1);
        if matches.len() >= 1000 {
          return Ok(matches);
        }
      }
    }
  }
  Ok(matches)
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
  // Only simplify a verbatim Windows path when doing so preserves its identity.
  // Keep canonical paths unchanged everywhere in the app's filesystem state.
  open::that(dunce::simplified(Path::new(&path))).map_err(|error| error.to_string())
}

#[tauri::command]
fn print_active_document(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
  window
    .set_title(&title)
    .map_err(|error| format!("Unable to set the PDF filename: {error}"))?;
  window
    .print()
    .map_err(|error| format!("Unable to open the print dialog: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let files = open_files::OpenFiles::default();
  if let Ok(cwd) = std::env::current_dir() {
    files.enqueue(open_files::argument_paths(std::env::args_os(), &cwd));
  }
  let builder = tauri::Builder::default().manage(files);
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
    open_files::receive(app, open_files::argument_paths(args.into_iter().map(Into::into), Path::new(&cwd)));
  }));
  let app = builder
    .manage(QuitCoordinator::default())
    .plugin(tauri_plugin_dialog::init())
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let coordinator = window.state::<QuitCoordinator>();
        let decision = coordinator.request_close();
        if decision != CloseDecision::Allow {
          api.prevent_close();
          if let CloseDecision::PreventAndNotify(request_id) = decision {
            quit::notify_close_request(window.app_handle(), &coordinator, request_id);
          }
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      list_folder,
      resolve_document_path,
      read_text_file,
      write_text_file,
      file_stamp,
      create_item,
      rename_item,
      move_item,
      duplicate_item,
      trash_item,
      search_folder,
      open_path,
      print_active_document,
      open_files::pending_open_files,
      open_files::resolve_open_file,
      open_files::acknowledge_open_file,
      quit::close_listener_ready,
      quit::close_listener_unready,
      quit::ack_close_request,
      quit::resolve_close_request
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let quit_coordinator = app.state::<QuitCoordinator>().inner().clone();
      quit::start_close_watchdog(app.handle(), quit_coordinator.clone())
        .map_err(std::io::Error::other)?;

      #[cfg(target_os = "macos")]
      quit::install_macos_termination_hook(
        app.handle(),
        quit_coordinator,
      )
      .map_err(std::io::Error::other)?;

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    if let tauri::RunEvent::Opened { ref urls } = event {
      open_files::receive(app_handle, urls.iter().filter_map(|url| url.to_file_path().ok()));
    }
    if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
      let coordinator = app_handle.state::<QuitCoordinator>();
      let decision = coordinator.request_exit(code);
      if decision != CloseDecision::Allow {
        api.prevent_exit();
        if let CloseDecision::PreventAndNotify(request_id) = decision {
          quit::notify_close_request(app_handle, &coordinator, request_id);
        }
      }
    }
  });
}
