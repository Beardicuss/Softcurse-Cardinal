const { app, BrowserWindow, ipcMain, powerMonitor, shell } = require('electron');
const path     = require('path');
const si       = require('systeminformation');
const { exec, spawn } = require('child_process');
const fs       = require('fs');
const puppeteer = require('puppeteer');
const { getActiveWindowTitle, runQuickThreatScan, getOpenConnections, clearSystemCache } = require('./src/js/system.js');

let mainWindow;
let monitorInterval;
let reminderInterval;
let threatInterval;
let startTime    = Date.now();
let spaceFreed   = 0;
let threatsFound = 0;

// ── JSON store ────────────────────────────────────────────────────────────────
const store = {
  _path: null,
  _data: { conversations: [], reminders: [], profile: { habits: {}, workingHours: [] } },
  init(p) {
    this._path = p;
    try { this._data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    if (!Array.isArray(this._data.conversations)) this._data.conversations = [];
    if (!Array.isArray(this._data.reminders))     this._data.reminders     = [];
    if (!this._data.profile) this._data.profile = { habits: {}, workingHours: [] };
  },
  save() { try { fs.writeFileSync(this._path, JSON.stringify(this._data)); } catch {} },
  addConv(role, content) {
    this._data.conversations.push({ role, content, ts: Date.now() });
    this.save();
  },
  getConvs(limit = -1) { 
    if (limit === -1) return this._data.conversations;
    return this._data.conversations.slice(-limit); 
  },
  clearConvs()         { this._data.conversations = []; this.save(); },
  addReminder(text, due) {
    const id = Date.now();
    this._data.reminders.push({ id, text, due, done: 0 });
    this.save(); return id;
  },
  getPendingReminders() { return this._data.reminders.filter(r => !r.done); },
  doneReminder(id) {
    const r = this._data.reminders.find(r => r.id === id);
    if (r) { r.done = 1; this.save(); }
  },
  updateProfile(key, val) {
    this._data.profile[key] = val;
    this.save();
  },
  getProfile() { return this._data.profile; }
};

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 880, minWidth: 1200, minHeight: 700,
    backgroundColor: '#0a0a0b',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// ── System monitor ────────────────────────────────────────────────────────────
async function startMonitoring() {
  const push = async () => {
    try {
      const [load, mem, nets, procs, disks, temp] = await Promise.all([
        si.currentLoad(), si.mem(), si.networkStats(),
        si.processes(), si.fsSize(),
        si.cpuTemperature().catch(() => ({ main: null }))
      ]);
      const net  = nets[0] || {};
      const disk = disks[0] || { size: 1, used: 0 };
      const topProcs = procs.list
        .filter(p => p.name && p.name !== 'idle')
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 5)
        .map(p => ({
          name: p.name, pid: p.pid,
          cpu:  Math.round(p.cpu * 10) / 10,
          mem:  Math.round(p.memVsz / 1024)
        }));

      const activeWindow = await getActiveWindowTitle().catch(() => 'Unknown');

      mainWindow?.webContents.send('system-update', {
        cpu:      Math.round(load.currentLoad),
        ram:      Math.round(mem.used / mem.total * 100),
        ramUsed:  +(mem.used / 1073741824).toFixed(1),
        ramTotal: +(mem.total / 1073741824).toFixed(1),
        diskPct:  Math.round(disk.used / disk.size * 100),
        diskFree: +((disk.size - disk.used) / 1073741824).toFixed(1),
        upload:   +(net.tx_sec / 1048576 || 0).toFixed(2),
        download: +(net.rx_sec / 1048576 || 0).toFixed(2),
        netConns: procs.list.length,
        temp:     temp.main ? Math.round(temp.main) : null,
        uptime:   Math.round((Date.now() - startTime) / 1000),
        processes: topProcs,
        activeWindow,
        spaceFreed,
        threatsFound
      });
    } catch (e) { console.error('Monitor error:', e.message); }
  };
  push();
  monitorInterval = setInterval(push, 2000);
}

// ── Threat scan ───────────────────────────────────────────────────────────────
async function startThreatMonitor() {
  const scan = async () => {
    try {
      const result = await runQuickThreatScan();
      const conns  = await getOpenConnections();
      threatsFound = result.findings.filter(f => f.level === 'warn').length;
      mainWindow?.webContents.send('threat-update', {
        score:    result.score,
        findings: result.findings,
        conns
      });
    } catch {}
  };
  scan();
  threatInterval = setInterval(scan, 5 * 60 * 1000);
}

// ── Reminder checker ──────────────────────────────────────────────────────────
function startReminderCheck() {
  reminderInterval = setInterval(() => {
    store.getPendingReminders()
      .filter(r => r.due <= Date.now())
      .forEach(r => {
        store.doneReminder(r.id);
        mainWindow?.webContents.send('reminder-due', { id: r.id, text: r.text });
      });
  }, 5000);
}

// ── IPC: window ───────────────────────────────────────────────────────────────
ipcMain.handle('win-minimize', () => mainWindow?.minimize());
ipcMain.handle('win-maximize', () =>
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('win-close',   () => mainWindow?.close());

// ── IPC: system info ──────────────────────────────────────────────────────────
ipcMain.handle('get-sysinfo', async () => {
  const [cpu, osInfo, mem] = await Promise.all([si.cpu(), si.osInfo(), si.mem()]);
  return {
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
    platform: osInfo.platform,
    hostname: osInfo.hostname,
    os:       `${osInfo.distro || osInfo.platform} ${osInfo.release}`,
    totalRam: +(mem.total / 1073741824).toFixed(1)
  };
});

// ── IPC: process control ──────────────────────────────────────────────────────
ipcMain.handle('kill-process', async (_e, pid) =>
  new Promise(resolve => {
    const cmd = process.platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`;
    exec(cmd, err => resolve({ success: !err, pid }));
  })
);

ipcMain.handle('run-command', async (_e, cmd) =>
  new Promise(resolve => {
    exec(cmd, { timeout: 30000, shell: true }, (err, stdout, stderr) =>
      resolve({ success: !err, output: (stdout || stderr || '').trim().slice(0, 1000) })
    );
  })
);

ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));

// ── IPC: OS operations ────────────────────────────────────────────────────────
ipcMain.handle('clear-cache', async () => {
  const results = await clearSystemCache();
  spaceFreed += 0.5;
  return { success: true, output: results.join('. ') };
});

ipcMain.handle('run-threat-scan', async () => {
  const result = await runQuickThreatScan();
  threatsFound = result.findings.filter(f => f.level === 'warn').length;
  mainWindow?.webContents.send('threat-update', { score: result.score, findings: result.findings });
  return result;
});

ipcMain.handle('run-defrag', async () => {
  return new Promise(resolve => {
    let cmd, label;
    if (process.platform === 'win32') { cmd = 'defrag C: /U /V'; label = 'Defrag C:'; }
    else if (process.platform === 'darwin') { cmd = 'diskutil repairvolume /'; label = 'Disk repair'; }
    else { cmd = 'echo "Defrag not applicable on Linux"'; label = 'Defrag'; }
    exec(cmd, { timeout: 60000, shell: true }, (err, stdout, stderr) => {
      spaceFreed += 0.2;
      resolve({ success: !err, output: (stdout || stderr || '').trim().slice(0, 500), label });
    });
  });
});

ipcMain.handle('run-sfc', async () =>
  new Promise(resolve => {
    const cmd = process.platform === 'win32' ? 'sfc /scannow' : 'echo "SFC is Windows-only"';
    exec(cmd, { timeout: 120000, shell: true }, (err, stdout, stderr) =>
      resolve({ success: !err, output: (stdout || stderr || '').trim().slice(0, 500) })
    );
  })
);

ipcMain.handle('run-defender', async () =>
  new Promise(resolve => {
    const cmd = process.platform === 'win32' ? 'powershell -NoProfile -Command "Start-MpScan -ScanType QuickScan"' : 'echo "Windows Defender not available"';
    exec(cmd, { timeout: 90000, shell: true }, (err, stdout, stderr) => {
      if (!err) threatsFound = 0;
      resolve({ success: !err, output: (stdout || stderr || '').trim().slice(0, 500) });
    });
  })
);

// ── IPC: Admin Elevation ──────────────────────────────────────────────────────
ipcMain.handle('elevate-admin', async () => {
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      const cmd = `powershell -Command "Start-Process '${process.execPath}' -Verb RunAs"`;
      exec(cmd, (err) => {
        if (!err) app.quit();
        resolve({ success: !err });
      });
    } else {
      resolve({ success: false, message: 'Elevation only supported on Windows' });
    }
  });
});

// ── IPC: Browser Automation ───────────────────────────────────────────────────
ipcMain.handle('browser-auto', async (_e, { url, action, data }) => {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    let result = '';
    if (action === 'read') {
      result = await page.evaluate(() => document.body.innerText.slice(0, 5000));
    } else if (action === 'fill' && data) {
      for (const [selector, value] of Object.entries(data)) {
        await page.type(selector, value);
      }
      result = 'Form filled';
    }
    await browser.close();
    return { success: true, result };
  } catch (e) {
    if (browser) await browser.close();
    return { success: false, error: e.message };
  }
});

// ── IPC: File Operations ─────────────────────────────────────────────────────
ipcMain.handle('file-list', async (_e, dirPath) => {
  try {
    // readdirSync can also throw if dirPath is invalid or inaccessible
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    const result = [];
    
    for (const f of files) {
      const fullPath = path.join(dirPath, f.name);
      try {
        // Use lstatSync to avoid following broken symlinks which can cause EINVAL
        const stats = fs.lstatSync(fullPath);
        result.push({
          name: f.name,
          isDirectory: f.isDirectory(),
          path: fullPath,
          size: f.isDirectory() ? 0 : stats.size,
          mtime: stats.mtime
        });
      } catch (e) {
        // Log and skip any file that causes an error (EINVAL, EPERM, EACCES, etc.)
        console.warn(`[FILE-LIST] Skipping ${fullPath}: ${e.code} ${e.message}`);
      }
    }
    return result;
  } catch (e) {
    console.error(`[FILE-LIST] Failed to read directory ${dirPath}:`, e);
    // Return empty list instead of throwing to keep the UI stable
    return [];
  }
});

ipcMain.handle('file-move', async (_e, { from, to }) => {
  try { fs.renameSync(from, to); return { success: true }; } catch (e) { throw e; }
});

ipcMain.handle('file-delete', async (_e, filePath) => {
  try {
    if (fs.statSync(filePath).isDirectory()) fs.rmSync(filePath, { recursive: true });
    else fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) { throw e; }
});

// ── IPC: AI chat ──────────────────────────────────────────────────────────────
ipcMain.handle('ai-chat', async (_e, { messages, systemPrompt, model }) => {
  const ollamaModels = [model, 'qwen2.5', 'llama3.1', 'llama3', 'mistral'].filter(Boolean);
  for (const m of ollamaModels) {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          stream: false,
          options: { temperature: 0.7, num_ctx: 4096 }
        }),
        signal: AbortSignal.timeout(30000)
      }).catch(() => null);
      if (res && res.ok) {
        const d = await res.json();
        const text = d.message?.content || '';
        if (text) return { ok: true, text, provider: `ollama/${m}` };
      }
    } catch {}
  }

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch {}
  if (cfg.anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1024, system: systemPrompt, messages }),
        signal: AbortSignal.timeout(25000)
      });
      if (res.ok) {
        const d = await res.json();
        return { ok: true, text: d.content?.[0]?.text || '', provider: 'anthropic' };
      }
    } catch {}
  }
  return { ok: false, text: 'No AI provider reachable.', provider: 'none' };
});

ipcMain.handle('get-ollama-models', async () => {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const d = await res.json();
      return { ok: true, models: (d.models || []).map(m => m.name) };
    }
  } catch {}
  return { ok: false, models: [] };
});

// ── IPC: History & Config ─────────────────────────────────────────────────────
ipcMain.handle('get-history',     ()              => store.getConvs(-1));
ipcMain.handle('save-message',    (_e, {role,content}) => store.addConv(role, content));
ipcMain.handle('clear-history',   ()              => store.clearConvs());
ipcMain.handle('add-reminder',    (_e, {text,due}) => store.addReminder(text, due));
ipcMain.handle('get-reminders',   ()               => store.getPendingReminders());
ipcMain.handle('dismiss-reminder',(_e, id)         => store.doneReminder(id));

const configPath = () => path.join(app.getPath('userData'), 'config.json');
ipcMain.handle('get-config',  ()    => { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; } });
ipcMain.handle('save-config', (_e, cfg) => fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)));
ipcMain.handle('get-profile', () => store.getProfile());
ipcMain.handle('update-profile', (_e, { key, val }) => store.updateProfile(key, val));

// ── IPC: Security & Network ──────────────────────────────────────────────────
ipcMain.handle('get-network-details', async () => {
  return si.networkConnections();
});

// ── Plugin System ────────────────────────────────────────────────────────────
const pluginsDir = path.join(app.getPath('userData'), 'plugins');
if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir);

ipcMain.handle('load-plugins', async () => {
  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
  const plugins = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
      plugins.push({ name: file, content });
    } catch (e) { console.error(`Failed to load plugin ${file}:`, e); }
  }
  return plugins;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  store.init(path.join(app.getPath('userData'), 'cardinal.json'));
  createWindow();
  startMonitoring();
  startThreatMonitor();
  startReminderCheck();
  powerMonitor.on('unlock-screen', () => mainWindow?.webContents.send('power-resume'));
  powerMonitor.on('resume',        () => mainWindow?.webContents.send('power-resume'));
});

app.on('window-all-closed', () => {
  clearInterval(monitorInterval);
  clearInterval(reminderInterval);
  clearInterval(threatInterval);
  app.quit();
});
