# Interview Copilot

A floating, always-on-top AI assistant for live interviews (Cluely-style), built with Electron, React, and Vite. Works on **macOS, Windows, and Linux**.

## Features

- Transparent, frameless overlay window that floats above other apps
- Hidden from screen capture on macOS and Windows (`setContentProtection`); on Linux the window auto-hides while taking screenshots
- One-click full-screen screenshots sent to GPT-4o for analysis
- Chat with pre-meeting context (job description, resume, custom instructions)
- Global shortcut **Ctrl/Cmd + Shift + Space** to show/hide the window (useful since it skips the taskbar/dock)

## Getting started

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
