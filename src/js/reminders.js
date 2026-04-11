// ── Reminders ─────────────────────────────────────────────────────────────
const Reminders = (() => {
  let onDue = null;

  function parseNaturalTime(text) {
    // "in 30 minutes", "in 2 hours", "через 15 минут"
    const patterns = [
      { re: /in\s+(\d+)\s+min/i,         mult: 60000 },
      { re: /in\s+(\d+)\s+hour/i,        mult: 3600000 },
      { re: /через\s+(\d+)\s+мин/i,      mult: 60000 },
      { re: /через\s+(\d+)\s+час/i,      mult: 3600000 },
      { re: /(\d+)\s*min/i,              mult: 60000 },
      { re: /(\d+)\s*h(?:our)?/i,        mult: 3600000 },
    ];

    for (const { re, mult } of patterns) {
      const m = text.match(re);
      if (m) return parseInt(m[1]) * mult;
    }
    return null;
  }

  function extractReminder(text) {
    // "Remind me to X in Y minutes"
    const m = text.match(/remind(?:\s+me)?\s+to\s+(.+?)\s+in\s+(\d+)\s+(min|hour)/i)
           || text.match(/напомни(?:\s+мне)?\s+(.+?)\s+через\s+(\d+)\s+(мин|час)/i);

    if (m) {
      const what   = m[1].trim();
      const amount = parseInt(m[2]);
      const unit   = m[3].toLowerCase();
      const ms     = unit.startsWith('h') || unit === 'час' ? amount * 3600000 : amount * 60000;
      return { text: what, ms };
    }
    return null;
  }

  async function add(text, ms) {
    const due = Date.now() + ms;
    return window.api.addReminder({ text, due });
  }

  async function tryParseAndAdd(userText) {
    const r = extractReminder(userText);
    if (!r) return false;
    await add(r.text, r.ms);
    return r;
  }

  function setOnDue(cb) { onDue = cb; }

  function handleDue(data) { onDue?.(data); }

  return { add, tryParseAndAdd, parseNaturalTime, setOnDue, handleDue };
})();
