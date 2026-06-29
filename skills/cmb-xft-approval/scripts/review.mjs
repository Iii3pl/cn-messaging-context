/**
 * 薪福通审核分析 v1 — 单笔/批量审核，不执行审批
 *
 * Usage:
 *   node review.mjs BILL_ID              # 单笔审核（默认带预审）
 *   node review.mjs --batch              # 批量审核（全部待审批，默认带预审）
 *   node review.mjs --batch --type 合同用印  # 按类型筛选
 *   node review.mjs BILL_ID --skip-preaudit  # 仅跑旧规则
 */

import { ensureLoggedIn, APPROVAL_LIST } from './shared/session.mjs';
import { parseHomepageBills, parseBillDetail, riskCheck } from './shared/extract.mjs';
import { openDb, findByBillId, findPreauditCache, recordPreauditCache } from './shared/db.mjs';
import { runPreauditForDetail } from './shared/preaudit.mjs';
import { createPage } from './shared/opencli.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function maybeRunPreaudit(detail, dbRecord, enabled, db, { useCache = true } = {}) {
  if (!enabled) return null;
  if (useCache && db) {
    const cached = findPreauditCache(db, detail);
    if (cached) {
      return {
        ...cached.value,
        _cache: {
          hit: true,
          cacheKey: cached.cacheKey,
          createdAt: cached.createdAt,
          expiresAt: cached.expiresAt,
        },
      };
    }
  }
  try {
    const preaudit = await runPreauditForDetail(detail, { dbRecord });
    if (useCache && db && preaudit?.ok) {
      const cache = recordPreauditCache(db, detail, preaudit, {
        ttlHours: Number(process.env.CMB_XFT_PREAUDIT_CACHE_HOURS || 24),
      });
      return {
        ...preaudit,
        _cache: { hit: false, cacheKey: cache.cacheKey, expiresAt: cache.expiresAt },
      };
    }
    return preaudit;
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      riskLevel: 'unknown',
      recommendation: 'manual_review',
      aiSummary: '预审执行失败，建议人工复核后处理。',
      checks: [],
    };
  }
}

function reviewSummaryFromPreaudit(preaudit, legacyRisks, legacySuggestion) {
  if (!preaudit) {
    return {
      riskFlags: legacyRisks,
      suggestion: legacySuggestion,
      riskLevel: null,
      recommendation: null,
    };
  }

  const riskFlags = (preaudit.checks || [])
    .filter(c => c.status === 'fail' || c.status === 'warn' || c.status === 'unknown')
    .map(c => c.message)
    .filter(Boolean);

  return {
    riskFlags,
    suggestion: preaudit.aiSummary || legacySuggestion,
    riskLevel: preaudit.riskLevel || 'unknown',
    recommendation: preaudit.recommendation || 'manual_review',
  };
}

// --- 单笔审核 ---
async function reviewSingle(page, billId, withPreaudit = false, usePreauditCache = true) {
  await ensureLoggedIn(page);
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });
  await parseHomepageBills(page);
  const detail = await parseBillDetail(page, billId);
  if (detail.error) {
    console.log(JSON.stringify(detail));
    return;
  }

  const db = openDb();
  const dbRecord = findByBillId(db, billId);

  const { risks, suggestion } = riskCheck(detail, dbRecord);
  const preaudit = await maybeRunPreaudit(detail, dbRecord, withPreaudit, db, { useCache: usePreauditCache });
  const review = reviewSummaryFromPreaudit(preaudit, risks, suggestion);

  console.log(JSON.stringify({
    billId: detail.billId,
    type: detail.type,
    subType: detail.subType || null,
    applicant: detail.applicant,
    applicantId: detail.applicantId || null,
    amount: detail.amount ?? 0,
    subject: detail.subject || '',
    department: detail.department || null,
    project: detail.project || null,
    bankAccount: detail.bankAccount || null,

    // 合同用印专属
    contractName: detail.contractName || null,
    supplier: detail.supplier || null,
    contractPeriod: detail.contractPeriod || null,

    // 费用
    expenseBreakdown: detail.expenseBreakdown || null,
    totalInvoices: detail.totalInvoices || 0,

    // 分摊明细
    allocations: detail.allocations || [],
    deptAgg: detail.deptAgg || [],
    projectAgg: detail.projectAgg || [],

    // 审批链
    approvalChain: detail.approvalChain || [],
    approvalProgress: detail.approvalProgress || '',
    nextApprover: detail.nextApprover || null,
    wuLiangStatus: detail.wuLiangStatus || '',
    systemRemark: detail.systemRemark || null,

    _review: {
      riskFlags: review.riskFlags,
      suggestion: review.suggestion,
      riskLevel: review.riskLevel,
      recommendation: review.recommendation,
      legacyRiskFlags: risks,
      legacySuggestion: suggestion,
      duplicate: !!dbRecord
    },
    preaudit
  }, null, 2));

  db.close();
}

// --- 批量审核 ---
async function reviewBatch(page, filterType, withPreaudit = false, usePreauditCache = true) {
  await ensureLoggedIn(page);
  // 导航到审批列表页
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });
  const { bills } = await parseHomepageBills(page);

  const db = openDb();
  let filtered = bills;
  if (filterType) {
    filtered = bills.filter(b => b.type === filterType || b.type?.includes(filterType));
  }

  const results = [];
  let totalAmount = 0;

  for (let i = 0; i < filtered.length; i++) {
    const b = filtered[i];
    console.error(`[review] ${i + 1}/${filtered.length}: ${b.billId} ${b.type}...`);

    const detail = await parseBillDetail(page, b.billId);
    if (detail.error) {
      results.push({ billId: b.billId, error: detail.error });
      continue;
    }

    const dbRecord = findByBillId(db, detail.billId);
    const { risks, suggestion } = riskCheck(detail, dbRecord);
    const preaudit = await maybeRunPreaudit(detail, dbRecord, withPreaudit, db, { useCache: usePreauditCache });
    const review = reviewSummaryFromPreaudit(preaudit, risks, suggestion);
    totalAmount += detail.amount ?? 0;

    results.push({
      billId: detail.billId,
      type: detail.type,
      subType: detail.subType || null,
      applicant: detail.applicant,
      amount: detail.amount ?? 0,
      subject: detail.subject || '',
      department: detail.department || null,
      project: detail.project || null,
      deptAgg: detail.deptAgg || [],
      projectAgg: detail.projectAgg || [],
      riskFlags: review.riskFlags,
      suggestion: review.suggestion,
      riskLevel: review.riskLevel,
      recommendation: review.recommendation,
      legacyRiskFlags: risks,
      legacySuggestion: suggestion,
      duplicate: !!dbRecord,
      preaudit
    });

    // 返回列表继续下一条
    await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 2000 });
    await sleep(500);
    await parseHomepageBills(page);
  }

  const byType = {};
  for (const r of results) {
    if (r.type) byType[r.type] = (byType[r.type] || 0) + 1;
  }

  const riskCount = results.filter(r => r.riskFlags?.length > 0).length;

  console.log(JSON.stringify({
    total: results.length,
    byType,
    totalAmount: Math.round(totalAmount * 100) / 100,
    withRisks: riskCount,
    bills: results,
    _summary: `${results.length}笔待审批，合计CNY ${totalAmount.toFixed(2)}。${riskCount > 0 ? `其中${riskCount}笔有风险标记需关注。` : '全部无异常。'}`
  }, null, 2));

  db.close();
}

// --- main ---
const arg = process.argv[2];
const withPreaudit = !process.argv.includes('--skip-preaudit');
const usePreauditCache = !process.argv.includes('--no-preaudit-cache');

const page = await createPage('cmb-review');
try {
  if (arg === '--batch') {
    const typeIdx = process.argv.indexOf('--type');
    const filterType = typeIdx >= 0 ? process.argv[typeIdx + 1] : null;
    await reviewBatch(page, filterType, withPreaudit, usePreauditCache);
  } else if (arg && !arg.startsWith('--')) {
    await reviewSingle(page, arg, withPreaudit, usePreauditCache);
  } else {
    console.log(JSON.stringify({
      error: 'Usage: node review.mjs BILL_ID | --batch [--type 类型] [--skip-preaudit]'
    }));
  }
} catch (err) {
  console.log(JSON.stringify({ error: err.message || String(err) }));
}
