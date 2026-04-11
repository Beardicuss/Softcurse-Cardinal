// ── Renderer — fully wired UI controller ──────────────────────────────────────
(async () => {
  const $ = id => document.getElementById(id);

  let sysState      = {};
  let selectedProc  = null;
  let cpuAlertSent  = false;
  let config        = {};
  let ollamaModels  = [];
  let currentPath   = '/';

  // ── Boot ──────────────────────────────────────────────────────────────────
  config = await window.api.getConfig().catch(() => ({}));
  if (config.userName)  AI.setUserName(config.userName);
  if (config.lang)      I18n.setLocale(config.lang);
  if (config.aiModel)   AI.setModel(config.aiModel);
  else                  I18n.applyToDOM();

  await AI.loadHistory();
  
  // Load Plugins
  const plugins = await window.api.loadPlugins().catch(() => []);
  plugins.forEach(p => {
    try {
      const fn = new Function('AI', 'window', p.content);
      fn(AI, window);
      term('[PLUGINS]', `Loaded: ${p.name}`, 't-cardinal');
    } catch (e) { console.error(`Plugin ${p.name} failed:`, e); }
  });

  const ollamaInfo = await window.api.getOllamaModels().catch(() => ({ ok: false, models: [] }));
  ollamaModels = ollamaInfo.models;
  const ollamaStatus = ollamaInfo.ok
    ? `Ollama online — models: ${ollamaModels.join(', ')}`
    : 'Ollama offline — add API key in Settings or run: ollama serve';

  const sysInfo = await window.api.getSysInfo().catch(() => ({}));
  term('[SYSTEM]', `Cardinal online — ${sysInfo.os || 'OS'} / ${sysInfo.hostname || 'host'}`, 't-sys');
  term('[SYSTEM]', `CPU: ${sysInfo.cpuModel || '?'} · RAM: ${sysInfo.totalRam || '?'} GB`, 't-sys');
  term('[CARDINAL]', ollamaStatus, ollamaInfo.ok ? 't-cardinal' : 't-error');

  const greeting = I18n.t('cardinal_greeting');
  appendMsg('ai', greeting);
  Voice.speak(greeting);

  // ── Clock ─────────────────────────────────────────────────────────────────
  setInterval(() => {
    const n = new Date();
    const pad = v => String(v).padStart(2,'0');
    $('clock').textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
  }, 1000);

  // ── Eye canvas ────────────────────────────────────────────────────────────
  (function initEye() {
    const canvas = $('eyeCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    let blinkState = 'open', openness = 1, blinkStart = 0;
    let nextBlink  = Date.now() + 3000 + Math.random() * 4000;
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
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = '#060608'; ctx.fillRect(0, 0, W, H);
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200,57,43,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,57,43,0.18)'; ctx.fill();
      ctx.strokeStyle = 'rgba(200,57,43,0.9)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#c8392b'; ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(200,57,43,0.92)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx-ew, cy);
      ctx.bezierCurveTo(cx-ew, cy-eh, cx+ew, cy-eh, cx+ew, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx-ew, cy);
      ctx.bezierCurveTo(cx-ew, cy+eh, cx+ew, cy+eh, cx+ew, cy); ctx.stroke();
    }

    function tick() {
      const now = Date.now();
      if (blinkState === 'open' && now >= nextBlink) { blinkState = 'closing'; blinkStart = now; }
      if (blinkState === 'closing') {
        openness = Math.max(0.02, 1 - (now - blinkStart) / CLOSE_MS);
        if (now - blinkStart >= CLOSE_MS) { blinkState = 'closed'; blinkStart = now; openness = 0.02; }
      } else if (blinkState === 'closed') {
        if (now - blinkStart >= PAUSE_MS) { blinkState = 'opening'; blinkStart = now; }
      } else if (blinkState === 'opening') {
        openness = Math.min(1, (now - blinkStart) / OPEN_MS);
        if (now - blinkStart >= OPEN_MS) { blinkState = 'open'; openness = 1; nextBlink = now + 3000 + Math.random() * 5000; }
      }
      drawEye(openness);
      requestAnimationFrame(tick);
    }
    tick();
  })();

  // ── Sparkline Chart ───────────────────────────────────────────────────────
  const sparkHistory = { cpu: [], ram: [] };
  function updateSparkline(data) {
    const canvas = $('sparklineChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;
    sparkHistory.cpu.push(data.cpu);
    sparkHistory.ram.push(data.ram);
    if (sparkHistory.cpu.length > 60) { sparkHistory.cpu.shift(); sparkHistory.ram.shift(); }
    ctx.clearRect(0, 0, W, H);
    const step = W / 60;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(212, 113, 42, 0.3)';
    ctx.lineWidth = 1;
    sparkHistory.ram.forEach((v, i) => {
      const x = i * step;
      const y = H - (v / 100 * H);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(200, 57, 43, 0.8)';
    ctx.lineWidth = 1.5;
    sparkHistory.cpu.forEach((v, i) => {
      const x = i * step;
      const y = H - (v / 100 * H);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // ── Tab Switching ─────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      const parent = btn.closest('.panel');
      parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      parent.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      $(`${tab}-tab-content`).classList.remove('hidden');
      if (tab === 'files') loadFiles(currentPath);
      if (tab === 'net') loadNetwork();
    };
  });

  // ── File Manager ──────────────────────────────────────────────────────────
  async function loadFiles(dir) {
    currentPath = dir;
    $('file-path-input').value = dir;
    try {
      const files = await window.api.fileList(dir);
      const list = $('file-list');
      list.innerHTML = files.map(f => `
        <div class="file-item" data-path="${f.path}" data-dir="${f.isDirectory}">
          ${f.isDirectory ? '📁' : '📄'} ${f.name}
        </div>
      `).join('');
      list.querySelectorAll('.file-item').forEach(el => {
        el.onclick = () => {
          if (el.dataset.dir === 'true') loadFiles(el.dataset.path);
        };
        el.oncontextmenu = (e) => {
          e.preventDefault();
          if (confirm(`Delete ${el.dataset.path}?`)) {
            window.api.fileDelete(el.dataset.path).then(() => loadFiles(currentPath));
          }
        };
      });
    } catch (e) { term('[FILES]', `Error: ${e.message}`, 't-error'); }
  }
  $('file-go-btn').onclick = () => loadFiles($('file-path-input').value);

  // ── Network Monitor ───────────────────────────────────────────────────────
  async function loadNetwork() {
    try {
      const conns = await window.api.getNetworkDetails();
      const list = $('net-conn-list');
      list.innerHTML = conns.map(c => `
        <div class="net-item">
          <div style="display:flex;justify-content:space-between">
            <span>${c.protocol} ${c.localAddress}:${c.localPort}</span>
            <span style="color:var(--red)">${c.state}</span>
          </div>
          <div style="font-size:8px;color:var(--text-lo)">${c.peerAddress || '—'}</div>
        </div>
      `).join('');
    } catch (e) { term('[NET]', `Error: ${e.message}`, 't-error'); }
  }

  // ── System updates ────────────────────────────────────────────────────────
  window.api.on('system-update', (data) => {
    sysState = data;
    AI.updateState(data);
    setVital('vCpu',  data.cpu + '%',         data.cpu,     'vCpuBar',  data.cpu  > 80 ? '#d4712a' : '#c8392b');
    setVital('vRam',  data.ram + '%',         data.ram,     'vRamBar',  data.ram  > 80 ? '#d4712a' : '#c8392b');
    setVital('vDisk', data.diskPct + '%',     data.diskPct, 'vDiskBar', data.diskPct > 85 ? '#c8392b' : '#d4712a');
    setVital('vNet',  data.download + ' MB/s', Math.min(data.download * 8, 100), 'vNetBar', '#5aaa70');
    updateSparkline(data);
    setText('netUp',   '↑ ' + data.upload   + ' MB/s');
    setText('netDown', '↓ ' + data.download + ' MB/s');
    setText('netConns', data.netConns + ' procs');
    setText('cpuTemp',  data.temp ? data.temp + '°C' : '—');
    setText('hd-temp',   data.temp ? data.temp + '°C' : '—°C');
    setText('hd-cpu',    data.cpu + '%');
    setText('hd-ram',    data.ram + '%');
    setText('hd-proc',   data.processes?.length || '—');
    const s = data.uptime || 0;
    const pad = v => String(v).padStart(2,'0');
    const uptStr = `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;
    setText('mUptime',   uptStr);
    setText('hd-uptime', `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}`);
    if (data.spaceFreed !== undefined) setText('mSpaceFreed', data.spaceFreed.toFixed(1));
    if (data.threatsFound !== undefined) setText('mThreats', data.threatsFound);
    renderProcs(data.processes || []);
    if (data.activeWindow) setText('hd-win', data.activeWindow.slice(0, 22));
  });

  // ── FIX: threat-update now wired — updates real integrity score + matrix ──
  window.api.on('threat-update', (data) => {
    const score = data.score ?? 98;
    setText('mIntegrity', score);
    const iBar = document.getElementById('integrityBar');
    if (iBar) {
      iBar.style.width = score + '%';
      iBar.style.background = score > 80 ? '#5aaa70' : score > 60 ? '#d4712a' : '#c8392b';
    }
    const updateBar = (id, pct, color) => {
      const el = document.getElementById(id);
      if (el) { el.style.width = pct + '%'; el.style.background = color; }
    };
    const finds = data.findings || [];
    const hasStartup = finds.some(f => f.type === 'startup');
    const hasHosts   = finds.some(f => f.type === 'hosts');
    updateBar('tbarMalware',  hasStartup ? 35 : 5,   '#c8392b');
    updateBar('tbarAdware',   hasHosts   ? 28 : 8,   '#d4712a');
    updateBar('tbarNetwork',  (data.conns || 0) > 50 ? 45 : 12, '#d4712a');
    updateBar('tbarIntegrity', score > 80 ? 3 : 22,  '#5aaa70');
    finds.forEach(f => term('[SCAN]', f.msg, f.level === 'warn' ? 't-error' : 't-sys'));
  });

  // ── FIX: reminder-due now wired ──────────────────────────────────────────
  window.api.on('reminder-due', (data) => {
    showToast(I18n ? I18n.t('reminder_label') : 'Reminder', data.text);
    appendMsg('ai', 'Reminder: ' + data.text);
    if (typeof Voice !== 'undefined') Voice.speak(data.text);
    window.api.dismissReminder(data.id);
  });

  // ── FIX: power-resume now wired ──────────────────────────────────────────
  window.api.on('power-resume', () => {
    const msg = typeof I18n !== 'undefined' ? I18n.t('resume_greeting') : 'Welcome back. System held steady.';
    appendMsg('ai', msg);
    if (typeof Voice !== 'undefined') Voice.speak(msg);
  });



  // ── UI Helpers ────────────────────────────────────────────────────────────
  function setText(id, txt) { if ($(id)) $(id).textContent = txt; }
  function setVital(id, txt, pct, barId, color) {
    setText(id, txt);
    if ($(barId)) {
      $(barId).style.width = pct + '%';
      if (color) $(barId).style.background = color;
    }
  }

  function renderProcs(list) {
    const container = $('proc-list');
    if (!container) return;
    container.innerHTML = list.map(p => `
      <div class="proc-item ${selectedProc === p.pid ? 'selected' : ''}" data-pid="${p.pid}" data-name="${p.name}">
        <div class="proc-top">
          <span class="proc-name">${p.name}</span>
          <span class="proc-pid">${p.pid}</span>
        </div>
        <div class="proc-bars">
          <div class="pbar-wrap">
            <span class="pbar-lbl">CPU</span>
            <div class="pbar-outer"><div class="pbar-inner" style="width:${Math.min(p.cpu, 100)}%; background:${p.cpu > 50 ? 'var(--red)' : 'var(--text-lo)'}"></div></div>
            <span class="pbar-val" style="color:${p.cpu > 50 ? 'var(--red)' : 'inherit'}">${p.cpu}%</span>
          </div>
          <div class="pbar-wrap">
            <span class="pbar-lbl">MEM</span>
            <div class="pbar-outer"><div class="pbar-inner" style="width:${Math.min(p.mem/10, 100)}%; background:var(--text-lo)"></div></div>
            <span class="pbar-val">${p.mem}M</span>
          </div>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.proc-item').forEach(el => {
      el.onclick = () => { selectedProc = parseInt(el.dataset.pid); renderProcs(list); };
      el.oncontextmenu = (e) => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, el.dataset.name, el.dataset.pid); };
    });
  }

  function showCtxMenu(x, y, name, pid) {
    const menu = $('ctx-menu');
    $('ctxProcName').textContent = name.toUpperCase();
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    menu.classList.remove('hidden');
    $('ctxKill').onclick = async () => {
      const res = await window.api.killProcess(parseInt(pid));
      if (res.success) term('[SYSTEM]', `Killed process ${name} (${pid})`, 't-sys');
      menu.classList.add('hidden');
    };
    $('ctxAsk').onclick = () => {
      $('chatInput').value = `What is ${name} doing?`;
      menu.classList.add('hidden');
      $('sendBtn').click();
    };
    document.addEventListener('click', () => menu.classList.add('hidden'), { once: true });
  }

  function term(tag, msg, cls) {
    const log = $('term-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'term-line ' + (cls || '');
    div.innerHTML = `<span class="t-tag">${tag}</span> ${msg}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function appendMsg(role, text) {
    const log = $('chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = `msg msg-${role}`;
    div.innerHTML = `<div class="msg-bubble">${text.replace(/\n/g, '<br>')}</div>`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function showToast(title, msg) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<strong>${title}</strong><p>${msg}</p>`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 5000);
  }

  // ── Events ────────────────────────────────────────────────────────────────
  $('sendBtn').onclick = async () => {
    const input = $('chatInput');
    const val = input.value.trim();
    if (!val) return;
    input.value = '';
    appendMsg('user', val);
    const resp = await AI.send(val);
    if (resp) {
      appendMsg('ai', resp.text);
      if (resp.action) term('[AI]', `Action: ${resp.action.action}`, 't-cardinal');
    }
  };
  $('chatInput').onkeydown = (e) => { if (e.key === 'Enter') $('sendBtn').click(); };
  $('micBtn').onclick = () => {
    if (!Voice.isAvailable()) {
      showToast('Voice', 'Web Speech API not available in this environment.');
      return;
    }
    Voice.toggle(
      (text, isFinal) => { if (isFinal) { $('chatInput').value = text; $('sendBtn').click(); } },
      (active) => {
        $('micIndicator').classList.toggle('active', active);
        $('micLabel').textContent = active ? 'LISTENING' : 'MIC OFF';
        $('micBtn').classList.toggle('active', active);
      }
    );
  };
  $('termClear').onclick = () => { $('term-log').innerHTML = ''; };

  const gear = document.createElement('button');
  gear.className = 'wc-btn'; gear.innerHTML = '⚙'; gear.style.marginRight = '8px';
  $('topbar').querySelector('.win-controls').prepend(gear);
  gear.onclick = async () => {
    // Pre-load saved config into settings fields
    const cfg = await window.api.getConfig().catch(() => ({}));
    const nameEl = document.getElementById('cfgName');
    const modelEl = document.getElementById('cfgModel');
    const anthEl = document.getElementById('cfgAnthropic');
    const oaiEl = document.getElementById('cfgOpenai');
    if (nameEl) nameEl.value = cfg.userName || '';
    if (anthEl) anthEl.value = cfg.anthropicKey || '';
    if (oaiEl) oaiEl.value = cfg.openaiKey || '';
    // Populate model dropdown with real Ollama models
    if (modelEl) {
      const ollamaRes = await window.api.getOllamaModels().catch(() => ({ ok: false, models: [] }));
      const models = ollamaRes.models.length ? ollamaRes.models : ['qwen2.5', 'llama3.1', 'llama3', 'mistral'];
      modelEl.innerHTML = models.map(m => `<option value="${m}" ${m === (cfg.aiModel || 'qwen2.5') ? 'selected' : ''}>${m}</option>`).join('');
    }
    document.getElementById('settings-overlay').classList.remove('hidden');
  };
  $('settingsClose').onclick = () => $('settings-overlay').classList.add('hidden');
  $('saveSettings').onclick = async () => {
    const cfg = { userName: $('cfgName').value, aiModel: $('cfgModel').value, anthropicKey: $('cfgAnthropic').value, openaiKey: $('cfgOpenai').value, lang: typeof I18n !== 'undefined' ? I18n.getLocale() : 'en' };
    await window.api.saveConfig(cfg);
    AI.setUserName(cfg.userName); AI.setModel(cfg.aiModel);
    $('settings-overlay').classList.add('hidden');
    showToast('Settings', 'Configuration saved.');
  };

  $('btnMin').onclick = () => window.api.minimize();
  $('btnMax').onclick = () => window.api.maximize();
  $('btnClose').onclick = () => window.api.close();

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.onclick = () => {
      const lang = btn.dataset.lang;
      I18n.setLocale(lang); Voice.updateLang();
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
})();
