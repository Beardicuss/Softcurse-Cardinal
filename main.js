const { app, BrowserWindow, ipcMain, powerMonitor, shell, session, screen, net } = require('electron');
const path = require('path');
const si = require('systeminformation');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');
const http = require('http');   // kept for system.js geo-IP (GET only, no upload)
const https = require('https'); // kept for system.js
const { getActiveWindowTitle, runQuickThreatScan, analyzeNetworkConnections, clearSystemCache } = require('./src/js/system.js');

// ── HTTP fetch using electron.net ─────────────────────────────────────────────
// Node's http/https module causes Chromium to open ChunkedDataPipeUploadDataStream
// objects internally. When those pipes are torn down after a response, Chromium
// logs "OnSizeReceived failed with Error: -2" because the pipe closed before the
// size callback fired. electron.net.fetch() is Chromium-native and handles
// chunked responses correctly without triggering those log errors.
// Must be called after app is ready; for pre-ready calls we fall back to Node http.
function nativeFetch(url, opts = {}) {
  // Use electron net.fetch if app is ready (it handles chunked responses natively)
  if (app.isReady()) {
    const { method = 'GET', headers = {}, body } = opts;
    const bodyBuf = body
      ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
      : null;
    return net.fetch(url, {
      method,
      headers: {
        ...headers,
        ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {})
      },
      body: bodyBuf || undefined
    }).then(res => ({
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text()
    }));
  }
  // Fallback for pre-ready (shouldn't normally be called)
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body } = opts;
    const bodyBuf = body
      ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
      : null;
    const mergedHeaders = { ...headers };
    if (bodyBuf) mergedHeaders['Content-Length'] = bodyBuf.length;
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, { method, headers: mergedHeaders }, res => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(data);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => JSON.parse(buf.toString()),
          text: async () => buf.toString()
        });
      });
    });
    req.on('error', err => reject(err));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function fetchWithTimeout(url, opts = {}, ms = 25000) {
  return Promise.race([
    nativeFetch(url, opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  ]);
}



let mainWindow;
let monitorInterval;
let reminderInterval;
let threatInterval;
let startTime = Date.now();
let spaceFreed = 0;
let threatsFound = 0;

// ── JSON store ────────────────────────────────────────────────────────────────
const store = {
  _path: null,
  _data: { conversations: [], reminders: [], profile: { habits: {}, workingHours: [] } },
  init(p) {
    this._path = p;
    try { this._data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { }
    if (!Array.isArray(this._data.conversations)) this._data.conversations = [];
    if (!Array.isArray(this._data.reminders)) this._data.reminders = [];
    if (!this._data.profile) this._data.profile = { habits: {}, workingHours: [] };
  },
  save() { try { fs.writeFileSync(this._path, JSON.stringify(this._data)); } catch { } },
  addConv(role, content) {
    this._data.conversations.push({ role, content, ts: Date.now() });
    if (this._data.conversations.length > 200) this._data.conversations.splice(0, 1);
    this.save();
  },
  getConvs(limit = 40) { return this._data.conversations.slice(-limit); },
  clearConvs() { this._data.conversations = []; this.save(); },
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
  updateProfile(key, val) { this._data.profile[key] = val; this.save(); },
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // ── FIX 1: Grant microphone permission in Electron ──────────────────────
  // Without this, Web Speech API silently fails — mic never activates.
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      callback(true); // grant mic
    } else {
      callback(false);
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      return true;
    }
    return false;
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// ── System monitor (2s polling) ───────────────────────────────────────────────
async function startMonitoring() {
  // Cache activeWindow separately — getActiveWindowTitle() spawns a PowerShell
  // subprocess which conflicts with Chromium's chunked_data_pipe and generates
  // repeated OnSizeReceived -2 errors when called every 2s. Poll it every 10s instead.
  let cachedActiveWindow = 'Desktop';
  getActiveWindowTitle().then(w => { cachedActiveWindow = w; }).catch(() => {});
  setInterval(() => {
    getActiveWindowTitle().then(w => { cachedActiveWindow = w; }).catch(() => {});
  }, 10000);

  const push = async () => {
    try {
      const [load, mem, nets, procs, disks, temp] = await Promise.all([
        si.currentLoad(), si.mem(), si.networkStats(),
        si.processes(), si.fsSize(),
        si.cpuTemperature().catch(() => ({ main: null, cores: [] }))
      ]);
      const net = nets[0] || {};
      const disk = disks[0] || { size: 1, used: 0 };

      // FIX 6: CPU temp — try main, then first core, then null
      const tempVal = temp.main || (temp.cores && temp.cores[0]) || null;

      const topProcs = procs.list
        .filter(p => p.name && p.name !== 'idle' && p.name !== 'System Idle Process')
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 5)
        .map(p => ({
          name: p.name, pid: p.pid,
          cpu: Math.round(p.cpu * 10) / 10,
          mem: Math.round(p.memVsz / 1024)
        }));

      // Keep payload small — large Mojo pipe transfers trigger OnSizeReceived
      // errors in Chromium's network service. Cap process names to avoid
      // crossing the inline-transfer threshold on every 2s push.
      mainWindow?.webContents.send('system-update', {
        cpu: Math.round(load.currentLoad),
        ram: Math.round(mem.used / mem.total * 100),
        ramUsed: +(mem.used / 1073741824).toFixed(1),
        ramTotal: +(mem.total / 1073741824).toFixed(1),
        diskPct: Math.round(disk.used / disk.size * 100),
        diskFree: +((disk.size - disk.used) / 1073741824).toFixed(1),
        upload: +(net.tx_sec / 1048576 || 0).toFixed(2),
        download: +(net.rx_sec / 1048576 || 0).toFixed(2),
        netConns: procs.list.length,
        browserProcs: procs.list.filter(p => ['chrome.exe','msedge.exe','firefox.exe','brave.exe','chrome','firefox'].includes(p.name.toLowerCase())).length,
        temp: tempVal ? Math.round(tempVal) : null,
        uptime: Math.round((Date.now() - startTime) / 1000),
        processes: topProcs.slice(0, 3).map(p => ({ name: p.name.slice(0, 20), pid: p.pid, cpu: p.cpu, mem: p.mem })),
        activeWindow: cachedActiveWindow.slice(0, 60),
        spaceFreed,
        threatsFound
      });
    } catch (e) { console.error('Monitor error:', e.message); }
  };
  push();
  monitorInterval = setInterval(push, 2000);
}

// ── Threat scan (background, every 5 min) ────────────────────────────────────
async function startThreatMonitor() {
  const scan = async () => {
    try {
      const result = await runQuickThreatScan();
      const conns = await analyzeNetworkConnections();
      threatsFound = result.findings.filter(f => f.level === 'warn').length;
      mainWindow?.webContents.send('threat-update', {
        score: result.score, findings: result.findings, conns
      });
    } catch { }
  };
  // Delay first scan 10s so startup isn't slowed
  setTimeout(() => { scan(); threatInterval = setInterval(scan, 5 * 60 * 1000); }, 10000);

  // Real-Time Directory Watchdog for OS Integrity
  try {
    if (process.platform === 'win32') {
      const hostsPath = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
      if (fs.existsSync(hostsPath)) {
        let watchTimeout;
        fs.watch(hostsPath, (eventType) => {
          if (watchTimeout) return; // Debounce triggers
          watchTimeout = setTimeout(() => watchTimeout = null, 3000);
          console.log(`[WATCHDOG] Integrity violation detected on Windows HOSTS file: ${eventType}`);
          mainWindow?.webContents.send('threat-update', {
            score: 0,
            findings: [{ type: 'watchdog', level: 'warn', msg: `CRITICAL: The system HOSTS file was unexpectedly modified (${eventType})!` }],
            conns: []
          });
        });
      }
    }
  } catch (e) { console.error('Watchdog initialization failed:', e); }
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
ipcMain.handle('win-close', () => mainWindow?.close());
// startWindowDrag() was removed in Electron 35+.
// Replacement: on mousedown we record the cursor position and window position,
// then poll on a tight interval until the mouse button is released, moving the
// window by the delta each tick. This gives smooth frameless-window dragging
// without any native API.
ipcMain.on('window-drag', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isMaximized()) return;
  const startCursor = screen.getCursorScreenPoint();
  const [startWinX, startWinY] = win.getPosition();
  let lastX = startCursor.x, lastY = startCursor.y;
  const poll = setInterval(() => {
    try {
      const cur = screen.getCursorScreenPoint();
      // Stop if mouse button released (no button state available, so we use
      // a stationary threshold — renderer sends 'window-drag-end' on mouseup)
      const dx = cur.x - lastX, dy = cur.y - lastY;
      if (dx === 0 && dy === 0) return;
      const [wx, wy] = win.getPosition();
      win.setPosition(wx + dx, wy + dy);
      lastX = cur.x; lastY = cur.y;
    } catch { clearInterval(poll); }
  }, 8); // ~120fps
  // Clean up on mouseup (sent from renderer) or after 30s safety timeout
  const cleanup = () => clearInterval(poll);
  ipcMain.once('window-drag-end', cleanup);
  setTimeout(cleanup, 30000);
});

// ── IPC: system info ──────────────────────────────────────────────────────────
ipcMain.handle('get-sysinfo', async () => {
  const [cpu, osInfo, mem] = await Promise.all([si.cpu(), si.osInfo(), si.mem()]);
  return {
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
    platform: osInfo.platform,
    hostname: osInfo.hostname,
    os: `${osInfo.distro || osInfo.platform} ${osInfo.release}`,
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
  spaceFreed = +(spaceFreed + 0.5).toFixed(1);
  return { success: true, output: results.join('. ') };
});

ipcMain.handle('run-threat-scan', async () => {
  const result = await runQuickThreatScan();
  const conns = await analyzeNetworkConnections();
  threatsFound = result.findings.filter(f => f.level === 'warn').length;
  mainWindow?.webContents.send('threat-update', { score: result.score, findings: result.findings, conns });
  return result;
});

ipcMain.handle('run-defrag', async () =>
  new Promise(resolve => {
    let cmd, label;
    if (process.platform === 'win32') { cmd = 'defrag C: /U /V'; label = 'Defrag C:'; }
    else if (process.platform === 'darwin') { cmd = 'diskutil repairvolume /'; label = 'Disk repair'; }
    else { cmd = 'echo "Defrag not applicable on Linux (ext4 self-manages)"'; label = 'Defrag'; }
    exec(cmd, { timeout: 60000, shell: true }, (err, stdout, stderr) => {
      spaceFreed = +(spaceFreed + 0.2).toFixed(1);
      resolve({ success: !err, output: (stdout || stderr || '').trim().slice(0, 500), label });
    });
  })
);

ipcMain.handle('run-sfc', async () =>
  new Promise(resolve => {
    const cmd = process.platform === 'win32' ? 'sfc /scannow' : 'echo "SFC is Windows-only."';
    exec(cmd, { timeout: 120000, shell: true }, (err, stdout, stderr) =>
      resolve({ success: !err, output: (stdout || stderr || '').trim().slice(0, 500) })
    );
  })
);

ipcMain.handle('run-defender', async () =>
  new Promise(resolve => {
    const cmd = process.platform === 'win32'
      ? 'powershell -NoProfile -Command "Start-MpScan -ScanType QuickScan"'
      : 'echo "Windows Defender not available on this OS."';
    exec(cmd, { timeout: 90000, shell: true }, (err, stdout, stderr) => {
      if (!err) threatsFound = 0;
      resolve({ success: !err, output: (stdout || stderr || '').trim().slice(0, 500) });
    });
  })
);

// ── IPC: Admin elevation ──────────────────────────────────────────────────────
ipcMain.handle('elevate-admin', async () =>
  new Promise(resolve => {
    if (process.platform === 'win32') {
      const cmd = `powershell -Command "Start-Process '${process.execPath}' -Verb RunAs"`;
      exec(cmd, (err) => { if (!err) app.quit(); resolve({ success: !err }); });
    } else {
      resolve({ success: false, message: 'Elevation only supported on Windows' });
    }
  })
);

// ── IPC: Firewall IP Blocking ──────────────────────────────────────────────────
ipcMain.handle('block-ip', async (_e, ip) =>
  new Promise(resolve => {
    if (!ip) return resolve({ success: false, message: 'No IP provided' });
    if (process.platform === 'win32') {
      const cmd = `netsh advfirewall firewall add rule name="Cardinal-Block-${ip}" dir=in action=block remoteip="${ip}" & netsh advfirewall firewall add rule name="Cardinal-Block-${ip}" dir=out action=block remoteip="${ip}"`;
      exec(`powershell -Command "Start-Process 'cmd.exe' -ArgumentList '/c ${cmd}' -Verb RunAs -WindowStyle Hidden"`, (err) => {
        resolve({ success: !err });
      });
    } else {
      resolve({ success: false, message: 'Firewall blocking natively only supported on Windows' });
    }
  })
);

// ── Persistent Browser State ──────────────────────────────────────────────────
let persistentBrowser = null;
let persistentPage = null;

app.on('before-quit', async () => {
  if (persistentBrowser) {
    try { await persistentBrowser.close(); } catch { }
  }
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8')); } catch { }
  if (cfg.ollamaAuto && process.platform === 'win32') {
    exec('cscript "D:\\Dev\\Artificial intelligence\\stop-ollama.vbs"', { shell: true }).unref();
  }
});

// ── IPC: Browser automation (Puppeteer) ───────────────────────────────────────
ipcMain.handle('browser-auto', async (_e, { url, action, data }) => {
  try {
    if (!persistentBrowser) {
      const puppeteer = require('puppeteer');
      const envoyPath = path.join(app.getPath('userData'), 'BrowserEnvoy');
      if (!fs.existsSync(envoyPath)) fs.mkdirSync(envoyPath, { recursive: true });
      persistentBrowser = await puppeteer.launch({
        headless: 'new',
        userDataDir: envoyPath
      });
      persistentPage = await persistentBrowser.newPage();
    }
    await persistentPage.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    let result = '';
    if (action === 'read') {
      result = await persistentPage.evaluate(() => document.body.innerText.slice(0, 5000));
    } else if (action === 'fill' && data) {
      for (const [selector, value] of Object.entries(data)) {
        await persistentPage.type(selector, String(value)).catch(() => { });
      }
      result = 'Form filled';
    }
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── IPC: File operations ──────────────────────────────────────────────────────
// FIX 3: Filter Windows system root files that cause EINVAL before lstat
const WIN_ROOT_SKIP = new Set(['DumpStack.log.tmp', 'pagefile.sys', 'swapfile.sys', 'hiberfil.sys', 'BOOTNXT']);

ipcMain.handle('file-list', async (_e, dirPath) => {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    const result = [];
    for (const f of files) {
      // Skip known problematic Windows root files silently
      if (WIN_ROOT_SKIP.has(f.name)) continue;
      const fullPath = path.join(dirPath, f.name);
      try {
        const stats = fs.lstatSync(fullPath);
        result.push({
          name: f.name,
          isDirectory: f.isDirectory(),
          path: fullPath,
          size: f.isDirectory() ? 0 : stats.size,
          mtime: stats.mtime
        });
      } catch {
        // Silently skip — no console.warn flooding
      }
    }
    return result;
  } catch {
    return [];
  }
});

ipcMain.handle('file-move', async (_e, { from, to }) => {
  try { fs.renameSync(from, to); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('file-delete', async (_e, filePath) => {
  try {
    if (fs.statSync(filePath).isDirectory()) fs.rmSync(filePath, { recursive: true });
    else fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: AI chat ── FIX 2: match :latest suffix Ollama returns ───────────────
ipcMain.handle('ai-chat', async (_e, { messages, systemPrompt, model }) => {
  // Fetch real model list from Ollama first to get exact names (with :latest suffix)
  let availableModels = [];
  try {
    const tagsRes = await fetchWithTimeout('http://127.0.0.1:11434/api/tags', {}, 3000);
    if (tagsRes.ok) {
      const d = await tagsRes.json();
      availableModels = (d.models || []).map(m => m.name);
    }
  } catch { }

  // Build try-order: preferred model, then fuzzy-match from available, then fallbacks
  const preferred = model || 'qwen2.5';
  const tryModels = [];

  // Exact match first
  if (availableModels.includes(preferred)) tryModels.push(preferred);
  // Fuzzy: find model whose name starts with preferred (handles :latest suffix)
  const fuzzy = availableModels.find(m => m.startsWith(preferred) || preferred.startsWith(m.split(':')[0]));
  if (fuzzy && !tryModels.includes(fuzzy)) tryModels.push(fuzzy);
  // Add all available Ollama models as additional fallbacks
  for (const m of availableModels) { if (!tryModels.includes(m)) tryModels.push(m); }
  // Hardcoded names in case Ollama tags endpoint was unreachable
  for (const m of ['qwen2.5', 'qwen2.5:latest', 'llama3.1', 'llama3.1:latest', 'llama3', 'mistral']) {
    if (!tryModels.includes(m)) tryModels.push(m);
  }

  for (const m of tryModels) {
    try {
      const res = await nativeFetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          stream: false,
          options: { temperature: 0.7, num_ctx: 4096 }
        })
      });
      if (res.ok) {
        const d = await res.json();
        const text = d.message?.content || '';
        if (text) return { ok: true, text, provider: `ollama/${m}` };
      }
    } catch { }
  }

  // Cloud fallbacks
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { }

  if (cfg.geminiKey) {
    try {
      const gapi = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cfg.geminiKey}`;
      const res = await fetchWithTimeout(gapi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: messages.filter(m => !m.content.includes('No AI provider reachable')).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }))
        })
      });
      if (res.ok) {
        const d = await res.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { ok: true, text: text || '(Empty response from Gemini. Check terminal logs.)', provider: 'gemini' };
      }
    } catch { }
  }

  if (cfg.openRouterKey) {
    try {
      const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.openRouterKey}`, 'HTTP-Referer': 'http://localhost', 'X-Title': 'Cardinal OS' },
        body: JSON.stringify({ model: 'anthropic/claude-3.5-sonnet', messages: [{ role: 'system', content: systemPrompt }, ...messages.filter(m => !m.content.includes('No AI provider'))] })
      });
      if (res.ok) {
        const d = await res.json();
        const text = d.choices?.[0]?.message?.content || '';
        return { ok: true, text: text || '(Empty response from OpenRouter)', provider: 'openrouter' };
      }
    } catch { }
  }

  if (cfg.anthropicKey) {
    try {
      const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-3-5-haiku-20241022', max_tokens: 1024, system: systemPrompt, messages }),
      });
      if (res.ok) {
        const d = await res.json();
        return { ok: true, text: d.content?.[0]?.text || '', provider: 'anthropic' };
      }
    } catch { }
  }

  if (cfg.openaiKey) {
    try {
      const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.openaiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, ...messages] })
      });
      if (res.ok) {
        const d = await res.json();
        return { ok: true, text: d.choices?.[0]?.message?.content || '', provider: 'openai' };
      }
    } catch { }
  }

  return {
    ok: false,
    text: 'No AI provider reachable. Make sure Ollama is running (`ollama serve`). ' +
      `Available models detected: ${availableModels.join(', ') || 'none'}.`,
    provider: 'none'
  };
});

ipcMain.handle('get-ollama-models', async () => {
  try {
    const res = await fetchWithTimeout('http://127.0.0.1:11434/api/tags', {}, 3000);
    if (res.ok) {
      const d = await res.json();
      return { ok: true, models: (d.models || []).map(m => m.name) };
    }
  } catch { }
  return { ok: false, models: [] };
});

// ── IPC: history, config, profile, plugins ────────────────────────────────────
ipcMain.handle('get-history', () => store.getConvs(40));
ipcMain.handle('save-message', (_e, { role, content }) => store.addConv(role, content));
ipcMain.handle('clear-history', () => store.clearConvs());
ipcMain.handle('add-reminder', (_e, { text, due }) => store.addReminder(text, due));
ipcMain.handle('get-reminders', () => store.getPendingReminders());
ipcMain.handle('dismiss-reminder', (_e, id) => store.doneReminder(id));
ipcMain.handle('get-profile', () => store.getProfile());
ipcMain.handle('update-profile', (_e, { key, val }) => store.updateProfile(key, val));

const configPath = () => path.join(app.getPath('userData'), 'config.json');
ipcMain.handle('get-config', () => { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; } });
ipcMain.handle('save-config', (_e, c) => fs.writeFileSync(configPath(), JSON.stringify(c, null, 2)));

ipcMain.handle('get-network-details', async () => si.networkConnections().catch(() => []));

ipcMain.handle('get-startup-progs', async () => {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('powershell -NoProfile -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name, Command | ConvertTo-Json"');
      return JSON.parse(stdout || '[]');
    }
    return [];
  } catch { return []; }
});

ipcMain.handle('disable-startup', async (_e, name) => {
  if (process.platform !== 'win32') return { ok: false };
  try {
    await execAsync(`powershell -NoProfile -Command "Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${name}' -ErrorAction SilentlyContinue"`);
    return { ok: true };
  } catch { return { ok: false }; }
});

ipcMain.handle('enable-startup', async (_e, { name, cmd }) => {
  if (process.platform !== 'win32') return { ok: false };
  try {
    await execAsync(`powershell -NoProfile -Command "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${name}' -Value '${cmd}'"`);
    return { ok: true };
  } catch { return { ok: false }; }
});

ipcMain.handle('get-scheduled-tasks', async () => {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('schtasks /query /fo csv /v');
      return stdout;
    }
    return 'Not supported on this platform';
  } catch { return 'Error fetching tasks'; }
});

ipcMain.handle('get-open-ports', async () => {
  try {
    const ports = await si.networkConnections();
    return ports.filter(c => c.state === 'LISTEN');
  } catch { return []; }
});

ipcMain.handle('get-event-logs', async (_e, { limit = 20, logName = 'System' } = {}) => {
  try {
    if (process.platform === 'win32') {
      const targetLog = logName === 'Application' ? 'Application' : 'System';
      const { stdout } = await execAsync(`powershell -NoProfile -Command "Get-EventLog -LogName ${targetLog} -Newest ${limit} -EntryType Error,Warning | Select-Object TimeGenerated, EntryType, Source, Message | ConvertTo-Json"`);
      return JSON.parse(stdout || '[]');
    }
    return [];
  } catch { return []; }
});

const pluginsDir = () => { const p = path.join(app.getPath('userData'), 'plugins'); if (!fs.existsSync(p)) fs.mkdirSync(p); return p; };
ipcMain.handle('load-plugins', async () => {
  return fs.readdirSync(pluginsDir())
    .filter(f => f.endsWith('.js'))
    .map(file => {
      try { return { name: file, content: fs.readFileSync(path.join(pluginsDir(), file), 'utf8') }; }
      catch { return null; }
    }).filter(Boolean);
});

ipcMain.handle('import-plugin', async () => {
  try {
    const { dialog } = require('electron');
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Plugin Modules',
      filters: [{ name: 'Javascript Modules', extensions: ['js'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      for (const p of res.filePaths) {
        const pName = path.basename(p);
        fs.copyFileSync(p, path.join(pluginsDir(), pName));
      }
      return { ok: true };
    }
    return { ok: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: write audio blob to temp file (avoids passing large base64 over IPC) ─
// Passing a multi-MB base64 string through Electron IPC triggers Chromium's
// chunked_data_pipe_upload_data_stream error (OnSizeReceived -2) because the
// renderer-side IPC pipe chokes on large binary payloads. The fix: write the
// data to a temp file here in the main process, return the short path string,
// then transcribe-audio reads the file directly — no large payload ever crosses IPC.
ipcMain.handle('write-temp-audio', async (_e, base64data) => {
  try {
    const os = require('os');
    const tmpDir = app.getPath('temp');
    const tmpFile = path.join(tmpDir, `cardinal-audio-${Date.now()}.webm`);
    fs.writeFileSync(tmpFile, Buffer.from(base64data, 'base64'));
    return tmpFile;
  } catch (e) {
    console.error('write-temp-audio error:', e.message);
    return null;
  }
});

ipcMain.handle('transcribe-audio', async (_e, tmpFilePath) => {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { }

  if (!cfg.geminiKey) return { ok: false, error: 'Gemini API key is required inside settings to enable Microphone STT.' };

  let base64data;
  try {
    base64data = fs.readFileSync(tmpFilePath).toString('base64');
  } catch (e) {
    return { ok: false, error: `Could not read temp audio file: ${e.message}` };
  } finally {
    // Always clean up the temp file
    try { fs.unlinkSync(tmpFilePath); } catch { }
  }

  try {
    const gapi = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cfg.geminiKey}`;
    const res = await fetchWithTimeout(gapi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "You are a raw speech-to-text transcriber. Output ONLY the exact transcription of the provided audio. Do not surround with quotes. Do not add commentary. Do not refuse." }] },
        contents: [{
          parts: [{
            inline_data: {
              mime_type: "audio/webm",
              data: base64data
            }
          }]
        }]
      })
    });
    if (res.ok) {
      const d = await res.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { ok: true, text };
    }
    return { ok: false, error: `Google API Error: ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  store.init(path.join(app.getPath('userData'), 'cardinal.json'));
  createWindow();

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8')); } catch { }
  if (cfg.ollamaAuto && process.platform === 'win32') {
    exec('cscript "D:\\Dev\\Artificial intelligence\\run-ollama.vbs"', { shell: true }, (err) => {
      if (err) console.warn('Failed to auto-start Ollama:', err);
    });
  }

  startMonitoring();
  startThreatMonitor();
  startReminderCheck();
  powerMonitor.on('unlock-screen', () => mainWindow?.webContents.send('power-resume'));
  powerMonitor.on('resume', () => mainWindow?.webContents.send('power-resume'));
});

app.on('window-all-closed', () => {
  clearInterval(monitorInterval);
  clearInterval(reminderInterval);
  clearInterval(threatInterval);
  app.quit();
});
