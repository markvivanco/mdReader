use serde::Serialize;
use std::{
  fs,
  path::{Path, PathBuf},
  time::UNIX_EPOCH,
};
use walkdir::WalkDir;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
  path: String,
  relative_path: String,
  name: String,
  is_dir: bool,
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

fn ensure_parent_inside(root: &str, path: &str) -> Result<PathBuf, String> {
  let requested = PathBuf::from(path);
  let parent = requested.parent().ok_or("The requested path has no parent.")?;
  let parent = clean_path(root).and_then(|root_path| {
    let canonical = parent
      .canonicalize()
      .map_err(|error| format!("Unable to access destination: {error}"))?;
    if canonical == root_path || canonical.starts_with(&root_path) {
      Ok(canonical)
    } else {
      Err("The requested path is outside the selected folder.".into())
    }
  })?;
  Ok(parent.join(requested.file_name().ok_or("Invalid file name.")?))
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

#[tauri::command]
fn list_folder(root: String) -> Result<Vec<FileEntry>, String> {
  let root_path = clean_path(&root)?;
  let mut entries = Vec::new();
  for item in WalkDir::new(&root_path).follow_links(false).into_iter().filter_entry(should_visit).filter_map(Result::ok) {
    if item.path() == root_path {
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
  Ok(entries)
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
fn create_item(root: String, path: String, directory: bool) -> Result<(), String> {
  let path = ensure_parent_inside(&root, &path)?;
  if path.exists() {
    return Err("An item with that name already exists.".into());
  }
  if directory {
    fs::create_dir(&path).map_err(|error| error.to_string())
  } else {
    fs::write(&path, "").map_err(|error| error.to_string())
  }
}

#[tauri::command]
fn rename_item(root: String, path: String, new_name: String) -> Result<String, String> {
  if new_name.is_empty() || new_name.contains('/') || new_name.contains('\\') {
    return Err("Enter a valid name without path separators.".into());
  }
  let source = ensure_inside(&root, &path)?;
  let destination = source.parent().ok_or("Invalid source path.")?.join(new_name);
  if destination.exists() {
    return Err("An item with that name already exists.".into());
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
    let is_markdown = path.extension().and_then(|value| value.to_str()).map(|ext| matches!(ext.to_lowercase().as_str(), "md" | "markdown" | "mdown" | "mkd")).unwrap_or(false);
    if !item.file_type().is_file() || !is_markdown {
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
  open::that(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn print_active_document(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
  window
    .set_title(&title)
    .map_err(|error| format!("Unable to set the PDF filename: {error}"))?;
  window
    .print()
    .map_err(|error| format!("Unable to open the macOS print dialog: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      list_folder,
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
      print_active_document
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
