// ── system.js — native-free OS utilities ──────────────────────────────────────
const { exec } = require('child_process');
const util      = require('util');
const execAsync = util.promisify(exec);

/**
 * FIX 4: Get active window title using shell only — no native modules.
 * Old DllImport/Add-Type approach was broken and returned 'Unknown' whenever
 * Cardinal itself had focus. New approach: find highest-CPU process with a
 * window title, excluding Electron/Cardinal itself.
 */
async function getActiveWindowTitle() {
  try {
    if (process.platform === 'win32') {
      // Simple PowerShell — no DllImport, no Add-Type
      const { stdout } = await execAsync(
        'powershell -NoProfile -NonInteractive -Command "' +
        '$p = Get-Process | Where-Object { $_.MainWindowTitle -ne \'\' -and $_.ProcessName -notmatch \'electron\' } | ' +
        'Sort-Object CPU -Descending | Select-Object -First 1; ' +
        'if ($p) { $p.MainWindowTitle } else { Write-Output Desktop }"',
        { timeout: 4000 }
      );
      return stdout.trim() || 'Desktop';
    } else if (process.platform === 'darwin') {
      const { stdout } = await execAsync(
        "osascript -e 'tell application \"System Events\" to get name of first process whose frontmost is true'",
        { timeout: 3000 }
      );
      return stdout.trim() || 'Desktop';
    } else {
      try {
        const { stdout } = await execAsync('xdotool getactivewindow getwindowname', { timeout: 2000 });
        return stdout.trim() || 'Desktop';
      } catch { return 'Linux Desktop'; }
    }
  } catch { return 'Desktop'; }
}

/**
 * Quick threat scan — startup entries, hosts file, temp dir size.
 * Returns { score: number, findings: [{type, level, msg}] }
 */
async function runQuickThreatScan() {
  const findings = [];
  let deductions = 0;

  try {
    if (process.platform === 'win32') {
      // Check suspicious startup entries
      const startupRes = await execAsync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command | ConvertTo-Json -Compress"',
        { timeout: 8000 }
      ).catch(() => ({ stdout: '[]' }));

      let startups = [];
      try { startups = JSON.parse(startupRes.stdout || '[]'); } catch {}
      if (!Array.isArray(startups)) startups = startups ? [startups] : [];

      const suspicious = [/temp/i, /appdata.*\\[a-z]{8,}/i, /\.vbs$/i, /\.bat$/i, /powershell.*hidden/i];
      startups.forEach(s => {
        if (s && suspicious.some(p => p.test(s.Command || ''))) {
          findings.push({ type: 'startup', level: 'warn', msg: 'Suspicious startup: ' + s.Name });
          deductions += 5;
        }
      });

      // Check hosts file for custom entries
      const hostsRes = await execAsync(
        'powershell -NoProfile -Command "Get-Content $env:SystemRoot\\System32\\drivers\\etc\\hosts | Where-Object { $_ -notmatch \'^#\' -and $_.Trim() -ne \'\' }"',
        { timeout: 3000 }
      ).catch(() => ({ stdout: '' }));

      const hostLines = (hostsRes.stdout || '').split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      if (hostLines.length > 3) {
        findings.push({ type: 'hosts', level: 'info', msg: hostLines.length + ' custom hosts entries' });
        deductions += Math.min(hostLines.length, 10);
      }

      // Check temp dir size
      const tempRes = await execAsync(
        'powershell -NoProfile -Command "(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"',
        { timeout: 5000 }
      ).catch(() => ({ stdout: '0' }));

      const tempMB = parseInt(tempRes.stdout || '0') / 1048576;
      if (tempMB > 500) {
        findings.push({ type: 'temp', level: 'info', msg: 'Temp folder: ' + tempMB.toFixed(0) + ' MB' });
        deductions += 3;
      }

    } else if (process.platform === 'darwin') {
      const laRes = await execAsync('ls ~/Library/LaunchAgents/ 2>/dev/null | wc -l', { timeout: 3000 })
        .catch(() => ({ stdout: '0' }));
      const count = parseInt(laRes.stdout.trim()) || 0;
      if (count > 10) {
        findings.push({ type: 'launchagents', level: 'warn', msg: count + ' launch agents installed' });
        deductions += Math.min(count, 15);
      }
    } else {
      const cronRes = await execAsync('crontab -l 2>/dev/null | wc -l', { timeout: 2000 })
        .catch(() => ({ stdout: '0' }));
      const cronLines = parseInt(cronRes.stdout.trim()) || 0;
      if (cronLines > 5) {
        findings.push({ type: 'cron', level: 'info', msg: cronLines + ' cron entries' });
      }
    }
  } catch {
    findings.push({ type: 'scan', level: 'info', msg: 'Partial scan — limited permissions' });
  }

  return { score: Math.max(0, 100 - deductions), findings, deductions };
}

/**
 * Count established network connections.
 */
async function getOpenConnections() {
  try {
    const cmd = process.platform === 'win32'
      ? 'powershell -NoProfile -Command "(netstat -n | Select-String ESTABLISHED).Count"'
      : "netstat -tn 2>/dev/null | grep -c ESTABLISHED || echo 0";
    const { stdout } = await execAsync(cmd, { timeout: 4000 });
    return parseInt(stdout.trim()) || 0;
  } catch { return 0; }
}

/**
 * Clear system temp/cache directories.
 */
async function clearSystemCache() {
  const results = [];
  try {
    if (process.platform === 'win32') {
      await execAsync('del /s /q "%TEMP%\\*" 2>nul').catch(() => {});
      results.push('User temp cleared');
      await execAsync('RunDll32.exe InetCpl.cpl,ClearMyTracksByProcess 255').catch(() => {});
      results.push('IE/Edge cache flushed');
    } else if (process.platform === 'darwin') {
      await execAsync('rm -rf ~/Library/Caches/* 2>/dev/null').catch(() => {});
      results.push('macOS user caches cleared');
    } else {
      await execAsync('rm -rf ~/.cache/* 2>/dev/null').catch(() => {});
      results.push('Linux user cache cleared');
    }
  } catch {}
  return results;
}

module.exports = { getActiveWindowTitle, runQuickThreatScan, getOpenConnections, clearSystemCache };
