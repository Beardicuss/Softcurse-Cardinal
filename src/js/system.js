// ── system.js — native-free OS utilities (from Softcurse Systems build) ──────
// Active window detection without any native addon — uses shell commands only.

const { exec } = require('child_process');
const util     = require('util');
const execAsync = util.promisify(exec);

/**
 * Get active window title using shell — no native modules required.
 * Works on Windows (PowerShell), macOS (AppleScript), Linux (xdotool).
 */
async function getActiveWindowTitle() {
  try {
    if (process.platform === 'win32') {
      const cmd = `powershell -NoProfile -Command "` +
        `Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();` +
        `[DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);' ` +
        `-Name Win32 -Namespace Win32Functions;" +
        "$hwnd = [Win32Functions.Win32]::GetForegroundWindow();" +
        "$sb = New-Object System.Text.StringBuilder 256;" +
        "[Win32Functions.Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null;" +
        "$sb.ToString()"`;
      const { stdout } = await execAsync(cmd, { timeout: 3000 });
      return stdout.trim() || 'Desktop';
    } else if (process.platform === 'darwin') {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
        { timeout: 3000 }
      );
      return stdout.trim() || 'Desktop';
    } else {
      // Linux — try xdotool, fallback gracefully
      try {
        const { stdout } = await execAsync('xdotool getactivewindow getwindowname', { timeout: 2000 });
        return stdout.trim() || 'Desktop';
      } catch {
        return 'Linux Desktop';
      }
    }
  } catch {
    return 'Unknown';
  }
}

/**
 * Run a quick threat scan — checks startup entries, hosts file, temp dirs.
 * Returns { score, findings[] }
 */
async function runQuickThreatScan() {
  const findings = [];
  let deductions = 0;

  try {
    if (process.platform === 'win32') {
      // Check suspicious startup entries
      const { stdout: startupOut } = await execAsync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command | ConvertTo-Json"`,
        { timeout: 8000 }
      ).catch(() => ({ stdout: '[]' }));

      let startups = [];
      try { startups = JSON.parse(startupOut || '[]'); } catch {}
      if (!Array.isArray(startups)) startups = [startups];

      const suspiciousPatterns = [/temp/i, /appdata.*\\[a-z]{8,}/i, /\.vbs$/i, /\.bat$/i, /powershell.*hidden/i];
      startups.forEach(s => {
        if (suspiciousPatterns.some(p => p.test(s?.Command || ''))) {
          findings.push({ type: 'startup', level: 'warn', msg: `Suspicious startup: ${s.Name}` });
          deductions += 5;
        }
      });

      // Check hosts file for redirects
      const { stdout: hostsOut } = await execAsync(
        `powershell -NoProfile -Command "Get-Content $env:SystemRoot\\System32\\drivers\\etc\\hosts | Where-Object { $_ -notmatch '^#' -and $_.Trim() -ne '' }"`,
        { timeout: 3000 }
      ).catch(() => ({ stdout: '' }));

      const hostLines = (hostsOut || '').split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      if (hostLines.length > 3) {
        findings.push({ type: 'hosts', level: 'info', msg: `${hostLines.length} custom hosts entries` });
        deductions += Math.min(hostLines.length, 10);
      }

      // Check temp directory size
      const { stdout: tempOut } = await execAsync(
        `powershell -NoProfile -Command "(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`,
        { timeout: 5000 }
      ).catch(() => ({ stdout: '0' }));

      const tempMB = parseInt(tempOut || '0') / 1048576;
      if (tempMB > 500) {
        findings.push({ type: 'temp', level: 'info', msg: `Temp folder: ${tempMB.toFixed(0)} MB` });
        deductions += 3;
      }

    } else if (process.platform === 'darwin') {
      // macOS — check launch agents
      const { stdout } = await execAsync(
        `ls ~/Library/LaunchAgents/ 2>/dev/null | wc -l`,
        { timeout: 3000 }
      ).catch(() => ({ stdout: '0' }));

      const count = parseInt(stdout.trim()) || 0;
      if (count > 10) {
        findings.push({ type: 'launchagents', level: 'warn', msg: `${count} launch agents installed` });
        deductions += Math.min(count, 15);
      }

    } else {
      // Linux — check cron and systemd units
      const { stdout } = await execAsync(`crontab -l 2>/dev/null | wc -l`).catch(() => ({ stdout: '0' }));
      const cronLines = parseInt(stdout.trim()) || 0;
      if (cronLines > 5) {
        findings.push({ type: 'cron', level: 'info', msg: `${cronLines} cron entries` });
      }
    }
  } catch (e) {
    findings.push({ type: 'scan', level: 'info', msg: 'Partial scan — limited permissions' });
  }

  const score = Math.max(0, 100 - deductions);
  return { score, findings, deductions };
}

/**
 * Get open network connections count (cross-platform).
 */
async function getOpenConnections() {
  try {
    const cmd = process.platform === 'win32'
      ? `powershell -NoProfile -Command "(netstat -n | Where-Object { $_ -match 'ESTABLISHED' }).Count"`
      : `netstat -tn 2>/dev/null | grep ESTABLISHED | wc -l`;
    const { stdout } = await execAsync(cmd, { timeout: 4000 });
    return parseInt(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Clear system temp/cache — cross-platform.
 */
async function clearSystemCache() {
  const results = [];
  try {
    if (process.platform === 'win32') {
      await execAsync(`del /s /q "%TEMP%\\*" 2>nul`).catch(() => {});
      results.push('User temp cleared');
      await execAsync(`RunDll32.exe InetCpl.cpl,ClearMyTracksByProcess 255`).catch(() => {});
      results.push('IE/Edge cache cleared');
    } else if (process.platform === 'darwin') {
      await execAsync(`rm -rf ~/Library/Caches/* 2>/dev/null`).catch(() => {});
      results.push('macOS user caches cleared');
    } else {
      await execAsync(`rm -rf ~/.cache/* 2>/dev/null`).catch(() => {});
      results.push('Linux user cache cleared');
    }
  } catch {}
  return results;
}

module.exports = { getActiveWindowTitle, runQuickThreatScan, getOpenConnections, clearSystemCache };
