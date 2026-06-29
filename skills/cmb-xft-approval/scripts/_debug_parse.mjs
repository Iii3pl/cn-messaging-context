/**
 * 诊断脚本：当 navigate.mjs homepage 返回 pending>0, bills=[] 时运行。
 * 输出页面上所有待审批行的类型列，用于对比 VALID_BILL_TYPES 白名单。
 *
 * Usage: node scripts/_debug_parse.mjs
 */
import { ensureLoggedIn, APPROVAL_LIST } from './shared/session.mjs';
import { createPage } from './shared/opencli.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const page = await createPage('cmb-debug-parse');
try {
  await ensureLoggedIn(page);
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 5000 });
  await sleep(3000);

  const result = await page.evaluate(`
    (() => {
      const rows = document.querySelectorAll('tr.ant-table-row');
      const data = [];
      for (const r of rows) {
        const tds = r.querySelectorAll('td');
        const tdCount = tds.length;
        data.push({
          tdCount,
          td1_billId: tds[1]?.textContent?.trim() || '',
          td3_amount:  tds[3]?.textContent?.trim() || '',
          td4_type:    tds[4]?.textContent?.trim() || '(empty)',
          td5_applicant: tds[5]?.textContent?.trim() || ''
        });
      }
      return {
        totalRows: rows.length,
        rows: data,
        // The VALID_BILL_TYPES regex — check td4_type against this
        validBillTypesSource: '合同用印|员工日常报销单|差旅报销单|团建费申请|供应商结算单|投流费用申请单|预算审批流程|对公付款|预算|项目申请|云账户支付|费用预算挤占报销单|供应商预付款|员工备用金'
      };
    })()
  `);

  // Check which types match and which don't
  const validPattern = /合同用印|员工日常报销单|差旅报销单|团建费申请|供应商结算单|投流费用申请单|预算审批流程|对公付款|预算|项目申请|云账户支付|费用预算挤占报销单|供应商预付款|员工备用金/;
  const mismatches = result.rows.filter(r => !validPattern.test(r.td4_type));

  console.log(JSON.stringify({
    totalRows: result.totalRows,
    matched: result.rows.length - mismatches.length,
    mismatched: mismatches.length,
    mismatchedTypes: [...new Set(mismatches.map(r => r.td4_type))],
    rows: result.rows
  }, null, 2));

  if (mismatches.length > 0) {
    console.error(`\n⚠️  ${mismatches.length} 行因类型不在 VALID_BILL_TYPES 中被过滤！`);
    console.error(`   遗漏类型: ${[...new Set(mismatches.map(r => r.td4_type))].join(', ')}`);
  }
} catch (e) {
  console.error(JSON.stringify({ error: e.message || String(e) }));
}
