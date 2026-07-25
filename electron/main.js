import { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import electronUpdater from 'electron-updater';

// electron-updater is CommonJS; grab autoUpdater off the default export.
const { autoUpdater } = electronUpdater;

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

let mainWindow = null;

// Whether the overlay is excluded from screen capture. Mirrors the renderer's
// persisted `hideFromScreenShare` setting, which re-applies it on launch.
let contentProtection = true;

// Stable window identity so compositor-level rules (e.g. KWin "Hide from
// ScreenCast", niri "block-out-from") can reliably target this window.
// See docs/LINUX_SCREEN_CAPTURE.md. Changing these strings means updating the
// documented compositor rules too.
const WINDOW_TITLE = 'Interview Copilot';
app.setName(WINDOW_TITLE); // influences WM_CLASS on X11 / app_id on Wayland

// "Reduce size" settings toggle shrinks the overlay to this footprint; the
// normal footprint is restored when the toggle is switched off.
const NORMAL_SIZE = { width: 400, height: 750 };
const COMPACT_SIZE = { width: 320, height: 560 };
// Collapsed = just the pill toolbar, no content area (see the "Hide"/"Ask"
// header toggle in App.tsx).
const COLLAPSED_SIZE = { width: 260, height: 64 };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: NORMAL_SIZE.width,
    height: NORMAL_SIZE.height,
    title: WINDOW_TITLE,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Makes window invisible to screen capture. Supported on macOS and Windows;
  // no-op on Linux (window is hidden during screenshots instead, see the
  // 'take-screenshot' handler). Toggleable from Settings — see
  // 'capture:setProtection'.
  mainWindow.setContentProtection(contentProtection);

  // Makes window hover over fullscreen apps and all workspaces
  // (visibleOnFullScreen is macOS-only and ignored elsewhere)
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) {
    mainWindow.setHiddenInMissionControl(true);
  }
  mainWindow.moveTop();

  // Keep the window caption fixed so compositor rules keep matching even when
  // the web page tries to set its own document title.
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(WINDOW_TITLE);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.dock?.hide(); // Crucial for macOS to allow floating over fullscreen apps
app.commandLine.appendSwitch('disable-background-timer-throttling');
if (isLinux) {
  // Required for transparent frameless windows on most Linux compositors
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

// --- Auto-update (GitHub Releases) ------------------------------------------

// Updates download in the background; installation waits for an explicit
// "restart now" from the renderer (or the next app quit) so we never restart
// the overlay mid-interview.
//
// Windows/Linux use electron-updater. macOS gets a custom updater below:
// Squirrel.Mac (what electron-updater delegates to on mac) refuses to install
// into an unsigned app, and we ship without a paid Developer ID cert. So on
// mac we download the release zip ourselves, swap the .app bundle, relaunch.

function sendUpdateStatus(payload) {
  mainWindow?.webContents?.send('updater:status', payload);
}

const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000;

function setupAutoUpdater() {
  if (!app.isPackaged) return; // dev builds have no update metadata

  if (isMac) {
    macCheckForUpdate().catch(() => {});
    setInterval(() => macCheckForUpdate().catch(() => {}), UPDATE_CHECK_INTERVAL);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({ state: 'downloading', version: info.version });
  });
  autoUpdater.on('download-progress', (p) => {
    sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({ state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    // Non-fatal: the app keeps working on the current version.
    console.error('Auto-update error:', err);
    sendUpdateStatus({ state: 'error', message: err?.message || String(err) });
  });

  autoUpdater.checkForUpdates().catch(() => {});
  // Long-running sessions still pick up releases published after launch.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), UPDATE_CHECK_INTERVAL);
}

// --- macOS unsigned-app updater ---------------------------------------------

const GITHUB_REPO = 'Nikhil-69/Interview-Helper';
const macUpdate = { version: null, zipPath: null, busy: false };

function isNewerVersion(candidate, current) {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// Returns the newer version string if one exists (and kicks off the download),
// or null when already up to date.
async function macCheckForUpdate() {
  if (macUpdate.busy) return macUpdate.version;
  if (macUpdate.zipPath) return macUpdate.version; // already downloaded

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'interview-hack-updater' },
  });
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  const release = await res.json();
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!version || !isNewerVersion(version, app.getVersion())) return null;

  // electron-builder names mac zips "<name>-<version>-mac.zip" (x64) and
  // "<name>-<version>-arm64-mac.zip" (Apple Silicon).
  const zips = (release.assets || []).filter((a) => a.name.endsWith('-mac.zip'));
  const wantArm = process.arch === 'arm64';
  const asset =
    zips.find((a) => a.name.includes('arm64') === wantArm) || zips[0];
  if (!asset) throw new Error('No mac zip asset on the latest release');

  macUpdate.busy = true;
  try {
    sendUpdateStatus({ state: 'downloading', version });
    const zipPath = path.join(app.getPath('temp'), `ih-update-${version}.zip`);
    await downloadToFile(asset.browser_download_url, zipPath, (percent) =>
      sendUpdateStatus({ state: 'downloading', version, percent })
    );
    macUpdate.version = version;
    macUpdate.zipPath = zipPath;
    sendUpdateStatus({ state: 'ready', version });
  } catch (err) {
    console.error('Mac update download error:', err);
    sendUpdateStatus({ state: 'error', message: err?.message || String(err) });
    throw err;
  } finally {
    macUpdate.busy = false;
  }
  return version;
}

async function downloadToFile(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': 'interview-hack-updater' } });
  if (!res.ok) throw new Error(`Download failed with ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  let lastPercent = -1;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    received += value.length;
    if (total) {
      const percent = Math.round((received / total) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress?.(percent);
      }
    }
  }
  await fs.promises.writeFile(dest, Buffer.concat(chunks));
}

// Swap the running .app bundle for the downloaded one and relaunch. The old
// bundle is kept beside it until the new one is in place so a failed move can
// be rolled back.
async function macInstallUpdate() {
  if (!macUpdate.zipPath) return;

  const extractDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'ih-update-'));
  await execFileAsync('ditto', ['-xk', macUpdate.zipPath, extractDir]);
  const appName = (await fs.promises.readdir(extractDir)).find((e) => e.endsWith('.app'));
  if (!appName) throw new Error('Update zip did not contain an .app bundle');
  const newApp = path.join(extractDir, appName);

  // process.execPath is <bundle>.app/Contents/MacOS/<bin>
  const currentApp = path.resolve(process.execPath, '..', '..', '..');
  if (!currentApp.endsWith('.app')) throw new Error(`Unexpected app path: ${currentApp}`);

  // Downloads made by the app itself normally carry no quarantine flag, but
  // clear it defensively so Gatekeeper never blocks the relaunch.
  await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', newApp]).catch(() => {});

  const backup = `${currentApp}.old`;
  await execFileAsync('rm', ['-rf', backup]);
  await execFileAsync('mv', [currentApp, backup]);
  try {
    await execFileAsync('mv', [newApp, currentApp]);
  } catch (err) {
    await execFileAsync('mv', [backup, currentApp]); // roll back
    throw err;
  }
  execFileAsync('rm', ['-rf', backup]).catch(() => {});
  fs.promises.unlink(macUpdate.zipPath).catch(() => {});

  app.relaunch();
  app.quit();
}

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return null;
  if (isMac) return macCheckForUpdate();
  const result = await autoUpdater.checkForUpdates();
  const version = result?.updateInfo?.version;
  return version && isNewerVersion(version, app.getVersion()) ? version : null;
});

ipcMain.on('updater:install', () => {
  if (isMac) {
    macInstallUpdate().catch((err) => {
      console.error('Mac update install error:', err);
      sendUpdateStatus({ state: 'error', message: err?.message || String(err) });
    });
  } else {
    autoUpdater.quitAndInstall();
  }
});

ipcMain.handle('app:getVersion', () => app.getVersion());

app.whenReady().then(() => {
  setupAutoUpdater();
  // On Linux, transparent windows render as black if created immediately
  // after ready — the compositor needs a moment to pick up the visuals.
  if (isLinux) {
    setTimeout(createWindow, 300);
  } else {
    createWindow();
  }

  // Since the window skips the taskbar/dock, provide a global shortcut to
  // bring it back after hiding (works on all platforms). This doubles as the
  // "panic hide" — the only fully reliable way to keep the overlay out of a
  // capture on Linux.
  globalShortcut.register('CommandOrControl+Shift+Space', () => toggleStealth());

  // Move the overlay to the next display — on multi-monitor setups this lets
  // you keep the overlay on a monitor that isn't being shared.
  globalShortcut.register('CommandOrControl+Shift+M', () => moveToNextDisplay());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});

// Capture the primary screen via Electron's desktopCapturer (works on
// Windows, X11, and Wayland via the desktop portal).
async function captureWithDesktopCapturer(tmpPath) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const scaleFactor = primaryDisplay.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor),
    },
  });

  if (!sources.length) {
    throw new Error('No screen sources available');
  }

  // Prefer the source matching the primary display, fall back to the first
  const source =
    sources.find((s) => s.display_id === String(primaryDisplay.id)) || sources[0];

  await fs.promises.writeFile(tmpPath, source.thumbnail.toPNG());
}

// Native Linux screenshot tools, tried in order. All capture the full screen
// silently to a file. Used when available since they don't depend on
// PipeWire/portal setup; otherwise we fall back to desktopCapturer.
const LINUX_SCREENSHOT_TOOLS = [
  { cmd: 'gnome-screenshot', args: (file) => ['-f', file] },
  { cmd: 'spectacle', args: (file) => ['-b', '-n', '-o', file] },
  { cmd: 'grim', args: (file) => [file] },
  { cmd: 'scrot', args: (file) => ['-o', file] },
  { cmd: 'import', args: (file) => ['-window', 'root', file] },
];

async function captureLinuxScreenshot(tmpPath) {
  for (const tool of LINUX_SCREENSHOT_TOOLS) {
    try {
      await execFileAsync(tool.cmd, tool.args(tmpPath));
      if (fs.existsSync(tmpPath)) return;
    } catch {
      // Tool missing or failed — try the next one
    }
  }
  await captureWithDesktopCapturer(tmpPath);
}

// IPC handlers
ipcMain.handle('take-screenshot', async () => {
  // setContentProtection(true) already excludes the window from capture on
  // mac/Windows (see createWindow), so hiding it there just flashes the app
  // away and back for no reason. Only Linux — which has no such flag — needs
  // the window made invisible during capture.
  //
  // Use setOpacity(0), not hide()/show(): hide() unmaps the window, and
  // remapping it with show() re-triggers the same "transparent window
  // renders black for a moment" compositor hiccup handled at startup (see
  // createWindow's 300ms delay). Fading opacity instead keeps the window
  // mapped throughout, so there's nothing for the compositor to redraw from
  // scratch — the screen capture still sees nothing (opacity 0 is what
  // composites onto the screen), but there's no black flash on return.
  const needsHide = isLinux && mainWindow;
  if (needsHide) {
    mainWindow.setOpacity(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const tmpPath = path.join(app.getPath('temp'), `${crypto.randomUUID()}.png`);

  try {
    if (isMac) {
      await execFileAsync('screencapture', ['-x', tmpPath]);
    } else if (isWindows) {
      await captureWithDesktopCapturer(tmpPath);
    } else {
      await captureLinuxScreenshot(tmpPath);
    }

    const buffer = await fs.promises.readFile(tmpPath);
    await fs.promises.unlink(tmpPath);

    if (needsHide) {
      mainWindow.setOpacity(1);
    }

    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (err) {
    if (needsHide) mainWindow.setOpacity(1);
    console.error('Screenshot error:', err);
    throw err;
  }
});

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

// --- Stealth / screen-capture protection -----------------------------------

// Instantly show or hide the overlay. Hiding is the only fully reliable way to
// keep the window out of a screen capture on Linux (see getCaptureStatus).
function toggleStealth(forceState) {
  if (!mainWindow) return false;
  const shouldShow =
    typeof forceState === 'boolean'
      ? forceState
      : mainWindow.isMinimized() || !mainWindow.isVisible();

  if (shouldShow) {
    mainWindow.show();
    mainWindow.moveTop();
  } else {
    mainWindow.hide();
  }
  const visible = shouldShow;
  mainWindow.webContents?.send('stealth-changed', visible);
  return visible;
}

// Cycle the overlay across connected displays. On multi-monitor setups this is
// the genuine way to stay invisible on Linux: put the overlay on a monitor you
// are NOT sharing. Note: setBounds does not move windows under a pure Wayland
// session (Wayland forbids apps from setting global coordinates); it works on
// macOS, Windows, and X11 / XWayland.
function moveToNextDisplay() {
  if (!mainWindow) return null;
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return null;

  const bounds = mainWindow.getBounds();
  const current = screen.getDisplayMatching(bounds);
  const idx = displays.findIndex((d) => d.id === current.id);
  const next = displays[(idx + 1) % displays.length];
  const area = next.workArea;

  mainWindow.setBounds({
    x: Math.round(area.x + (area.width - bounds.width) / 2),
    y: Math.round(area.y + (area.height - bounds.height) / 2),
    width: bounds.width,
    height: bounds.height,
  });
  mainWindow.moveTop();
  return { id: next.id, label: next.label || `Display ${next.id}` };
}

// Honest capability report. OS-level capture exclusion only exists on macOS
// (NSWindowSharingNone) and Windows 10 2004+ (WDA_EXCLUDEFROMCAPTURE), both
// driven by setContentProtection. No such flag exists on Linux/X11/Wayland.
function getCaptureStatus() {
  if (isMac || isWindows) {
    return {
      platform: process.platform,
      supported: true,
      protected: contentProtection,
      note: contentProtection
        ? 'Overlay is hidden from screen shares and recordings at the OS level.'
        : 'Screen-share hiding is turned off — the overlay WILL appear in shares and recordings.',
    };
  }
  return {
    platform: process.platform,
    supported: false,
    protected: false,
    note:
      'Linux has no OS flag to hide a window from screen capture. The overlay ' +
      'WILL appear in a full-screen share. Use panic-hide (Ctrl+Shift+Space) or ' +
      'move it to an unshared monitor (Ctrl+Shift+M).',
  };
}

// Best-effort, clearly-heuristic scan for well-known screen-recording and
// conferencing apps. It cannot see browser-tab-based sharing (Meet/Zoom in a
// browser) and a match does not guarantee active capture — it exists to remind
// the user that on Linux the overlay is not hidden.
const CAPTURE_PROCESS_PATTERNS = [
  'obs',
  'wf-recorder',
  'kooha',
  'simplescreenrecorder',
  'vokoscreen',
  'peek',
  'zoom',
  'teams-for-linux',
  'teams',
  'skypeforlinux',
  'slack',
  'discord',
  'webex',
];

// Match a pattern against a process name without substring false positives
// (e.g. "webex" must not match "webextensions"). Accepts exact names and
// common suffixed variants like "teams-for-linux" or "zoom.real".
function processMatches(name, pattern) {
  return (
    name === pattern ||
    name === `${pattern}.exe` ||
    name.startsWith(`${pattern}-`) ||
    name.startsWith(`${pattern}.`)
  );
}

async function scanForCaptureApps() {
  try {
    let names = [];
    if (isWindows) {
      const { stdout } = await execFileAsync('tasklist', ['/fo', 'csv', '/nh']);
      names = stdout
        .toLowerCase()
        .split('\n')
        .map((line) => (line.match(/^"([^"]+)"/) || [])[1])
        .filter(Boolean);
    } else {
      const { stdout } = await execFileAsync('ps', ['-eo', 'comm=']);
      names = stdout
        .toLowerCase()
        .split('\n')
        .map((line) => line.trim().split('/').pop())
        .filter(Boolean);
    }
    const nameSet = new Set(names);
    const found = CAPTURE_PROCESS_PATTERNS.filter((p) =>
      [...nameSet].some((n) => processMatches(n, p))
    );
    return { active: found.length > 0, apps: [...new Set(found)] };
  } catch {
    return { active: false, apps: [] };
  }
}

ipcMain.handle('capture:getStatus', () => getCaptureStatus());
// Toggle whether the overlay is excluded from screen shares/recordings.
// No-op on Linux, which has no such OS flag (getCaptureStatus reports that).
ipcMain.handle('capture:setProtection', (_e, enabled) => {
  contentProtection = !!enabled;
  mainWindow?.setContentProtection(contentProtection);
  return getCaptureStatus();
});
ipcMain.handle('capture:scan', () => scanForCaptureApps());
ipcMain.handle('stealth:toggle', (_e, forceState) => toggleStealth(forceState));
ipcMain.handle('window:moveToNextDisplay', () => moveToNextDisplay());
// setSize() alone doesn't reliably keep the window's top-left corner fixed on
// every platform/WM — some reposition (e.g. re-center) a frameless window as
// it resizes. Read the current bounds and pass an explicit target through
// setBounds() instead of relying on implicit anchoring.
//
// Anchored to the RIGHT edge (not the left): all of the header's buttons
// (Hide/Ask, close, etc.) hug the right edge of the window, so keeping that
// edge fixed on screen is what keeps those buttons from visually jumping
// when the window grows/shrinks — the window eats into itself from the left
// instead.
function resizeInPlace(width, height) {
  if (!mainWindow) return;
  const { x, y, width: oldWidth } = mainWindow.getBounds();
  mainWindow.setBounds({ x: x + oldWidth - width, y, width, height });
}

ipcMain.handle('window:setCompact', (_e, compact) => {
  if (!mainWindow) return false;
  const size = compact ? COMPACT_SIZE : NORMAL_SIZE;
  resizeInPlace(size.width, size.height);
  return compact;
});
// Collapse the window down to just the pill toolbar, or restore it to
// `expandedSize` (whatever the renderer's current normal/compact size is).
ipcMain.handle('window:setCollapsed', (_e, collapsed, expandedSize) => {
  if (!mainWindow) return false;
  const size = collapsed ? COLLAPSED_SIZE : expandedSize || NORMAL_SIZE;
  resizeInPlace(size.width, size.height);
  return collapsed;
});

// Open a URL in the system browser (used for Razorpay payment links —
// bank/UPI pages misbehave inside embedded webviews). https-only.
ipcMain.handle('shell:openExternal', async (_e, url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  try {
    await shell.openExternal(parsed.href);
    return true;
  } catch (err) {
    // xdg-open missing/misconfigured on some Linux setups — the renderer
    // shows the URL as a fallback so the user can open it manually.
    console.error('openExternal failed:', err);
    return false;
  }
});

// App controls
ipcMain.on('close-app', () => {
  app.quit();
});
ipcMain.on('minimize-app', () => {
  mainWindow?.minimize();
});
