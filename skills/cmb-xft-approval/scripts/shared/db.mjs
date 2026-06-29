/**
 * shared/db.mjs — SQLite 数据库操作（Node 22+ DatabaseSync）
 *
 * 表结构包含增强字段：sub_type, applicant_id, bank_account,
 * contract_name, supplier, contract_period, system_remark,
 * approval_chain (JSON), expense_breakdown (JSON)
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export const DB_PATH = '/Users/wuliang/.hermes/data/cmb_approvals.db';

/**
 * 打开/创建数据库，确保表结构最新。
 * @returns {DatabaseSync}
 */
export function openDb() {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id TEXT NOT NULL UNIQUE,
      bill_type TEXT NOT NULL,
      sub_type TEXT,
      applicant_name TEXT NOT NULL,
      applicant_id TEXT,
      amount REAL,
      subject TEXT,
      department TEXT,
      project TEXT,
      bank_account TEXT,
      company TEXT DEFAULT '厦门小题旅行科技有限公司',
      approved_at TEXT NOT NULL,
      approved_by TEXT DEFAULT '吴亮',
      action TEXT NOT NULL DEFAULT 'agree',
      remark TEXT,
      system_remark TEXT,
      approval_chain TEXT,
      expense_breakdown TEXT,
      contract_name TEXT,
      supplier TEXT,
      contract_period TEXT,
      source TEXT DEFAULT 'cmb-xft',
      sync_dingtalk_todo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
	    CREATE INDEX IF NOT EXISTS idx_bill_id ON approvals(bill_id);
	    CREATE INDEX IF NOT EXISTS idx_approved_at ON approvals(approved_at);

	    CREATE TABLE IF NOT EXISTS preaudit_cache (
	      cache_key TEXT PRIMARY KEY,
	      bill_id TEXT,
	      project_key TEXT,
	      preaudit_json TEXT NOT NULL,
	      created_at TEXT NOT NULL,
	      expires_at TEXT NOT NULL
	    );
	    CREATE INDEX IF NOT EXISTS idx_preaudit_cache_bill_id ON preaudit_cache(bill_id);
	    CREATE INDEX IF NOT EXISTS idx_preaudit_cache_expires_at ON preaudit_cache(expires_at);
	  `);

  // 自动迁移：补旧表缺失的 v3 增强字段
  const cols = db.prepare("PRAGMA table_info('approvals')").all().map(r => r.name);
  const migrations = [
    ['sub_type', 'TEXT'],
    ['bank_account', 'TEXT'],
    ['approval_chain', 'TEXT'],
    ['expense_breakdown', 'TEXT'],
    ['contract_name', 'TEXT'],
    ['supplier', 'TEXT'],
    ['contract_period', 'TEXT'],
    ['system_remark', 'TEXT'],
    ['allocations', 'TEXT'],
    ['dept_l2', 'TEXT'],
    ['dept_l3', 'TEXT'],
    ['dept_l4', 'TEXT'],
    ['dept_source', 'TEXT'],
    ['platform', 'TEXT'],
    ['charge_id', 'TEXT'],
    ['account_name', 'TEXT'],
  ];
  for (const [col, type] of migrations) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE approvals ADD COLUMN ${col} ${type}`);
    }
  }

  return db;
}

/**
 * 写入审批记录（INSERT OR IGNORE，重复不覆盖）。
 * @param {DatabaseSync} db
 * @param {object} info - { billId, type, subType?, applicant, applicantId?,
 *   amount?, subject?, department?, project?, bankAccount?,
 *   approvalChain?, expenseBreakdown?, contractName?, supplier?,
 *   contractPeriod?, systemRemark?, action, remark }
 * @returns {{ inserted: boolean, duplicate?: boolean, existing?: object }}
 */
export function recordApproval(db, info) {
  const now = new Date().toISOString();
  // 先查是否已存在
  const existing = findByBillId(db, info.billId);
  if (existing) {
    return { inserted: false, duplicate: true, existing };
  }

  const stmt = db.prepare(`
    INSERT INTO approvals
      (bill_id, bill_type, sub_type, applicant_name, applicant_id,
       amount, subject, department, project, bank_account,
       approval_chain, expense_breakdown,
       contract_name, supplier, contract_period,
       system_remark, allocations, approved_at, action, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    info.billId,
    info.type,
    info.subType || null,
    info.applicant || '',
    info.applicantId || null,
    info.amount ?? null,
    info.subject || null,
    info.department || null,
    info.project || null,
    info.bankAccount || null,
    info.approvalChain ? JSON.stringify(info.approvalChain) : null,
    info.expenseBreakdown ? JSON.stringify(info.expenseBreakdown) : null,
    info.contractName || null,
    info.supplier || null,
    info.contractPeriod || null,
    info.systemRemark || null,
    info.allocations ? JSON.stringify(info.allocations) : null,
    now,
    info.action || 'agree',
    info.remark || null
  );
  return { inserted: true };
}

/**
 * 按 billId 查询是否已处理。
 * @param {DatabaseSync} db
 * @param {string} billId
 * @returns {object|null}
 */
export function findByBillId(db, billId) {
  const stmt = db.prepare('SELECT * FROM approvals WHERE bill_id = ?');
  const row = stmt.get(billId);
  if (!row) return null;
  // 解析 JSON 字段
  if (row.approval_chain) {
    try { row.approval_chain = JSON.parse(row.approval_chain); } catch (_) {}
  }
  if (row.expense_breakdown) {
    try { row.expense_breakdown = JSON.parse(row.expense_breakdown); } catch (_) {}
  }
  return row;
}

/**
 * 列出最近审批记录。
 * @param {DatabaseSync} db
 * @param {number} limit
 * @returns {Array<object>}
 */
export function listRecentApprovals(db, limit = 20) {
  const stmt = db.prepare('SELECT * FROM approvals ORDER BY approved_at DESC LIMIT ?');
  return stmt.all(limit);
}

function normalizeCachePart(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function makePreauditCacheKey(detail) {
  const allocationProjects = (detail?.allocations || [])
    .map(a => a.project_id || a.project_full || a.project_name)
    .filter(Boolean)
    .sort()
    .join('|');
  const projectKey = normalizeCachePart(detail?.project || allocationProjects || detail?.subject || '');
  const parts = [
    normalizeCachePart(detail?.billId),
    normalizeCachePart(detail?.type),
    normalizeCachePart(detail?.applicantId || detail?.applicant),
    normalizeCachePart(detail?.amount),
    projectKey,
  ];
  return {
    cacheKey: parts.join('::'),
    billId: normalizeCachePart(detail?.billId),
    projectKey,
  };
}

export function findPreauditCache(db, detail, { now = new Date() } = {}) {
  const { cacheKey } = typeof detail === 'string'
    ? { cacheKey: detail }
    : makePreauditCacheKey(detail);
  const row = db.prepare('SELECT * FROM preaudit_cache WHERE cache_key = ?').get(cacheKey);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) return null;
  try {
    return {
      cacheKey,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      value: JSON.parse(row.preaudit_json),
    };
  } catch {
    return null;
  }
}

export function recordPreauditCache(db, detail, preaudit, { ttlHours = 24 } = {}) {
  const { cacheKey, billId, projectKey } = makePreauditCacheKey(detail);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 3600 * 1000);
  db.prepare(`
    INSERT OR REPLACE INTO preaudit_cache
      (cache_key, bill_id, project_key, preaudit_json, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    cacheKey,
    billId || null,
    projectKey || null,
    JSON.stringify(preaudit),
    now.toISOString(),
    expires.toISOString()
  );
  return { cacheKey, expiresAt: expires.toISOString() };
}
