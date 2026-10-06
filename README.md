# mdReader

mdReader is a desktop Markdown reader, editor, and file manager for **macOS and Windows**, built with **Tauri 2, React, TypeScript, and Rust**. Open a local folder, read documents in tabs, switch between visual and source editing, search your notes, and print the active document or save it as PDF.

Documents remain ordinary files on your filesystem. There is no account, application backend, database, API key, or cloud service to configure.

**Status:** early desktop application. Windows compatibility has automated regression coverage and a native Windows CI/build workflow; installer and WebView2 UI acceptance must still be verified on Windows. Linux and mobile are unverified. The current code has unresolved security findings. Read [Security and privacy](#security-and-privacy), [Publication review](#publication-review), and the [Windows acceptance checklist](docs/WINDOWS_TESTING.md) before distributing a build.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation and setup](#installation-and-setup)
- [Using mdReader](#using-mdreader)
- [Markdown support](#markdown-support)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Development commands](#development-commands)
- [Building and installing the desktop app](#building-and-installing-the-desktop-app)
- [Configuration](#configuration)
- [Architecture and source map](#architecture-and-source-map)
- [Data and network behavior](#data-and-network-behavior)
- [Security and privacy](#security-and-privacy)
- [Publication review](#publication-review)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License and third-party assets](#license-and-third-party-assets)

## Features

### Reading and editing

- Open `.md`, `.markdown`, `.mdown`, and `.mkd` files, with case-insensitive extension matching.
- Keep multiple documents open in tabs.
- Start in read-only Preview mode; explicitly enable **Edit** to make changes.
- Use the rich editor in Preview mode or CodeMirror in Raw mode.
- Format headings, emphasis, lists, links, images, tables, quotes, code blocks, math, footnotes, and front matter.
- Render syntax-highlighted code, Mermaid diagrams, KaTeX math, footnotes, and sanitized embedded HTML.
- Fall back to Raw editing when the visual editor cannot safely represent a Markdown construct.
- Follow the operating system's light or dark appearance.

### Files, search, and export

- Browse a selected folder recursively in a collapsible, resizable sidebar, with file-type filtering.
- Create documents and folders; rename, duplicate, drag to move, or send local items to macOS Trash / Windows Recycle Bin.
- Follow relative Markdown links, display local images, and open other file types with their OS handler.
- Search the active document or saved Markdown files below the selected folder.
- Open search results at their matching lines in read-only Raw mode and highlight occurrences.
- Check open files for external changes and review conflicts with unsaved edits.
- Review unsaved documents when closing tabs, changing folders, or quitting.
- Print a snapshot of the active document, including unsaved edits, or save it as PDF through the platform's print dialog.

## Requirements

| Component | Requirement |
| --- | --- |
| Operating system | macOS, or Windows 10/11 with a current WebView2 Runtime. Windows CI targets x64; ARM64 is not verified. |
| Node.js | Use **Node.js 24 LTS** for the documented workflow and TypeScript test runner. |
| Package manager | `pnpm` with support for the committed version-9 lockfile. Verification used pnpm 12. |
| Rust | A current stable Rust toolchain installed through `rustup`, including Cargo. |
| Native toolchain | macOS: Xcode Command Line Tools/Xcode. Windows: Microsoft C++ Build Tools, Windows SDK, and the MSVC Rust toolchain. |
| Git | Required to clone the repository and review changes. |
| Network | Needed initially for dependency downloads, and when documents reference remote images. |

The crate declares `rust-version = "1.77.2"`, but this does not establish that the current locked dependency graph builds on that old toolchain. Use current stable Rust. The repository does not pin Rust through `rust-toolchain.toml`, or Node/pnpm through version-manager files or a `packageManager` field.

Install macOS desktop build tools if needed (skip this command on Windows):

```sh
xcode-select --install
```

For other system prerequisites, consult the [official Tauri documentation](https://v2.tauri.app/start/prerequisites/). Install Node.js from [nodejs.org](https://nodejs.org/en/download), then install pnpm if necessary:

```sh
npm install --global pnpm@12
```

Install Rust using [rustup.rs](https://rustup.rs/). If Rust is already installed:

```sh
rustup update stable
```

Verify the tools in the terminal you will use:

```sh
git --version
node --version
pnpm --version
rustc --version
cargo --version
```

On macOS also run `xcode-select -p` to verify the selected developer tools.

### Windows development setup

Use a native Windows terminal such as PowerShell and a local writable checkout. WSL builds a Linux application; use native Windows tools for the Windows app.

1. Install Git, Node.js 24, and pnpm using the instructions above.
2. Install **Microsoft C++ Build Tools** with the **Desktop development with C++** workload, including the MSVC compiler and a Windows SDK.
3. Install or update **Microsoft Edge WebView2 Runtime**. mdReader uses WebView2 to render its Windows UI.
4. Install Rust through the Windows installer from [rustup.rs](https://rustup.rs/), selecting the MSVC toolchain. Reopen PowerShell after installation.

For an x64 Windows development machine:

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustup update stable
rustc -vV
node --version
pnpm --version
```

The Rust host should be `x86_64-pc-windows-msvc`. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows) for platform setup. Windows ARM64 requires matching tooling and separate acceptance testing.

Then follow the same clone, install, and `pnpm desktop` commands below. If PowerShell blocks the npm/pnpm `.ps1` shim, use `npm.cmd` / `pnpm.cmd`, or Command Prompt; changing machine-wide execution policy is not required.

## Installation and setup

### 1. Clone the repository

```sh
git clone https://github.com/markvivanco/mdReader.git
cd mdReader
```

While the repository is private, cloning requires an account with access. Once public, its HTTPS clone does not require repository credentials.

### 2. Install dependencies

```sh
pnpm install --frozen-lockfile
```

Keep `pnpm-lock.yaml` and `src-tauri/Cargo.lock` under version control. A frozen install reproduces the locked JavaScript versions and fails if the manifest and lockfile disagree. The initial native build downloads Rust dependencies automatically.

**No `.env` file is required.** There are no database migrations, API endpoints, authentication providers, or service credentials to configure.

### 3. Run the desktop application

```sh
pnpm desktop
```

This runs `tauri dev`. Tauri starts Vite with `pnpm dev --port 1420`, loads `http://localhost:1420` in its native window, and builds the Rust application. The first native build can take longer than subsequent launches.

Choose **Open a Folder** in the application and select a folder of Markdown documents. The app does not automatically open the repository from which it was launched.

### 4. Verify the development setup

```sh
pnpm test
pnpm lint
pnpm check
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

See [Testing](#testing) for coverage and manual checks.

### Frontend-only development

```sh
pnpm dev
```

Open the URL Vite prints to inspect the frontend shell and styling. A normal browser does not provide the Tauri bridge: folder dialogs, filesystem operations, native printing, and desktop quit handling require `pnpm desktop`.

Similarly, `pnpm build` followed by `pnpm preview` serves compiled frontend assets for inspection. It does not provide a fully functional browser edition of mdReader.

## Using mdReader

### Browse folders and tabs

Choose **Open a Folder**, then select a Markdown file in the sidebar. Each document opens in a tab. Selecting a non-Markdown file hands it to the operating system's associated application.

Enumeration excludes dot-prefixed files/directories, `node_modules`, and `target`. It does not interpret `.gitignore`. Use the refresh button after another program adds, removes, or renames files; content polling for open documents is separate from tree refresh.

The extension filter supports selecting and deselecting file types. Parent folders remain visible for matching descendants. Drag the sidebar boundary to resize it between 220 and 520 pixels.

### Read, edit, and save

Files open read-only. **Preview** displays formatted content; **Raw** displays source with line numbers. Enable **Edit** to make changes in either mode. Preview editing activates the visual editor and formatting toolbar.

Save using the toolbar, **Command-S** on macOS, or **Ctrl-S** on Windows. Edits are not autosaved. Turning Edit off changes the interaction mode without saving or discarding changes. Switching tabs or modes flushes pending rich-editor changes into the in-memory document.

Rich editing preserves the original BOM, line-ending convention, and surrounding blank-line envelope where supported. Raw editing uses the saved document's LF/CRLF convention. Rich editing is not byte-for-byte source preservation: serialization can normalize Markdown formatting. Use Raw mode when exact syntax matters. Mixed task/plain lists, ordered task lists, non-default ordered-list starts, and raw HTML images have explicit preservation checks that can require Raw editing.

### Manage files

- **New Markdown File**, **Command-N** (macOS), or **Ctrl-N** (Windows) creates a document. With no folder open, the app first asks for one. Names without a recognized Markdown extension receive `.md`.
- New items are created inside the selected directory, beside the selected file, or at the root when nothing is selected.
- Use the sidebar folder button to create a directory.
- Select an item and open its **…** menu for Rename, Duplicate, or Move to Trash / Recycle Bin.
- Duplicates use names ending in ` copy`, ` copy 2`, and so on. Duplication reads saved disk content; save edits first if they should be included.
- Drag an item onto a directory in the tree to move it.
- Trash / Recycle Bin requires confirmation and reviews affected dirty tabs. The `trash_item` command rejects trashing the root itself. Windows UNC shares are explicitly excluded from recycling; manage those files in File Explorer. There is no fallback to permanent deletion.
- On Windows, creation/rename rejects reserved device names (such as `CON.md`), alternate data streams (`file.md:stream`), forbidden characters, and trailing dots/spaces. Case-only renames are supported when the filesystem resolves the destination to the source.
- Native canonical paths retain drive letters, UNC shares, and Windows extended-length prefixes. Renaming or moving a folder updates its open descendant tabs and expanded tree entries, while similarly named siblings remain unchanged.

These actions operate on real files. Review the [symlink limitations](#current-security-limitations) before managing a folder obtained from someone else.

### Search

Press **Command-F** (macOS) or **Ctrl-F** (Windows), or select Search, then choose **Current file** or **Folder**.

Search is case-insensitive, literal substring matching, debounced by 180 ms. Current-file search uses in-memory text, including unsaved edits. Folder search reads saved Markdown files and returns at most 1,000 matches. The sidebar extension filter does not change the folder-search scope.

Selecting a result opens read-only Raw mode, selects the matching line, and highlights occurrences. Rust search columns are UTF-8 byte offsets, so they can differ from visual character columns for non-ASCII text.

### External changes and unsaved work

Every three seconds, open files are checked for modification-time or size changes. Clean documents reload automatically. A document with local edits prompts for **Reload**, discarding local edits, or **Keep My Edits**.

This is polling-based conflict handling. Saving does not recheck a file's version atomically, and writes are not atomic replacement. A change made between checks can still be overwritten. Use backups or version control for important documents.

Closing a dirty tab offers Save, Don't Save, or Cancel. Changing folders reviews existing tabs. Quitting offers **Review & Save**, **Quit Without Saving**, or **Cancel**; review processes dirty documents one at a time. A cancelled or failed save stops quitting.

Unsaved text is held in memory. There is no crash-recovery journal or session restore.

### Print or save PDF

1. Activate the document and select the printer button, **Command-P** (macOS), or **Ctrl-P** (Windows).
2. Wait for images, fonts, and Mermaid diagrams to prepare.
3. Use the print dialog to print or select a PDF destination. On Windows, use **Save as PDF** or **Microsoft Print to PDF**, depending on the available dialog/destinations.

Only the active document is exported. Pending rich-editor edits are included without requiring a disk save. The suggested PDF filename comes from the document name, and front matter is expanded. Image and Mermaid preparation has a 30-second timeout; a failed image can prevent export.

On Windows, the rendered snapshot remains mounted until WebView2 emits `afterprint`, including cancellation. The native Windows print call only queues JavaScript, so its IPC return is not used as a signal to remove printable content.

## Markdown support

| Construct | Behavior |
| --- | --- |
| Common Markdown | Headings, paragraphs, emphasis, quotes, lists, thematic breaks, links, and images. |
| GitHub Flavored Markdown | Tables, task lists, strikethrough, and autolinks through `remark-gfm`. |
| Fenced code | Highlight.js syntax highlighting. Code fences are displayed, not executed by the editor. |
| Mermaid | Fences labelled `mermaid` render as diagrams in the reader and print preview; rich mode exposes a code-block editor. |
| Math | `$...$` inline and `$$...$$` display math through remark/rehype and KaTeX; rich mode includes math insertion/editing. |
| Footnotes | GFM references and definitions, with custom rich-editor nodes and toolbar buttons. |
| YAML front matter | A leading `---` block appears in an expandable panel; the visual editor includes a front-matter plugin. |
| Embedded HTML | Parsed and sanitized in the reader. Unsafe tags/attributes are removed. The visual editor does not provide arbitrary HTML editing. |
| Local images | Resolved relative to the document or from absolute local paths through Tauri's asset protocol. |
| Remote images | HTTP(S) images load from their source, making the reading session use the network. |
| Markdown links | Relative paths, absolute native paths, and `file:` URLs open in tabs if the native read accepts the path. URL query/fragment suffixes are removed before local reads; cross-document heading navigation is not implemented. HTTP(S) URLs ending in `.md` open externally. |
| Other links | Passed to the operating system after path resolution; see security limitations. |

The preview is a Markdown renderer, not an MDX execution environment. Custom JavaScript components, embedded scripts, and complete HTML-page fidelity are not supported features.

Prefer relative URL paths such as `../images/my%20photo.png` to share documents between operating systems. For Windows absolute URLs with encoded characters or fragments, use `file:///C:/Notes/my%20file.md#heading`; for a share use `file://server/share/Notes/file.md`. Literal native paths such as `C:\Notes\file#1%.md` preserve `#` and `%` as filename characters. A leading `//host/...` is treated as an HTTPS network URL; use `file:` or native backslashes for a UNC file path. A single leading `/` in a local reference resolves from the current filesystem drive/share root on Windows.

## Keyboard shortcuts

| macOS | Windows | Action |
| --- | --- | --- |
| **Command-N** | **Ctrl-N** | Create a Markdown file. |
| **Command-F** | **Ctrl-F** | Open search. |
| **Command-S** | **Ctrl-S** | Save the active document. |
| **Command-W** | **Ctrl-W** | Close the active tab. |
| **Command-P** | **Ctrl-P** | Print or save the active document as PDF. |
| **Command-Q** | **Alt-F4** / window close | Native quit request, including unsaved-change review. |
| **Escape** | **Escape** | Dismiss supported dialogs/popovers or cancel an inline editor operation. |

Shortcut labels follow the platform, including inside rich-editor workflows. Ctrl+Alt (AltGr) is excluded from app shortcuts so international keyboard input does not trigger commands. Startup temporarily blocks app shortcuts until the splash screen finishes. Other desktop platforms use Ctrl, but Linux runtime behavior is unverified.

## Development commands

Run commands from the repository root after installing dependencies.

| Command | Purpose |
| --- | --- |
| `pnpm desktop` | Native app with Vite development server. |
| `pnpm tauri dev` | Equivalent direct Tauri development command. |
| `pnpm dev` | Frontend-only Vite server. |
| `pnpm test` | Type-check tests, then run `src/lib/*.test.ts` with Node's test runner. |
| `pnpm lint` | Oxlint with `.oxlintrc.json`. |
| `pnpm check` | TypeScript project checks and Cargo check. |
| `pnpm build` | Type-check and build frontend assets into `dist/`. |
| `pnpm preview` | Serve the built frontend for inspection. |
| `pnpm tauri build` | Build the release desktop application and host-platform bundles. |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | Check native Rust with the committed dependency resolution. |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Run native Rust tests. |
| `pnpm audit` | Query current registry advisories for the locked JavaScript dependencies. |
| `cargo audit --file src-tauri/Cargo.lock` | Query Rust advisories; requires separately installed `cargo-audit`. |

Audit tools are optional development tools, not runtime requirements. Review dependency changes and compatibility before applying upgrades.

## Building and installing the desktop app

```sh
pnpm install --frozen-lockfile
pnpm tauri build
```

Tauri runs `pnpm build`, then builds the release Rust application. `targets: "all"` requests applicable bundle formats for the build host.

Default macOS output is normally under:

```text
src-tauri/target/release/bundle/
├── macos/mdReader.app
└── dmg/                       # DMG when bundling succeeds
```

Explicit Rust targets or `CARGO_TARGET_DIR` change these paths. Use the output paths printed by the build. Copy the generated `.app` into `/Applications`, or install the app from the generated DMG.

The default build targets the host architecture. Universal macOS builds and Linux installers are not verified.

### Windows installers

Run the build on Windows after installing the prerequisites:

```powershell
pnpm exec tauri build --bundles nsis msi -- --locked
```

Default outputs:

```text
src-tauri/target/release/
├── mdreader.exe
└── bundle/
    ├── nsis/*-setup.exe
    └── msi/*.msi
```

The `.exe` setup uses NSIS; `.msi` uses WiX. MSI creation requires Windows and its VBScript optional feature. If WiX reports `failed to run light.exe`, check VBScript availability, or build only `--bundles nsis`. By default, Tauri's installer downloads WebView2's bootstrapper if the runtime is missing, requiring internet access. See [Tauri's installer documentation](https://v2.tauri.app/distribute/windows-installer/) for offline runtime packaging and installer options.

Use `pnpm exec` here to preserve Cargo's `-- --locked` arguments, and list bundle types as separate arguments so PowerShell does not convert a comma-separated list into one space-containing argument.

Installed-app users do not need Node, Rust, pnpm, or C++ build tools. Install and launch each installer on a clean machine and complete [Windows acceptance](docs/WINDOWS_TESTING.md) before distribution. Windows 10/11 x64 is the intended initial target; ARM64 and older Windows versions are not certified by this repository.

### Continuous integration

[`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) runs frontend build/lint/tests and native Rust tests on macOS and Windows for pull requests, pushes to `main`, and manual dispatch. The Windows job also builds NSIS and MSI packages and retains them for 14 days under the workflow's **Artifacts** section as `mdReader-windows-x64-unsigned`. Actions are pinned to commits, permissions are read-only, and repository credentials are not persisted in the checkout.

The workflow must succeed for the revision being tested. Adding it does not establish that a Windows run has passed; manual WebView2/dialog/installer checks remain separate.

The separate `Repository integrity` workflow checks tracked configuration/assets and incoming commit metadata on every push and PR. Its `Verify repository integrity` check is required by the repository's protected-main rules.

### Signing and distribution

CI produces test installers but does not publish releases. No signing identity, notarization configuration, updater, or update feed is configured. A successful build does not establish a signed release. For public macOS binaries, follow Tauri's [macOS signing guide](https://v2.tauri.app/distribute/sign/macos/); for Windows, configure [Windows code signing](https://v2.tauri.app/distribute/sign/windows/) and verify the distributed artifact. Unsigned Windows builds can trigger SmartScreen or organizational security policy.

Keep certificates, private keys, Apple credentials, and future updater secrets outside Git in secure local storage or CI secrets. Development users do not need the distributor's signing credentials.

## Configuration

There is no settings file or required environment configuration. Defaults live in source:

| Location | Controls |
| --- | --- |
| `src-tauri/tauri.conf.json` | Product/version/identifier, window dimensions, build hooks, asset protocol, CSP, icons, bundling. |
| `src-tauri/Cargo.toml` | Native package metadata, Rust edition/toolchain floor, dependencies. |
| `src-tauri/capabilities/default.json` | Main-window core and native-dialog permissions. |
| `package.json` | JavaScript dependencies and scripts. |
| `vite.config.ts` | React integration, strict development port 1420, and build-time splash version injection. |
| `src/store/useAppStore.ts` | Initial in-memory documents, folder, sidebar, and search state. |
| `src/index.css`, `src/App.css`, `src/splash.css` | Appearance, reader/editor styles, print layout, startup animation. |

The application version is **0.1.1**, aligned in Tauri configuration, Cargo, Cargo's lockfile entry, and `package.json`. The splash screen reads the Tauri version. `package.json` keeps `private: true` to prevent accidental npm publication; that flag does not control GitHub visibility. Keep these versions aligned before releases.

The native window defaults to 1440 × 900 with a 980 × 640 minimum. To change development port 1420, update both `build.devUrl` and `build.beforeDevCommand`.

Also update Vite's configured port when changing it. `dragDropEnabled: false` disables Tauri's native file-drop interception so the sidebar's HTML drag/drop works on Windows; it does not add external Explorer drag-in support.

## Architecture and source map

```text
Native window / system webview
  └── React application + in-memory Zustand state
        ├── MarkdownPreview → remark/rehype → sanitized HTML, KaTeX, Mermaid
        ├── RichMarkdownEditor → MDXEditor/Lexical + custom plugins
        ├── RawEditor → CodeMirror
        └── Tauri IPC → Rust → local disk / OS handlers / print dialog
```

| Path | Responsibility |
| --- | --- |
| `index.html`, `src/main.tsx` | HTML entry, splash, version display, React startup. |
| `src/App.tsx` | Folders, tabs, editing/saving, search, file actions, polling, PDF preparation, frontend quit review. |
| `src/components/FileTree.tsx`, `src/lib/fileTree.ts` | Native-path tree construction, navigation, drag/drop. |
| `src/components/MarkdownPreview.tsx` | Markdown pipeline, front matter, images, links, print rendering. |
| `src/components/MermaidDiagram.tsx` | Mermaid configuration, rendering, error display. |
| `src/components/RawEditor.tsx` | Source view, read-only state, search highlights, line jumps. |
| `src/components/RichMarkdownEditor.tsx` | Visual editor, toolbar/plugins, pending-edit flush, Raw fallback. |
| `src/components/rich-editor/` | Math/footnote nodes, nested-editor flush, list/HTML preservation checks. |
| `src/lib/` | State/path helpers, Markdown preservation, quit review, TypeScript tests. |
| `src/store/useAppStore.ts`, `src/types.ts` | Shared state and data types. |
| `src-tauri/src/lib.rs` | Native initialization and filesystem/search/open/print commands. |
| `src-tauri/src/filesystem_tests.rs` | Filesystem round trips, boundaries, names, and Windows-only path/rename tests. |
| `src-tauri/src/quit.rs` | Close/exit state machine, acknowledgements/timeouts, macOS termination hook, Rust tests. |
| `src-tauri/src/main.rs`, `src-tauri/build.rs` | Native executable entry and Tauri build integration. |
| `src-tauri/icons/` | Application icons and source icon images. |
| `public/` | Static build assets, including legacy Font Awesome files. |

Native command groups:

- Reads/search: `list_folder`, `resolve_document_path`, `read_text_file`, `file_stamp`, `search_folder`.
- Writes/file management: `write_text_file`, `create_item`, `rename_item`, `move_item`, `duplicate_item`, `trash_item`.
- OS integration: `open_path`, `print_active_document`.
- Quit: `close_listener_ready`, `close_listener_unready`, `ack_close_request`, `resolve_close_request`.

There is no HTTP API server. The JavaScript shell-plugin dependency is present, but external opening currently uses the custom Rust `open_path` command backed by the Rust `open` crate.

## Data and network behavior

- Documents are local plaintext files; mdReader adds no encryption.
- Tabs, unsaved content, chosen folder, search state, and sidebar state are memory-only and are not restored on restart.
- No application telemetry, analytics SDK, account system, document upload service, or cloud sync is configured in first-party code.
- Remote image hosts can observe ordinary request metadata, including the user's IP address. Images may act as tracking pixels.
- External links and non-Markdown files can invoke other applications through the OS.
- Debug native builds enable Tauri logging; frontend errors also reach the console. Error messages can include local paths. Review diagnostics before sharing them.
- Webview caches, OS print/spool storage, and Trash are platform-controlled. Memory-only app state does not imply that the OS retains no traces.

## Security and privacy

### Existing controls

The reader parses embedded HTML and applies `rehype-sanitize` before math/highlighting transformations. Mermaid uses `securityLevel: 'strict'`. The rich editor suppresses HTML processing and falls back to Raw mode for unsupported constructs.

Most native file operations canonicalize existing paths and check containment against a supplied root. New-item creation validates a single filename and its canonical parent, and exclusively creates files rather than following an existing destination link. Tree listing/search disable symlink following. UI actions confirm trash operations and review unsaved changes during normal close/quit flows.

These controls do not establish complete isolation for hostile documents.

### Current security limitations

1. **Dangling destination symlinks can redirect duplication.** The duplicate-name existence check follows links and treats a link to an absent target as available. The subsequent copy can create a file outside the selected folder. New-item creation now uses exclusive creation, but `duplicate_item` still requires remediation.
2. **Recursive duplication follows nested source symlinks.** The copy helper does not check each descendant against the root. It can copy unrelated local data into the duplicate; cycles or large linked trees can also exhaust resources.
3. **Document links can launch native file handlers.** Clicked non-Markdown links reach `open_path` and `open::that` without a native type/scheme allowlist, root check, or separate execution warning. Impact depends on the destination's OS association and platform protections.
4. **Local image access is broad.** Asset scope is `["**"]`; image resolution does not enforce the chosen root. Accessible external images can be displayed or included in a PDF. This alone does not prove arbitrary secret exfiltration.
5. **CSP is disabled.** `app.security.csp` is `null`, removing a defense against script/network activity if another rendering control fails.
6. **Native commands trust the renderer's root argument.** The folder selection is frontend state, not a native grant. A separately compromised renderer could supply a different root.
7. **Excessive or unsupported input can disrupt the UI.** There is no top-level React error boundary or comprehensive resource limits for reading/rendering/search/copy. Malformed percent escapes in local links/images are now handled without throwing.

Until these are addressed, use trusted documents and directory trees. Avoid untrusted non-Markdown links and file-management actions on untrusted folders. Read-only mode controls editing; it does not isolate rendering, network requests, or link handling.

### Credentials and repository hygiene

No credentials are needed to build or use mdReader. Do not put private credentials in source, public assets, examples, screenshots, or fixtures. Any future frontend configuration, including `VITE_*` values, must be treated as public build content.

Ignore rules exclude environment files, common private-key/signing formats, dependencies, build output, logs, and temporary files. Sanitized `.env.example`/`.env.sample` files may be tracked if needed later. Ignore rules do not remove already tracked content or erase history.

## Publication review

Review date: **2026-10-06**. Application revision: **`6b0cf81`**. This is a dated result, not an ongoing security guarantee.

| Area | Result |
| --- | --- |
| Recognized secrets in tracked snapshot | Gitleaks 8.30.1 reported no leaks. |
| Recognized secrets in local reachable history | Gitleaks with `--all` reported no leaks and 17 scanned commits with changes. The local ref inventory contained 18 reachable commits. |
| Sensitive filenames/private paths | Targeted checks found no tracked environment/key/signing files or private home/LAN path references. |
| JavaScript dependencies | `pnpm audit`: **11 advisories — 3 high, 5 moderate, 3 low**. No dependency upgrades were applied during this documentation review. |
| Rust dependencies | `cargo audit --no-yanked`: **0 vulnerabilities**, **6 unmaintained warnings**, **1 `glib` unsoundness warning**. Yanked-crate checks were not performed. |
| Application security | The path/link findings and configuration limitations above remain unresolved. |
| Licensing | No project license is selected. Full applicable notices for legacy font assets also need to be accounted for before redistribution. |

These are advisory matches, not proof that every affected dependency path is exploitable in this app:

| Locked dependency | Advisory scope | Published severity |
| --- | --- | --- |
| `mermaid` 11.16.0 | Configuration/architecture prototype pollution, CSS injection, XY/radar diagram denial of service; five advisories. | 1 low, 4 moderate |
| `dompurify` 3.4.12 through Mermaid | Two advisories with `IN_PLACE` sanitization/reparsing prerequisites. | 1 low, 1 moderate |
| `js-yaml` 4.3.1 through MDXEditor | Excessive CPU use in YAML merge processing. | High |
| `katex` 0.18.1 and transitive 0.16.47 | Trust restriction bypass requiring existing prototype pollution. | Low |
| `nanoid` 3.3.16 through Vite/PostCSS | Custom-generator infinite loop; development dependency. | High |
| `source-map-js` 1.2.1 through Vite/PostCSS | Indexed-source-map denial of service; development dependency. | High |

Use `pnpm audit --json` for current advisory IDs, dependency paths, and patched ranges. Review upgrades alongside diagram, math, YAML/front-matter, and editor regressions. Rust warnings concern `proc-macro-error`, five `unic-*` crates, and `glib`; cross-platform lockfiles can include dependencies not built on macOS.

Before publication:

- Resolve application findings and dependency alerts, or explicitly limit and document the intended trust model.
- Review remote branches/tags, releases, attached binaries, metadata, issues, and CI logs. The local scan did not audit these remote surfaces, forks, or other clones.
- Choose a project license and account for third-party redistribution notices.
- Re-run redacted secret scanning and dependency audits on the actual revision being published.
- Enable hosting-provider secret scanning/push protection where available and establish a private vulnerability-reporting route.
- Verify signing/notarization and exact download artifacts separately when distributing native builds.

Do not paste credentials into public issues. If a credential is ever committed, revoke/rotate it before relying on file deletion or history cleanup.

## Testing

The 2026-10-06 Windows compatibility work passed 37 TypeScript tests, 17 Rust tests on macOS, lint, the frontend build, and native compile checks using frozen dependencies (`--ignore-scripts`). Native Windows x64 CI also passed the 37 TypeScript tests and 16 Rust tests, including extended-length paths and case-only renames. The frontend build emitted a large-chunk warning. Check the CI run for the exact revision's installer-build status; manual WebView2 UI and installed-app acceptance remain outstanding.

A macOS debug `.app` bundle also built successfully. A native smoke test verified folder selection/nesting, relative-link navigation without duplicate tabs, Raw editing and keyboard save with CRLF verified on disk, creating a filename containing `#`, renaming a folder with open descendant tabs, and clean quitting. It did not exercise Windows or actual PDF output.

TypeScript tests cover document state, Markdown preservation, ordered quit review, POSIX/drive/UNC/extended-length paths, tree construction, component-aware rename/move behavior, encoded/malformed image/link paths, Ctrl/Command/AltGr handling, and print lifecycle cleanup. Rust tests cover native quit coordination and filesystem create/read/write/search/rename/move/duplicate workflows, root boundaries, filename validation, and exclusive creation. Additional Windows-only tests cover native long paths, canonical identity, reserved names, and case-only renames; test counts vary by target.

There is no automated end-to-end suite for native dialogs, actual print output, or full rich-editor interaction. Passing helper/native tests does not verify those interfaces or resolve all security findings. Use the [Windows acceptance checklist](docs/WINDOWS_TESTING.md) with disposable data on the installed app.

For relevant changes, manually check:

1. Supported extensions, opening documents, tabs, and mode changes.
2. Read-only behavior, rich/Raw edits, save, and line endings.
3. Images/links, front matter, lists, tables, code, math, and footnotes.
4. Current-file versus folder search, including unsaved edits.
5. External changes with clean and dirty documents.
6. Create, rename, duplicate, move, and Trash using disposable fixtures.
7. Save/cancel/discard during tab close, folder change, window close, and native quit.
8. PDF output with images, Mermaid, front matter, and unsaved changes.

Use disposable test files rather than important documents for file operations.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing `pnpm`, `cargo`, or `rustc` | Install prerequisites, reopen the terminal, and check `PATH`. |
| Native linker/SDK/developer-directory errors | macOS: check `xcode-select -p`. Windows: install C++ Desktop development, the SDK, and MSVC Rust; reopen the terminal. |
| Windows app shows a blank window or cannot start | Confirm WebView2 Runtime is installed/current, and check the development/build log for errors. |
| PowerShell blocks `pnpm.ps1` | Use `pnpm.cmd` or Command Prompt. |
| Windows MSI build fails at `light.exe` | Check the VBScript optional feature, or build an NSIS installer with `--bundles nsis`. |
| Frozen install fails | Check pnpm compatibility and matching manifest/lockfile revisions. Regenerate a lockfile only for an intended, reviewed dependency change. |
| Native window cannot load frontend | Check port 1420. Vite now fails if it is occupied; free it or update Vite and both Tauri port settings. |
| Browser cannot open folders or save | Use `pnpm desktop` for native features. |
| Missing sidebar item | Check excluded names, active extension filters, permissions, and Refresh. |
| Document cannot open | Check UTF-8 text, supported extension, permissions, and canonical containment in the selected folder. |
| Visual editor requests Raw mode | The construct cannot be safely represented. Use **Edit Raw**. |
| Local image fails | Check its path relative to the document, existence, URL encoding, and permissions. Keep assets alongside documents for portability. |
| Windows absolute link with spaces/fragments fails | Use a `file:///C:/...` URL with percent encoding, or a portable relative path. Literal native paths are treated as filesystem names. |
| PDF export fails/times out | Check all images and Mermaid syntax. Remote images may fail offline; preparation has a 30-second timeout. |
| External edits are delayed | Allow the polling interval; dirty documents prompt for conflicts. Structural tree changes require Refresh. |
| Large-chunk build warning | Editor/diagram dependencies produce large bundles. The warning alone does not mean the build failed. |
| macOS refuses a downloaded build | Verify source, signing, and notarization. A local source build and a signed public release have different trust requirements. |
| Network-share item cannot be recycled | UNC shares do not have a local Recycle Bin; manage the item in File Explorer. |

## Known limitations

- Windows UI and installed-app acceptance remain outstanding; Linux/mobile and Windows ARM64 are unverified.
- No session restore, autosave, automatic backups, database, cloud sync, or app-level encryption.
- No atomic saves or final compare-before-write conflict check.
- No complete security isolation for hostile Markdown, assets, file handlers, or symlink-containing folders.
- No comprehensive byte/file limits for rendering, search, or recursive copies.
- Cross-document heading navigation is not implemented. Native external file handlers and recycling may impose their own path-length/filesystem restrictions.
- Rich editing can normalize formatting or require Raw fallback.
- External structural changes require sidebar refresh.
- No configured file associations, updater, or automated release publishing/signing. CI installer artifacts are unsigned test builds.
- Minimum macOS version, signing, and universal builds are not verified by the existing checks.

## Contributing

Keep changes focused and preserve both lockfiles. Run the development checks. Add meaningful regressions for behavioral changes, especially serialization, file operations, lifecycle handling, and security boundaries.

Bug reports should include the revision/app version, OS version/architecture, WebView2 version on Windows, reproduction steps, and a minimal sanitized Markdown example. Remove personal paths, private document contents, credentials, and image tokens from logs/screenshots. Use a private reporting route for security-sensitive issues once the maintainer configures one.

## License and third-party assets

No project `LICENSE` file is present and Cargo's `license` field is empty. Repository visibility should not be interpreted as an open-source license. The owner must select a license before the documentation can promise reuse rights.

Dependencies retain their own licenses. `public/fonts/` contains Font Awesome Free 5.13.0 files according to embedded SVG headers. The first-party UI does not reference them, but Vite still copies public assets into builds. See the [font inventory](public/fonts/README.md); account for applicable notices before redistributing these files. KaTeX fonts are supplied by its dependency stylesheet.
