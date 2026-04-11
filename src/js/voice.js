// ── Voice — STT + TTS via Web Speech API ────────────────────────────────
const Voice = (() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening    = false;
  let onResult     = null;
  let onStateChange= null;

  const langMap = { en: 'en-US', ru: 'ru-RU', ka: 'ka-GE' };
  const WAKE_WORDS = ['cardinal', 'кардинал', 'კარდინალი'];

  function initRecognition() {
    if (!SpeechRecognition) return null;
    const r = new SpeechRecognition();
    r.continuous      = true;
    r.interimResults  = true;
    r.lang            = langMap[I18n.getLocale()] || 'en-US';

    r.onresult = (e) => {
      let final = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final   += e.results[i][0].transcript;
        else                      interim += e.results[i][0].transcript;
      }

      const text = (final || interim).trim().toLowerCase();
      const hasWake = WAKE_WORDS.some(w => text.startsWith(w));
      const payload = hasWake
        ? (final || interim).trim().replace(new RegExp(WAKE_WORDS.join('|'), 'i'), '').trim()
        : (final || interim).trim();

      if (final && onResult) onResult(payload || final.trim(), true);
    };

    r.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (e.error === 'not-allowed') {
        console.error('Microphone access denied');
      }
      console.warn('STT error:', e.error);
      setListening(false);
    };

    r.onend = () => {
      if (listening) {
        try { r.start(); } catch (e) { console.warn('STT restart failed:', e); }
      }
    };

    return r;
  }

  function setListening(val) {
    listening = val;
    onStateChange?.(val);
  }

  function start(cb, stateCb) {
    if (!SpeechRecognition) {
      console.warn('Web Speech API not available');
      return false;
    }
    onResult      = cb;
    onStateChange = stateCb;
    recognition   = initRecognition();
    recognition.lang = langMap[I18n.getLocale()] || 'en-US';
    try {
      recognition.start();
      setListening(true);
      return true;
    } catch (e) {
      console.error('STT start failed:', e);
      return false;
    }
  }

  function stop() {
    listening = false;
    recognition?.stop();
    onStateChange?.(false);
  }

  function toggle(cb, stateCb) {
    return listening ? (stop(), false) : start(cb, stateCb);
  }

  function speak(text, lang) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = langMap[lang || I18n.getLocale()] || 'en-US';
    utt.rate   = 0.95;
    utt.pitch  = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const match  = voices.find(v => v.lang.startsWith(utt.lang.split('-')[0]));
    if (match) utt.voice = match;
    window.speechSynthesis.speak(utt);
  }

  function updateLang() {
    if (recognition) recognition.lang = langMap[I18n.getLocale()] || 'en-US';
  }

  function isListening() { return listening; }
  function isAvailable()  { return !!SpeechRecognition; }

  return { start, stop, toggle, speak, updateLang, isListening, isAvailable };
})();
