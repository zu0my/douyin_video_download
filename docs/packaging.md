# Desktop packaging

Tauri merges the base configuration in `src-tauri/tauri.conf.json` with the
configuration for the host platform. Build each installer on its native host;
this is required for the macOS WebKit and signing toolchain, and avoids
shipping Linux packages linked against an incompatible distribution.

| Host                    | Command                                                                                      | Output                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Windows 10/11           | `pnpm package:windows`                                                                       | `src-tauri/target/release/bundle/nsis/` and `msi/`              |
| macOS 11+               | `pnpm package:macos`                                                                         | `src-tauri/target/release/bundle/macos/` and `dmg/`             |
| macOS, universal binary | `rustup target add aarch64-apple-darwin x86_64-apple-darwin && pnpm package:macos:universal` | macOS and DMG bundle directories                                |
| Debian/Ubuntu or Fedora | `pnpm package:linux`                                                                         | `src-tauri/target/release/bundle/deb/`, `rpm/`, and `appimage/` |

## Required host setup

All hosts need Node.js 20+, Corepack/Pnpm, and stable Rust. Run `pnpm install
--frozen-lockfile` before packaging.

- Windows: the bundled WebView2 bootstrapper is included in the installer and
  downloads the runtime on machines where it is missing.
- macOS: install Xcode command-line tools with `xcode-select --install`.
  The resulting app is unsigned unless a Developer ID signing identity and
  notarization credentials are configured in the build environment.
- Linux (Debian/Ubuntu): install `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
  `libayatana-appindicator3-dev`, `libdbus-1-dev`, `pkg-config`,
  `librsvg2-dev`, and the normal C/Rust build toolchain. Use a current distro
  to produce the `deb`/`AppImage` artifacts; use Fedora to produce the `rpm`
  when possible.

## Signing boundaries

The repository intentionally contains no certificates or signing credentials.
Configure signing only in the release environment:

- Windows: add a code-signing certificate and set `bundle.windows` signing
  values or a `signCommand`.
- macOS: provide the Developer ID signing identity, then notarize the finished
  `.dmg` before distribution.

Keep the Windows WiX `upgradeCode` unchanged after the first public release;
changing it makes Windows treat a new release as a different application.

## GitHub Actions

`.github/workflows/build-desktop.yml` builds the following native artifacts
when manually started from the Actions tab or when a `v*` tag is pushed:

| Artifact                         | GitHub runner      | Target                      |
| -------------------------------- | ------------------ | --------------------------- |
| `douyin-archive-windows-x64`     | `windows-latest`   | `x86_64-pc-windows-msvc`    |
| `douyin-archive-macos-x64`       | `macos-13`         | `x86_64-apple-darwin`       |
| `douyin-archive-macos-arm64`     | `macos-14`         | `aarch64-apple-darwin`      |
| `douyin-archive-macos-universal` | `macos-14`         | `universal-apple-darwin`    |
| `douyin-archive-linux-x64`       | `ubuntu-24.04`     | `x86_64-unknown-linux-gnu`  |
| `douyin-archive-linux-arm64`     | `ubuntu-24.04-arm` | `aarch64-unknown-linux-gnu` |

Each artifact is retained for 30 days. The workflow generates unsigned
installers only; configure code-signing and notarization secrets before making
the artifacts available as public downloads. Windows ARM64 is deliberately not
included because the standard GitHub-hosted Windows runner is x64; add it only
when an ARM64 Windows runner is available to the repository.
