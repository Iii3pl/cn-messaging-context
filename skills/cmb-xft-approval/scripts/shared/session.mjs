/**
 * shared/session.mjs — 统一登录检测 + 首页导航 + 桥接自愈 + 自动登录
 *
 * 所有脚本导入此模块，不再各自检测 SESSION_EXPIRED 和断连。
 *
 * v4 — 智能 daemon 愈合：
 *   - 区分 daemon 三态：alive（正常）/ hung（端口占用但 HTTP 无响应）/ dead（未运行）
 *   - hung 态不再盲目 opencli daemon stop（对僵死进程无效），改用 restart + kill -9 回退
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const HOMEPAGE = 'https://xft.cmbchina.com/TripMainWeb/#/trip-app/homepage';
export const APPROVAL_LIST = 'https://xft.cmbchina.com/TripMainWeb/#/form-app/approval';

const AUTH_FILE = join(homedir(), '.hermes', 'auth', 'cmb_xft.json');
const DAEMON_PORT = 19825;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadCredentials() {
  try {
    const raw = readFileSync(AUTH_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Daemon 健康检测（三层：alive / hung / dead）
// ═══════════════════════════════════════════════════════════════

/**
 * 检测 daemon 真实状态。
 * alive:  端口被占用 且 /status HTTP 有响应
 * hung:   端口被占用 但 /status HTTP 无响应（进程僵死）
 * dead:   端口空闲
 * @returns {'alive'|'hung'|'dead'}
 */
function checkDaemonHealth() {
  let portInUse = false;
  try {
    const out = execSync(`lsof -tiTCP:${DAEMON_PORT} -sTCP:LISTEN`, { stdio: 'pipe', timeout: 3000 }).toString().trim();
    portInUse = out.length > 0;
  } catch {
    portInUse = false;
  }

  if (!portInUse) return 'dead';

  // 端口被占用 → 发 HTTP 验证 daemon 是否真的在响应
  try {
    execSync(`curl -s -m 2 ${DAEMON_URL}/status`, { stdio: 'pipe', timeout: 3000 });
    return 'alive';
  } catch {
    return 'hung';
  }
}

/**
 * 获取占用 daemon 端口的 PID，用于僵死进程清理。
 * @returns {string|null}
 */
function getDaemonPid() {
  try {
    return execSync(`lsof -tiTCP:${DAEMON_PORT} -sTCP:LISTEN`, { stdio: 'pipe', timeout: 3000 }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * 智能愈合 daemon，按状态分层处理。
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
async function healDaemon() {
  const state = checkDaemonHealth();

  // ── alive: daemon 正常，只是 page.goto 偶发超时 → 只重试，不杀 ──
  if (state === 'alive') {
    console.error('[session] Daemon alive — transient error, will retry');
    return { ok: true, reason: 'daemon alive, transient' };
  }

  // ── dead: daemon 没在跑 → restart 启动 ──
  if (state === 'dead') {
    console.error('[session] Daemon not running, starting...');
    try {
      execSync('opencli daemon restart', { stdio: 'pipe', timeout: 15000 });
      return { ok: true, reason: 'daemon started' };
    } catch (e) {
      const msg = (e.stderr || e.message || String(e)).toString();
      return { ok: false, reason: `Failed to start daemon: ${msg}` };
    }
  }

  // ── hung: 端口占用但 HTTP 无响应 → 进程僵死 ──
  const pid = getDaemonPid() || '?';
  console.error(`[session] Daemon hung (PID ${pid}) — port in use but /status unresponsive`);

  // 第一层：opencli daemon restart（内部先 graceful shutdown，失败则 spawn 新进程）
  try {
    execSync('opencli daemon restart', { stdio: 'pipe', timeout: 15000 });
    // 重启后验证
    await sleep(2000);
    if (checkDaemonHealth() !== 'dead') {
      return { ok: true, reason: 'daemon restarted (was hung)' };
    }
  } catch {
    console.error('[session] daemon restart failed, trying force kill...');
  }

  // 第二层：kill -9 僵死进程，然后让 opencli 自动 spawn
  if (pid && pid !== '?') {
    try {
      execSync(`kill -9 ${pid}`, { stdio: 'pipe', timeout: 5000 });
      console.error(`[session] Killed hung daemon PID ${pid}`);
    } catch (e) {
      // 无权限 kill → 告诉用户手动处理
      return {
        ok: false,
        reason: [
          `Daemon hung (PID ${pid}) and we lack permission to kill it.`,
          `Fix:  kill -9 ${pid}  &&  opencli daemon restart`,
        ].join('\n'),
      };
    }
  }

  // 等端口释放 + 启动新 daemon
  await sleep(2000);
  try {
    execSync('opencli daemon restart', { stdio: 'pipe', timeout: 15000 });
    return { ok: true, reason: `killed PID ${pid} and restarted daemon` };
  } catch (e) {
    const msg = (e.stderr || e.message || String(e)).toString();
    return { ok: false, reason: `Killed old daemon but restart failed: ${msg}` };
  }
}

// ═══════════════════════════════════════════════════════════════
//  Bind 模式：用户前台 Chrome 手动登录后接管
// ═══════════════════════════════════════════════════════════════

/**
 * 把用户已在前台 Chrome 中手动打开的 tab（含已登录态）绑定到当前 opencli session。
 *
 * 适用场景：
 * - 自动登录被滑块验证码阻断
 * - 用户已经自己在前台 Chrome 登录了薪福通
 * - 想让 agent 接管用户当前的 tab，而不是新开一个 automation window
 *
 * 调用方式（CLI）：
 *   opencli browser xft-bind bind
 *   opencli browser xft-bind state    # 验证接管成功
 *
 * @param {string} sessionName - opencli session 名
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function bindToUserTab(sessionName) {
  // 用 sendCommand 调 opencli 的 bind 命令
  const { loadSendCommand } = await import('./opencli.mjs');
  const sendCommand = await loadSendCommand();
  try {
    const result = await sendCommand('bind', { session: sessionName });
    return { ok: true, reason: `bind 成功: ${JSON.stringify(result).substring(0, 200)}` };
  } catch (e) {
    return { ok: false, reason: `bind 失败: ${e.message || e}` };
  }
}

/**
 * 引导用户完成前台 Chrome 手动登录的提示语。
 * 当自动登录失败时返回这个，让用户自己开前台 Chrome 操作。
 */
export function userManualLoginPrompt() {
  return [
    '',
    '┌─ 需要你在前台 Chrome 手动登录 ─────────────────────┐',
    '│ 1. 在前台 Chrome 打开 https://xft.cmbchina.com         │',
    '│ 2. 输入手机号 + 密码完成登录                          │',
    '│ 3. 登录后告诉 agent「我开好了」                       │',
    '│                                                      │',
    '│ 然后 agent 会跑: opencli browser xft-bind bind 接管   │',
    '│ 或者 agent 重新跑 navigate.mjs / approve.mjs         │',
    '│ 前台 Chrome cookie 与 opencli bridge 共享，无需重复登录 │',
    '└──────────────────────────────────────────────────────┘',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════
//  自动登录
// ═══════════════════════════════════════════════════════════════

/**
 * 尝试自动登录薪福通。
 * 在 SESSION_EXPIRED 页面（title="招商银行"）上填写手机号+密码并提交。
 *
 * @param {import('@jackwener/opencli/dist/src/browser/page.js').Page} page
 * @returns {Promise<boolean>} 成功返回 true
 */
async function tryAutoLogin(page) {
  const creds = loadCredentials();
  if (!creds || !creds.phone || !creds.password) {
    console.error('[session] 无登录凭据，跳过自动登录');
    return false;
  }

  console.error('[session] 检测到 SESSION_EXPIRED，尝试自动登录...');

  // Step 1: 等登录表单渲染
  await sleep(2000);

  // Step 2: 检测登录表单是否存在
  const formInfo = await page.evaluate(`
    (() => {
      const inputs = document.querySelectorAll('input');
      const result = { phone: null, password: null, sms: false, captcha: false, submit: null };

      for (const inp of inputs) {
        const type = (inp.type || '').toLowerCase();
        const placeholder = (inp.placeholder || '').toLowerCase();
        const name = (inp.name || inp.id || '').toLowerCase();

        if (type === 'password') {
          result.password = true;
        } else if (
          placeholder.includes('手机') || placeholder.includes('电话') ||
          placeholder.includes('账号') || placeholder.includes('用户名') ||
          name.includes('phone') || name.includes('mobile') || name.includes('account') ||
          type === 'tel'
        ) {
          result.phone = true;
        }

        // SMS 验证码检测
        if (placeholder.includes('验证码') || placeholder.includes('短信')) {
          result.sms = true;
        }
      }

      // CAPTCHA 检测（含滑块验证码文字提示）
      const imgs = document.querySelectorAll('img[src*="captcha"], img[src*="verify"], canvas');
      const bodyText = (document.body.innerText || '');
      if (imgs.length > 0 || bodyText.includes('向右拖动滑块') || bodyText.includes('按住左方滑块')) {
        result.captcha = true;
      }

      // 登录按钮（兼容 button/input[submit]/div 三种形式）
      const buttons = document.querySelectorAll('button, [type="submit"], .ant-btn-primary, [data-x-track-id*="登录"], div[class*="loginBtn"], div[class*="LoginBtn"]');
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim();
        if (text === '登录' || text.includes('登 录')) {
          result.submit = true;
          break;
        }
      }

      return JSON.stringify(result);
    })()
  `);

  let info;
  try { info = JSON.parse(formInfo); } catch { return false; }

  console.error(`[session] 登录表单: phone=${info.phone} pwd=${info.password} sms=${info.sms} captcha=${info.captcha} submit=${info.submit}`);

  if (info.captcha) {
    console.error('[session] ⚠️ 检测到验证码，无法自动登录');
    return false;
  }
  if (info.sms) {
    console.error('[session] ⚠️ 需要短信验证码，自动登录可能失败');
  }

  if (!info.phone || !info.password || !info.submit) {
    console.error('[session] 登录表单不完整，无法自动填充');
    return false;
  }

  // Step 3: 填写手机号
  await page.evaluate(`
    (() => {
      const phone = '${creds.phone}';
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        const type = (inp.type || '').toLowerCase();
        const placeholder = (inp.placeholder || '').toLowerCase();
        const name = (inp.name || inp.id || '').toLowerCase();
        if (
          placeholder.includes('手机') || placeholder.includes('电话') ||
          placeholder.includes('账号') || placeholder.includes('用户名') ||
          name.includes('phone') || name.includes('mobile') || name.includes('account') ||
          type === 'tel'
        ) {
          // React controlled input: 需要触发 input 事件
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(inp, phone);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return 'filled';
        }
      }
      return 'miss';
    })()
  `);

  await sleep(500);

  // Step 4: 填写密码
  await page.evaluate(`
    (() => {
      const pwd = '${creds.password}';
      const inputs = document.querySelectorAll('input[type="password"]');
      for (const inp of inputs) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(inp, pwd);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return 'filled';
      }
      return 'miss';
    })()
  `);

  await sleep(500);

  // Step 5: 点击登录（兼容 div 形式的登录按钮）
  const clicked = await page.evaluate(`
    (() => {
      const buttons = document.querySelectorAll('button, [type="submit"], .ant-btn-primary, [data-x-track-id*="登录"], div[class*="loginBtn"], div[class*="LoginBtn"]');
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim();
        if (text === '登录' || text.includes('登 录')) {
          // 先用 MouseEvent 触发（div 形式的按钮无原生 click 行为）
          const rect = btn.getBoundingClientRect();
          btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2}));
          btn.click();
          return 'clicked';
        }
      }
      return 'miss';
    })()
  `);

  if (clicked !== 'clicked') {
    console.error('[session] 未找到登录按钮');
    return false;
  }

  // Step 6: 等待跳转
  console.error('[session] 已点击登录，等待跳转...');
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    try {
      const title = await page.evaluate('document.title');
      if (title.includes('智能费控')) {
        console.error('[session] ✅ 自动登录成功');
        return true;
      }
      // SMS code page detected
      const text = await page.evaluate('document.body.innerText');
      if (text.includes('验证码') && text.includes('发送')) {
        console.error('[session] ⚠️ 需要短信验证码，请在自动化窗口中输入');
        return false;
      }
      // 滑块验证码检测
      if (text.includes('向右拖动滑块') || text.includes('按住左方滑块')) {
        console.error('[session] ⚠️ 检测到滑块验证码，需手动完成。打开自动化窗口 → 拖动滑块完成拼图');
        return false;
      }
    } catch (_) {
      // page may be navigating
    }
  }

  console.error('[session] ⚠️ 登录超时，可能失败');
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  确保登录（含智能 daemon 愈合）
// ═══════════════════════════════════════════════════════════════

/**
 * 确保已登录薪福通首页，内置 auto-heal + auto-login。
 *
 * @param {import('@jackwener/opencli/dist/src/browser/page.js').Page} page
 * @param {{retries?: number}} opts
 * @returns {Promise<{title: string, text: string}>}
 * @throws {string} 'SESSION_EXPIRED' | 'HEAL_FAILED'
 */
export async function ensureLoggedIn(page, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await page.goto(HOMEPAGE, { waitUntil: 'load', settleMs: 3000 });
    } catch (err) {
      const msg = err.message || String(err);
      const isBridgeError = msg.includes('fetch failed')
        || msg.includes('DAEMON_UNREACHABLE')
        || msg.includes('not connected')
        || msg.includes('ECONNREFUSED');

      if (!isBridgeError) throw err;

      if (attempt >= retries) {
        // 最后一次尝试前做完整诊断
        const state = checkDaemonHealth();
        const pid = getDaemonPid();
        if (state === 'hung') {
          throw `HEAL_FAILED: Daemon hung (PID ${pid}, port ${DAEMON_PORT} in use but unresponsive).\n` +
                `Fix:  kill -9 ${pid}  &&  opencli daemon restart`;
        }
        throw `HEAL_FAILED: Bridge unreachable after ${retries + 1} attempts.\n` +
              `Daemon state: ${state}. Fix: opencli daemon restart`;
      }

      console.error(`[session] Bridge error (attempt ${attempt + 1}/${retries}), healing...`);
      const heal = await healDaemon();

      if (!heal.ok) {
        // 自愈失败 → 抛出明确修复指令
        throw `HEAL_FAILED: ${heal.reason}`;
      }

      console.error(`[session] Healed: ${heal.reason}, retrying...`);
      await sleep(2000);
      continue;
    }

    const title = await page.evaluate('document.title');
    if (title.includes('招商银行') && !title.includes('智能费控')) {
      // SESSION_EXPIRED — 尝试自动登录
      const loggedIn = await tryAutoLogin(page);
      if (loggedIn) {
        // 重新获取首页
        try {
          await page.goto(HOMEPAGE, { waitUntil: 'load', settleMs: 3000 });
        } catch (_) {}
        const title2 = await page.evaluate('document.title');
        const text = await page.evaluate('document.body.innerText');
        return { title: title2, text };
      }
      // 自动登录失败 → 引导用户前台 Chrome 手动登录 + 后续 bind 接管
      console.error(userManualLoginPrompt());
      throw 'SESSION_EXPIRED: 自动登录失败（多半是滑块验证码）。' +
            '请按提示在前台 Chrome 手动登录后，让 agent 跑 `opencli browser xft-bind bind` 接管。';
    }

    const text = await page.evaluate('document.body.innerText');
    return { title, text };
  }
  throw `HEAL_FAILED: Bridge unreachable after ${retries + 1} attempts`;
}
