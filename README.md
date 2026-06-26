# Douyin Archive

Tauri + React desktop app for monitoring Douyin user pages and downloading video, image, and mixed-media works incrementally.

## Project Structure

```text
src/                 React frontend
src-tauri/           Tauri and Rust backend
chrome-extension/    Manifest V3 Chrome companion
index.html           Vite entry
vite.config.ts       Vite config
package.json         frontend scripts and dependencies
```

The previous Node CLI code has been removed. The app now starts through Tauri.

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Release Build

Create the extension signing key once on each release machine, then back up the
generated file securely. Do not commit it.

```bash
npm run extension:init-key
npm run release
```

`npm run release` runs type checking and extension tests, builds the Windows
Tauri installers, and packages the Chrome extension. The installer and
extension artifacts are written beneath:

```text
src-tauri/target/release/bundle/
```

The extension artifacts are named
`chrome-extension/DouyinArchiveCompanion-<version>.crx` and
`chrome-extension/DouyinArchiveCompanion-<version>.zip`. The signing key is
stored locally at `.local/douyin-archive-companion.pem`; keeping that file is
required for future releases to retain the same Chrome extension ID.

## Useful Checks

```bash
npm run typecheck
npm run build
cd src-tauri
cargo check
cargo test
```

## Behavior

- Closing the window hides it to the system tray.
- Use the tray menu to show the window or exit the app.
- Cookie values are encrypted with AES-256-GCM before being written to SQLite; the master key is stored in Windows Credential Manager.
- Videos, images, mixed-media assets, manifests, and covers are saved under the app data directory, grouped by stable `sec_user_id`.
- Image and mixed-media works also save their BGM locally; images advance every 4 seconds while video clips advance when playback ends.

## Chrome Extension

1. Start Douyin Archive and keep it running in the tray.
2. Download and extract the release ZIP, or use the repository's `chrome-extension/` directory during development.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted directory.
4. Visit a Douyin user page. Use either the page button or extension popup to add the user to the monitor list.

The extension reads only `douyin.com` cookies and talks only to `http://127.0.0.1:32145`. Cookie changes are debounced and synced automatically, with a daily alarm as a fallback. It uses its installation ID as the fixed Cookie record identity and fails silently while the desktop app is not running. When the desktop app identifies a likely Cookie-expiry error, the extension polls the local bridge once per minute, refreshes the Cookie, and the app immediately retries affected monitors. Repeated automatic retries are throttled for 15 minutes.

Chrome does not reliably allow ordinary users to install local CRX files
directly. The CRX is retained for managed deployments; use the ZIP for the
manual Chrome installation flow above.
