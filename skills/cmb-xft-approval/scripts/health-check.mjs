/**
 * 全栈健康检查 — daemon → bridge → session → page
 *
 * 比 health.mjs 更完整：不仅查 daemon 连通性，还检测 session 是否过期。
 *
 * Usage: node health-check.mjs
 * Output: JSON { ok, daemon, bridge, session, title, fix[] }
 */

import { execSync } from 'child_process';
import { createPage, loadSendCommand } from './shared/opencli.mjs';
import { ensureLoggedIn, APPROVAL_LIST } from './shared/session.mjs';

const DAEMON_PORT = 19825;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Layer 1: Daemon 进程状态 ──
function checkDaemon() {
  let pid = null;
  try {
    pid = execSync(`lsof -tiTCP:${DAEMON_PORT} -sTCP:LISTEN`, { stdio: 'pipe', timeout: 3000 }).toString().trim();
  } catch { /* port free */ }

  if (!pid) return { state: 'dead', pid: null, detail: 'Port 19825 free — daemon not running' };

  // 端口占用 → 验证 HTTP 响应
  try {
    execSync(`curl -s -m 2 ${DAEMON_URL}/status`, { stdio: 'pipe', timeout: 3000 });
    return { state: 'alive', pid, detail: `PID ${pid}, /status OK` };
  } catch {
    return { state: 'hung', pid, detail: `PID ${pid} — port occupied but /status unresponsive` };
  }
}

// ── Layer 2: Bridge 连通性 (opencli exec) ──
async function checkBridge() {
  try {
    const sendCommand = await loadSendCommand();
    const result = await sendCommand('exec', { code: '1+1', session: 'health-check', surface: 'browser' });
    if (result !== undefined && result !== null) {
      return { ok: true, detail: 'Bridge responsive' };
    }
    return { ok: false, detail: 'Bridge returned null/undefined' };
  } catch (err) {
    const msg = err.message || String(err);
    // Common bridge error patterns
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
      return { ok: false, detail: 'Bridge fetch failed — daemon may be hung', recoverable: true };
    }
    if (msg.includes('not connected')) {
      return { ok: false, detail: 'Bridge extension not connected — restart Chrome extension', recoverable: true };
    }
    return { ok: false, detail: msg, recoverable: false };
  }
}

// ── Layer 3: Session 有效性 (page navigate + title) ──
async function checkSession() {
  try {
    const page = await createPage('cmb-health-check');
    await ensureLoggedIn(page, { retries: 1 });
    await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });
    await sleep(1000);

    const title = await page.evaluate('document.title');
    const bodyText = await page.evaluate('document.body ? document.body.innerText.substring(0, 500) : ""');

    if (!title) {
      return { ok: false, reason: 'NO_TITLE', detail: 'Page title empty — bridge may be partially broken' };
    }

    // Check for login page indicators
    const isLoginPage = title.includes('招商银行') && !title.includes('智能费控');
    const hasLoginForm = (bodyText || '').includes('手机号') || (bodyText || '').includes('密码登录');
    const isInside = title.includes('智能费控') || title.includes('TripMain');

    if (isLoginPage || hasLoginForm) {
      return {
        ok: false,
        reason: 'SESSION_EXPIRED',
        detail: `Title="${title}", login form detected`,
        recoverable: true,
      };
    }

    if (isInside) {
      return {
        ok: true,
        reason: 'SESSION_VALID',
        detail: `Title="${title}", inside app`,
      };
    }

    // Unknown state
    return {
      ok: false,
      reason: 'UNKNOWN_PAGE',
      detail: `Title="${title}", body preview: "${(bodyText || '').substring(0, 100)}"`,
    };

  } catch (err) {
    const msg = err.message || String(err);
    return {
      ok: false,
      reason: 'BRIDGE_ERROR',
      detail: msg,
      recoverable: msg.includes('fetch failed') || msg.includes('ECONNREFUSED'),
    };
  }
}

// ── Main ──
async function main() {
  const result = {
    ok: false,
    timestamp: new Date().toISOString(),
    daemon: null,
    bridge: null,
    session: null,
    fix: [],
  };

  // Layer 1
  result.daemon = checkDaemon();
  if (result.daemon.state !== 'alive') {
    result.fix.push(
      result.daemon.state === 'dead'
        ? 'opencli daemon restart'
        : `kill -9 ${result.daemon.pid} && opencli daemon restart`
    );
    console.log(JSON.stringify(result));
    return;
  }

  // Layer 2
  result.bridge = await checkBridge();
  if (!result.bridge.ok) {
    result.fix.push('opencli daemon stop && 刷新 Chrome 扩展 (chrome://extensions) && opencli daemon restart');
    console.log(JSON.stringify(result));
    return;
  }

  // Layer 3
  result.session = await checkSession();

  if (result.session.ok) {
    result.ok = true;
    console.log(JSON.stringify(result));
    return;
  }

  // Session issue
  if (result.session.reason === 'SESSION_EXPIRED') {
    result.fix.push(
      '尝试自动登录 (node scripts/self-heal.mjs)',
      '若自动登录失败(验证码) → 手动登录: open -a "Google Chrome" "https://xft.cmbchina.com/"'
    );
  } else if (result.session.reason === 'BRIDGE_ERROR') {
    result.fix.push('opencli daemon stop && 刷新 Chrome 扩展 && opencli daemon restart');
  }

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.log(JSON.stringify({
    ok: false,
    timestamp: new Date().toISOString(),
    error: err.message || String(err),
    fix: ['Check opencli installation', 'Check daemon status'],
  }));
});
