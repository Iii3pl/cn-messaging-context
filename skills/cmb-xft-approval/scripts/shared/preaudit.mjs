/**
 * shared/preaudit.mjs — 薪福通 AI 预审数据包与规则引擎。
 *
 * 设计边界：
 * - CRM CLI 是在线事实源，用于项目/订单/人员的当前状态校验。
 * - Databoard DuckDB 是经营口径源，用于项目/客户 P&L 补充。
 * - 本模块不点击审批按钮，只产出可追溯证据和建议。
 */

import { spawnSync } from 'node:child_process';

const DEFAULT_DATABOARD_DB = '/Users/wuliang/.mounts/运营中心-SU/小题 2026 年部门经营计划/03_数据与分析/经营数据/db/经营数据.duckdb';
const CRM_TIMEOUT_MS = 20000;
const PY_TIMEOUT_MS = 20000;

function unique(items) {
  return [...new Set(items.filter(Boolean).map(s => String(s).trim()).filter(Boolean))];
}

function lastDeptSegment(department) {
  if (!department) return '';
  const raw = String(department);
  const parts = raw.includes('→') ? raw.split('→') : raw.split('|');
  return (parts[parts.length - 1] || raw).trim();
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    const first = text.search(/[\[{]/);
    if (first >= 0) {
      return JSON.parse(text.slice(first));
    }
    throw new Error(`JSON_PARSE_FAILED: ${text.slice(0, 200)}`);
  }
}

function runCommand(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout || CRM_TIMEOUT_MS,
    input: opts.input,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error) {
    return { ok: false, error: result.error.message, stdout: result.stdout || '', stderr: result.stderr || '' };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: `EXIT_${result.status}`,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  }
  return { ok: true, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export function normalizeXftProjectRef(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    return { raw: input, internalId: null, canonicalFullName: '', canonicalName: '', keywords: [] };
  }

  const cleaned = input
    .replace(/^关联项目\s*/g, '')
    .replace(/^单据项目\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = cleaned.split('-').map(p => p.trim()).filter(Boolean);
  const idIndex = parts.findIndex(p => /^\d{12,}[a-z0-9]{3,}$/i.test(p));
  const internalId = idIndex >= 0 ? parts[idIndex] : null;
  const canonicalParts = idIndex >= 0 && parts.length > idIndex + 1
    ? parts.slice(idIndex + 1)
    : parts;
  const canonicalFullName = canonicalParts.join('-') || cleaned;

  const canonicalName = deriveCrmProjectName(canonicalFullName);
  const keywords = unique([
    canonicalFullName,
    canonicalName,
    stripDateSuffix(canonicalFullName),
    stripDateSuffix(canonicalName),
  ]);

  return {
    raw: cleaned,
    internalId,
    canonicalFullName,
    canonicalName,
    keywords,
  };
}

export function deriveCrmProjectName(projectFullName) {
  const full = String(projectFullName || '').trim();
  if (!full) return '';
  const parts = full.split('-').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return full;

  let work = parts.slice();
  if (/^\d{2}\.\d{2}$/.test(work[work.length - 1] || '') && /^\d{2}\.\d{2}$/.test(work[work.length - 2] || '')) {
    work = work.slice(0, -2);
  }
  if (work.length > 1) work = work.slice(1);
  return work.join('-') || full;
}

function stripDateSuffix(value) {
  return String(value || '')
    .replace(/-\d{2}\.\d{2}-\d{2}\.\d{2}$/g, '')
    .trim();
}

export function extractProjectRefs(detail) {
  const refs = [];
  for (const a of detail?.allocations || []) {
    if (a.project_full) refs.push(a.project_full);
  }
  if (detail?.project) refs.push(detail.project);
  if (detail?.subject) {
    const bracket = String(detail.subject).match(/[（(]([^()（）]+)[)）]/);
    if (bracket) refs.push(bracket[1]);
    const projectLike = String(detail.subject).match(/(?:视频平台代运营|图文平台代运营|多平台视频代运营|内容制作|代运营|传播)-[^）)\n]+/);
    if (projectLike) refs.push(projectLike[0]);
  }
  return unique(refs).map(normalizeXftProjectRef);
}

function scoreProjectCandidate(candidate, norm, detail) {
  const full = candidate.project_full_name || candidate.full_name || '';
  const name = candidate.project_name || candidate.name || '';
  const dept = candidate.charge_department_path || candidate.charge_department?.full_name || candidate.charge_department_name || candidate.charge_department?.name || '';
  const deptTail = lastDeptSegment(detail?.department);

  let score = 0;
  const reasons = [];

  if (norm.canonicalFullName && full === norm.canonicalFullName) {
    score += 100;
    reasons.push('project_full_name 精确匹配');
  } else if (norm.canonicalFullName && full.includes(norm.canonicalFullName)) {
    score += 90;
    reasons.push('project_full_name 包含匹配');
  } else if (norm.canonicalName && name === norm.canonicalName) {
    score += 92;
    reasons.push('project_name 精确匹配');
  } else if (norm.canonicalName && (full.includes(norm.canonicalName) || name.includes(norm.canonicalName))) {
    score += 78;
    reasons.push('项目名称包含匹配');
  }

  if (deptTail && dept.includes(deptTail)) {
    score += 10;
    reasons.push('承担部门匹配');
  }

  if (candidate.approval_status === 3 || candidate.approval_status_str === '已通过') {
    score += 5;
    reasons.push('CRM 项目已审批');
  }

  return { score, reasons };
}

function normalizeCrmCandidate(row, source) {
  const id = row.crm_project_id ?? row.id;
  return {
    source,
    id: id != null ? Number(id) : null,
    project_unique_sn: row.project_unique_sn ?? row.unique_sn ?? null,
    project_full_name: row.project_full_name ?? row.full_name ?? '',
    project_name: row.project_name ?? row.name ?? '',
    amount_yuan: row.amount_yuan ?? (row.amount != null ? Number(row.amount) : null),
    project_begin_at: row.project_begin_at ?? null,
    project_end_at: row.project_end_at ?? null,
    status: row.status ?? null,
    approval_status: row.approval_status ?? null,
    approval_status_str: row.approval_status_str ?? null,
    charge_department_name: row.charge_department_name ?? row.charge_department?.name ?? null,
    charge_department_path: row.charge_department_path ?? row.charge_department?.full_name ?? null,
    project_owner_names: row.project_owner_names ?? (Array.isArray(row.project_owner) ? row.project_owner.map(o => o.user?.name).filter(Boolean).join(',') : null),
    contract_order_id: row.contract_order_id ?? row.contract_order?.id ?? null,
    order_name: row.order_name ?? row.contract_order?.name ?? null,
    order_sn: row.order_sn ?? row.contract_order?.order_sn ?? null,
    sub_order_sn: row.sub_order_sn ?? row.contract_order?.sub_order_sn ?? null,
    order_amount_yuan: row.order_amount_yuan ?? row.contract_order?.amount ?? null,
    order_customer_name: row.order_customer_name ?? row.contract_order?.customer_name ?? null,
    raw: row,
  };
}

function queryDataboardProjectCandidates(norms, detail, dbPath = DEFAULT_DATABOARD_DB) {
  const payload = { norms, dbPath };
  const py = String.raw`
import duckdb, json, sys
payload = json.loads(sys.stdin.read())
db_path = payload["dbPath"]
norms = payload.get("norms", [])
out = []
try:
    con = duckdb.connect(db_path, read_only=True)
    for norm in norms:
        kws = [norm.get("canonicalFullName"), norm.get("canonicalName")] + norm.get("keywords", [])
        seen = set()
        for kw in [k for k in kws if k]:
            rows = con.execute("""
                SELECT crm_project_id, project_unique_sn, project_name, project_full_name,
                       project_type_name, amount_yuan, CAST(project_begin_at AS VARCHAR) AS project_begin_at,
                       CAST(project_end_at AS VARCHAR) AS project_end_at, status, approval_status,
                       approval_status_str, CAST(approval_pass_at AS VARCHAR) AS approval_pass_at,
                       charge_department_id, charge_department_name, charge_department_path,
                       project_owner_names, project_owner_job_numbers, contract_order_id,
                       order_name, order_sn, sub_order_sn, order_status, order_amount_yuan,
                       order_customer_name, synced_at
                FROM stg_crm_project_list
                WHERE project_full_name = ?
                   OR project_name = ?
                   OR project_full_name LIKE '%' || ? || '%'
                   OR project_name LIKE '%' || ? || '%'
                LIMIT 20
            """, [kw, kw, kw, kw]).fetchall()
            cols = [d[0] for d in con.description]
            for row in rows:
                rec = dict(zip(cols, row))
                key = rec.get("crm_project_id")
                if key in seen:
                    continue
                seen.add(key)
                rec["_matched_keyword"] = kw
                out.append(rec)
    print(json.dumps({"ok": True, "rows": out}, ensure_ascii=False, default=str))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
`;
  const result = runCommand('python3', ['-c', py], {
    input: JSON.stringify(payload),
    timeout: PY_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, error: result.error, rows: [] };
  const parsed = parseJsonOutput(result.stdout);
  if (!parsed?.ok) return { ok: false, error: parsed?.error || 'DATABOARD_QUERY_FAILED', rows: [] };
  const rows = parsed.rows || [];
  return {
    ok: true,
    rows: rows.map(r => normalizeCrmCandidate(r, 'databoard.stg_crm_project_list')),
  };
}

function queryCrmProjectList(norms) {
  const rows = [];
  const seen = new Set();
  const errors = [];
  const keywords = unique(norms.flatMap(n => n.keywords || []));

  for (const keyword of keywords.slice(0, 8)) {
    const result = runCommand('crm', ['project', 'list', '--keyword', keyword, '--rows', '10', '--json']);
    if (!result.ok) {
      errors.push({ keyword, error: result.error, stderr: result.stderr });
      continue;
    }
    let parsed;
    try {
      parsed = parseJsonOutput(result.stdout);
    } catch (err) {
      errors.push({ keyword, error: err.message, stdout: result.stdout.slice(0, 300) });
      continue;
    }
    for (const row of Array.isArray(parsed) ? parsed : []) {
      if (row?.id == null || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(normalizeCrmCandidate({ ...row, _matched_keyword: keyword }, 'crm.project.list'));
    }
  }

  return { ok: errors.length === 0 || rows.length > 0, rows, errors };
}

function fetchCrmProjectDetail(projectId) {
  if (!projectId) return { ok: false, error: 'NO_PROJECT_ID' };
  const result = runCommand('crm', ['project', 'detail', String(projectId), '--json']);
  if (!result.ok) return { ok: false, error: result.error, stderr: result.stderr };
  try {
    return { ok: true, data: parseJsonOutput(result.stdout) };
  } catch (err) {
    return { ok: false, error: err.message, stdout: result.stdout.slice(0, 300) };
  }
}

function fetchCrmApplicant(name) {
  if (!name) return { ok: false, error: 'NO_APPLICANT' };
  const result = runCommand('crm', ['org', 'users', '--name', String(name), '--rows', '5', '--json']);
  if (!result.ok) return { ok: false, error: result.error, stderr: result.stderr };
  try {
    return { ok: true, data: parseJsonOutput(result.stdout) };
  } catch (err) {
    return { ok: false, error: err.message, stdout: result.stdout.slice(0, 300) };
  }
}

function queryDataboardFinancials(project, dbPath = DEFAULT_DATABOARD_DB) {
  if (!project?.project_name && !project?.project_full_name) {
    return { ok: false, error: 'NO_PROJECT_FOR_FINANCIALS' };
  }
  const payload = {
    dbPath,
    projectName: project.project_name,
    projectFullName: project.project_full_name,
    crmProjectId: project.id,
  };
  const py = String.raw`
import duckdb, json, sys
payload = json.loads(sys.stdin.read())
out = {"ok": True, "project_rows": [], "raw_rows": []}
try:
    con = duckdb.connect(payload["dbPath"], read_only=True)
    names = [payload.get("projectName"), payload.get("projectFullName")]
    names = [n for n in names if n]
    for name in names[:2]:
        rows = con.execute("""
            SELECT 年月, 项目名称, 一级客户, 二级客户, 三级客户,
                   SUM(当月经营收入_元) AS revenue_yuan,
                   SUM(当月经营成本_元) AS cost_yuan,
                   SUM(当月经营毛利_元) AS gross_yuan,
                   CASE WHEN SUM(当月经营收入_元) = 0 THEN NULL
                        ELSE SUM(当月经营毛利_元) / SUM(当月经营收入_元) END AS gross_margin,
                   MAX(是否亏损) AS loss_flag,
                   MAX(是否低毛利) AS low_margin_flag
            FROM projects
            WHERE 项目名称 = ? OR 项目名称 LIKE '%' || ? || '%'
            GROUP BY 年月, 项目名称, 一级客户, 二级客户, 三级客户
            ORDER BY 年月 DESC
            LIMIT 12
        """, [name, name]).fetchall()
        cols = [d[0] for d in con.description]
        for row in rows:
            out["project_rows"].append(dict(zip(cols, row)))
        raw = con.execute("""
            SELECT 年月, 报表项目, 成本分类对应科目, 项目, 立项编号,
                   一级客户, 二级客户, 三级客户, SUM(金额) AS amount_yuan
            FROM raw_financials
            WHERE 项目 = ? OR 项目 LIKE '%' || ? || '%'
            GROUP BY 年月, 报表项目, 成本分类对应科目, 项目, 立项编号, 一级客户, 二级客户, 三级客户
            ORDER BY 年月 DESC, ABS(SUM(金额)) DESC
            LIMIT 20
        """, [name, name]).fetchall()
        cols = [d[0] for d in con.description]
        for row in raw:
            out["raw_rows"].append(dict(zip(cols, row)))
    seen = set()
    dedup = []
    for row in out["project_rows"]:
        key = json.dumps(row, ensure_ascii=False, default=str)
        if key not in seen:
            seen.add(key)
            dedup.append(row)
    out["project_rows"] = dedup
    seen = set()
    dedup = []
    for row in out["raw_rows"]:
        key = json.dumps(row, ensure_ascii=False, default=str)
        if key not in seen:
            seen.add(key)
            dedup.append(row)
    out["raw_rows"] = dedup
    print(json.dumps(out, ensure_ascii=False, default=str))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
`;
  const result = runCommand('python3', ['-c', py], {
    input: JSON.stringify(payload),
    timeout: PY_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, error: result.error, stderr: result.stderr };
  try {
    return parseJsonOutput(result.stdout);
  } catch (err) {
    return { ok: false, error: err.message, stdout: result.stdout.slice(0, 300) };
  }
}

function pickBestMatch(candidates, norms, detail) {
  let best = null;
  for (const candidate of candidates) {
    for (const norm of norms) {
      const scored = scoreProjectCandidate(candidate, norm, detail);
      if (!best || scored.score > best.score) {
        best = { candidate, norm, score: scored.score, reasons: scored.reasons };
      }
    }
  }
  if (!best) return null;
  const confidence = best.score >= 95 ? 'high' : best.score >= 78 ? 'medium' : 'low';
  return {
    ...best,
    confidence,
    matched: best.score >= 78,
  };
}

function addCheck(checks, id, status, severity, message, evidence = {}) {
  checks.push({ id, status, severity, message, evidence });
}

function requiresProjectMatch(detail) {
  const type = detail?.type || '';
  return !/员工日常报销单|团建费申请|员工备用金/.test(type);
}

function numberValue(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function projectPeriodState(projectDetail) {
  const today = new Date();
  const begin = projectDetail?.project_begin_at ? new Date(projectDetail.project_begin_at) : null;
  const end = projectDetail?.project_end_at ? new Date(projectDetail.project_end_at) : null;
  if (!begin || Number.isNaN(begin.getTime()) || !end || Number.isNaN(end.getTime())) return 'unknown';
  if (today < begin) return 'future';
  if (today > end) return 'ended';
  return 'active';
}

function summarizeFinancials(financials) {
  const rows = financials?.project_rows || [];
  if (!rows.length) return null;
  const totals = rows.reduce((acc, r) => {
    acc.revenue += numberValue(r.revenue_yuan) || 0;
    acc.cost += numberValue(r.cost_yuan) || 0;
    acc.gross += numberValue(r.gross_yuan) || 0;
    if (!acc.latestMonth || String(r['年月']) > acc.latestMonth) acc.latestMonth = String(r['年月']);
    return acc;
  }, { revenue: 0, cost: 0, gross: 0, latestMonth: '' });
  totals.grossMargin = totals.revenue ? totals.gross / totals.revenue : null;
  return totals;
}

export async function runPreauditForDetail(detail, opts = {}) {
  const checks = [];
  const evidence = [];
  const missingContext = [];
  const projectRefs = extractProjectRefs(detail);
  const projectRequired = requiresProjectMatch(detail);
  const dbRecord = opts.dbRecord || null;

  if (dbRecord) {
    addCheck(checks, 'duplicate_db', 'fail', 'red', '本地审批库已有该单据记录', { approved_at: dbRecord.approved_at, action: dbRecord.action });
  } else {
    addCheck(checks, 'duplicate_db', 'pass', 'info', '本地审批库未发现重复记录');
  }

  const amount = detail.amount ?? 0;
  if (amount <= 0) {
    addCheck(checks, 'amount', 'warn', 'yellow', '金额为 0 或未解析到金额', { amount });
  } else if (amount > 50000) {
    addCheck(checks, 'amount', 'warn', 'yellow', '金额超过 50000，需要重点复核', { amount });
  } else if (amount > 10000) {
    addCheck(checks, 'amount', 'warn', 'yellow', '金额超过 10000，建议复核', { amount });
  } else {
    addCheck(checks, 'amount', 'pass', 'info', '金额在常规阈值内', { amount });
  }

  if (!projectRefs.length && projectRequired) {
    addCheck(checks, 'xft_project_ref', 'fail', 'red', '薪福通详情未读取到项目字段');
    missingContext.push('xft_project');
  } else if (!projectRefs.length) {
    addCheck(checks, 'xft_project_ref', 'pass', 'info', '该类型按部门费用预审，不强制要求项目字段', { type: detail.type || null });
  } else {
    addCheck(checks, 'xft_project_ref', 'pass', 'info', '已读取薪福通项目字段', { refs: projectRefs.map(r => r.canonicalFullName) });
  }

  const databoard = opts.skipDataboard || !projectRefs.length ? { ok: false, rows: [] } : queryDataboardProjectCandidates(projectRefs, detail, opts.databoardDbPath);
  const crmList = opts.skipCrm || !projectRefs.length ? { ok: false, rows: [], errors: [] } : queryCrmProjectList(projectRefs);
  const allCandidates = [...(databoard.rows || []), ...(crmList.rows || [])];
  const best = pickBestMatch(allCandidates, projectRefs, detail);

  let crmProject = null;
  let crmProjectDetail = null;
  if (best?.matched) {
    crmProject = best.candidate;
    addCheck(checks, 'crm_project_match', 'pass', 'info', '已匹配 CRM 项目', {
      crm_project_id: crmProject.id,
      project_full_name: crmProject.project_full_name,
      match_method: best.reasons.join('；'),
      confidence: best.confidence,
      source: crmProject.source,
    });
    evidence.push({
      source: crmProject.source,
      kind: 'crm_project_match',
      data: {
        crm_project_id: crmProject.id,
        project_full_name: crmProject.project_full_name,
        project_name: crmProject.project_name,
        order_customer_name: crmProject.order_customer_name,
        charge_department_path: crmProject.charge_department_path,
      },
    });
    if (!opts.skipCrm && crmProject.id) {
      const detailResult = fetchCrmProjectDetail(crmProject.id);
      if (detailResult.ok) {
        crmProjectDetail = detailResult.data;
        evidence.push({
          source: 'crm.project.detail',
          kind: 'crm_project_detail',
          data: {
            id: crmProjectDetail.id,
            amount: crmProjectDetail.amount,
            cost_amount: crmProjectDetail.cost_amount,
            outsourcing_cost_amount: crmProjectDetail.outsourcing_cost_amount,
            exec_cost_amount: crmProjectDetail.exec_cost_amount,
            acceptance_amount: crmProjectDetail.acceptance_amount,
            approval_status: crmProjectDetail.approval_status,
            project_begin_at: crmProjectDetail.project_begin_at,
            project_end_at: crmProjectDetail.project_end_at,
            accountability_count: crmProjectDetail.accountability_records?.length || 0,
            acceptance_count: crmProjectDetail.project_acceptance_with_detail?.length || 0,
          },
        });
      } else {
        addCheck(checks, 'crm_project_detail', 'unknown', 'yellow', 'CRM 项目详情读取失败', detailResult);
        missingContext.push('crm_project_detail');
      }
    }
  } else if (projectRequired) {
    addCheck(checks, 'crm_project_match', 'fail', 'red', '未匹配到 CRM 项目', {
      tried: projectRefs.flatMap(r => r.keywords),
      crm_errors: crmList.errors || [],
      databoard_error: databoard.error || null,
    });
    missingContext.push('crm_project');
  } else {
    addCheck(checks, 'crm_project_match', 'pass', 'info', '该类型为部门/人员费用，跳过 CRM 项目匹配', { type: detail.type || null });
  }

  const projectForChecks = crmProjectDetail || crmProject;
  if (projectForChecks) {
    if (projectForChecks.approval_status === 3 || projectForChecks.approval_status_str === '已通过') {
      addCheck(checks, 'crm_project_approved', 'pass', 'info', 'CRM 项目审批状态为已通过');
    } else {
      addCheck(checks, 'crm_project_approved', 'fail', 'red', 'CRM 项目未处于已通过状态', {
        approval_status: projectForChecks.approval_status,
        approval_status_str: projectForChecks.approval_status_str,
      });
    }

    const deptTail = lastDeptSegment(detail.department);
    const crmDept = projectForChecks.charge_department?.full_name || projectForChecks.charge_department_path || projectForChecks.charge_department_name || '';
    if (deptTail && crmDept.includes(deptTail)) {
      addCheck(checks, 'department_match', 'pass', 'info', '薪福通承担部门与 CRM 项目承担部门一致', { xft: deptTail, crm: crmDept });
    } else if (deptTail && crmDept) {
      addCheck(checks, 'department_match', 'warn', 'yellow', '薪福通承担部门与 CRM 项目承担部门不完全一致', { xft: deptTail, crm: crmDept });
    } else {
      addCheck(checks, 'department_match', 'unknown', 'yellow', '部门信息不足，无法校验');
    }

    const periodState = projectPeriodState(projectForChecks);
    if (periodState === 'active') {
      addCheck(checks, 'project_period', 'pass', 'info', '项目当前仍在执行周期内', {
        begin: projectForChecks.project_begin_at,
        end: projectForChecks.project_end_at,
      });
    } else if (periodState === 'ended') {
      addCheck(checks, 'project_period', 'warn', 'yellow', '项目执行周期已结束，可能是历史补结算', {
        begin: projectForChecks.project_begin_at,
        end: projectForChecks.project_end_at,
      });
    } else if (periodState === 'future') {
      addCheck(checks, 'project_period', 'warn', 'yellow', '项目尚未开始，需确认预付款或提前采购合理性', {
        begin: projectForChecks.project_begin_at,
        end: projectForChecks.project_end_at,
      });
    } else {
      addCheck(checks, 'project_period', 'unknown', 'yellow', '项目周期缺失，无法校验');
    }

    const costBudget = numberValue(projectForChecks.cost_amount);
    if (costBudget != null && amount > 0) {
      if (amount <= costBudget) {
        addCheck(checks, 'cost_budget', 'pass', 'info', '本次金额未超过 CRM 项目总成本预算', { amount, cost_budget: costBudget });
      } else {
        addCheck(checks, 'cost_budget', 'fail', 'red', '本次金额超过 CRM 项目总成本预算', { amount, cost_budget: costBudget });
      }
    } else {
      addCheck(checks, 'cost_budget', 'unknown', 'yellow', 'CRM 项目成本预算缺失，无法校验');
    }

    const acceptanceAmount = numberValue(projectForChecks.acceptance_amount);
    const acceptanceCount = projectForChecks.project_acceptance_with_detail?.length || 0;
    if (acceptanceAmount > 0 || acceptanceCount > 0) {
      addCheck(checks, 'acceptance', 'pass', 'info', 'CRM 项目已有验收记录或验收金额', { acceptance_amount: acceptanceAmount, acceptance_count: acceptanceCount });
    } else if (detail.type === '供应商结算单' && amount > 1000) {
      addCheck(checks, 'acceptance', 'warn', 'yellow', '供应商结算单未看到 CRM 验收记录，需确认执行证明', { acceptance_amount: acceptanceAmount, acceptance_count: acceptanceCount });
    } else {
      addCheck(checks, 'acceptance', 'unknown', 'yellow', '未看到 CRM 验收记录，金额较小可人工确认');
    }

    const accRecords = projectForChecks.accountability_records || [];
    if (accRecords.some(r => r.status === 2)) {
      addCheck(checks, 'accountability', 'pass', 'info', 'CRM 项目已有已确认权责记录', { count: accRecords.length });
    } else if (accRecords.length > 0) {
      addCheck(checks, 'accountability', 'warn', 'yellow', 'CRM 项目权责记录未确认或未录入', { statuses: accRecords.map(r => r.status) });
    } else {
      addCheck(checks, 'accountability', 'unknown', 'yellow', 'CRM 项目未返回权责记录');
    }
  }

  let applicant = null;
  if (!opts.skipCrm && detail.applicant) {
    const applicantResult = fetchCrmApplicant(detail.applicant);
    if (applicantResult.ok) {
      applicant = Array.isArray(applicantResult.data) ? applicantResult.data[0] : null;
      if (applicant) {
        addCheck(checks, 'applicant', 'pass', 'info', '申请人可在 CRM 组织中识别', {
          name: applicant.name,
          job_number: applicant.job_number,
          title: applicant.title,
        });
      } else {
        addCheck(checks, 'applicant', 'warn', 'yellow', '申请人在 CRM 组织中未命中', { applicant: detail.applicant });
      }
    } else {
      addCheck(checks, 'applicant', 'unknown', 'yellow', 'CRM 组织查询失败', applicantResult);
    }
  }

  if (detail.type === '团建费申请') {
    if (detail.teamSize && amount > 0) {
      const perCapita = amount / detail.teamSize;
      if (perCapita <= 200) {
        addCheck(checks, 'team_building_per_capita', 'pass', 'info', '团建人均金额在常规阈值内', { teamSize: detail.teamSize, amount, perCapita });
      } else {
        addCheck(checks, 'team_building_per_capita', 'warn', 'yellow', '团建人均金额偏高，建议复核名单和标准', { teamSize: detail.teamSize, amount, perCapita });
      }
    } else {
      addCheck(checks, 'team_building_per_capita', 'unknown', 'yellow', '团建人数或金额缺失，无法计算人均金额', { teamSize: detail.teamSize || null, amount });
    }
  }

  let financials = null;
  if (!opts.skipDataboard && crmProject) {
    financials = queryDataboardFinancials(crmProject, opts.databoardDbPath);
    if (financials?.ok && (financials.project_rows?.length || financials.raw_rows?.length)) {
      const totals = summarizeFinancials(financials);
      evidence.push({
        source: 'databoard.duckdb',
        kind: 'project_financials',
        data: {
          project_rows: financials.project_rows?.slice(0, 5) || [],
          raw_rows: financials.raw_rows?.slice(0, 5) || [],
          totals,
        },
      });
      if (totals?.revenue || totals?.cost) {
        addCheck(checks, 'databoard_financials', 'pass', 'info', 'Databoard 已找到项目经营数据', totals);
      } else {
        addCheck(checks, 'databoard_financials', 'unknown', 'yellow', 'Databoard 有项目记录但收入/成本暂为空', { rows: financials.project_rows?.length || 0 });
      }
    } else {
      addCheck(checks, 'databoard_financials', 'unknown', 'yellow', 'Databoard 暂未找到项目经营明细', { error: financials?.error || null });
    }
  }

  const riskLevel = deriveRiskLevel(checks);
  const recommendation = deriveRecommendation(riskLevel, checks, detail);
  const aiSummary = buildSummary({ detail, crmProject, crmProjectDetail, checks, riskLevel, recommendation });
  const approvalNoteSuggestion = buildApprovalNoteSuggestion(riskLevel, detail, crmProject || crmProjectDetail);

  return {
    ok: true,
    billId: detail.billId,
    category: detail.type || null,
    riskLevel,
    recommendation,
    confidence: deriveConfidence(checks),
    projectRefs,
    crmProjectMatch: best ? {
      matched: best.matched,
      confidence: best.confidence,
      score: best.score,
      reasons: best.reasons,
      candidate: crmProject,
      normalizedProject: best.norm,
    } : null,
    crmProjectDetail,
    applicant,
    financials,
    checks,
    evidence,
    missingContext: unique(missingContext),
    aiSummary,
    approvalNoteSuggestion,
  };
}

function deriveRiskLevel(checks) {
  if (checks.some(c => c.status === 'fail' && c.severity === 'red')) return 'red';
  const unknownCritical = checks.some(c => c.id === 'crm_project_match' && c.status !== 'pass');
  if (unknownCritical) return 'unknown';
  if (checks.some(c => c.status === 'warn' || c.status === 'unknown')) return 'yellow';
  return 'green';
}

function deriveConfidence(checks) {
  const pass = checks.filter(c => c.status === 'pass').length;
  const total = checks.length || 1;
  const base = pass / total;
  if (checks.some(c => c.id === 'crm_project_match' && c.status === 'pass')) return Math.max(base, 0.72);
  return Math.min(base, 0.55);
}

function deriveRecommendation(riskLevel) {
  if (riskLevel === 'green') return 'pass';
  if (riskLevel === 'yellow') return 'manual_review';
  if (riskLevel === 'red') return 'return_or_reject';
  return 'need_more_info';
}

function buildSummary({ detail, crmProject, crmProjectDetail, checks, riskLevel, recommendation }) {
  const amount = detail.amount != null ? `CNY ${Number(detail.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '金额未解析';
  const project = requiresProjectMatch(detail)
    ? (crmProjectDetail?.full_name || crmProject?.project_full_name || '未匹配 CRM 项目')
    : '部门/人员费用，无需 CRM 项目匹配';
  const riskText = {
    green: '绿灯',
    yellow: '黄灯',
    red: '红灯',
    unknown: '未知',
  }[riskLevel] || riskLevel;
  const recText = {
    pass: '建议通过',
    manual_review: '建议人工复核后处理',
    return_or_reject: '建议退回或拒绝，先补齐问题',
    need_more_info: '需要补充信息后再判断',
  }[recommendation] || recommendation;
  const topIssues = checks
    .filter(c => c.status !== 'pass')
    .slice(0, 4)
    .map(c => c.message);
  const issueText = topIssues.length ? `主要关注：${topIssues.join('；')}。` : '关键校验均通过。';
  return `${recText}（${riskText}）。${detail.type || '审批单'}，申请人 ${detail.applicant || '-'}，金额 ${amount}，匹配项目：${project}。${issueText}`;
}

function buildApprovalNoteSuggestion(riskLevel, detail, project) {
  if (riskLevel === 'green') {
    if (!requiresProjectMatch(detail)) {
      if (detail.type === '团建费申请' && detail.teamSize && detail.amount) {
        const perCapita = detail.amount / detail.teamSize;
        return `同意。已预审：团建 ${detail.teamSize} 人，合计 ${detail.amount} 元，人均 ${perCapita.toFixed(2)} 元，金额和申请人校验通过。`;
      }
      return `同意。已预审：${detail.type || '部门费用'}，金额和申请人校验通过。`;
    }
    return `同意。已预审：项目已匹配 CRM（${project?.project_name || project?.name || '项目'}），金额和部门校验通过。`;
  }
  if (riskLevel === 'yellow') {
    if (!requiresProjectMatch(detail)) {
      return `待人工确认后同意：${detail.subject || detail.type || '该单'} 为部门/人员费用，存在预审提醒，请确认材料完整。`;
    }
    return `待人工确认后同意：${detail.subject || detail.type || '该单'} 已匹配项目，但存在预审提醒，请确认材料完整。`;
  }
  if (riskLevel === 'red') {
    return '建议退回补充材料：预审发现关键校验未通过。';
  }
  return '暂不建议审批：项目或经营证据不足。';
}
