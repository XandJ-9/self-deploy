import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { registerServerHandlers } from './ipc/server-handlers';
import { registerProjectHandlers } from './ipc/project-handlers';
import { registerGitHandlers } from './ipc/git-handlers';
import { registerDeployHandlers } from './ipc/deploy-handlers';
import { initDatabase } from './db/database';

const isDev = process.env.NODE_ENV === 'development';

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'SelfDeploy',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    if (process.platform === 'darwin') {
      app.dock?.show?.();
      app.focus({ steal: true });
    }
  });

  if (isDev) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // dist/main/main/index.js -> ../../renderer/index.html
    await win.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  initDatabase();

  // 通用对话框 IPC（项目目录选择会复用）
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  registerServerHandlers();
  registerProjectHandlers();
  registerGitHandlers();
  registerDeployHandlers();

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
