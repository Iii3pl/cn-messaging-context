/**
 * 预算单详情提取脚本 — 独立 Page 会话 + 防缓存 + 双 viewType 兜底
 *
 * Usage:
 *   node scripts/budget-detail-extract.mjs <billId> [label]
 *
 * Example:
 *   node scripts/budget-detail-extract.mjs 2026061561860076 商贤
 *   node scripts/budget-detail-extract.mjs 2026061562287009 钱天雨
 *
 * Output: JSON with:
 *   - label, billId, url
 *   - basic (key info lines: 申请人/预算方案/区间/总额)
 *   - tables (预算调整表格行)
 *   - approvalChain (审批节点状态)
 *   - rawTail (页面底部raw文本)
 */
import { ensureLoggedIn } from './shared/session.mjs';
import { createPage } from './shared/opencli.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(s) { return String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim(); }

const billId = process.argv[2];
const label = process.argv[3] || billId;
if (!billId) { console.log(JSON.stringify({error:'Usage: node budget-detail-extract.mjs <billId> [label]'})); process.exit(1); }

const page = await createPage('budget-dtl-' + billId.slice(-6));
await ensureLoggedIn(page);

const variants = [
  `https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId=${billId}&viewType=APPROVE_PEND&_=${Date.now()}`,
  `https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId=${billId}&viewType=APPROVED&_=${Date.now()}`,
];

for (const url of variants) {
  await page.goto(url, { waitUntil: 'load', settleMs: 3000 });
  await sleep(5000);
  await page.evaluate(`window.dispatchEvent(new HashChangeEvent('hashchange'))`);
  await sleep(2000);

  const raw = await page.evaluate(`(() => JSON.stringify({
    url: location.href,
    text: document.body.innerText || '',
    tables: [...document.querySelectorAll('table')].map((tbl,ti)=>({ti, rows:[...tbl.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(td=>td.innerText.trim().replace(/\\s+/g,' ')))}))
  }))()`);
  const data = JSON.parse(raw);

  if (!data.text.includes(billId)) continue;

  const lines = data.text.split('\n').map(clean).filter(Boolean);

  // Extract key info section
  const keyLabels = ['预算单-', '申请人', '预算方案', '预算区间', '周期类型', '附件', '说明', '调整后预算总额'];
  const basic = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (keyLabels.some(p => l.includes(p))) {
      basic.push(`#${i} ${l}`);
      for (let j = 1; j <= 2 && i + j < lines.length; j++) {
        const nxt = lines[i + j];
        if (nxt.length < 120) basic.push(`  +${j} ${nxt}`);
      }
    }
  }

  // Extract approval chain
  const chainLabels = ['流程信息', '发起申请', '已申请', '部门审批节点', '项目预算', '财务审批节点', 'CFO/副总裁审批节点', 'CEO', '审批中', '已通过', '自动通过', '未找到审批人'];
  const chain = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (chainLabels.some(p => l.includes(p))) {
      chain.push(`#${i} ${l}`);
      for (let j = 1; j <= 2 && i + j < lines.length; j++) {
        const nxt = lines[i + j];
        if (nxt.length < 120) chain.push(`  +${j} ${nxt}`);
      }
    }
  }

  const result = {
    label,
    billId,
    url: data.url,
    basic,
    tables: data.tables.filter(t => t.rows?.length > 0),
    approvalChain: chain,
    rawTail: lines.slice(-120)
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(JSON.stringify({ error: 'BILL_NOT_FOUND', billId, label, hint: 'SPA可能没加载到该预算单的详情页' }));
process.exit(1);
