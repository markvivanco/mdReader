# Windows acceptance checks

The implementation and automated tests cover Windows paths, shortcuts and file
operations. A passing macOS run does **not** verify WebView2, Windows dialogs, or
an installer. Run this checklist on Windows before claiming a verified release.

## Build and automated tests

Follow the [Windows prerequisites](../README.md#windows-development-setup), then:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml
pnpm exec tauri build --bundles nsis msi -- --locked
```

The `Desktop checks and Windows installers` GitHub Actions workflow runs these
checks on native Windows x64 and retains unsigned installers as workflow artifacts.
It also runs regression checks on macOS. It does not publish a GitHub release,
sign installers, or perform the manual checks below.

Windows-only Rust tests exercise actual extended-length paths longer than 260
characters, canonical versus ordinary drive paths, case-only renames, and
reserved filenames/alternate data streams. Other filesystem tests exercise
create, read, save, search, rename, move and duplicate against disposable files.

## Disposable fixture

This PowerShell example creates a fresh folder under the temporary directory.
It does not alter existing documents. Save `$fixture` so you can select it in the app.

```powershell
$fixture = Join-Path $env:TEMP ("mdreader-check-" + [guid]::NewGuid())
$nested = Join-Path $fixture 'Notes & spaces\nested'
New-Item -ItemType Directory -Path $nested -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $fixture 'destination') | Out-Null
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$text = "# Windows test`r`n`r`n[Next](../second.md)`r`n`r`n![Local image](../sample.svg)`r`n"
[System.IO.File]::WriteAllText((Join-Path $nested 'first.md'), $text, $utf8Bom)
[System.IO.File]::WriteAllText((Join-Path $fixture 'Notes & spaces\second.md'), "# Second`r`n", $utf8Bom)
[System.IO.File]::WriteAllText((Join-Path $fixture 'Notes & spaces\sample.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>')
$fixture
```

## Manual checks

| Area | Check and expected result |
| --- | --- |
| Installation | Install and launch each generated installer on a clean Windows machine. Verify the installed app and icon, then uninstall. Check WebView2 installation when missing. |
| Folder tree | Open the fixture. Nested entries appear inside their parents; filtering preserves ancestor folders. Refresh keeps the tree usable. |
| Paths | Use spaces, Unicode, `#` and `%` in filenames. Test a drive root, a folder with a long path, and an accessible UNC share. Keep long-path OS-handler limitations separate from native read/save results. |
| Identity | Open one file via tree, search and a relative link. They select one tab. If available, use a case-sensitive Windows directory containing both `a.md` and `A.md`; they must remain separate. |
| Editing | Edit both Preview and Raw, save, and verify BOM/CRLF preservation. Exercise math and footnote input with pending edits before saving or switching tabs. |
| Keyboard | Ctrl+N/F/S/W/P perform app actions. Ctrl+W with no tab does not close the window. AltGr typing must not trigger actions. Labels say Ctrl, not Command. |
| Links/images | Follow `../second.md`; render the local SVG and an encoded-space image path. Test `file:///C:/...` and `file://server/share/...` where available. An HTTP URL ending in `.md` opens the browser. |
| File management | Create files/folders, duplicate, rename a file with only capitalization changed, and drag a folder into `destination`. Open descendant tabs and their unsaved edits must survive rename/move; a similarly named sibling must remain unchanged. |
| Invalid names | Try `CON.md`, `aux.txt`, `file.md:stream`, `a?b.md`, and a folder ending in `.`. The app reports an error and creates nothing. |
| Recycle Bin | Recycle disposable local files/directories, including a dirty descendant tab. Cancel leaves the item intact. Confirm the item reaches the Recycle Bin. UNC shares report that local recycling is unavailable; they are not permanently deleted. |
| Search/polling | Search saved content and unsaved current-file edits. Edit externally in another editor; check clean reload and dirty conflict choices. |
| Print | Print/save PDF with unsaved edits, local images, Mermaid and front matter. The PDF includes only the active document. Leave the dialog open, then cancel; a second print still works. |
| Quit | Close via the title-bar X and Alt+F4 with multiple dirty tabs. Exercise save, discard, cancel, and a save failure (read-only file). Cancel/failure must keep the app open. |
| Display | Check 100%, 150%, and 200% scaling, light/dark themes, window resizing, and a non-English keyboard layout. |

## Record verification

For each tested build record the Git commit, Windows version/architecture, WebView2
version, filesystem type, CI run URL, installer filename/hash, and failed checklist
items. Mark network shares, ARM64, or other unavailable environments as **not tested**.
Do not include private document contents or credentials in a public test report.

Local smoke testing was performed on macOS. Native Windows x64 CI has passed
37 TypeScript and 16 Rust tests. Check the exact revision's CI result for installer
build status; manual installer/UI acceptance remains pending this checklist.
