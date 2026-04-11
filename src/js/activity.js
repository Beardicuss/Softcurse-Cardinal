// ── Activity — monitor usage patterns, trigger proactive advice ───────────
const Activity = (() => {
  let sessionStart  = Date.now();
  let lastActivity  = Date.now();
  let breakSent     = false;
  let resumeSent    = false;
  let onAdvice      = null;
  let checkInterval = null;

  const BREAK_THRESHOLD   = 90 * 60 * 1000;  // 90 min
  const IDLE_THRESHOLD    =  5 * 60 * 1000;  // 5 min
  const CHECK_INTERVAL    = 60 * 1000;        // every 60s

  function recordActivity() {
    lastActivity = Date.now();
    resumeSent   = false; // reset so next return triggers greeting
  }

  function getSessionSeconds() {
    return Math.round((Date.now() - sessionStart) / 1000);
  }

  function getIdleSeconds() {
    return Math.round((Date.now() - lastActivity) / 1000);
  }

  function startChecking(adviceCb) {
    onAdvice = adviceCb;
    document.addEventListener('mousemove', recordActivity, { passive: true });
    document.addEventListener('keydown',   recordActivity, { passive: true });

    checkInterval = setInterval(() => {
      const idleMs    = Date.now() - lastActivity;
      const sessionMs = Date.now() - sessionStart;

      // Returned from being away
      if (idleMs < IDLE_THRESHOLD && !resumeSent && idleMs < CHECK_INTERVAL) {
        // do nothing — only trigger if we were actually idle
      }

      // User has been idle then came back
      // (this is handled via power-resume event in renderer)

      // Long session without break
      if (sessionMs >= BREAK_THRESHOLD && !breakSent && idleMs < IDLE_THRESHOLD) {
        breakSent = true;
        onAdvice?.({ type: 'break', message: I18n.t('break_suggestion') });
      }

      // Late night alert
      const hour = new Date().getHours();
      if ((hour >= 23 || hour < 5) && !this.lateNightSent) {
        this.lateNightSent = true;
        onAdvice?.({ type: 'late_night', message: "It's getting late. Remember to rest your eyes." });
      }

      // Check CPU spike (handled via system-update in renderer)
    }, CHECK_INTERVAL);
  }

  function stop() {
    clearInterval(checkInterval);
    document.removeEventListener('mousemove', recordActivity);
    document.removeEventListener('keydown',   recordActivity);
  }

  function onResume() {
    if (!resumeSent) {
      resumeSent = true;
      onAdvice?.({ type: 'resume', message: I18n.t('resume_greeting') });
    }
  }

  return { startChecking, stop, onResume, getSessionSeconds, getIdleSeconds, recordActivity };
})();
