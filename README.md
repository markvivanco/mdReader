# mdReader

mdReader is a macOS-first native Markdown reader, editor, and file manager built with Tauri 2, React, TypeScript, and Rust.

## Features

- Browse a selected folder and its subfolders in a resizable file tree
- Open Markdown documents in tabs
- Toggle every tab between rendered Preview and editable Raw modes
- GitHub Flavored Markdown: tables, task lists, autolinks, strikethrough, and fenced code
- Syntax-highlighted code, Mermaid diagrams, KaTeX math, footnotes, YAML front matter, and sanitized embedded HTML
- Relative local images, assets, and Markdown links
- Search the active document or every Markdown file below the selected folder
- Open a search result at its matching line and highlight all occurrences
- Create, rename, move, duplicate, and move files or folders to macOS Trash
- Detect external file changes and protect unsaved edits from conflicts
- Print or save the rendered active tab as PDF
- Native light and dark appearances

## Development

Requirements:

- macOS
- Node.js 24 or later
- pnpm
- Rust stable

```sh
pnpm install
pnpm desktop
```

Useful checks:

```sh
pnpm check
pnpm lint
pnpm build
```

Create a macOS bundle:

```sh
pnpm tauri build
```

## Safety

Raw HTML is sanitized before rendering. Filesystem commands are constrained to the folder selected by the user. Delete operations use the operating system Trash rather than permanent deletion.
