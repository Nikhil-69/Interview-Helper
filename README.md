# RAG-CHAT

A floating, always-on-top AI assistant for live , built with Electron, React, and Vite. Works on **macOS, Windows, and Linux**.

## Features

- One-click full-screen screenshots sent to GPT-4o for analysis
- Chat with pre-meeting context (job description, resume, custom instructions)
- Global shortcut **Ctrl/Cmd + Shift + Space** to show/hide the window (useful since it skips the taskbar/dock)

## Install

Download the latest build for your platform from the [**Releases**](https://github.com/Nikhil-69/Interview-Helper/releases/latest) page.

### Windows

1. Download `Interview-Hack-Setup-<version>.exe`.
2. Run it. If SmartScreen warns about an unrecognized app, click **More info → Run anyway** (the app is unsigned).
3. It installs per-user — no admin rights needed.

### macOS (Apple Silicon)

1. Download `Interview-Hack-<version>-arm64.dmg`, open it, and drag **Interview Hack** to **Applications**.
2. The app is unsigned, so macOS will say *"Interview Hack is damaged and can't be opened."* This is expected — clear the quarantine flag once with:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Interview Hack.app"
   ```

3. Open it normally afterward.

> Only Apple Silicon (M-series) builds are published. There is no Intel build yet.

### Linux

- **AppImage** (recommended — supports auto-update):

  ```bash
  chmod +x Interview-Hack-<version>.AppImage
  ./Interview-Hack-<version>.AppImage
  ```

- **Debian/Ubuntu** (`.deb`):

  ```bash
  sudo apt install ./interview-hack_<version>_amd64.deb
  ```

  Note: `.deb` installs do **not** auto-update — download a newer `.deb` to upgrade.

### Updates

The app checks for updates on launch and every few hours, downloading in the background and prompting you to **Restart to update** (or you can use **Check for updates** in the setup screen). Auto-update works on Windows, the Linux AppImage, and macOS. On macOS the app updates itself in place (no re-download needed) since it is unsigned.

## Getting started (development)

```bash
npm install
npm run start   # runs Vite dev server + Electron together
```

Sign in with your Interview Helper account (email + password). The app talks to the backend in the `interview-helper-server` repo, which holds the OpenAI key, manages credit balances, and logs usage — start it first (`npm run dev` there). Point the app at a different backend with `VITE_API_URL` in a `.env` file (default `http://localhost:4000`).

## Building installers

```bash
npm run dist
```

electron-builder produces platform-specific packages in `release/`:

| Platform | Target |
|----------|--------|
| macOS    | `.dmg` |
| Windows  | NSIS installer (`.exe`) |
| Linux    | `.AppImage` + `.deb` |

Note: each installer is built on its own platform (e.g. run `npm run dist` on Windows to get the `.exe`).

## Platform notes

- **macOS** — screenshots use the native `screencapture` tool; the dock icon is hidden so the window can float over fullscreen apps.
- **Windows** — screenshots use Electron's `desktopCapturer` at native resolution.
- **Linux** — screenshots try native tools first (`gnome-screenshot`, `spectacle`, `grim`, `scrot`, `import`), falling back to `desktopCapturer`. On Wayland the fallback goes through the desktop portal (PipeWire), which may show a one-time permission prompt. **No app-level screen-capture invisibility exists on Linux** — the overlay is visible in full-screen shares. Use panic-hide (**Ctrl+Shift+Space**), move it to an unshared monitor (**Ctrl+Shift+M**), or set up true compositor-level exclusion (KWin / niri) — see [`docs/LINUX_SCREEN_CAPTURE.md`](docs/LINUX_SCREEN_CAPTURE.md).
