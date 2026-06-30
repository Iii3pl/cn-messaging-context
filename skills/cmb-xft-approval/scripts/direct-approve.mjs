/**
 * direct-approve.mjs — 直达详情页快速审批
 *
 * 跳过列表页导航+逐行定位的复杂流程，直接构造详情页 URL 打开、点击通过、确认。
 * 适合用户已明确指定 billId 列表的批量审批场景。
 *
 * 核心优化（2026-06-30 实战验证）：
 *   1. 直接 URL：?billId=XXXX&viewType=APPROVE_PEND&reserveTab=true
 *      绕过列表页 row click → SPA 路由的不确定性
 *   2. 幽灵单据：APPROVE_PEND viewType 强制进入审批视口，不受列表 tab 状态影响
 *   3. 简化按钮定位：ant-btn-primary + 文本匹配，不依赖 Vue 组件层级
 *
 * Usage:
 *   node scripts/direct-approve.mjs --ids 202606...,202606... [--yes]
 *   node scripts/direct-approve.mjs 2026062565792104 --yes
 *
 * 默认 dry-run，加 --yes 才真正点击。
 */

import { ensureLoggedIn } from './shared/session.mjs';
import { createPage } from './shared/opencli.mjs';

const XFT_BILL_DETAIL = 'https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 参数解析 ──
function parseArgs(argv) {
  const out = { ids: [], yes: false, session: 'cmb-direct-approve' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ids') out.ids.push(...String(argv[++i] || '').split(','));
    else if (a === '--yes') out.yes = true;
    else if (a === '--session') out.session = argv[++i] || out.session;
    else if (/^\d{10,}$/.test(a)) out.ids.push(a);
  }
  out.ids = [...new Set(out.ids.map(s => String(s).trim()).filter(Boolean))];
  return out;
}

// ── 直达详情页 ──
async function openBillDetail(page, billId) {
  const url = `${XFT_BILL_DETAIL}?billId=${billId}&viewType=APPROVE_PEND&reserveTab=true`;
  await page.goto(url, { waitUntil: 'load', settleMs: 5000 });

  // 验证页面已加载（有单据编号即为成功）
  const loaded = await page.evaluate(`
    (() => {
      const body = (document.body?.innerText || '');
      return body.includes('单据编号') || body.includes('事项标题');
    })()
  `);

  return { url, loaded };
}

// ── 简化按钮点击：ant-btn-primary + 文本匹配 ──
async function clickApprove(page) {
  return page.evaluate(`
    (() => {
      // Step 1: 找「通过」按钮（ant-btn-primary + 精确文本）
      for (const b of document.querySelectorAll('button')) {
        if (!b.offsetParent) continue;
        if (!b.className.includes('ant-btn-primary')) continue;
        if (b.innerText.trim() === '通过') { b.click(); return 'clicked_pass'; }
      }
      // 降级：不限定 primary
      for (const b of document.querySelectorAll('button')) {
        if (!b.offsetParent) continue;
        if (!b.className.includes('ant-btn')) continue;
        if (b.innerText.trim() === '通过') { b.click(); return 'clicked_pass_fb'; }
      }
      return 'pass_button_not_found';
    })()
  `);
}

async function clickConfirm(page) {
  return page.evaluate(`
    (() => {
      // 找弹窗中的确认按钮
      const modal = document.querySelector('.ant-modal');
      const scope = modal || document;
      for (const b of scope.querySelectorAll('button')) {
        if (!b.offsetParent) continue;
        const t = b.innerText.trim();
        if (t === '确认' || t === '确定' || t === '同意') { b.click(); return 'clicked_confirm'; }
      }
      return 'confirm_button_not_found';
    })()
  `);
}

// ── 提取基本信息（用于结果展示）──
async function extractSummary(page) {
  return page.evaluate(`
    (() => {
      const body = (document.body?.innerText || '');
      const lines = body.split('\\n').map(l => l.trim()).filter(Boolean);
      const extract = (keyword) => {
        const idx = lines.findIndex(l => l.includes(keyword));
        return idx >= 0 ? (lines[idx + 1] || '') : '';
      };
      return {
        billId: extract('单据编号'),
        subject: extract('事项标题'),
        amount: extract('报销金额') || extract('申请金额') || extract('金额'),
        applicant: extract('申请人'),
        type: extract('单据类型'),
      };
    })()
  `);
}

// ── main ──
const args = parseArgs(process.argv.slice(2));

if (args.ids.length === 0) {
  console.log(JSON.stringify({
    error: 'Usage: node scripts/direct-approve.mjs --ids BILL_ID[,BILL_ID...] [--yes]',
    example: 'node scripts/direct-approve.mjs --ids 2026062565792104,2026063067262409 --yes',
  }, null, 2));
  process.exit(1);
}

if (args.ids.length > 30) {
  console.log(JSON.stringify({ error: 'TOO_MANY_IDS', max: 30, count: args.ids.length }));
  process.exit(1);
}

const page = await createPage(args.session);
let exitCode = 0;

try {
  await ensureLoggedIn(page);

  const results = [];

  for (const billId of args.ids) {
    console.error(`[direct-approve] 处理 ${billId}...`);

    // Step 1: 打开详情页
    const { url, loaded } = await openBillDetail(page, billId);

    if (!loaded) {
      results.push({ billId, ok: false, error: 'PAGE_NOT_LOADED', url });
      exitCode = 1;
      continue;
    }

    // Step 2: 提取摘要
    const summary = await extractSummary(page);

    if (args.yes) {
      // Step 3: 点击「通过」
      const passResult = await clickApprove(page);
      await sleep(2000);

      // Step 4: 点击「确认」
      const confirmResult = await clickConfirm(page);
      await sleep(2000);

      const ok = passResult.startsWith('clicked') && confirmResult.startsWith('clicked');

      results.push({
        billId,
        ok,
        summary,
        steps: { pass: passResult, confirm: confirmResult },
      });
    } else {
      // dry-run: 只展示摘要
      results.push({
        billId,
        ok: null,
        dryRun: true,
        summary,
        hint: '加 --yes 执行审批',
      });
    }
  }

  console.log(JSON.stringify({
    ok: results.every(r => r.ok !== false),
    dryRun: !args.yes,
    total: args.ids.length,
    passed: results.filter(r => r.ok === true).length,
    failed: results.filter(r => r.ok === false).length,
    results,
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message || String(err) }));
  exitCode = 1;
}

process.exit(exitCode);
