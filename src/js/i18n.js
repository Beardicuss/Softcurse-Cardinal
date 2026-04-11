// ── i18n — simple translation engine ──────────────────────────────────
const I18n = (() => {
  let locale = 'en';
  const cache = {};

  const strings = {
    en: {
      process_intel:    'Process Intel',
      network_io:       'Network I/O',
      upload:           'Upload',
      download:         'Download',
      connections:      'Connections',
      temp:             'CPU Temp',
      system_health:    'System Health',
      integrity_score:  'Integrity Score',
      space_freed:      'Space Freed',
      threats_cleared:  'Threats Cleared',
      session_uptime:   'Session Uptime',
      threat_matrix:    'Threat Matrix',
      quick_actions:    'Quick Actions',
      run_defender:     'Run Defender',
      run_sfc:          'SFC Scan',
      run_defrag:       'Defrag C:',
      clear_cache:      'Clear Cache',
      send:             'Send',
      disk:             'Disk',
      anthropic_key:    'Anthropic API Key',
      openai_key:       'OpenAI API Key',
      user_name:        'Your Name',
      ollama_model:     'Ollama Model',
      save_settings:    'Save Settings',
      settings:         'Settings',
      cardinal_greeting:'System online. All sectors nominal. How can I assist?',
      break_suggestion: "You've been active for over 90 minutes. Consider a short break.",
      resume_greeting:  "Welcome back. System held steady while you were away.",
      reminder_label:   'Reminder',
    },
    ru: {
      process_intel:    'Процессы',
      network_io:       'Сеть I/O',
      upload:           'Отправка',
      download:         'Загрузка',
      connections:      'Соединения',
      temp:             'Темп. CPU',
      system_health:    'Здоровье системы',
      integrity_score:  'Целостность',
      space_freed:      'Освобождено',
      threats_cleared:  'Угроз нейтрализовано',
      session_uptime:   'Время сессии',
      threat_matrix:    'Матрица угроз',
      quick_actions:    'Быстрые действия',
      run_defender:     'Запустить Defender',
      run_sfc:          'Сканирование SFC',
      run_defrag:       'Дефрагментация C:',
      clear_cache:      'Очистить кэш',
      send:             'Отправить',
      disk:             'Диск',
      anthropic_key:    'Ключ Anthropic API',
      openai_key:       'Ключ OpenAI API',
      user_name:        'Ваше имя',
      ollama_model:     'Модель Ollama',
      save_settings:    'Сохранить',
      settings:         'Настройки',
      cardinal_greeting:'Система онлайн. Все сектора в норме. Чем могу помочь?',
      break_suggestion: 'Вы активны более 90 минут. Рекомендую короткий перерыв.',
      resume_greeting:  'С возвращением. Система работала стабильно.',
      reminder_label:   'Напоминание',
    },
    ka: {
      process_intel:    'პროცესები',
      network_io:       'ქსელი I/O',
      upload:           'გაგზავნა',
      download:         'ჩამოტვირთვა',
      connections:      'კავშირები',
      temp:             'CPU ტემპ.',
      system_health:    'სისტემის ჯანმრთელობა',
      integrity_score:  'მთლიანობა',
      space_freed:      'გათავისუფლებული',
      threats_cleared:  'საფრთხეები',
      session_uptime:   'სესიის დრო',
      threat_matrix:    'საფრთხის მატრიცა',
      quick_actions:    'სწრაფი მოქმედებები',
      run_defender:     'Defender-ის გაშვება',
      run_sfc:          'SFC სკანირება',
      run_defrag:       'დეფრაგ C:',
      clear_cache:      'ქეშის გასუფთავება',
      send:             'გაგზავნა',
      disk:             'დისკი',
      anthropic_key:    'Anthropic API გასაღები',
      openai_key:       'OpenAI API გასაღები',
      user_name:        'თქვენი სახელი',
      ollama_model:     'Ollama მოდელი',
      save_settings:    'შენახვა',
      settings:         'პარამეტრები',
      cardinal_greeting:'სისტემა ონლაინ. ყველა სექტორი ნორმალურია. რით დაგეხმარო?',
      break_suggestion: '90 წუთზე მეტია აქტიური ხარ. გირჩევ მოკლე შესვენებას.',
      resume_greeting:  'მოგესალმები. სისტემა სტაბილურად მუშაობდა.',
      reminder_label:   'შეხსენება',
    }
  };

  function applyToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val) el.textContent = val;
    });
  }

  function t(key) {
    return (strings[locale] && strings[locale][key]) ||
           (strings['en']   && strings['en'][key]) ||
           key;
  }

  function setLocale(l) {
    if (!strings[l]) return;
    locale = l;
    document.documentElement.lang = l;
    applyToDOM();
    document.querySelectorAll('.lang-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === l);
    });
  }

  function getLocale() { return locale; }

  return { t, setLocale, getLocale, applyToDOM };
})();
