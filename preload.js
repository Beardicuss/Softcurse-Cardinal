const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window
  minimize: () => ipcRenderer.invoke('win-minimize'),
  maximize: () => ipcRenderer.invoke('win-maximize'),
  close: () => ipcRenderer.invoke('win-close'),
  startDrag: () => ipcRenderer.send('window-drag'),

  // System info & monitor
  getSysInfo: () => ipcRenderer.invoke('get-sysinfo'),

  // Process control
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  runCommand: (cmd) => ipcRenderer.invoke('run-command', cmd),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // OS operations
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  runDefrag: () => ipcRenderer.invoke('run-defrag'),
  runSfc: () => ipcRenderer.invoke('run-sfc'),
  runDefender: () => ipcRenderer.invoke('run-defender'),
  runThreatScan: () => ipcRenderer.invoke('run-threat-scan'),
  elevateAdmin: () => ipcRenderer.invoke('elevate-admin'),
  blockIp: (ip) => ipcRenderer.invoke('block-ip', ip),

  // AI
  aiChat: (p) => ipcRenderer.invoke('ai-chat', p),
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),
  browserAuto: (p) => ipcRenderer.invoke('browser-auto', p),

  // Conversation
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveMessage: (m) => ipcRenderer.invoke('save-message', m),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Reminders
  addReminder: (r) => ipcRenderer.invoke('add-reminder', r),
  getReminders: () => ipcRenderer.invoke('get-reminders'),
  dismissReminder: (id) => ipcRenderer.invoke('dismiss-reminder', id),

  // Config & Profile
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (c) => ipcRenderer.invoke('save-config', c),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  updateProfile: (k, v) => ipcRenderer.invoke('update-profile', { key: k, val: v }),
  loadPlugins: () => ipcRenderer.invoke('load-plugins'),
  importPlugin: () => ipcRenderer.invoke('import-plugin'),

  // File Operations
  fileList: (dir) => ipcRenderer.invoke('file-list', dir),
  fileMove: (f, t) => ipcRenderer.invoke('file-move', { from: f, to: t }),
  fileDelete: (p) => ipcRenderer.invoke('file-delete', p),

  // Startup & Tasks
  getStartupProgs: () => ipcRenderer.invoke('get-startup-progs'),
  disableStartup: (n) => ipcRenderer.invoke('disable-startup', n),
  enableStartup: (n, c) => ipcRenderer.invoke('enable-startup', { name: n, cmd: c }),
  getScheduledTasks: () => ipcRenderer.invoke('get-scheduled-tasks'),

  // Security & Network
  getOpenPorts: () => ipcRenderer.invoke('get-open-ports'),
  getNetworkDetails: () => ipcRenderer.invoke('get-network-details'),
  getEventLogs: (l) => ipcRenderer.invoke('get-event-logs', l),
  transcribeAudio: (d) => ipcRenderer.invoke('transcribe-audio', d),

  // Platform info — renderer can't access process.* directly
  platform: process.platform,
  homeDir: require('os').homedir(),

  // Events from main
  on: (ch, fn) => {
    const allowed = ['system-update', 'threat-update', 'reminder-due', 'power-resume'];
    if (allowed.includes(ch)) ipcRenderer.on(ch, (_e, ...a) => fn(...a));
  },
  off: (ch, fn) => ipcRenderer.removeListener(ch, fn)
});
// Expose platform info so renderer can use it without Node.js globals
// Must be added OUTSIDE contextBridge to work correctly
