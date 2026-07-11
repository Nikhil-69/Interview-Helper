import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 750,
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

  // Makes window invisible to screen capture (per user request)
  mainWindow.setContentProtection(true);
  
  // Makes window hover over fullscreen apps and all workspaces
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setHiddenInMissionControl(true);
  mainWindow.moveTop();

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.dock?.hide(); // Crucial for macOS to allow floating over fullscreen apps
app.commandLine.appendSwitch("disable-background-timer-throttling");

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('take-screenshot', async () => {
  if (mainWindow) {
    // Hide the window briefly so it doesn't get captured (if setContentProtection is insufficient)
    mainWindow.hide();
  }
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const tmpPath = path.join(app.getPath("temp"), `${crypto.randomUUID()}.png`);
  
  try {
    if (process.platform === 'darwin') {
      await execFileAsync("screencapture", ["-x", tmpPath]);
    } else {
      // Fallback for Windows/Linux if needed, but keeping it simple for macOS
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
      const primaryDisplay = sources[0];
      fs.writeFileSync(tmpPath, primaryDisplay.thumbnail.toPNG());
    }
    
    const buffer = await fs.promises.readFile(tmpPath);
    await fs.promises.unlink(tmpPath);
    
    if (mainWindow) {
      mainWindow.show();
    }
    
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (err) {
    if (mainWindow) mainWindow.show();
    console.error("Screenshot error:", err);
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

// App controls
ipcMain.on('close-app', () => {
  app.quit();
});
ipcMain.on('minimize-app', () => {
  mainWindow?.minimize();
});
