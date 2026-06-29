/**
 * 薪福通 Session 自愈流水线
 *
 * 检测 → 愈合 daemon → 自动登录 → 验证
 * 用于 cron keepalive 或手动修复。
 *
 * Usage: node self-heal.mjs [--notify]
 *   --notify: 输出钉钉通知格式 (用于 cron 推送)
 *
 * Exit code: 0 = recovered/healthy, 1 = needs manual fix
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadSendCommand } from './shared/opencli.mjs';

const DAEMON_PORT = 19825;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const HOMEPAGE = 'https://xft.cmbchina.com/TripMainWeb/#/trip-app/homepage';
const AUTH_FILE = join(homedir(), '.hermes', 'auth', 'cmb_xft.json');

const NOTIFY = process.argv.includes('--notify');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { if (!NOTIFY) console.error(`[self-heal] ${msg}`); }

// ═══════════════════════════════════════════════
//  Stage 0: Daemon 检测 + 愈合
// ═══════════════════════════════════════════════

function getDaemonState() {
  let pid = null;
  try {
    pid = execSync(`lsof -tiTCP:${DAEMON_PORT} -sTCP:LISTEN`, { stdio: 'pipe', timeout: 3000 }).toString().trim();
  } catch { return { state: 'dead', pid: null }; }

  try {
    execSync(`curl -s -m 2 ${DAEMON_URL}/status`, { stdio: 'pipe', timeout: 3000 });
    return { state: 'alive', pid };
  } catch {
    return { state: 'hung', pid };
  }
}

function healDaemon() {
  const { state, pid } = getDaemonState();

  if (state === 'alive') {
    log('Daemon alive');
    return { ok: true, action: 'none' };
  }

  if (state === 'dead') {
    log('Daemon dead → starting...');
    try {
      execSync('opencli daemon restart', { stdio: 'pipe', timeout: 15000 });
      const after = getDaemonState();
      return { ok: after.state === 'alive', action: 'restart', detail: after.state };
    } catch (e) {
      return { ok: false, action: 'restart', detail: (e.stderr || e.message || String(e)).toString() };
    }
  }

  // hung
  log(`Daemon hung (PID ${pid}) → force restart...`);
  try { execSync('opencli daemon restart', { stdio: 'pipe', timeout: 15000 }); } catch {}
  sleep(2000);

  if (pid && pid !== '?') {
    try { execSync(`kill -9 ${pid}`, { stdio: 'pipe', timeout: 5000 }); } catch {}
    sleep(2000);
    try { execSync('opencli daemon restart', { stdio: 'pipe', timeout: 15000 }); } catch {}
  }

  const after = getDaemonState();
  return { ok: after.state === 'alive', action: 'force-restart', pid, detail: after.state };
}

// ═══════════════════════════════════════════════
//  Stage 1: Bridge 验证
// ═══════════════════════════════════════════════

async function bridgeAlive() {
  try {
    const sendCommand = await loadSendCommand();
    const r = await sendCommand('exec', { code: '1+1', session: 'self-heal', surface: 'browser' });
    return r !== undefined && r !== null;
  } catch { return false; }
}

// ═══════════════════════════════════════════════
//  Stage 2: Session 检测 + 自动登录
// ═══════════════════════════════════════════════

function loadCredentials() {
  try { return JSON.parse(readFileSync(AUTH_FILE, 'utf-8')); } catch { return null; }
}

async function checkAndRecoverSession() {
  const sendCommand = await loadSendCommand();

  // Navigate
  try {
    await sendCommand('exec', { code: `window.location.href = "${HOMEPAGE}";`, session: 'self-heal', surface: 'browser' });
  } catch (err) {
    return { ok: false, reason: 'NAV_FAIL', detail: err.message };
  }
  await sleep(2000);

  const title = await sendCommand('exec', { code: 'document.title', session: 'self-heal', surface: 'browser' });

  // Already inside
  if (title && (title.includes('智能费控') || title.includes('TripMain'))) {
    log(`Session valid (title="${title}")`);
    return { ok: true, reason: 'SESSION_VALID', title };
  }

  // At login page — try auto-login
  log(`Session expired (title="${title}"), attempting auto-login...`);

  const creds = loadCredentials();
  if (!creds || !creds.phone || !creds.password) {
    return { ok: false, reason: 'NO_CREDENTIALS', detail: '无登录凭据' };
  }

  // Check for captcha before attempting
  const bodyText = await sendCommand('exec', {
    code: 'document.body ? document.body.innerText.substring(0, 500) : ""',
    session: 'self-heal', surface: 'browser'
  });

  if (bodyText && (bodyText.includes('向右拖动滑块') || bodyText.includes('按住左方滑块'))) {
    return { ok: false, reason: 'CAPTCHA_BLOCK', detail: '滑块验证码阻断，需手动登录' };
  }

  // Fill phone
  await sendCommand('exec', {
    code: `
      (() => {
        const phone = '${creds.phone}';
        const inputs = document.querySelectorAll('input');
        for (const inp of inputs) {
          const ph = (inp.placeholder || '').toLowerCase();
          if (ph.includes('手机') || ph.includes('电话') || ph.includes('账号') || inp.type === 'tel') {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(inp, phone);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            return 'ok';
          }
        }
        return 'miss';
      })()
    `,
    session: 'self-heal', surface: 'browser'
  });

  await sleep(500);

  // Fill password
  await sendCommand('exec', {
    code: `
      (() => {
        const pwd = '${creds.password}';
        const inputs = document.querySelectorAll('input[type="password"]');
        for (const inp of inputs) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inp, pwd);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return 'ok';
        }
        return 'miss';
      })()
    `,
    session: 'self-heal', surface: 'browser'
  });

  await sleep(500);

  // Click login button
  await sendCommand('exec', {
    code: `
      (() => {
        const btns = document.querySelectorAll('button, [type="submit"], .ant-btn-primary, [data-x-track-id*="登录"], div[class*="loginBtn"], div[class*="LoginBtn"]');
        for (const btn of btns) {
          if ((btn.textContent || '').trim().includes('登录')) {
            btn.click();
            return 'clicked';
          }
        }
        return 'miss';
      })()
    `,
    session: 'self-heal', surface: 'browser'
  });

  // Wait for redirect
  log('Login clicked, waiting for redirect...');
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    try {
      const t = await sendCommand('exec', { code: 'document.title', session: 'self-heal', surface: 'browser' });
      const bt = await sendCommand('exec', { code: 'document.body ? document.body.innerText.substring(0, 300) : ""', session: 'self-heal', surface: 'browser' });

      if (t && t.includes('智能费控')) {
        log('Auto-login SUCCESS');
        return { ok: true, reason: 'AUTO_LOGIN_OK', title: t };
      }
      if (bt && (bt.includes('验证码') || bt.includes('滑块'))) {
        return { ok: false, reason: 'CAPTCHA_AFTER_LOGIN', detail: '登录后触发验证码' };
      }
    } catch {}
  }

  return { ok: false, reason: 'LOGIN_TIMEOUT', detail: '登录超时，可能触发验证码或密码错误' };
}

// ═══════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════

async function main() {
  const stages = [];

  // Stage 0: Daemon
  const daemon = healDaemon();
  stages.push({ stage: 'daemon', ...daemon });
  if (!daemon.ok) {
    output({ ok: false, stages, summary: 'Daemon 无法启动，需手动修复' });
    return;
  }

  // Stage 1: Bridge
  const bridgeOk = await bridgeAlive();
  stages.push({ stage: 'bridge', ok: bridgeOk });
  if (!bridgeOk) {
    output({
      ok: false,
      stages,
      summary: 'Bridge 不通 — 尝试刷新 Chrome 扩展 (chrome://extensions → OpenCLI → 关闭再开启)',
      fix: 'opencli daemon stop && 刷新 Chrome 扩展 && opencli daemon restart',
    });
    return;
  }

  // Stage 2: Session
  const session = await checkAndRecoverSession();
  stages.push({ stage: 'session', ...session });

  const allOk = session.ok;

  output({
    ok: allOk,
    stages,
    summary: allOk
      ? '✅ 薪福通 session 正常'
      : `❌ Session 恢复失败: ${session.reason} — ${session.detail || ''}`,
    fix: allOk ? null : (
      session.reason === 'CAPTCHA_BLOCK' || session.reason === 'CAPTCHA_AFTER_LOGIN'
        ? '需手动登录: open -a "Google Chrome" "https://xft.cmbchina.com/" — 输入手机号+密码+完成滑块验证'
        : '检查登录凭据: ~/.hermes/auth/cmb_xft.json'
    ),
  });
}

function output(data) {
  if (NOTIFY) {
    // Dingtalk-friendly format
    const icon = data.ok ? '✅' : '🔴';
    const lines = [
      `${icon} **薪福通 Session 自愈报告**`,
      `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      `结果: ${data.summary}`,
    ];
    if (data.fix) lines.push(`🔧 修复: ${data.fix}`);
    lines.push('', '---');
    for (const s of data.stages) {
      const sIcon = s.ok ? '✅' : '❌';
      lines.push(`${sIcon} ${s.stage}: ${s.reason || s.action || (s.ok ? 'OK' : 'FAIL')} ${s.detail || ''}`);
    }
    console.log(lines.join('\n'));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }

  // Exit code for cron scripting
  if (!data.ok) process.exit(1);
}

main();
