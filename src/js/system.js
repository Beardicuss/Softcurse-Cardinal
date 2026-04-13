// ── system.js — native-free OS utilities ──────────────────────────────────────
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const si = require('systeminformation');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Geo-IP Cache to respect API limits
const geoCache = new Map();

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
      try { startups = JSON.parse(startupRes.stdout || '[]'); } catch { }
      if (!Array.isArray(startups)) startups = startups ? [startups] : [];

      const suspicious = [/temp/i, /appdata.*\\[a-z]{8,}/i, /\.vbs$/i, /\.bat$/i, /powershell.*hidden/i];

      // Known bad SHA-256 hashes (e.g. well-known malicious payloads or test hashes)
      const badHashes = new Set([
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // empty hash example
      ]);

      for (const s of startups) {
        if (!s || !s.Command) continue;

        let flagged = false;
        if (suspicious.some(p => p.test(s.Command))) {
          findings.push({ type: 'startup', level: 'warn', msg: 'Heuristic Match: ' + s.Name });
          deductions += 5;
          flagged = true;
        }

        // Extract filePath from Command string e.g., "C:\path\to\file.exe" -arg
        const match = s.Command.match(/(?:")([^"]+\.exe)(?:")|([^ ]+\.exe)/i);
        const exePath = match ? (match[1] || match[2]) : null;

        if (exePath && fs.existsSync(exePath)) {
          try {
            // 1. Validate against SHA-256 list
            const hash = crypto.createHash('sha256');
            const data = fs.readFileSync(exePath); // Memory limit warning on massive files!
            hash.update(data);
            const hex = hash.digest('hex');

            if (badHashes.has(hex.toLowerCase())) {
              findings.push({ type: 'startup_hash', level: 'warn', msg: 'Malicious Hash Detected: ' + exePath });
              deductions += 15;
            }

            // 2. YARA Sweep across user plugins
            const reqUserPath = (process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share")) + '/cardinal/plugins';
            if (fs.existsSync(reqUserPath)) {
              const yaras = fs.readdirSync(reqUserPath).filter(f => f.endsWith('.yara'));
              for (const yf of yaras) {
                const ruleText = fs.readFileSync(path.join(reqUserPath, yf), 'utf-8');
                // Extract rudimentary strings from basic YARA syntax: $a = "malicious_string"
                const strMatches = [...ruleText.matchAll(/\$[^=]+\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                if (strMatches.length > 0) {
                  const contentStr = data.toString('utf-8');
                  for (const target of strMatches) {
                    if (contentStr.includes(target) && !flagged) {
                      findings.push({ type: 'yara_match', level: 'warn', msg: `YARA Rule Match [${yf}]: ${exePath}` });
                      deductions += 15;
                      flagged = true;
                      break;
                    }
                  }
                }
              }
            }
          } catch (e) { /* File locked or too large */ }
        }
      }

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
 * Hardened Network Connection analyzer. 
 * Maps remote ESTABLISHED IP sockets to local PIDs explicitly alongside Geo-IP location.
 */
async function analyzeNetworkConnections() {
  try {
    const conns = await si.networkConnections();
    const active = [];

    for (const c of conns) {
      if (c.state !== 'ESTABLISHED') continue;
      const ip = c.peeraddress;
      if (!ip || ip.includes('*') || ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip.startsWith('192.168.') || ip.startsWith('10.')) continue;

      // Fetch geo-data dynamically mapping active foreign blocks
      if (!geoCache.has(ip)) {
        try {
          const data = await new Promise((resolve, reject) => {
            const req = http.get(`http://ip-api.com/json/${ip}?fields=country,isp`, { timeout: 2000 }, (res) => {
              if (res.statusCode !== 200) { res.resume(); return reject(new Error('Status: ' + res.statusCode)); }
              let body = '';
              res.on('data', chunk => body += chunk);
              res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
            }).on('error', reject).on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
          });
          geoCache.set(ip, data);
        } catch (e) {
          geoCache.set(ip, { country: 'Unknown' });
        }
      }

      const geo = geoCache.get(ip);
      active.push({
        pid: c.pid,
        process: c.process || 'Unknown',
        peerIp: c.peeraddress,
        peerPort: c.peerport,
        country: geo.country || 'Unknown',
        isp: geo.isp || 'Unknown'
      });
    }

    // Deduplicate same IP/PID combinations
    const unique = [];
    const seen = new Set();
    for (const a of active) {
      const key = `${a.pid}-${a.peerIp}`;
      if (!seen.has(key)) { seen.add(key); unique.push(a); }
    }

    return unique;
  } catch { return []; }
}

/**
 * Clear system temp/cache directories.
 */
async function clearSystemCache() {
  const results = [];
  try {
    if (process.platform === 'win32') {
      await execAsync('del /s /q "%TEMP%\\*" 2>nul').catch(() => { });
      results.push('User temp cleared');
      await execAsync('RunDll32.exe InetCpl.cpl,ClearMyTracksByProcess 255').catch(() => { });
      results.push('IE/Edge cache flushed');
    } else if (process.platform === 'darwin') {
      await execAsync('rm -rf ~/Library/Caches/* 2>/dev/null').catch(() => { });
      results.push('macOS user caches cleared');
    } else {
      await execAsync('rm -rf ~/.cache/* 2>/dev/null').catch(() => { });
      results.push('Linux user cache cleared');
    }
  } catch { }
  return results;
}

module.exports = { getActiveWindowTitle, runQuickThreatScan, analyzeNetworkConnections, clearSystemCache };
