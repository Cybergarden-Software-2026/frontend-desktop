// Sandboxed preload scripts only expose Electron through CommonJS.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('underCtrl', {
  getConnection: () => ipcRenderer.invoke('connection:get'),
  setConnection: origin => ipcRenderer.invoke('connection:set', origin),
});
