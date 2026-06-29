/**
 * 薪福通审批执行 v3 — Vue 多策略点击 + 双重验证 + review 内嵌
 * Usage: node approve.mjs BILL_ID [agree|reject] [remark] [--force] [--skip-preaudit]
 *
 * Exit codes (sysexits.h compatible — same as opencli):
 *   0  成功
 *   1  通用运行时失败（点击失败 / DB 异常 / 按钮未找到）
 *   66 EX_NO_DATA   — 单据没数据（已审批/不存在）
 *   75 EX_TEMPFAIL  — 超时（网络/页面未加载）
 *   77 EX_NOPERM    — 登录态过期 / 需重新认证
 *   78 EX_CONFIG    — 配置/参数错误（单号错误、JSON 解析失败）
 *
 * 上层 agent 调用时仍然 parse stdout 的 JSON 拿 error 字段，
 * exit code 只用于 fast-path 路由决策（不需要再 grep "ok":true）。
 */

import { ensureLoggedIn, APPROVAL_LIST } from './shared/session.mjs';
import { parseHomepageBills, parseBillDetail, riskCheck } from './shared/extract.mjs';
import { openDb, recordApproval, findByBillId, findPreauditCache, recordPreauditCache } from './shared/db.mjs';
import { runPreauditForDetail } from './shared/preaudit.mjs';
import { createPage } from './shared/opencli.mjs';

const EXIT = {
  OK: 0,
  ERR: 1,
  NO_DATA: 66,
  TIMEOUT: 75,
  AUTH: 77,
  CONFIG: 78,
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 多策略点击审批按钮 + 确认按钮（两步提交）。
 *
 * Step 1: 点击「通过」/「退回」选中动作
 * Step 2: 点击「确认」提交审批
 *
 * 关键发现（2026-05-02）：按钮是 <button>，内部有 <span> 子元素，
 * 必须点击 <button> 本身（按 data-opencli-ref 或 parentElement），
 * 不能点 span。element.click() 在 ant-btn 上直接有效。
 */
async function clickApproveAndConfirm(page, action) {
  const labels = action === 'agree' ? ['通过', '同意', '提交'] : ['退回', '拒绝'];

  // 滚到底部
  await page.scroll('down', 5000);
  await sleep(1500);

  // Step 1: 多策略点击审批按钮
  const step1 = await page.evaluate(`
    (() => {
      const labels = ${JSON.stringify(labels)};
      // 策略1: button.ant-btn 精确匹配
      for (const label of labels) {
        const btns = document.querySelectorAll('button.ant-btn');
        for (const b of btns) {
          if (b.textContent.trim() === label && b.offsetParent !== null) {
            b.click();
            return 'clicked ant-btn: ' + label;
          }
        }
      }
      // 策略2: button.ant-btn-primary 精确匹配
      for (const label of labels) {
        const btns = document.querySelectorAll('button.ant-btn-primary');
        for (const b of btns) {
          if (b.textContent.trim() === label && b.offsetParent !== null) {
            b.click();
            return 'clicked ant-btn-primary: ' + label;
          }
        }
      }
      // 策略3: 所有 button 模糊匹配
      for (const label of labels) {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          const t = b.textContent.trim();
          if ((t === label || t.includes(label)) && b.offsetParent !== null && b.className.includes('ant-btn')) {
            b.click();
            return 'clicked fuzzy: ' + label;
          }
        }
      }
      return 'button-not-found';
    })()
  `);

  if (step1 === 'button-not-found') {
    return { executed: false, method: step1 };
  }

  await sleep(1500);

  // Step 2: 查找并点击「确认」按钮
  const step2 = await page.evaluate(`
    (() => {
      // 策略1: button.ant-btn-primary 精确匹配
      for (const t of ['确认', '同意', '确定', '提交']) {
        const btns = document.querySelectorAll('button.ant-btn-primary');
        for (const b of btns) {
          if (b.textContent.trim() === t && b.offsetParent !== null) {
            b.click();
            return 'clicked confirm: ' + t;
          }
        }
      }
      // 降级：遍历所有 button
      for (const t of ['确认', '同意', '确定']) {
        for (const b of document.querySelectorAll('button')) {
          if (b.textContent.trim() === t && b.offsetParent !== null) {
            b.click();
            return 'clicked confirm (fb): ' + t;
          }
        }
      }
      return 'confirm-button-not-found';
    })()
  `);

  return { executed: true, method: step1 + ' → ' + step2 };
}

/**
 * 双重验证：点击后确认是否生效。
 * 判断标准：URL 回到审批列表 / 审批状态变更 / 单据从待审批列表消失
 */
async function verifyClick(page, billId) {
  await sleep(3000);
  const url = await page.evaluate('window.location.href');
  const text = await page.evaluate('document.body.innerText');

  // 回到审批列表页面（新版 /#/form-app/approval 或旧版 /#/trip-app/homepage）
  const backToList = url.includes('form-app/approval') || url.includes('trip-app/homepage');
  // 审批状态变更
  const statusChanged = text.includes('已通过') || text.includes('已拒绝') || !text.includes('审批中');
  // 单据不在列表中了（回到列表 + 已审批 tab）
  const billRemoved = backToList && !text.includes(billId);

  const verified = billRemoved || statusChanged;

  return { verified, url, backToList, billRemoved, statusChanged };
}

// --- main ---
const billId = process.argv[2];
const action = process.argv[3] || 'agree';
const remark = process.argv[4] || (action === 'agree' ? '同意' : '退回');

const forceMode = process.argv.includes('--force');
const skipPreaudit = process.argv.includes('--skip-preaudit');
const usePreauditCache = !process.argv.includes('--no-preaudit-cache');

if (!billId) {
  console.log(JSON.stringify({ error: 'Usage: node approve.mjs BILL_ID [agree|reject] [remark] [--force] [--skip-preaudit]' }));
  process.exit(EXIT.CONFIG);
}

const page = await createPage('cmb-approve');

try {
  // Step 1: 登录 + 查 DB
  await ensureLoggedIn(page);

  const db = openDb();
  const existing = findByBillId(db, billId);

  // Step 2: 打开详情
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });
  await parseHomepageBills(page);
  const detail = await parseBillDetail(page, billId);

  if (detail.error && detail.error === 'BILL_NOT_FOUND') {
    // 查 DB 是否已处理
    if (existing) {
      console.log(JSON.stringify({
        ok: true,
        alreadyProcessed: true,
        billId,
        existing: {
          type: existing.bill_type,
          applicant: existing.applicant_name,
          amount: existing.amount,
          approvedAt: existing.approved_at,
          action: existing.action
        }
      }));
      db.close();
      process.exit(0);
    }
    console.log(JSON.stringify({
      error: 'BILL_NOT_FOUND',
      billId,
      hint: '可能已从待审批列表移除，或单号错误。请确认单号后重试。'
    }));
    db.close();
    process.exit(78);  // sysexits: EX_CONFIG
  }

  if (detail.error) {
    console.log(JSON.stringify(detail));
    db.close();
    // detail.error 可能是 SESSION_EXPIRED / PARSE_ERROR / HEAL_FAILED 等
    const code = detail.error === 'SESSION_EXPIRED' ? EXIT.AUTH
              : detail.error === 'HEAL_FAILED'    ? EXIT.TIMEOUT
              : EXIT.ERR;
    process.exit(code);
  }

  // Step 3: 审核摘要（执行前确认）
  const { risks, suggestion } = riskCheck(detail, existing);

  const reviewSummary = {
    billId,
    type: detail.type,
    subType: detail.subType || null,
    applicant: detail.applicant,
    applicantId: detail.applicantId || null,
    amount: detail.amount ?? 0,
    subject: detail.subject || '',
    department: detail.department || null,
    project: detail.project || null,
    approvalProgress: detail.approvalProgress || '',
    riskFlags: risks,
    suggestion
  };

  console.error(JSON.stringify({ review: reviewSummary }, null, 2));

  // Step 3.5: CRM/Databoard 预审。红灯/未知默认不自动通过，黄灯仅提示。
  let preaudit = null;
  if (!skipPreaudit) {
    const cached = usePreauditCache ? findPreauditCache(db, detail) : null;
    if (cached) {
      preaudit = {
        ...cached.value,
        _cache: {
          hit: true,
          cacheKey: cached.cacheKey,
          createdAt: cached.createdAt,
          expiresAt: cached.expiresAt,
        },
      };
    } else {
      preaudit = await runPreauditForDetail(detail, { dbRecord: existing });
      if (usePreauditCache && preaudit?.ok) {
        const cache = recordPreauditCache(db, detail, preaudit, {
          ttlHours: Number(process.env.CMB_XFT_PREAUDIT_CACHE_HOURS || 24),
        });
        preaudit = {
          ...preaudit,
          _cache: { hit: false, cacheKey: cache.cacheKey, expiresAt: cache.expiresAt },
        };
      }
    }
    console.error(JSON.stringify({
      preaudit: {
        riskLevel: preaudit.riskLevel,
        recommendation: preaudit.recommendation,
        aiSummary: preaudit.aiSummary,
        cache: preaudit._cache || null,
        crmProjectMatch: preaudit.crmProjectMatch,
        blockingChecks: preaudit.checks.filter(c => c.status === 'fail' || c.status === 'unknown').map(c => ({
          id: c.id,
          status: c.status,
          severity: c.severity,
          message: c.message,
        })),
      }
    }, null, 2));

    if (action === 'agree' && !forceMode && (preaudit.riskLevel === 'red' || preaudit.riskLevel === 'unknown')) {
      console.log(JSON.stringify({
        ok: false,
        error: 'PREAUDIT_BLOCKED',
        billId,
        action,
        riskLevel: preaudit.riskLevel,
        recommendation: preaudit.recommendation,
        aiSummary: preaudit.aiSummary,
        hint: '预审为红灯/未知，已阻止自动通过。确认仍要处理时请复核后加 --force，或仅跳过预审加 --skip-preaudit。',
        checks: preaudit.checks,
      }, null, 2));
      db.close();
      process.exit(1);
    }
  }

  // 如果已处理且非 force 模式，直接返回
  if (existing && !forceMode) {
    console.log(JSON.stringify({
      ok: true,
      alreadyProcessed: true,
      billId,
      action: existing.action,
      approvedAt: existing.approved_at,
      hint: '如需强制重新审批，添加 --force 参数'
    }, null, 2));
    db.close();
    process.exit(0);
  }
  if (existing && forceMode) {
    console.error('[force] 已跳过 DB 去重检查，强制重走点击流程');
    // 删除旧 DB 记录
    db.prepare('DELETE FROM approvals WHERE bill_id = ?').run(billId);
  }

  // Step 4: 两步提交：点击「通过」→ 点击「确认」
  const clickResult = await clickApproveAndConfirm(page, action);

  // Step 5: 验证（只在按钮确实被点击后才验证）
  if (!clickResult.executed) {
    console.log(JSON.stringify({
      ok: false,
      error: 'BUTTON_NOT_FOUND',
      billId,
      action,
      hint: '审批按钮未找到，可能单据已处理或页面结构不匹配。请手动检查。',
      method: clickResult.method
    }, null, 2));
    db.close();
    process.exit(1);
  }

  const verifyResult = await verifyClick(page, billId);

  // Step 6: 写入 DB（INSERT OR IGNORE），失败时降级到核心字段
  let dbResult = { inserted: false };
  let dbError = null;
  try {
    dbResult = recordApproval(db, {
      billId,
      type: detail.type,
      subType: detail.subType,
      applicant: detail.applicant,
      applicantId: detail.applicantId,
      amount: detail.amount,
      subject: detail.subject,
      department: detail.department,
      project: detail.project,
      bankAccount: detail.bankAccount,
      approvalChain: detail.approvalChain,
      expenseBreakdown: detail.expenseBreakdown,
      contractName: detail.contractName,
      supplier: detail.supplier,
      contractPeriod: detail.contractPeriod,
      systemRemark: detail.systemRemark,
      allocations: detail.allocations,
      action,
      remark
    });
  } catch (err) {
    dbError = err.message;
    // 降级：只写核心字段
    try {
      dbResult = recordApproval(db, {
        billId, type: detail.type, applicant: detail.applicant,
        amount: detail.amount, subject: detail.subject,
        deptL2: detail.deptL2 || null,
        deptL3: detail.deptL3 || null,
        deptL4: detail.deptL4 || null,
        action, remark
      });
    } catch (_) { /* both failed, dbResult stays false */ }
  }

  // Step 7: 输出结果
  console.log(JSON.stringify({
    ok: verifyResult.verified,
    action,
    billId,
    type: detail.type,
    applicant: detail.applicant,
    amount: detail.amount,
    clickMethod: clickResult.method,
    clickVerified: verifyResult.verified,
    dbSaved: dbResult.inserted,
    duplicate: dbResult.duplicate || false,
    dbError: dbError || null,
    preaudit: preaudit ? {
      riskLevel: preaudit.riskLevel,
      recommendation: preaudit.recommendation,
      aiSummary: preaudit.aiSummary,
      approvalNoteSuggestion: preaudit.approvalNoteSuggestion,
    } : null,
    dingtalkSync: false,
    dingtalkHint: verifyResult.verified ? '需手动同步钉钉待办（dingtalk-todo skill）' : '请先确认审批是否成功'
  }, null, 2));

  if (!verifyResult.verified) {
    console.error(JSON.stringify({
      warning: 'CLICK_NOT_VERIFIED',
      hint: '请手动在 Chrome 自动化窗口中点击「通过」按钮',
      buttonLabel: action === 'agree' ? '通过' : '退回',
      billId,
      url: verifyResult.url
    }));
  }

  if (verifyResult.verified && !dbResult.inserted && dbError) {
    console.error(JSON.stringify({
      warning: 'APPROVED_BUT_DB_FAILED',
      hint: '审批已提交但数据库写入失败。记录：' + dbError,
      billId,
      action,
      manualFix: `sqlite3 /Users/wuliang/.hermes/data/cmb_approvals.db "INSERT INTO approvals(bill_id,bill_type,applicant_name,amount,action,approved_at) VALUES('${billId}','${detail.type}','${detail.applicant || ""}',${detail.amount ?? 0},'${action}',datetime('now','localtime'));"`
    }));
  }

  db.close();
} catch (err) {
  console.log(JSON.stringify({ error: err.message || String(err) }));
}
