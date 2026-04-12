// ── AI — LLM conversation engine (Ollama: qwen2.5 / llama3.1 priority) ────────
const AI = (() => {
  let history = [];
  let sysState = {};
  let userName = '';
  let thinking = false;
  let preferredModel = 'qwen2.5';
  let pluginDescriptions = [];

  const ACTIONS = {
    kill_process: async (p) => window.api.killProcess(p.pid),
    run_command: async (p) => window.api.runCommand(p.cmd),
    run_defender: async () => window.api.runDefender(),
    run_sfc: async () => window.api.runSfc(),
    run_defrag: async () => window.api.runDefrag(),
    clear_cache: async () => window.api.clearCache(),
    run_threat_scan: async () => window.api.runThreatScan(),
    set_reminder: async (p) => {
      const due = Date.now() + (p.minutes || 30) * 60000;
      return window.api.addReminder({ text: p.text || p.message, due });
    },
    open_url: async (p) => window.api.openExternal(p.url),
    clear_history: async () => window.api.clearHistory(),
    browser_read: async (p) => window.api.browserAuto({ url: p.url, action: 'read' }),
    browser_fill: async (p) => window.api.browserAuto({ url: p.url, action: 'fill', data: p.data }),
    elevate_admin: async () => window.api.elevateAdmin(),
    update_profile: async (p) => window.api.updateProfile(p.key, p.val),
  };

  function buildSystemPrompt() {
    const now = new Date();
    const langName = { en: 'English', ru: 'Russian', ka: 'Georgian' }[I18n.getLocale()] || 'English';
    const top = sysState.processes?.[0];
    const profile = sysState.profile || {};

    return `You are Cardinal, an OS commander and companion built by Softcurse Systems.
You are direct, composed, observant, and occasionally dry-witted.
You have full situational awareness of the machine you run on.
You learn the user's patterns: working hours, frequent apps, and habits.
Current Profile: ${JSON.stringify(profile)}
${userName ? `The user's name is ${userName}. Address them occasionally by name.` : ''}
Keep responses concise and purposeful. No filler. You can use markdown in chat.

When you need to take an action, append a JSON block at the very end of your reply:
{"action":"action_name","params":{}}

Available actions:
- kill_process       params: { pid: number, name: string }
- run_command        params: { cmd: string }
- run_defender       (no params) — Windows Defender quick scan
- run_sfc            (no params) — System File Checker
- run_defrag         (no params) — Defragment C: drive
- clear_cache        (no params) — clear system temp/cache
- run_threat_scan    (no params) — quick security scan
- set_reminder       params: { text: string, minutes: number }
- open_url           params: { url: string }
- browser_read       params: { url: string } — read text from a webpage
- browser_fill       params: { url: string, data: object } — fill form fields (key=selector, val=text)
- elevate_admin      (no params) — request admin rights on Windows
- update_profile     params: { key: string, val: any } — update user profile/habits
${pluginDescriptions.join('\n')}

Only include the JSON block when an action is actually needed. Never fabricate it.

Current system state:
- Time: ${now.toLocaleTimeString()} | Date: ${now.toLocaleDateString()}
- CPU: ${sysState.cpu || 0}% | RAM: ${sysState.ram || 0}% (${sysState.ramUsed || 0}/${sysState.ramTotal || 0} GB)
- Disk: ${sysState.diskPct || 0}% used (${sysState.diskFree || 0} GB free)
- CPU Temp: ${sysState.temp ? sysState.temp + '°C' : 'unknown'}
- Network: ↑${sysState.upload || 0} ↓${sysState.download || 0} MB/s
- Active window: ${sysState.activeWindow || 'unknown'}
- Top process: ${top ? `${top.name} (${top.cpu}% CPU, ${top.mem}MB RAM)` : 'unknown'}
- Session uptime: ${formatUptime(sysState.uptime || 0)}
- Space freed this session: ${sysState.spaceFreed || 0} GB
- Threats found: ${sysState.threatsFound || 0}

Respond in ${langName}.`;
  }

  function formatUptime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function parseAction(text) {
    const match = text.match(/\{[\s\S]*?"action"[\s\S]*?\}(?:\s*)$/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }

  function cleanText(text) {
    return text.replace(/\{[\s\S]*?"action"[\s\S]*?\}(?:\s*)$/, '').trim();
  }

  async function send(userMessage) {
    if (thinking) return null;
    thinking = true;
    history.push({ role: 'user', content: userMessage });
    try {
      const result = await window.api.aiChat({
        messages: history.map(h => ({ role: h.role, content: h.content })),
        systemPrompt: buildSystemPrompt(),
        model: preferredModel
      });
      const rawText = result.text || '';
      const cleanResp = cleanText(rawText);
      const action = parseAction(rawText);
      history.push({ role: 'assistant', content: cleanResp });
      await window.api.saveMessage({ role: 'user', content: userMessage });
      await window.api.saveMessage({ role: 'assistant', content: cleanResp });
      let actionResult = null;
      if (action && ACTIONS[action.action]) {
        try {
          actionResult = await ACTIONS[action.action](action.params || {});
          if (action.action === 'update_profile') {
            const newProfile = await window.api.getProfile();
            updateState({ profile: newProfile });
          }
        } catch (e) {
          console.warn('Action failed:', action.action, e.message);
        }
      }
      return { text: cleanResp, action, actionResult, provider: result.provider, ok: result.ok };
    } catch (e) {
      console.error('AI send error:', e);
      return { text: 'Error communicating with AI engine.', action: null, ok: false };
    } finally {
      thinking = false;
    }
  }

  async function loadHistory() {
    const h = await window.api.getHistory().catch(() => []);
    history = h.map(r => ({ role: r.role, content: r.content }));
    const profile = await window.api.getProfile().catch(() => ({}));
    updateState({ profile });
  }

  function updateState(state) { sysState = { ...sysState, ...state }; }
  function setUserName(name) { userName = name; }
  function setModel(m) { preferredModel = m; }
  function getModel() { return preferredModel; }
  function isThinking() { return thinking; }

  function registerAction(name, description, fn) {
    ACTIONS[name] = fn;
    pluginDescriptions.push(`- ${name}       ${description}`);
  }

  return { send, updateState, setUserName, setModel, getModel, loadHistory, isThinking, registerAction };
})();
