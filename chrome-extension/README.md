# Douyin Archive Companion

Manifest V3 extension for the local Douyin Archive desktop app.

## Install

1. Start the desktop app.
2. For a release build, extract
   `DouyinArchiveCompanion-<version>.zip`. For development, use this
   `chrome-extension` directory directly.
3. Open `chrome://extensions`.
4. Enable Developer mode and choose **Load unpacked**.
5. Select the extracted release directory or this development directory.

The release build also produces a CRX3 file. It is for managed deployment
scenarios; ordinary Chrome users should install the extracted ZIP because
Chrome does not reliably allow direct local CRX installation.

## Permissions

- `cookies`: reads cookies for `*.douyin.com` only.
- `alarms`: performs the daily fallback sync and cookie-change debounce.
- `storage`: stores the installation fallback ID and last sync time locally.
- `tabs`: identifies the active Douyin user page in the popup.

The extension sends data only to `http://127.0.0.1:32145`, with no pairing or account-profile detection. If the app detects a likely expired Cookie, the extension's one-minute local poll synchronizes the current browser Cookie and triggers an immediate monitor retry; repeated retries are throttled for 15 minutes.
