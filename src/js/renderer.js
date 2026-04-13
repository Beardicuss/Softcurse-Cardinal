// ── Cardinal Renderer — clean rewrite v4 ──────────────────────────────────────
// All helpers defined FIRST, boot sequence LAST, every await has .catch()

(async () => {

  // ── Element helper ───────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── State ────────────────────────────────────────────────────────────────
  let config = {};
  let ollamaModels = [];
  let selectedProc = null;
  let selectedFile = null;
  let cpuAlerted = false;
  let currentPath = (window.api.platform === 'win32') ? 'C:\\' : (window.api.homeDir || '/');
  let pathHistory = [];

  // ── Sparkline data ───────────────────────────────────────────────────────
  const sparkHistory = { cpu: [], ram: [] };

  // ── Acoustics ────────────────────────────────────────────────────────────
  const sounds = {
    startup: new Audio('assets/sounds/startup.wav'),
    micOn: new Audio('assets/sounds/mic_on.wav'),
    processing: new Audio('assets/sounds/processing.wav'),
    threat: new Audio('assets/sounds/threat_detect.wav'),
    toast: new Audio('assets/sounds/toast_notify.wav')
  };
  sounds.processing.loop = true;
  sounds.startup.volume = 0.5;
  sounds.processing.volume = 0.5;

  function playSound(name) {
    try {
      const s = sounds[name];
      if (!s) return;
      if (name !== 'processing') s.currentTime = 0;
      s.play().catch(() => { });
    } catch (e) { }
  }
  function stopSound(name) {
    try {
      const s = sounds[name];
      if (!s) return;
      s.pause();
      s.currentTime = 0;
    } catch (e) { }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS — all defined before boot so they're available
  // ═══════════════════════════════════════════════════════════════════════

  // ── Terminal log ─────────────────────────────────────────────────────────
  function term(tag, msg, cls) {
    try {
      const log = $('term-log');
      if (!log) return;
      const div = document.createElement('div');
      div.className = 'term-line';
      const n = new Date();
      const pad = v => String(v).padStart(2, '0');
      const ts = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
      div.innerHTML = `<span class="term-ts">${ts}</span> <span class="${cls || 't-sys'}">${tag}</span> ${msg}`;
      log.appendChild(div);
      while (log.children.length > 300) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
    } catch (e) { }
  }

  // ── Chat messages ─────────────────────────────────────────────────────────
  async function sendMessage(text) {
    if (!text.trim() || AI.isThinking()) return;
    const input = $('chatInput');
    if (input) input.value = '';
    appendMsg('user', text);
    showThinking();
    try {
      const res = await AI.send(text);
      hideThinking();
      if (res) {
        appendMsg('ai', res.text);
        if (res.action) term('[AI]', `Action: ${res.action.action}`, 't-proc');
        if (res.provider) term('[AI]', `Provider: ${res.provider}`, 't-sys');
      }
    } catch (e) {
      hideThinking();
      appendMsg('ai', 'Error: ' + e.message);
    }
  }

  function appendMsg(role, text) {
    try {
      const log = $('chat-log');
      if (!log) return;
      const div = document.createElement('div');
      div.className = 'chat-msg ' + role;
      const n = new Date();
      const pad = v => String(v).padStart(2, '0');
      const ts = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
      const label = (role === 'ai') ? 'Cardinal' : 'User';
      const cls = (role === 'ai') ? 'ai-lbl' : 'user-lbl';
      const safe = String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code style="background:rgba(200,57,43,0.15);padding:1px 5px;border-radius:2px;font-family:var(--font-mono);font-size:12px">$1</code>')
        .replace(/\n/g, '<br>');
      div.innerHTML = `<div class="msg-label ${cls}">${label} — ${ts}</div><div class="msg-body">${safe}</div>`;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    } catch (e) { }
  }

  function showThinking() {
    try {
      playSound('processing');
      const log = $('chat-log');
      if (!log || $('thinkDots')) return;
      const div = document.createElement('div');
      div.id = 'thinkDots';
      div.className = 'chat-msg ai chat-thinking';
      div.innerHTML = '<span class="think-dot"></span><span class="think-dot"></span><span class="think-dot"></span>';
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    } catch (e) { }
  }

  function hideThinking() {
    try {
      stopSound('processing');
      $('thinkDots')?.remove();
    } catch (e) { }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(title, message, duration) {
    try {
      playSound('toast');
      const container = $('toast-container');
      if (!container) return;
      const t = document.createElement('div');
      t.className = 'toast';
      t.innerHTML = `<div class="toast-label">${title}</div>
        <div class="toast-text">${message}</div>
        <div class="toast-actions">
          <button class="toast-btn ts-snooze">Snooze 10m</button>
          <button class="toast-btn ts-dismiss">Dismiss</button>
        </div>`;
      container.appendChild(t);
      const dismiss = () => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); };
      t.querySelector('.ts-dismiss')?.addEventListener('click', dismiss);
      t.querySelector('.ts-snooze')?.addEventListener('click', () => {
        dismiss();
        window.api.addReminder({ text: message, due: Date.now() + 600000 }).catch(() => { });
      });
      setTimeout(dismiss, duration || 6000);
    } catch (e) { }
  }

  // ── Vitals helpers ─────────────────────────────────────────────────────────
  function setText(id, val) {
    try { const el = $(id); if (el) el.textContent = val; } catch (e) { }
  }

  function setVital(id, txt, pct, barId, color) {
    setText(id, txt);
    try {
      const bar = $(barId);
      if (!bar) return;
      bar.style.width = Math.min(Math.max(pct, 0), 100) + '%';
      if (color) bar.style.background = color;
    } catch (e) { }
  }

  function updateThreatBar(id, pct, color) {
    try {
      const el = $(id);
      if (!el) return;
      el.style.width = Math.min(pct, 100) + '%';
      el.style.background = color;
    } catch (e) { }
  }

  // ── Sparkline ──────────────────────────────────────────────────────────────
  function updateSparkline(data) {
    try {
      const canvas = $('sparklineChart');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth || 400;
      canvas.height = canvas.offsetHeight || 60;
      const W = canvas.width, H = canvas.height;
      sparkHistory.cpu.push(data.cpu);
      sparkHistory.ram.push(data.ram);
      if (sparkHistory.cpu.length > 60) { sparkHistory.cpu.shift(); sparkHistory.ram.shift(); }
      ctx.clearRect(0, 0, W, H);
      const step = W / 60;
      const draw = (arr, color, lw) => {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lw;
        arr.forEach((v, i) => {
          const x = i * step, y = H - (v / 100 * H);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      };
      draw(sparkHistory.ram, 'rgba(212,113,42,0.4)', 1);
      draw(sparkHistory.cpu, 'rgba(200,57,43,0.85)', 1.5);
    } catch (e) { }
  }

  // ── Process list ───────────────────────────────────────────────────────────
  function renderProcs(list) {
    try {
      const container = $('proc-list');
      if (!container || !list.length) return;
      container.innerHTML = list.map(p => {
        const cpuColor = p.cpu > 50 ? 'var(--red)' : p.cpu > 20 ? '#d4712a' : 'var(--text-lo)';
        const memLabel = p.mem > 1024 ? (p.mem / 1024).toFixed(1) + 'G' : p.mem + 'M';
        const memPct = Math.min(p.mem / 30, 100);
        return `<div class="proc-item" data-pid="${p.pid}" data-name="${p.name}" data-cpu="${p.cpu}">
          <div class="proc-top">
            <span class="proc-name" title="${p.name}">${p.name}</span>
            <span class="proc-pid">#${p.pid}</span>
          </div>
          <div class="proc-bars">
            <div class="pbar-wrap">
              <span class="pbar-lbl">CPU</span>
              <div class="pbar-outer"><div class="pbar-inner" style="width:${Math.min(p.cpu, 100)}%;background:${cpuColor}"></div></div>
              <span class="pbar-val" style="color:${cpuColor}">${p.cpu}%</span>
            </div>
            <div class="pbar-wrap">
              <span class="pbar-lbl">RAM</span>
              <div class="pbar-outer"><div class="pbar-inner" style="width:${memPct}%;background:var(--text-lo)"></div></div>
              <span class="pbar-val">${memLabel}</span>
            </div>
          </div>
        </div>`;
      }).join('');

      container.querySelectorAll('.proc-item').forEach(el => {
        el.onmouseenter = () => { el.style.background = 'rgba(180,40,30,0.07)'; };
        el.onmouseleave = () => { el.style.background = ''; };
        el.oncontextmenu = (e) => {
          e.preventDefault();
          selectedProc = { pid: parseInt(el.dataset.pid), name: el.dataset.name, cpu: el.dataset.cpu };
          showCtxMenu(e.clientX, e.clientY);
        };
      });
    } catch (e) { }
  }

  // ── Context menu ───────────────────────────────────────────────────────────
  function showCtxMenu(x, y, type = 'proc') {
    try {
      const menu = $('ctx-menu');
      if (!menu) return;
      const nameEl = $('ctxProcName');
      $('ctxKill').style.display = type === 'proc' ? 'block' : 'none';
      $('ctxAsk').style.display = type === 'proc' ? 'block' : 'none';
      $('ctxRename') && ($('ctxRename').style.display = type === 'file' ? 'block' : 'none');
      $('ctxMove') && ($('ctxMove').style.display = type === 'file' ? 'block' : 'none');

      if (type === 'proc' && nameEl && selectedProc) nameEl.textContent = 'PROC: ' + selectedProc.name?.toUpperCase();
      if (type === 'file' && nameEl && selectedFile) nameEl.textContent = 'FILE: ' + selectedFile.name?.slice(0, 20).toUpperCase();

      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.classList.remove('hidden');
    } catch (e) { }
  }

  // ── File manager ───────────────────────────────────────────────────────────
  function formatBytes(b) {
    if (!b || b < 0) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(1) + ' GB';
  }

  async function loadFiles(dir, push) {
    try {
      if (push !== false && currentPath && currentPath !== dir) pathHistory.push(currentPath);
      currentPath = dir;
      const pathEl = $('file-path-input');
      if (pathEl) pathEl.value = dir;
      const bc = $('file-breadcrumb');
      if (bc) bc.textContent = '📂 ' + dir;

      const list = $('file-list');
      if (!list) return;
      list.innerHTML = '<div style="color:var(--text-ghost);padding:8px">Loading...</div>';

      const files = await window.api.fileList(dir);
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const status = $('file-status');
      const dirs = files.filter(f => f.isDirectory).length;
      const fls = files.filter(f => !f.isDirectory).length;
      if (status) status.textContent = `${dirs} folders, ${fls} files`;

      if (!files.length) {
        list.innerHTML = '<div style="color:var(--text-ghost);padding:8px">Empty</div>';
        return;
      }

      list.innerHTML = files.map(f => {
        const icon = f.isDirectory ? '📁' : '📄';
        const sz = f.isDirectory ? '' : `<span style="color:var(--text-ghost);font-size:11px">${formatBytes(f.size)}</span>`;
        const safePath = f.path.replace(/"/g, '&quot;');
        return `<div class="file-item" data-path="${safePath}" data-dir="${f.isDirectory}"
          style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;
          display:flex;justify-content:space-between;align-items:center;overflow:hidden" title="${f.path}">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${icon} ${f.name}</span>${sz}
        </div>`;
      }).join('');

      list.querySelectorAll('.file-item').forEach(el => {
        el.onmouseenter = () => { el.style.background = 'rgba(180,40,30,0.07)'; };
        el.onmouseleave = () => { el.style.background = ''; };
        el.onclick = () => {
          if (el.dataset.dir === 'true') loadFiles(el.dataset.path);
          else window.api.openExternal('file://' + el.dataset.path).catch(() => { });
        };
        el.oncontextmenu = (e) => {
          e.preventDefault();
          selectedFile = { path: el.dataset.path, dir: el.dataset.dir === 'true', name: f.name };
          showCtxMenu(e.clientX, e.clientY, 'file');
        };
      });
    } catch (e) {
      const list = $('file-list');
      if (list) list.innerHTML = `<div style="color:#d4712a;padding:8px">Error: ${e.message}</div>`;
      term('[FILES]', 'Error: ' + e.message, 't-error');
    }
  }

  // ── Send message ───────────────────────────────────────────────────────────
  async function sendMessage(text) {
    if (!text?.trim() || AI.isThinking()) return;
    appendMsg('user', text);
    term('[USER]', text.slice(0, 80), 't-sys');
    const input = $('chatInput');
    if (input) input.value = '';
    const btn = $('sendBtn');
    if (btn) btn.disabled = true;
    showThinking();

    // Check for reminder pattern
    try {
      const rem = await Reminders.tryParseAndAdd(text);
      if (rem) {
        hideThinking();
        const mins = Math.round(rem.ms / 60000);
        const reply = `Reminder set — "${rem.text}" in ${mins} minute${mins !== 1 ? 's' : ''}.`;
        appendMsg('ai', reply);
        Voice.speak(reply);
        term('[CARDINAL]', reply, 't-cardinal');
        if (btn) btn.disabled = false;
        return;
      }
    } catch (e) { }

    try {
      const result = await AI.send(text);
      hideThinking();
      if (result) {
        appendMsg('ai', result.text);
        Voice.speak(result.text);
        term('[CARDINAL]', result.text.slice(0, 80), 't-cardinal');
        if (result.action) term('[ACTION]', `Executed: ${result.action.action}`, 't-proc');
        if (!result.ok) term('[ERROR]', 'No AI provider reachable', 't-error');
      }
    } catch (e) {
      hideThinking();
      appendMsg('ai', 'Connection error. Check Ollama status or API key in Settings.');
      term('[ERROR]', e.message, 't-error');
    }

    if (btn) btn.disabled = false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BOOT SEQUENCE — wrapped in try/catch at each step
  // ═══════════════════════════════════════════════════════════════════════

  // 1. Load config
  try { config = await window.api.getConfig(); } catch (e) { config = {}; }
  if (config.userName) AI.setUserName(config.userName);
  if (config.lang) I18n.setLocale(config.lang);
  else I18n.applyToDOM();
  if (config.aiModel) AI.setModel(config.aiModel);

  // 2. Load conversation history
  try { await AI.loadHistory(); } catch (e) { /* non-fatal */ }

  // 3. Load plugins
  try {
    const plugins = await window.api.loadPlugins();
    plugins.forEach(p => {
      try { new Function('AI', 'window', p.content)(AI, window); term('[PLUGIN]', 'Loaded: ' + p.name, 't-cardinal'); }
      catch (e) { console.warn('Plugin failed:', p.name, e); }
    });
  } catch (e) { }

  // 4. Check Ollama
  try {
    const info = await window.api.getOllamaModels();
    ollamaModels = info.models || [];
    const status = info.ok
      ? `Ollama online — ${ollamaModels.join(', ')}`
      : 'Ollama offline — run: ollama serve';
    term('[CARDINAL]', status, info.ok ? 't-cardinal' : 't-error');
    // Populate model selector with real models
    const sel = $('cfgModel');
    if (sel && ollamaModels.length) {
      sel.innerHTML = ollamaModels.map(m =>
        `<option value="${m}" ${m === AI.getModel() ? 'selected' : ''}>${m}</option>`
      ).join('');
    }
  } catch (e) { }

  // 5. System info
  try {
    const si = await window.api.getSysInfo();
    term('[SYSTEM]', `Cardinal online — ${si.os || 'OS'} / ${si.hostname || 'host'}`, 't-sys');
    term('[SYSTEM]', `CPU: ${si.cpuModel || '?'} · RAM: ${si.totalRam || '?'} GB`, 't-sys');
  } catch (e) { term('[SYSTEM]', 'System info unavailable', 't-sys'); }

  // 6. Greeting
  try {
    const greeting = I18n.t('cardinal_greeting');
    appendMsg('ai', greeting);
    Voice.speak(greeting);
  } catch (e) { }

  // ═══════════════════════════════════════════════════════════════════════
  // CLOCK
  // ═══════════════════════════════════════════════════════════════════════
  setInterval(() => {
    try {
      const n = new Date();
      const pad = v => String(v).padStart(2, '0');
      setText('clock', `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`);
    } catch (e) { }
  }, 1000);

  // ═══════════════════════════════════════════════════════════════════════
  // EYE CANVAS
  // ═══════════════════════════════════════════════════════════════════════
  try {
    const canvas = $('eyeCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      const cx = W / 2, cy = H / 2;
      let blinkState = 'open', openness = 1, blinkStart = 0;
      let nextBlink = Date.now() + 3000 + Math.random() * 4000;
      const CLOSE_MS = 75, PAUSE_MS = 55, OPEN_MS = 95;

      function drawEye(op) {
        ctx.clearRect(0, 0, W, H);
        const ew = 24, eh = 13 * op;
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, ew + 8);
        g.addColorStop(0, 'rgba(200,57,43,0.18)');
        g.addColorStop(1, 'rgba(200,57,43,0)');
        ctx.beginPath(); ctx.ellipse(cx, cy, ew + 8, eh + 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - ew, cy);
        ctx.bezierCurveTo(cx - ew, cy - eh, cx + ew, cy - eh, cx + ew, cy);
        ctx.bezierCurveTo(cx + ew, cy + eh, cx - ew, cy + eh, cx - ew, cy);
        ctx.closePath(); ctx.clip();
        ctx.fillStyle = '#060608'; ctx.fillRect(0, 0, W, H);
        ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200,57,43,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,57,43,0.18)'; ctx.fill();
        ctx.strokeStyle = 'rgba(200,57,43,0.9)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = 'rgba(200,57,43,0.22)'; ctx.lineWidth = 0.5;
        [[cx, cy - 8.5, cx, cy + 8.5], [cx - 8.5, cy, cx + 8.5, cy]].forEach(([x1, y1, x2, y2]) => {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        });
        ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#c8392b'; ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 2, cy - 2.5, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,190,170,0.55)'; ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(200,57,43,0.92)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - ew, cy);
        ctx.bezierCurveTo(cx - ew, cy - eh, cx + ew, cy - eh, cx + ew, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - ew, cy);
        ctx.bezierCurveTo(cx - ew, cy + eh, cx + ew, cy + eh, cx + ew, cy); ctx.stroke();
        ctx.strokeStyle = 'rgba(200,57,43,0.4)'; ctx.lineWidth = 0.7;
        [[cx - ew - 1, cy, cx - ew - 7, cy], [cx + ew + 1, cy, cx + ew + 7, cy]].forEach(([x1, y1, x2, y2]) => {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        });
      }

      (function tick() {
        const now = Date.now();
        if (blinkState === 'open' && now >= nextBlink) { blinkState = 'closing'; blinkStart = now; }
        if (blinkState === 'closing') {
          openness = Math.max(0.02, 1 - (now - blinkStart) / CLOSE_MS);
          if (now - blinkStart >= CLOSE_MS) { blinkState = 'closed'; blinkStart = now; openness = 0.02; }
        } else if (blinkState === 'closed') {
          if (now - blinkStart >= PAUSE_MS) { blinkState = 'opening'; blinkStart = now; }
        } else if (blinkState === 'opening') {
          openness = Math.min(1, (now - blinkStart) / OPEN_MS);
          if (now - blinkStart >= OPEN_MS) { blinkState = 'open'; openness = 1; nextBlink = Date.now() + 3000 + Math.random() * 5000; }
        }
        drawEye(openness);
        requestAnimationFrame(tick);
      })();
    }
  } catch (e) { console.warn('Eye init failed:', e); }

  // ═══════════════════════════════════════════════════════════════════════
  // SYSTEM UPDATE EVENT
  // ═══════════════════════════════════════════════════════════════════════
  window.api.on('system-update', (data) => {
    try {
      AI.updateState(data);
      if (data.activeWindow) Activity.trackWindow(data.activeWindow);
      setVital('vCpu', data.cpu + '%', data.cpu, 'vCpuBar', data.cpu > 80 ? '#d4712a' : '#c8392b');
      setVital('vRam', data.ram + '%', data.ram, 'vRamBar', data.ram > 80 ? '#d4712a' : '#c8392b');
      setVital('vDisk', data.diskPct + '%', data.diskPct, 'vDiskBar', data.diskPct > 85 ? '#c8392b' : '#d4712a');
      setVital('vNet', data.download + ' MB/s', Math.min((data.download || 0) * 8, 100), 'vNetBar', '#5aaa70');
      setText('netUp', '↑ ' + data.upload + ' MB/s');
      setText('netDown', '↓ ' + data.download + ' MB/s');
      setText('netConns', data.netConns + ' procs');
      setText('cpuTemp', data.temp ? data.temp + '°C' : '—');
      setText('hd-temp', data.temp ? data.temp + '°C' : '—°C');
      setText('hd-cpu', data.cpu + '%');
      setText('hd-ram', data.ram + '%');
      setText('hd-proc', data.processes?.length || '—');
      const netMB = (parseFloat(data.upload) || 0) + (parseFloat(data.download) || 0);
      setText('hd-net', netMB > 10 ? 'ACTIVE ' + netMB.toFixed(1) + 'MB' : netMB > 0.5 ? 'ACTIVE' : 'IDLE');
      setText('hd-sys', data.cpu > 90 ? 'CRITICAL' : data.cpu > 70 ? 'ELEVATED' : 'NOMINAL');
      if (data.activeWindow) setText('hd-win', data.activeWindow.slice(0, 22));
      const s = data.uptime || 0;
      const pad = v => String(v).padStart(2, '0');
      setText('mUptime', `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`);
      setText('hd-uptime', `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`);
      if (data.spaceFreed !== undefined) setText('mSpaceFreed', data.spaceFreed.toFixed(1));
      if (data.threatsFound !== undefined) setText('mThreats', data.threatsFound);
      renderProcs(data.processes || []);
      updateSparkline(data);
      // CPU spike alert
      if (data.cpu > 85 && !cpuAlerted) {
        cpuAlerted = true;
        const top = data.processes?.[0];
        showToast('System Alert', top
          ? `CPU at ${data.cpu}% — ${top.name} (${top.cpu}%) is the cause. Want me to kill it?`
          : `CPU at ${data.cpu}% — unusually high.`);
      }
      if (data.cpu < 70) cpuAlerted = false;

      // Disk full alert
      if (data.diskPct > 90 && !window.diskAlerted) {
        window.diskAlerted = true;
        showToast('System Alert', `Disk usage is at ${data.diskPct}%. Consider running Clear Cache.`);
      }
      if (data.diskPct < 85) window.diskAlerted = false;

      // Browser overload alert
      if (data.browserProcs > 40 && !window.browserAlerted) {
        window.browserAlerted = true;
        showToast('Resource Warning', `Detected ${data.browserProcs} browser processes running concurrently. Closing unused tabs might free up RAM.`);
      }
      if (data.browserProcs < 30) window.browserAlerted = false;
    } catch (e) { console.warn('system-update error:', e); }
  });

  // ── Threat update ──────────────────────────────────────────────────────
  let lastThreatScore = 100;
  window.api.on('threat-update', (data) => {
    try {
      const score = data.score ?? 98;
      if (score < 80 && score < lastThreatScore) playSound('threat');
      lastThreatScore = score;

      setText('mIntegrity', score);
      const iBar = $('integrityBar');
      if (iBar) { iBar.style.width = score + '%'; iBar.style.background = score > 80 ? '#5aaa70' : score > 60 ? '#d4712a' : '#c8392b'; }
      const finds = data.findings || [];
      updateThreatBar('tbarMalware', finds.some(f => f.type === 'startup') ? 35 : 5, '#c8392b');
      updateThreatBar('tbarAdware', finds.some(f => f.type === 'hosts') ? 28 : 8, '#d4712a');
      updateThreatBar('tbarNetwork', (Array.isArray(data.conns) ? data.conns.length : data.conns || 0) > 50 ? 45 : 12, '#d4712a');
      updateThreatBar('tbarIntegrity', score > 80 ? 3 : 22, '#5aaa70');
      finds.forEach(f => term('[SCAN]', f.msg, f.level === 'warn' ? 't-error' : 't-sys'));

      // Log active foreign sockets directly into terminal
      if (Array.isArray(data.conns) && data.conns.length > 0) {
        const untrusted = data.conns.filter(c => c.country !== 'Unknown' && c.country !== 'United States' && c.country !== 'Undefined');
        if (untrusted.length > 0) {
          term('[NET-GEO]', `Detected ${untrusted.length} foreign socket bindings.`, 't-error');
          untrusted.slice(0, 5).forEach(c => term('[NET-GEO]', `${c.process} (PID:${c.pid}) bounds to ${c.peerIp} [${c.country}]`, 't-error'));
        }
      }
    } catch (e) { }
  });

  // ── Reminder due ───────────────────────────────────────────────────────
  window.api.on('reminder-due', (data) => {
    try {
      const label = typeof I18n !== 'undefined' ? I18n.t('reminder_label') : 'Reminder';
      showToast(label, data.text, 10000);
      appendMsg('ai', 'Reminder: ' + data.text);
      Voice.speak(data.text);
      window.api.dismissReminder(data.id).catch(() => { });
    } catch (e) { }
  });

  // ── Power resume ───────────────────────────────────────────────────────
  window.api.on('power-resume', () => {
    try {
      const msg = typeof I18n !== 'undefined' ? I18n.t('resume_greeting') : 'Welcome back.';
      appendMsg('ai', msg);
      Voice.speak(msg);
    } catch (e) { }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // WIRE UP UI CONTROLS
  // ═══════════════════════════════════════════════════════════════════════

  // Global Cyber S Custom Cursor Tracker
  const cyberCursor = document.getElementById('cyber-cursor');
  if (cyberCursor) {
    document.addEventListener('mousemove', (e) => {
      // Use requestAnimationFrame natively inside browser engine if performance drops
      // but direct sub-pixel offset application works best for 120hz/144hz UI
      cyberCursor.style.left = e.clientX + 'px';
      cyberCursor.style.top = e.clientY + 'px';
    }, { passive: true });

    // Add glowing hover/click reactions
    document.addEventListener('mousedown', () => cyberCursor.style.transform = 'scale(0.85)');
    document.addEventListener('mouseup', () => cyberCursor.style.transform = 'scale(1)');

    // Custom pure-JS Window Dragging Hook replacing native `-webkit-app-region: drag`
    const topBar = document.getElementById('topbar');
    if (topBar) {
      topBar.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, .clickable, select, input, .title-text, span, img')) return;
        if (window.api && window.api.startDrag) window.api.startDrag();
      });
      topBar.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, .clickable, select, input, .title-text, span, img')) return;
        if (window.api && window.api.maximize) window.api.maximize();
      });
    }

    // Toggle selection/hover state frames
    document.addEventListener('mouseover', (e) => {
      if (!e.target || !e.target.closest) return;
      const isInteractable = e.target.closest('a, button, input, textarea, select, [contenteditable="true"], .clickable');
      const style = window.getComputedStyle(e.target);
      if (isInteractable || style.cursor === 'text' || style.cursor === 'pointer') {
        cyberCursor.classList.add('select-mode');
      }
    });

    document.addEventListener('mouseout', (e) => {
      cyberCursor.classList.remove('select-mode');
    });
  }

  // Window Resizers (Drag-And-Drop)
  const resizerLeft = $('resizer-left');
  const panelLeft = $('panel-left');
  if (resizerLeft && panelLeft) {
    let isResizing = false;
    resizerLeft.addEventListener('mousedown', e => { isResizing = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (isResizing) { const w = Math.max(200, Math.min(e.clientX, window.innerWidth / 2)); panelLeft.style.width = w + 'px'; } });
    window.addEventListener('mouseup', () => { isResizing = false; document.body.style.cursor = 'default'; });
  }

  const resizerRight = $('resizer-right');
  const panelRight = $('panel-right');
  if (resizerRight && panelRight) {
    let isResizing = false;
    resizerRight.addEventListener('mousedown', e => { isResizing = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (isResizing) { const w = Math.max(180, Math.min(window.innerWidth - e.clientX, window.innerWidth / 2)); panelRight.style.width = w + 'px'; } });
    window.addEventListener('mouseup', () => { isResizing = false; document.body.style.cursor = 'default'; });
  }

  // Chat input
  const sendBtn = $('sendBtn');
  const chatInput = $('chatInput');
  if (sendBtn) sendBtn.onclick = () => sendMessage(chatInput?.value || '');
  if (chatInput) chatInput.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput.value); } };

  // Mic button
  const micBtn = $('micBtn');
  if (micBtn) micBtn.onclick = () => {
    playSound('micOn');
    if (!Voice.isAvailable()) { showToast('Voice', 'Microphone API not available.'); return; }
    Voice.toggle(
      (text, isFinal) => { if (isFinal && text && chatInput) { chatInput.value = text; sendMessage(text); } },
      (active) => {
        micBtn.classList.toggle('listening', active);
        $('micIndicator')?.classList.toggle('active', active);
        setText('micLabel', active ? 'LIVE' : 'MIC OFF');
      }
    );
  };

  // Initialize Always-On Acoustic Engine for passive triggers
  if (typeof Voice !== 'undefined' && Voice.isAvailable()) {
    setTimeout(() => {
      Voice.startWakeWordListener(() => {
        if (!Voice.isListening() && micBtn) {
          term('[VOICE]', 'Wake Word detected. System listening.', 't-cardinal');
          micBtn.click();
        }
      });
      term('[SYS]', 'Acoustic Subsystem online (Listening for explicit wake-word)', 't-sys');
    }, 1500);
  }

  // Terminal clear
  const termClear = $('termClear');
  if (termClear) termClear.onclick = () => { const l = $('term-log'); if (l) l.innerHTML = ''; };

  // Context menu
  document.addEventListener('click', () => $('ctx-menu')?.classList.add('hidden'));
  const ctxKill = $('ctxKill');
  if (ctxKill) ctxKill.onclick = async () => {
    if (!selectedProc) return;
    $('ctx-menu')?.classList.add('hidden');
    term('[PROCESS]', `Killing ${selectedProc.name} (#${selectedProc.pid})...`, 't-sys');
    const res = await window.api.killProcess(selectedProc.pid).catch(() => ({ success: false }));
    const msg = res.success ? `${selectedProc.name} terminated.` : `Could not kill ${selectedProc.name} — may need admin rights.`;
    appendMsg('ai', msg);
    term('[PROCESS]', msg, res.success ? 't-proc' : 't-error');
    selectedProc = null;
  };
  const ctxMove = $('ctxMove');
  if (ctxMove) ctxMove.onclick = () => {
    if (!selectedFile) return;
    $('ctx-menu')?.classList.add('hidden');
    const to = prompt('Move ' + selectedFile.path + ' to new absolute path:');
    if (!to) return;
    window.api.fileMove(selectedFile.path, to).then(() => loadFiles(currentPath, false)).catch(() => { });
    selectedFile = null;
  };

  const ctxRename = $('ctxRename');
  if (ctxRename) ctxRename.onclick = () => {
    if (!selectedFile) return;
    $('ctx-menu')?.classList.add('hidden');
    const newName = prompt('Rename ' + selectedFile.name + ' to:', selectedFile.name);
    if (!newName || newName === selectedFile.name) return;
    const dir = selectedFile.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const to = dir + '/' + newName;
    window.api.fileMove(selectedFile.path, to).then(() => loadFiles(currentPath, false)).catch(() => { });
    selectedFile = null;
  };

  const ctxAsk = $('ctxAsk');
  if (ctxAsk) ctxAsk.onclick = () => {
    if (!selectedProc) return;
    $('ctx-menu')?.classList.add('hidden');
    sendMessage(`What is "${selectedProc.name}" (PID ${selectedProc.pid}, ${selectedProc.cpu}% CPU)? Is it safe?`);
    selectedProc = null;
  };

  // Quick actions
  const QUICK = {
    defender: { fn: () => window.api.runDefender(), label: 'Defender Scan' },
    sfc: { fn: () => window.api.runSfc(), label: 'SFC Scan' },
    defrag: { fn: () => window.api.runDefrag(), label: 'Defrag' },
    cache: { fn: () => window.api.clearCache(), label: 'Cache Clear' }
  };
  document.querySelectorAll('.qa-btn').forEach(btn => {
    btn.onclick = async () => {
      const def = QUICK[btn.dataset.cmd];
      if (!def) return;
      btn.classList.add('running');
      term('[SYSTEM]', 'Starting: ' + def.label, 't-sys');
      try {
        const res = await def.fn();
        btn.classList.remove('running');
        const msg = (res?.success !== false) ? `${def.label} complete.${res?.output ? ' ' + res.output.slice(0, 100) : ''}` : `${def.label} failed — may need admin rights.`;
        appendMsg('ai', msg);
        term('[SYSTEM]', msg.slice(0, 100), res?.success !== false ? 't-proc' : 't-error');
      } catch (e) { btn.classList.remove('running'); term('[ERROR]', def.label + ': ' + e.message, 't-error'); }
    };
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      try {
        const tab = btn.dataset.tab;
        const parent = btn.closest('.panel');
        parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        parent.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        const content = $(`${tab}-tab-content`);
        if (content) content.classList.remove('hidden');
        if (tab === 'files') loadFiles(currentPath, false);
        if (tab === 'net') loadNetworkList();
        if (tab === 'startup') loadStartupList();
      } catch (e) { }
    };
  });

  // Browser controls
  $('browserReadBtn') && ($('browserReadBtn').onclick = async () => {
    const url = $('browserUrl')?.value;
    if (!url) return;
    if ($('browserStatus')) $('browserStatus').textContent = 'Reading...';
    try {
      const res = await window.api.browserAuto({ url, action: 'read' });
      if ($('browserStatus')) $('browserStatus').textContent = res.success ? 'Read OK. See terminal.' : 'Error: ' + res.error;
      if (res.success) term('[BROWSER]', 'Read DOM: ' + res.result.slice(0, 100), 't-sys');
    } catch (e) { if ($('browserStatus')) $('browserStatus').textContent = e.message; }
  });

  $('browserFillBtn') && ($('browserFillBtn').onclick = async () => {
    const url = $('browserUrl')?.value;
    if (!url) return;
    let data; try { data = JSON.parse($('browserData')?.value || '{}'); } catch { return; }
    if ($('browserStatus')) $('browserStatus').textContent = 'Filling...';
    try {
      const res = await window.api.browserAuto({ url, action: 'fill', data });
      if ($('browserStatus')) $('browserStatus').textContent = res.success ? 'Fill OK.' : 'Error: ' + res.error;
    } catch (e) { if ($('browserStatus')) $('browserStatus').textContent = e.message; }
  });

  // Startup list
  async function loadStartupList() {
    try {
      const slist = $('startup-list');
      if (!slist) return;
      slist.innerHTML = 'Fetching tasks...';
      const progs = await window.api.getStartupProgs();
      slist.innerHTML = progs.map((p, i) => `
        <div style="padding:4px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80%">
            ${p.Name}<br><span style="color:var(--text-ghost);font-size:9px">${p.Command}</span>
          </div>
          <button id="sdis-${i}" style="background:#c8392b;color:#fff;border:none;border-radius:2px;font-size:9px;padding:2px 4px;cursor:pointer">DEL</button>
        </div>`).join('');

      progs.forEach((p, i) => {
        const btn = document.getElementById(`sdis-${i}`);
        if (btn) btn.onclick = async () => {
          btn.textContent = '...';
          const res = await window.api.disableStartup(p.Name);
          if (res.ok) { btn.textContent = 'OK'; setTimeout(loadStartupList, 500); }
          else btn.textContent = 'ERR';
        };
      });

      // Load Scheduled Tasks
      const schlist = $('schtasks-list');
      if (schlist) {
        schlist.innerHTML = 'Fetching cron jobs...';
        const tasksCsv = await window.api.getScheduledTasks();
        if (typeof tasksCsv !== 'string' || tasksCsv.includes('Error')) {
          schlist.innerHTML = 'Unavailable';
        } else {
          // Rudimentary CSV parse
          const lines = tasksCsv.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (lines.length > 1) {
            lines.shift(); // remove header
            schlist.innerHTML = lines.map((l) => {
              const parts = l.split('","');
              if (parts.length < 2) return '';
              const tName = parts[0].replace('"', '');
              let tNext = parts[1].replace('"', '');
              return `<div style="padding:4px;border-bottom:1px solid rgba(255,255,255,0.05);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${tName}<br><span style="color:var(--text-ghost);font-size:9px">Next Run: ${tNext}</span>
              </div>`;
            }).join('');
          } else {
            schlist.innerHTML = 'No active tasks found.';
          }
        }
      }
    } catch (e) { }
  }

  // Network list
  async function loadNetworkList() {
    try {
      const conns = await window.api.getNetworkDetails();
      const list = $('net-conn-list');
      if (!list) return;
      list.innerHTML = conns.slice(0, 50).map(c =>
        `<div class="net-item" style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
          <div style="display:flex;justify-content:space-between">
            <span>${c.protocol} ${c.localAddress}:${c.localPort}</span>
            <span style="color:var(--red)">${c.state || ''}</span>
          </div>
          <div style="font-size:11px;color:var(--text-ghost)">${c.peerAddress || '—'}</div>
        </div>`
      ).join('');
    } catch (e) { }
  }

  // File manager buttons
  $('file-go-btn') && ($('file-go-btn').onclick = () => loadFiles($('file-path-input')?.value || currentPath));
  $('file-back-btn') && ($('file-back-btn').onclick = () => { if (pathHistory.length > 0) loadFiles(pathHistory.pop(), false); });
  $('file-home-btn') && ($('file-home-btn').onclick = () => { pathHistory = []; loadFiles((window.api.platform === 'win32') ? 'C:\\' : (window.api.homeDir || '/')); });
  $('file-path-input') && ($('file-path-input').onkeydown = e => { if (e.key === 'Enter') loadFiles($('file-path-input').value); });

  // Window controls
  $('btnMin') && ($('btnMin').onclick = () => window.api.minimize());
  $('btnMax') && ($('btnMax').onclick = () => window.api.maximize());
  $('btnClose') && ($('btnClose').onclick = () => window.api.close());

  // Language switcher
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.onclick = () => {
      I18n.setLocale(btn.dataset.lang);
      Voice.updateLang();
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      config.lang = btn.dataset.lang;
      window.api.saveConfig(config).catch(() => { });
    };
  });

  // Settings gear button
  const gear = document.createElement('button');
  gear.className = 'wc-btn'; gear.textContent = '⚙'; gear.style.marginRight = '8px'; gear.title = 'Settings';
  document.querySelector('.win-controls')?.prepend(gear);

  gear.onclick = async () => {
    try {
      const cfg = await window.api.getConfig().catch(() => ({}));
      if ($('cfgName')) $('cfgName').value = cfg.userName || '';
      if ($('cfgAnthropic')) $('cfgAnthropic').value = cfg.anthropicKey || '';
      if ($('cfgOpenai')) $('cfgOpenai').value = cfg.openaiKey || '';
      if ($('cfgGemini')) $('cfgGemini').value = cfg.geminiKey || '';
      if ($('cfgOpenRouter')) $('cfgOpenRouter').value = cfg.openRouterKey || '';
      if ($('cfgPitch')) $('cfgPitch').value = cfg.pitch || 0.9;
      if ($('cfgRate')) $('cfgRate').value = cfg.rate || 0.95;
      if ($('cfgOllamaAuto')) $('cfgOllamaAuto').checked = !!cfg.ollamaAuto;

      const vSel = $('cfgVoice');
      if (vSel) {
        const voices = speechSynthesis.getVoices();
        vSel.innerHTML = '<option value="default">System Default</option>' +
          voices.map(v => `<option value="${v.name}" ${v.name === cfg.voice ? 'selected' : ''}>${v.name}</option>`).join('');
      }

      const sel = $('cfgModel');
      if (sel) {
        const models = ollamaModels.length ? ollamaModels : ['qwen2.5', 'llama3.1', 'llama3', 'mistral'];
        sel.innerHTML = models.map(m => `<option value="${m}" ${m === (cfg.aiModel || AI.getModel()) ? 'selected' : ''}>${m}</option>`).join('');
      }

      try {
        const plugins = await window.api.loadPlugins();
        if ($('cfgPluginsList')) {
          $('cfgPluginsList').innerHTML = plugins.map(p =>
            `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
               <span>${p.name}</span><input type="checkbox" checked disabled title="Plugin loaded" />
             </div>`
          ).join('') || 'No plugins found.';
        }
      } catch { }

      $('settings-overlay')?.classList.remove('hidden');
    } catch (e) { }
  };

  $('settingsClose') && ($('settingsClose').onclick = () => $('settings-overlay')?.classList.add('hidden'));
  $('settings-overlay') && ($('settings-overlay').onclick = e => { if (e.target === $('settings-overlay')) $('settings-overlay').classList.add('hidden'); });

  // Settings Tab Switcher
  document.querySelectorAll('.tab-btn[data-settab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn[data-settab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.set-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      const target = $('set-tab-' + btn.dataset.settab);
      if (target) target.classList.remove('hidden');
    };
  });

  $('btnAddPlugin') && ($('btnAddPlugin').onclick = async () => {
    try {
      const res = await window.api.importPlugin();
      if (res?.ok) {
        const plugins = await window.api.loadPlugins();
        if ($('cfgPluginsList')) {
          $('cfgPluginsList').innerHTML = plugins.map(p =>
            `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
               <span>${p.name}</span><input type="checkbox" checked disabled title="Plugin loaded" />
             </div>`
          ).join('') || 'No plugins found.';
        }
      }
    } catch { }
  });

  $('saveSettings') && ($('saveSettings').onclick = async () => {
    try {
      const cfg = {
        userName: $('cfgName')?.value.trim() || '',
        anthropicKey: $('cfgAnthropic')?.value.trim() || '',
        openaiKey: $('cfgOpenai')?.value.trim() || '',
        geminiKey: $('cfgGemini')?.value.trim() || '',
        openRouterKey: $('cfgOpenRouter')?.value.trim() || '',
        aiModel: $('cfgModel')?.value || 'qwen2.5',
        lang: I18n.getLocale(),
        voice: $('cfgVoice')?.value || 'default',
        pitch: parseFloat($('cfgPitch')?.value) || 0.9,
        rate: parseFloat($('cfgRate')?.value) || 0.95,
        ollamaAuto: $('cfgOllamaAuto')?.checked || false
      };
      await window.api.saveConfig(cfg);
      config = cfg;
      AI.setUserName(cfg.userName);
      AI.setModel(cfg.aiModel);
      Voice.setConfig(cfg.pitch, cfg.rate, cfg.voice);
      $('settings-overlay')?.classList.add('hidden');
      showToast('Settings', 'Configuration saved.');
      term('[SYSTEM]', 'Config saved — model: ' + cfg.aiModel, 't-proc');
    } catch (e) { showToast('Settings', 'Save failed: ' + e.message); }
  });

  // ── Clock ─────────────────────────────────────────────────────────────────
  setInterval(() => {
    const n = new Date();
    const pad = v => String(v).padStart(2, '0');
    setText('clock', `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`);
    setText('mUptime', formatUptime(Activity.getSessionSeconds()));
    setText('hd-uptime', formatUptime(Activity.getSessionSeconds()));
  }, 1000);

  function formatUptime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = v => String(v).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // ── Eye Animation ─────────────────────────────────────────────────────────
  const canvas = $('eyeCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let frame = 0;
    function animate() {
      frame++;
      ctx.clearRect(0, 0, 64, 44);
      ctx.strokeStyle = 'var(--red)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const blink = Math.sin(frame * 0.05) > 0.98 ? 0 : 1;
      ctx.ellipse(32, 22, 20, 12 * blink, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'var(--red)';
      ctx.beginPath();
      ctx.arc(32 + Math.sin(frame * 0.02) * 5, 22, 6 * blink, 0, Math.PI * 2);
      ctx.fill();
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ── Resizers ──────────────────────────────────────────────────────────────
  function initResizer(resizerId, panelId, side) {
    const resizer = $(resizerId);
    const panel = $(panelId);
    if (!resizer || !panel) return;
    let startX, startWidth;
    resizer.onmousedown = e => {
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      document.onmousemove = e => {
        const delta = e.clientX - startX;
        const newWidth = side === 'left' ? startWidth + delta : startWidth - delta;
        panel.style.width = Math.min(Math.max(newWidth, 150), 450) + 'px';
      };
      document.onmouseup = () => { document.onmousemove = document.onmouseup = null; };
    };
  }
  initResizer('resizer-left', 'panel-left', 'left');
  initResizer('resizer-right', 'panel-right', 'right');

  // ── Boot ──────────────────────────────────────────────────────────────────
  try {
    config = await window.api.getConfig().catch(() => ({}));
    I18n.setLocale(config.lang || 'en');
    AI.setUserName(config.userName || 'Dante');
    AI.setModel(config.aiModel || 'qwen2.5');
    await AI.loadHistory();

    const sys = await window.api.getSysInfo().catch(() => ({}));
    if (config.theme === 'light') document.body.classList.add('light-theme');
    Voice.setConfig(config.pitch || 0.9, config.rate || 0.95, config.voice || 'default');
    term('[SYSTEM]', `OS: ${sys.os || 'Unknown'} | CPU: ${sys.cpuModel || 'Unknown'}`, 't-sys');

    const models = await window.api.getOllamaModels().catch(() => ({ ok: false, models: [] }));
    ollamaModels = models.models || [];

    Activity.startChecking(advice => {
      showToast('Activity', advice.message);
      appendMsg('ai', advice.message);
    });

    loadFiles(currentPath, false);
  } catch (e) {
    term('[ERROR]', 'Boot failed: ' + e.message, 't-error');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════════════════
  term('[CARDINAL]', 'All systems armed and ready', 't-cardinal');
  playSound('startup');

})().catch(e => {
  // Last-resort catch — log to console if the entire IIFE somehow throws
  console.error('Cardinal renderer fatal error:', e);
});
