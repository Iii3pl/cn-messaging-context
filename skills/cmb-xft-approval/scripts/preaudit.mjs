/**
 * 薪福通 AI 预审 v1 — 读取详情 + CRM/Databoard 经营校验。
 *
 * Usage:
 *   node preaudit.mjs BILL_ID
 *   node preaudit.mjs --batch [--type 供应商结算单]
 *   node preaudit.mjs --stdin < detail.json
 */

import { readFileSync } from 'node:fs';
import { ensureLoggedIn, APPROVAL_LIST } from './shared/session.mjs';
import { parseHomepageBills, parseBillDetail } from './shared/extract.mjs';
import { openDb, findByBillId, findPreauditCache, recordPreauditCache } from './shared/db.mjs';
import { runPreauditForDetail } from './shared/preaudit.mjs';
import { createPage } from './shared/opencli.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function preauditDetail(detail, db, { useCache = true } = {}) {
  const dbRecord = detail?.billId ? findByBillId(db, detail.billId) : null;
  let preaudit = null;
  if (useCache) {
    const cached = findPreauditCache(db, detail);
    if (cached) {
      preaudit = {
        ...cached.value,
        _cache: { hit: true, cacheKey: cached.cacheKey, createdAt: cached.createdAt, expiresAt: cached.expiresAt },
      };
    }
  }
  if (!preaudit) {
    preaudit = await runPreauditForDetail(detail, { dbRecord });
    if (useCache && preaudit?.ok) {
      const cache = recordPreauditCache(db, detail, preaudit, {
        ttlHours: Number(process.env.CMB_XFT_PREAUDIT_CACHE_HOURS || 24),
      });
      preaudit = { ...preaudit, _cache: { hit: false, cacheKey: cache.cacheKey, expiresAt: cache.expiresAt } };
    }
  }
  return {
    billId: detail.billId,
    type: detail.type || null,
    applicant: detail.applicant || null,
    amount: detail.amount ?? null,
    subject: detail.subject || '',
    department: detail.department || null,
    project: detail.project || null,
    allocations: detail.allocations || [],
    preaudit,
  };
}

async function preauditSingle(page, billId, db, useCache = true) {
  await ensureLoggedIn(page);
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });
  await parseHomepageBills(page);
  const detail = await parseBillDetail(page, billId);
  if (detail.error) return detail;
  return preauditDetail(detail, db, { useCache });
}

async function preauditBatch(page, db, filterType = null, useCache = true) {
  await ensureLoggedIn(page);
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });
  const { bills, pending } = await parseHomepageBills(page);
  const filtered = filterType
    ? bills.filter(b => b.type === filterType || b.type?.includes(filterType))
    : bills;

  const results = [];
  for (let i = 0; i < filtered.length; i++) {
    const bill = filtered[i];
    console.error(`[preaudit] ${i + 1}/${filtered.length}: ${bill.billId} ${bill.type}`);
    await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 2000 });
    await sleep(500);
    await parseHomepageBills(page);
    const detail = await parseBillDetail(page, bill.billId);
    if (detail.error) {
      results.push({ billId: bill.billId, error: detail.error, listItem: bill });
      continue;
    }
    results.push(await preauditDetail(detail, db, { useCache }));
  }

  const byRisk = {};
  for (const r of results) {
    const risk = r.preaudit?.riskLevel || 'error';
    byRisk[risk] = (byRisk[risk] || 0) + 1;
  }

  return {
    ok: true,
    pending,
    total: results.length,
    byRisk,
    bills: results,
    summary: `${results.length} 笔完成预审：${Object.entries(byRisk).map(([k, v]) => `${k}=${v}`).join('，')}`,
  };
}

const args = process.argv.slice(2);
const db = openDb();
const usePreauditCache = !args.includes('--no-preaudit-cache');

try {
  if (args.includes('--stdin')) {
    const input = readFileSync(0, 'utf8');
    const detail = JSON.parse(input);
    printJson(await preauditDetail(detail, db, { useCache: usePreauditCache }));
  } else if (args[0] === '--batch') {
    const typeIdx = args.indexOf('--type');
    const filterType = typeIdx >= 0 ? args[typeIdx + 1] : null;
    const page = await createPage('cmb-preaudit');
    printJson(await preauditBatch(page, db, filterType, usePreauditCache));
  } else if (args[0] && !args[0].startsWith('--')) {
    const page = await createPage('cmb-preaudit');
    printJson(await preauditSingle(page, args[0], db, usePreauditCache));
  } else {
    printJson({
      error: 'Usage: node preaudit.mjs BILL_ID | --batch [--type 类型] | --stdin < detail.json',
    });
  }
} catch (err) {
  printJson({ error: err.message || String(err), stack: err.stack });
  process.exitCode = 1;
} finally {
  db.close();
}
