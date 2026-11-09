# ReelPlay

A cross-platform local video player with a vertical, Reels-style feed. Built with Rust, Tauri 2, Vite and vanilla JavaScript.

## Included in this starter

- Vertical snap-scrolling feed
- Auto-play the visible video and pause off-screen videos
- Import individual videos
- Recursively scan a selected folder
- Favourites stored locally
- Shuffle, seek bar, mute, fullscreen
- Keyboard shortcuts
- Remembers imported file paths in local browser storage

## Requirements

- Rust stable toolchain
- Node.js 20 or newer and npm
- Tauri 2 platform prerequisites:
  - Windows: Microsoft C++ Build Tools and WebView2 Runtime
  - macOS: Xcode Command Line Tools
  - Linux: Tauri's WebKitGTK and system-library prerequisites

See the official Tauri prerequisites guide: https://v2.tauri.app/start/prerequisites/

## Run on Windows

1. Extract the project folder.
2. Install Rust from https://rustup.rs/ if it is not installed.
3. Install Node.js LTS from https://nodejs.org/.
4. Open PowerShell in the extracted `ReelPlay` folder.
5. Run:

```powershell
npm install
npm run dev
```

The first Rust build can take several minutes while dependencies compile.

## Build an installer

```powershell
npm run build
```

Tauri writes platform bundles under:

`src-tauri/target/release/bundle/`

## How to use

- **Add videos** imports one or more files.
- **Import folder** scans the selected folder and its subfolders.
- Scroll inside the feed to move between videos.
- Press Up/Down to move one item, Space to play/pause, M to mute and F for fullscreen.
- Tap the heart to add a video to Favourites.

## Notes and current limitations

- The library stores file paths, not copies of your videos. Moving or deleting a source file will break its saved entry; import it again after moving it.
- Playback depends on codecs available to the operating system webview. MP4 with H.264 video and AAC audio is the safest initial test format. MKV/AVI containers may appear in the picker but may not play.
- This is a starter, not a finished production release. It does not yet generate thumbnails, extract metadata, scan removable drives automatically, or include a database.
- The asset protocol is enabled so the webview can load user-selected local files. Before distributing a production build, tighten file access and review Tauri's security guidance.
- The first version uses a simple localStorage library. A later version should migrate library data and watch progress to SQLite.

## Suggested roadmap

### V0.1 — Starter
Feed, local imports, auto-play, favourites, keyboard controls.

### V0.2 — Library
SQLite database, thumbnails, duration/resolution metadata, resume playback, duplicate detection, missing-file handling.

### V0.3 — Polish
Drag-and-drop, subtitle selection, playback speed, audio track selection, mini-player, better empty/error states.

### V1.0 — Release
Installer signing, app icons, platform testing, accessibility, performance profiling and security review.
