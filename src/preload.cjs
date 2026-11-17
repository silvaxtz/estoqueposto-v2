const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('estoque', {
  authorizeAdmin: (data) => ipcRenderer.invoke('admin:authorize', data),
  audit: () => ipcRenderer.invoke('audit:list'),
  dashboard: () => ipcRenderer.invoke('dashboard:get'),
  categories: () => ipcRenderer.invoke('categories:list'),
  addCategory: (data) => ipcRenderer.invoke('categories:add', data),
  products: (category) => ipcRenderer.invoke('products:list', category),
  saveProduct: (p) => ipcRenderer.invoke('products:save', p),
  deactivateProduct: (data) => ipcRenderer.invoke('products:deactivate', data),
  sellers: () => ipcRenderer.invoke('sellers:list'),
  addSeller: (data) => ipcRenderer.invoke('sellers:add', data),
  movements: (limit) => ipcRenderer.invoke('movements:list', limit),
  addMovement: (m) => ipcRenderer.invoke('movements:add', m),
  deleteSale: (data) => ipcRenderer.invoke('movements:deleteSale', data),
  exportCsv: () => ipcRenderer.invoke('reports:csv'),
  backup: () => ipcRenderer.invoke('backup:save')
});
