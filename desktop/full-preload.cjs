const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopSession', {
  getItem: key => ipcRenderer.invoke('desktop-session:get', key),
  setItem: (key, value) => ipcRenderer.invoke('desktop-session:set', key, value),
  removeItem: key => ipcRenderer.invoke('desktop-session:remove', key),
});
