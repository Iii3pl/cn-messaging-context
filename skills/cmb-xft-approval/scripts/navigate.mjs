/**
 * 薪福通页面导航 v3 — 使用 shared 模块
 * Usage: node navigate.mjs homepage [--page N] | bill BILL_ID
 */

import { ensureLoggedIn, APPROVAL_LIST } from './shared/session.mjs';
import { parseHomepageBills, parseBillDetail, parseDoneBills } from './shared/extract.mjs';
import { createPage } from './shared/opencli.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- 分页：点击目标页码 ---
async function goToPage(page, pageNum) {
  const hasPagination = await page.evaluate(`
    (() => {
      const pg = document.querySelector('.ant-pagination');
      if (!pg) return false;
      // 找页码按钮
      const items = pg.querySelectorAll('.ant-pagination-item');
      for (const item of items) {
        if (item.textContent.trim() === '${pageNum}') {
          item.click();
          return true;
        }
      }
      return false;
    })()
  `);
  if (hasPagination) await sleep(2000);
  return hasPagination;
}

// --- 首页（审批列表）---
async function homepageCmd(page, args) {
  const pageNum = parseInt(args[0] || '1');
  const filterGhosts = args.includes('--filter-ghosts');
  await ensureLoggedIn(page);
  // 导航到审批列表页（新版 /#/form-app/approval）
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });
  if (pageNum > 1) await goToPage(page, pageNum);
  const result = await parseHomepageBills(page);

  // 幽灵过滤：交叉比对已审批 tab
  let ghostIds = new Set();
  if (filterGhosts && result.bills.length > 0) {
    // 先收集当前待审批的 billId
    const pendingIds = new Set(result.bills.map(b => b.billId));

    // 切到已审批 tab
    const tabClicked = await page.evaluate(`
      (() => {
        const tabs = document.querySelectorAll('.ant-tabs-tab');
        for (const tab of tabs) {
          if (tab.textContent.includes('已审批')) { tab.click(); return true; }
        }
        return false;
      })()
    `);
    if (tabClicked) {
      await sleep(3000);
      const doneResult = await parseDoneBills(page, { tabName: '已审批' });
      // 同时出现在两个 tab 的 = 幽灵
      for (const b of (doneResult.bills || [])) {
        if (pendingIds.has(b.billId)) ghostIds.add(b.billId);
      }
      // 切回待审批 tab
      await page.evaluate(`
        (() => {
          const tabs = document.querySelectorAll('.ant-tabs-tab');
          for (const tab of tabs) {
            if (tab.textContent.includes('待审批')) { tab.click(); return true; }
          }
          return false;
        })()
      `);
      await sleep(2000);
    }
  }

  // 标记幽灵
  const bills = result.bills.map(b => ({
    ...b,
    ghost: ghostIds.has(b.billId)
  }));

  const realCount = bills.filter(b => !b.ghost).length;
  console.log(JSON.stringify({
    ok: true,
    pending: result.pending,
    realPending: filterGhosts ? realCount : undefined,
    ghostCount: filterGhosts ? ghostIds.size : undefined,
    bills,
    page: pageNum
  }));
}

// --- 已审批列表 ---
async function doneCmd(page, args) {
  const pageNum = parseInt(args[0] || '1');
  await ensureLoggedIn(page);
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });

  // 点击「已审批」tab
  const tabClicked = await page.evaluate(`
    (() => {
      // 找 tabs 容器
      const tabs = document.querySelectorAll('.ant-tabs-tab');
      for (const tab of tabs) {
        if (tab.textContent.includes('已审批')) {
          tab.click();
          return true;
        }
      }
      // fallback: 找任何包含"已审批"的可点击元素
      const all = document.querySelectorAll('[role="tab"], .ant-tabs-tab-btn, .ant-tabs-tab');
      for (const el of all) {
        if (el.textContent.includes('已审批')) {
          el.click();
          return true;
        }
      }
      return false;
    })()
  `);

  if (tabClicked) {
    // 等表格数据加载
    await sleep(3000);
  }

  if (pageNum > 1) await goToPage(page, pageNum);
  const result = await parseDoneBills(page, { tabName: '已审批' });
  console.log(JSON.stringify({ ok: true, ...result, page: pageNum, tab: 'done' }));
}

// --- 单据详情 ---
async function billCmd(page, billId) {
  await ensureLoggedIn(page);
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });
  await parseHomepageBills(page);
  const result = await parseBillDetail(page, billId);
  console.log(JSON.stringify(result, null, 2));
}

// --- main ---
const mode = process.argv[2];
const billId = process.argv[3];

// 解析 --page N 和 --filter-ghosts
let pageArg = 1;
let filterGhosts = false;
const pageIdx = process.argv.indexOf('--page');
if (pageIdx >= 0) {
  pageArg = parseInt(process.argv[pageIdx + 1]) || 1;
}
if (process.argv.includes('--filter-ghosts')) {
  filterGhosts = true;
}

const page = await createPage('cmb-nav');
try {
  if (mode === 'homepage') {
    const args = [pageArg];
    if (filterGhosts) args.push('--filter-ghosts');
    await homepageCmd(page, args);
  } else if (mode === 'done') {
    await doneCmd(page, [pageArg]);
  } else if (mode === 'bill' && billId) {
    await billCmd(page, billId);
  } else {
    console.log(JSON.stringify({
      error: 'Usage: node navigate.mjs homepage [--page N] | done [--page N] | bill BILL_ID'
    }));
  }
} catch (err) {
  console.log(JSON.stringify({ error: err.message || String(err) }));
}
