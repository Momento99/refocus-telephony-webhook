// desktop/main.js — Refocus CRM (улучшенный)
// 1) Автозапуск сервера (npm run start) из cfg.serverDir
// 2) Ожидание APP_URL
// 3) Одно приложение (single instance), автозагрузка в Windows
// 4) Главное окно + окно покупателя (можно на второй монитор)
// 5) Киоск/фуллскрин, без лишних меню
// 6) IPC для POS: system:get-terminal, system:shutdown, system:restart, system:sleep

const { app, BrowserWindow, shell, screen, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');

// ──────────────────────────────────────────────────────────
// Конфиг в ProgramData (общесистемный)
// ──────────────────────────────────────────────────────────
const PROGRAM_DATA = process.env.PROGRAMDATA || 'C:\\ProgramData';
const CFG_DIR  = path.join(PROGRAM_DATA, 'RefocusCRM');
const CFG_FILE = path.join(CFG_DIR, 'config.json');

const defaultCfg = {
  appUrl: 'http://localhost:3000',
  crmPath: '/new-order',
  customerPath: '/pos/customer',
  terminal: 'KANT-01',

  // где запускать сервер (npm run start)
  serverDir: 'C:\\refocus-crm\\web\\refocus-crm',
  serverStartCmd: 'npm run start', // должен слушать тот же порт, что в appUrl

  // окна
  mainFullscreen: true,
  mainKiosk: true,
  customerFullscreen: true,
  placeOnSecondMonitor: true,

  // прочее
  autostart: true, // автозагрузка через setLoginItemSettings
  backgroundColor: '#0b152f',
};

// текущее состояние конфига для IPC
let CURRENT_CFG = { ...defaultCfg };

// ──────────────────────────────────────────────────────────

function ensureConfigExists() {
  try {
    if (!fs.existsSync(CFG_DIR)) fs.mkdirSync(CFG_DIR, { recursive: true });
    if (!fs.existsSync(CFG_FILE)) {
      fs.writeFileSync(CFG_FILE, JSON.stringify(defaultCfg, null, 2), 'utf8');
    }
  } catch (e) {
    console.warn('Config write error:', e.message);
  }
}
function loadConfig() {
  try {
    if (fs.existsSync(CFG_FILE)) {
      const raw = fs.readFileSync(CFG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...defaultCfg, ...parsed };
    }
  } catch (e) {
    console.warn('Config read error:', e.message);
  }
  return { ...defaultCfg };
}

// ──────────────────────────────────────────────────────────
// Служебные утилиты
// ──────────────────────────────────────────────────────────
let serverProcess = null;

function startServer(cfg) {
  serverProcess = spawn('cmd.exe', ['/c', cfg.serverStartCmd], {
    cwd: cfg.serverDir,
    windowsHide: true,
    env: { ...process.env },
  });
  serverProcess.stdout?.on('data', d => console.log('[server]', String(d).trim()));
  serverProcess.stderr?.on('data', d => console.error('[server:err]', String(d).trim()));
  serverProcess.on('exit', code => console.log('[server] exit', code));
}
function stopServer() {
  if (!serverProcess) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t']);
    } else {
      serverProcess.kill('SIGTERM');
    }
  } catch {}
  serverProcess = null;
}

function waitForServer(url, timeoutMs = 90_000, intervalMs = 1500) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(url, res => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Сервер не поднялся вовремя: ' + url));
        } else {
          setTimeout(ping, intervalMs);
        }
      });
    };
    ping();
  });
}

// Чтобы аппарат не открывал две копии
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// Автозагрузка (Windows)
app.whenReady().then(() => {
  try {
    const cfg = loadConfig();
    app.setLoginItemSettings({
      openAtLogin: !!cfg.autostart,
      path: process.execPath,
      args: [],
    });
  } catch {}
});

// app.disableHardwareAcceleration(); // если вдруг черный экран

// ──────────────────────────────────────────────────────────
// Окна
// ──────────────────────────────────────────────────────────
let mainWin = null;
let customerWin = null;

function createMainWindow(cfg) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: cfg.backgroundColor || '#ffffff',
    fullscreen: !!cfg.mainFullscreen,
    kiosk: !!cfg.mainKiosk,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  const url = `${cfg.appUrl}${cfg.crmPath}`;
  win.loadURL(url);

  // внешние ссылки открывать в браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { mainWin = null; });
  mainWin = win;
  return win;
}

function createCustomerWindow(cfg) {
  const url = `${cfg.appUrl}${cfg.customerPath}?terminal=${encodeURIComponent(cfg.terminal)}`;

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    fullscreen: !!cfg.customerFullscreen,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    const displays = screen.getAllDisplays();
    if (cfg.placeOnSecondMonitor && displays.length > 1) {
      const ext = displays[1];
      const { x, y, width, height } = ext.workArea;
      win.setBounds({ x, y, width, height });
    }
  } catch (e) {
    console.warn('Screen place error:', e.message);
  }

  win.once('ready-to-show', () => win.show());
  win.loadURL(url);

  win.on('closed', () => { customerWin = null; });
  customerWin = win;
  return win;
}

// ──────────────────────────────────────────────────────────
// IPC для POS (get-terminal, shutdown, restart, sleep)
// ──────────────────────────────────────────────────────────
function registerIpc() {
  // Код терминала из конфигурации
  ipcMain.handle('system:get-terminal', async () => {
    return CURRENT_CFG?.terminal || 'SK-01';
  });

  // Выключение ОС (Windows)
  ipcMain.handle('system:shutdown', async () => {
    if (process.platform === 'win32') {
      return new Promise((resolve, reject) => {
        execFile('shutdown', ['/s', '/t', '0'], (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
    // на других системах просто закрываем приложение
    try { stopServer(); } catch {}
    app.quit();
  });

  // Перезагрузка ОС (опционально)
  ipcMain.handle('system:restart', async () => {
    if (process.platform === 'win32') {
      return new Promise((resolve, reject) => {
        execFile('shutdown', ['/r', '/t', '0'], (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
    try { stopServer(); } catch {}
    app.relaunch();
    app.exit(0);
  });

  // Сон (опционально; может потребовать права)
  ipcMain.handle('system:sleep', async () => {
    if (process.platform === 'win32') {
      return new Promise((resolve, reject) => {
        execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
    return;
  });
}

// ──────────────────────────────────────────────────────────
// Бутстрап: сервер → ожидание → окна
// ──────────────────────────────────────────────────────────
async function bootstrap() {
  ensureConfigExists();
  const cfg = loadConfig();
  CURRENT_CFG = cfg;          // сохраним для IPC
  registerIpc();              // регистрируем хендлеры

  // 1) Поднимаем сервер
  startServer(cfg);

  // 2) Ждём, пока URL оживёт
  try {
    await waitForServer(cfg.appUrl, 90_000, 1500);
  } catch (e) {
    console.error(e);
    dialog.showErrorBox(
      'Refocus CRM',
      'Сервер не запустился. Проверьте cfg.serverDir и cfg.serverStartCmd.\n' + String(e?.message || e)
    );
    // всё равно пытаемся открыть окна — вдруг доступен внешний бэкенд
  }

  // 3) Открываем окна
  createMainWindow(cfg);
  createCustomerWindow(cfg);
}

// ──────────────────────────────────────────────────────────
// Жизненный цикл
// ──────────────────────────────────────────────────────────
app.whenReady().then(bootstrap);

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('before-quit', () => { stopServer(); });
app.on('quit', () => { stopServer(); });
