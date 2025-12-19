import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

app.commandLine.appendSwitch('disable-print-preview');
app.commandLine.appendSwitch('kiosk-printing'); // гарантирует тишину

const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3000';
const PREFERRED_PRINTER = process.env.RECEIPT_PRINTER ?? 'XP-58';

async function pickPrinter(contents: Electron.WebContents) {
  const list = await contents.getPrintersAsync();
  const byName =
    list.find(p => p.name.includes(PREFERRED_PRINTER)) ||
    list.find(p => /XP[-\s]?58|58/i.test(p.name)) ||
    list.find(p => p.isDefault);
  return byName?.name;
}

ipcMain.handle('print:receipt', async (ev, { orderId }: { orderId: number }) => {
  const printerName = await pickPrinter(ev.sender);

  const win = new BrowserWindow({
    show: false,
    width: 420,
    height: 800,
    webPreferences: { offscreen: true, preload: path.join(__dirname, 'preload.js') },
  });

  const url = `${APP_ORIGIN}/receipt/${orderId}?print=0`; // без window.print() на странице
  await win.loadURL(url);

  // дождёмся шрифтов/DOM
  await new Promise(r => setTimeout(r, 200));

  await new Promise<void>((resolve) => {
    win.webContents.print(
      {
        silent: true,
        deviceName: printerName,      // XP-58
        printBackground: true,
      },
      (success, err) => {
        if (!success) console.error('Print failed:', err);
        resolve();
      }
    );
  });

  win.destroy();
});
