// desktop/preload.js — Refocus CRM
// Предоставляет безопасные IPC-методы из main.js в окно браузера
// для взаимодействия с Electron (переключение экрана, перезапуск,
// выключение, получение кода терминала и т.д.)

const { contextBridge, ipcRenderer } = require('electron');

// ───────────────────────────────────────────────
// Служебные функции CRM-оболочки
// ───────────────────────────────────────────────
contextBridge.exposeInMainWorld('RefocusShell', {
  toggleCustomer: () => ipcRenderer.send('toggle-customer'),
  reloadMain:     () => ipcRenderer.send('reload-main'),
  moveToExternal: () => ipcRenderer.send('move-to-external'),
});

// ───────────────────────────────────────────────
// Системные вызовы для POS
// ───────────────────────────────────────────────
contextBridge.exposeInMainWorld('system', {
  // выключить устройство
  shutdown: () => ipcRenderer.invoke('system:shutdown').catch(err => {
    console.error('Shutdown error:', err);
  }),

  // получить код терминала (например "SK-01")
  getTerminal: () => ipcRenderer.invoke('system:get-terminal')
    .catch(err => {
      console.error('GetTerminal error:', err);
      return 'UNKNOWN';
    }),

  // перезапуск (опционально)
  restart: () => ipcRenderer.invoke('system:restart')
    .catch(err => console.error('Restart error:', err)),

  // режим сна (опционально)
  sleep: () => ipcRenderer.invoke('system:sleep')
    .catch(err => console.error('Sleep error:', err)),
});
