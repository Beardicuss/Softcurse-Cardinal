// ── Voice — STT + TTS via Web Speech API ────────────────────────────────
const Voice = (() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let onResult = null;
  let onStateChange = null;
  let confPitch = 0.9;
  let confRate = 0.95;
  let confVoice = 'default';

  const langMap = { en: 'en-US', ru: 'ru-RU', ka: 'ka-GE' };
  const WAKE_WORDS = ['cardinal', 'кардинал', 'კარდინალი'];

  let mediaRecorder = null;
  let audioChunks = [];

  function setListening(val) {
    listening = val;
    onStateChange?.(val);
  }

  function startWakeWordListener(triggerCb) {
    if (!SpeechRecognition) return false;
    if (!recognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = langMap[I18n?.getLocale?.() || 'en'] || 'en-US';

      recognition.onresult = (e) => {
        if (listening) return; // Ignore if we are actively communicating
        const transcript = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();

        // Exact wake word threshold logic
        if (WAKE_WORDS.some(w => transcript.includes(w))) {
          if (triggerCb) triggerCb();
        }
      };

      // Restart silently if OS kills the background listen stream
      recognition.onend = () => {
        if (!listening) {
          try { recognition.start(); } catch (e) { }
        }
      };

      try { recognition.start(); } catch (e) { }
    }
  }

  async function start(cb, stateCb) {
    if (recognition) { try { recognition.stop(); } catch (e) { } }
    onResult = cb;
    onStateChange = stateCb;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        setListening(false);
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];

        // Release tracks
        stream.getTracks().forEach(t => t.stop());

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64data = reader.result.split(',')[1];
          try {
            const res = await window.api.transcribeAudio(base64data);
            if (res?.ok && res?.text) {
              const text = res.text.trim();
              const payload = text.toLowerCase().replace(new RegExp('^(cardinal|кардинал|კარდინალი)[\\s,]*', 'i'), '').trim();
              if (onResult && payload) onResult(payload, true);
            }
          } catch (e) { }
        };
      };

      mediaRecorder.start();
      setListening(true);
      return true;
    } catch (e) {
      console.error('Mic start failed:', e);
      return false;
    }
  }

  function stop() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    } else {
      setListening(false);
    }
    // Re-engage passive wake-word layer
    if (recognition && !listening) {
      setTimeout(() => { try { recognition.start(); } catch (e) { } }, 500);
    }
  }

  function toggle(cb, stateCb) {
    return listening ? (stop(), false) : start(cb, stateCb);
  }

  function speak(text, lang) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = langMap[lang || I18n.getLocale()] || 'en-US';
    utt.rate = confRate;
    utt.pitch = confPitch;
    const voices = window.speechSynthesis.getVoices();
    let match = null;
    if (confVoice && confVoice !== 'default') {
      match = voices.find(v => v.name === confVoice);
    }
    if (!match) {
      match = voices.find(v => v.lang.startsWith(utt.lang.split('-')[0]));
    }
    if (match) utt.voice = match;
    window.speechSynthesis.speak(utt);
  }

  function updateLang() {
    if (recognition) recognition.lang = langMap[I18n.getLocale()] || 'en-US';
  }

  function setConfig(pitch, rate, voice) {
    confPitch = pitch || 0.9;
    confRate = rate || 0.95;
    confVoice = voice || 'default';
  }

  function isListening() { return listening; }
  function isAvailable() { return !!SpeechRecognition; }

  return { start, stop, toggle, startWakeWordListener, speak, updateLang, setConfig, isListening, isAvailable };
})();
