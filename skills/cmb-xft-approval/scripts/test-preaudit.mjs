/**
 * 预审实战测试：
 * - 不依赖浏览器，使用已脱敏的薪福通详情 fixture。
 * - 真实调用 crm CLI 与 Databoard DuckDB。
 */

import assert from 'node:assert/strict';
import {
  normalizeXftProjectRef,
  extractProjectRefs,
  runPreauditForDetail,
} from './shared/preaudit.mjs';

const fixtures = [
  {
    expectedProjectId: 5122,
    detail: {
      billId: '2026061060572506',
      type: '供应商结算单',
      applicant: '张婷',
      applicantId: '000370',
      amount: 9958.94,
      subject: '淘宝秒杀5月达人费用核销',
      department: '运营中心 → 运营六部 → 改名了吗四组',
      project: '视频平台代运营-B站视频代运营-202605061633375ce7e-视频平台代运营-淘宝秒杀b站5月代运营-26.05-26.05',
      allocations: [
        {
          category: '达人(项目)新',
          dept_id: '919872092',
          dept_name: '改名了吗四组',
          dept_path: '厦门小题旅行科技有限公司|运营中心|运营六部|改名了吗四组',
          project_full: '视频平台代运营-B站视频代运营-202605061633375ce7e-视频平台代运营-淘宝秒杀b站5月代运营-26.05-26.05',
          project_id: '202605061633375ce7e',
          amount: 9958.94,
        }
      ],
    },
  },
  {
    expectedProjectId: 3930,
    detail: {
      billId: '2026061160873667',
      type: '供应商结算单',
      applicant: '彭宁宁',
      applicantId: '000379',
      amount: 79970,
      subject: '11-2月阿里妈妈奖杯采买报销',
      department: '运营中心 → 运营六部 → 天下第一组 → 带资进组',
      project: '代运营-20251114183814dd801-代运营-阿里妈妈数字营销增补-25.11-26.02',
      allocations: [
        {
          category: '其他成本(项目)',
          dept_id: '987552377',
          dept_name: '带资进组',
          dept_path: '厦门小题旅行科技有限公司|运营中心|运营六部|天下第一组|带资进组',
          amount: 79970,
        }
      ],
    },
  },
  {
    expectedProjectId: 5324,
    detail: {
      billId: '2026061060554009',
      type: '供应商结算单',
      applicant: '郑滢蓥',
      applicantId: '001222',
      amount: 780,
      subject: '猫天天619佛山龙舟赛冰淇淋（图文平台代运营-猫天天小红书和微博6月事件增补-26.06-26.06',
      department: '运营中心 → 运营六部 → 项目饿组 → 刀组',
      project: '图文平台代运营-小红书代运营-20260605164913c60ad-图文平台代运营-猫天天小红书和微博6月事件增补-26.06-26.06',
      allocations: [
        {
          category: '其他成本(项目)新',
          dept_id: '1048807184',
          dept_name: '刀组',
          dept_path: '厦门小题旅行科技有限公司|运营中心|运营六部|项目饿组|刀组',
          project_full: '图文平台代运营-小红书代运营-20260605164913c60ad-图文平台代运营-猫天天小红书和微博6月事件增补-26.06-26.06',
          project_id: '20260605164913c60ad',
          amount: 780,
        }
      ],
    },
  },
];

const normalized = normalizeXftProjectRef(fixtures[0].detail.project);
assert.equal(normalized.internalId, '202605061633375ce7e');
assert.equal(normalized.canonicalFullName, '视频平台代运营-淘宝秒杀b站5月代运营-26.05-26.05');
assert.equal(normalized.canonicalName, '淘宝秒杀b站5月代运营');

const results = [];
for (const fixture of fixtures) {
  const refs = extractProjectRefs(fixture.detail);
  assert.ok(refs.length >= 1, `${fixture.detail.billId} should expose project refs`);

  const preaudit = await runPreauditForDetail(fixture.detail);
  const matchedId = preaudit.crmProjectMatch?.candidate?.id;
  assert.equal(matchedId, fixture.expectedProjectId, `${fixture.detail.billId} should match CRM project`);
  assert.notEqual(preaudit.riskLevel, 'red', `${fixture.detail.billId} should not be red`);
  assert.notEqual(preaudit.riskLevel, 'unknown', `${fixture.detail.billId} should not be unknown`);
  assert.ok(preaudit.checks.some(c => c.id === 'crm_project_match' && c.status === 'pass'));
  assert.ok(preaudit.evidence.some(e => e.kind === 'crm_project_detail'));
  assert.ok(preaudit.aiSummary.includes('匹配项目'));

  results.push({
    billId: fixture.detail.billId,
    expectedProjectId: fixture.expectedProjectId,
    matchedProjectId: matchedId,
    riskLevel: preaudit.riskLevel,
    recommendation: preaudit.recommendation,
    summary: preaudit.aiSummary,
    failedOrUnknownChecks: preaudit.checks
      .filter(c => c.status === 'fail' || c.status === 'unknown')
      .map(c => ({ id: c.id, status: c.status, message: c.message })),
  });
}

console.log(JSON.stringify({
  ok: true,
  tested: fixtures.length,
  results,
}, null, 2));

