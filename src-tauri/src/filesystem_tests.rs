use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);

struct Fixture(PathBuf);

impl Fixture {
  fn new() -> Self {
    let id = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let path = std::env::temp_dir().join(format!("mdreader-files-{}-{nanos}-{id}", std::process::id()));
    fs::create_dir(&path).unwrap();
    Self(path.canonicalize().unwrap())
  }

  fn root(&self) -> String { self.0.to_string_lossy().into_owned() }

  fn create(&self, parent: &str, name: &str, directory: bool) -> String {
    create_item(self.root(), parent.into(), name.into(), directory).unwrap()
  }
}

impl Drop for Fixture {
  fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

#[test]
fn native_file_workflow_preserves_paths_content_and_search() {
  let fixture = Fixture::new();
  let folder = fixture.create(&fixture.root(), "Notes & café", true);
  let nested = fixture.create(&folder, "nested", true);
  let original = fixture.create(&nested, "hello #1%.md", false);
  let contents = "\u{feff}# Hello\r\n\r\nWindows and macOS café\r\n";
  let stamp = write_text_file(fixture.root(), original.clone(), contents.into()).unwrap();
  assert_eq!(stamp.size, contents.len() as u64);
  assert_eq!(read_text_file(fixture.root(), original.clone()).unwrap(), contents);
  let listing = list_folder(fixture.root()).unwrap();
  assert_eq!(listing.root, fixture.root());
  let item = listing.entries.iter().find(|entry| entry.path == original).unwrap();
  assert_eq!(item.name, "hello #1%.md");
  assert_eq!(Path::new(&item.relative_path), Path::new("Notes & café").join("nested").join("hello #1%.md"));
  assert_eq!(resolve_document_path(fixture.root(), original.clone()).unwrap(), original);
  let found = search_folder(fixture.root(), "windows".into()).unwrap();
  assert_eq!(found.len(), 1);
  assert_eq!(found[0].path, original);
  assert_eq!(found[0].line, 3);

  let renamed = rename_item(fixture.root(), original, "renamed.md".into()).unwrap();
  let moved = move_item(fixture.root(), renamed.clone(), folder.clone()).unwrap();
  assert!(!Path::new(&renamed).exists());
  assert_eq!(Path::new(&moved), Path::new(&folder).join("renamed.md"));
  let duplicate = duplicate_item(fixture.root(), moved.clone()).unwrap();
  assert_eq!(read_text_file(fixture.root(), duplicate).unwrap(), contents);
  let renamed_folder = rename_item(fixture.root(), folder, "Renamed folder".into()).unwrap();
  assert_eq!(fs::read_to_string(Path::new(&renamed_folder).join("renamed.md")).unwrap(), contents);
}

#[test]
fn native_commands_reject_outside_roots_and_existing_destinations() {
  let fixture = Fixture::new();
  let outside = Fixture::new();
  let file = fixture.create(&fixture.root(), "existing.md", false);
  fs::write(&file, "do not overwrite").unwrap();
  assert!(create_item(fixture.root(), fixture.root(), "existing.md".into(), false).is_err());
  assert!(create_item(fixture.root(), outside.root(), "outside.md".into(), false).is_err());
  assert!(create_item(fixture.root(), fixture.root(), "../outside.md".into(), false).is_err());
  assert!(list_folder(file.clone()).is_err());
  assert!(resolve_document_path(fixture.root(), outside.root()).is_err());
  assert!(resolve_document_path(fixture.root(), fixture.root()).is_err());
  let second = fixture.create(&fixture.root(), "second.md", false);
  assert!(rename_item(fixture.root(), second, "existing.md".into()).is_err());
  assert!(rename_item(fixture.root(), fixture.root(), "outside".into()).is_err());
  assert_eq!(fs::read_to_string(file).unwrap(), "do not overwrite");
}

#[test]
fn windows_names_reject_device_names_streams_and_normalization_aliases() {
  for name in ["CON", "con.md", "AUX.txt", "NUL.tar.gz", "PRN", "LPT9.md", "COM1", "COM¹.txt", "CONIN$", "CONOUT$",
    "note.md:stream", "has?question", "has*star", "has|pipe", "has<angle>", "quote\"", "trailing.", "trailing ", "control\u{1}"] {
    assert!(validate_item_name(name, true).is_err(), "accepted Windows name {name:?}");
  }
  for name in ["COM10.md", "console.md", "Notes & café", "hello #1%.md", ".hidden", "中.md"] {
    assert!(validate_item_name(name, true).is_ok(), "rejected valid name {name:?}");
  }
  for name in ["", ".", "..", "../file", "sub/file", "sub\\file", "null\0file"] {
    assert!(validate_item_name(name, false).is_err());
    assert!(validate_item_name(name, true).is_err());
  }
  assert!(validate_item_name("legal:posix?.md", false).is_ok());
}

#[cfg(unix)]
#[test]
fn creation_does_not_follow_a_dangling_destination_symlink() {
  let fixture = Fixture::new();
  let outside = Fixture::new();
  let destination = outside.0.join("must-not-be-created.md");
  std::os::unix::fs::symlink(&destination, fixture.0.join("link.md")).unwrap();
  assert!(create_item(fixture.root(), fixture.root(), "link.md".into(), false).is_err());
  assert!(!destination.exists());
}

#[cfg(windows)]
#[test]
fn windows_canonical_identity_and_case_only_rename() {
  let fixture = Fixture::new();
  let file = fixture.create(&fixture.root(), "ReadMe.md", false);
  assert!(file.starts_with(r"\\?\"));
  let ordinary = dunce::simplified(Path::new(&file)).to_string_lossy().into_owned();
  assert_eq!(resolve_document_path(fixture.root(), ordinary).unwrap(), file);
  let renamed = rename_item(fixture.root(), file, "README.md".into()).unwrap();
  let listing = list_folder(fixture.root()).unwrap();
  assert!(listing.entries.iter().any(|entry| entry.name == "README.md" && entry.path == renamed));
}

#[cfg(windows)]
#[test]
fn windows_native_creation_rejects_reserved_names_and_alternate_streams() {
  let fixture = Fixture::new();
  for name in ["CON.md", "aux.txt", "file.md:stream", "trailing."] {
    assert!(create_item(fixture.root(), fixture.root(), name.into(), false).is_err());
  }
  assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
}

#[cfg(windows)]
#[test]
fn windows_extended_length_paths_round_trip() {
  let fixture = Fixture::new();
  let mut parent = fixture.root();
  for index in 0..8 {
    parent = fixture.create(&parent, &format!("folder-{index}-{}", "x".repeat(35)), true);
  }
  let file = fixture.create(&parent, "long.md", false);
  assert!(file.len() > 260);
  write_text_file(fixture.root(), file.clone(), "long path\r\n".into()).unwrap();
  assert_eq!(read_text_file(fixture.root(), file.clone()).unwrap(), "long path\r\n");
  assert!(list_folder(fixture.root()).unwrap().entries.iter().any(|entry| entry.path == file));
}
