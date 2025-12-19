import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('RefocusPrinter', {
  printReceipt: (args: { orderId: number }) =>
    ipcRenderer.invoke('print:receipt', args),
});
