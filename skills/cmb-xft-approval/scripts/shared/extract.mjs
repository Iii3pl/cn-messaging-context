/**
 * shared/extract.mjs — 单据信息提取 + 审核规则
 *
 * 核心改进：
 * - 逐 td 提取，不再 textContent 拼合
 * - 侧栏过滤：只取主内容区的表格行
 * - 完整字段：审批链、发票明细、合同信息等
 */

import { resolveDept } from './dept-mapper.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 合法单据类型（用作侧栏降级过滤）
const VALID_BILL_TYPES = /合同用印|员工日常报销单|差旅报销单|团建费申请|供应商结算单|投流费用申请单|预算审批流程|对公付款|预算|项目申请|云账户支付|费用预算挤占报销单|供应商预付款|员工备用金/;

/**
 * 解析首页待审批列表（逐 td + 侧栏过滤）。
 * @param {import('@jackwener/opencli/dist/src/browser/page.js').Page} page
 * @returns {Promise<{pending: number, bills: Array}>}
 */
export async function parseHomepageBills(page) {
  let latest = { pending: 0, bills: [] };

  for (let attempt = 0; attempt < 8; attempt++) {
    const text = await page.evaluate('document.body.innerText');
    const pendingMatch = text.match(/待审批\s*(\d+)/);
    const pending = pendingMatch ? parseInt(pendingMatch[1]) : 0;

    const snapshot = await page.evaluate(`
    (() => {
      const results = [];

      // 优先：限定在有「待审批」标题的 card 内
      let rows = [];
      const cards = document.querySelectorAll('.ant-card');
      for (const card of cards) {
        if (card.textContent.includes('待审批')) {
          rows = card.querySelectorAll('tr.ant-table-row');
          break;
        }
      }
      // 降级：全局查找 + 类型过滤
      if (rows.length === 0) {
        rows = document.querySelectorAll('tr.ant-table-row');
      }

      for (const r of rows) {
        const tds = r.querySelectorAll('td');
        const tdCount = tds.length;

        // 新版 31 列表格（/form-app/approval）
        if (tdCount >= 30) {
          const billId   = tds[1]?.textContent?.trim() || '';
          const subject  = tds[2]?.textContent?.trim() || '';
          const amount   = tds[3]?.textContent?.trim() || '';
          const type     = tds[4]?.textContent?.trim() || '';
          const applicant = tds[5]?.textContent?.trim() || '';
          if (!billId) continue;
          // 侧栏过滤：类型必须匹配已知审批类型
          if (!/${VALID_BILL_TYPES.source}/.test(type)) continue;
          results.push({ type, applicant, date: '', billId, subject, amount });
          continue;
        }

        // 旧版 5 列表格（兼容）
        if (tdCount < 5) continue;
        const type     = tds[0]?.textContent?.trim() || '';
        const appDate  = tds[1]?.textContent?.trim() || '';
        const billText = tds[2]?.textContent?.trim() || '';
        const subject  = tds[3]?.textContent?.trim() || '';
        const amount   = tds[4]?.textContent?.trim() || '';

        if (!/${VALID_BILL_TYPES.source}/.test(type)) continue;

        const appParts = appDate.split('/');
        const applicant = appParts[0]?.trim() || '';
        const date      = appParts[1]?.trim() || '';
        const billId    = (billText.match(/单号\\\\s*(\\\\d+)/)||[])[1] || '';
        if (!billId) continue;

        results.push({ type, applicant, date, billId, subject, amount });
      }
      return { bills: results, rowCount: rows.length };
    })()
  `);

    const inferredPending = pending > 0 ? pending : snapshot.bills.length;
    latest = { pending: inferredPending, tabPending: pending, bills: snapshot.bills };

    // 薪福通 SPA 会先显示 tab 数量，再异步填充表格行。
    // 如果已知有待审批但当前行还是空骨架，继续等一轮。
    if (snapshot.bills.length > 0) return latest;
    if (pending === 0 && attempt >= 2) return latest;
    if (snapshot.rowCount > 0 && snapshot.bills.length >= snapshot.rowCount) return latest;
    await sleep(1000);
  }

  return latest;
}

/**
 * 通过点击行进入详情页，提取完整字段。
 * @param {import('@jackwener/opencli/dist/src/browser/page.js').Page} page
 * @param {string} billId
 * @returns {Promise<object>}
 */
export async function parseBillDetail(page, billId) {
  // 点击对应行进入详情
  const clicked = await page.evaluate(`
    (() => {
      const rows = document.querySelectorAll('tr.ant-table-row');
      for (const r of rows) {
        if (r.textContent.indexOf('${billId}') !== -1) {
          r.click();
          return 'clicked';
        }
      }
      return 'miss';
    })()
  `);

  if (clicked === 'miss') {
    return { error: 'BILL_NOT_FOUND', billId };
  }

  // SPA 导航后等待渲染 + 重试直到金额加载完成（非零值）
  let text = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(500);
    text = await page.evaluate('document.body.innerText');
    // 等金额合计出现且金额非零（SPA 先渲染骨架 0.00，再异步加载真实值）
    const amtCheck = text.match(/金额合计[\s\S]*?([\d,.]+)/)
      || text.match(/报销金额[\s\S]*?([\d,.]+)/)
      || text.match(/申请金额[\s\S]*?([\d,.]+)/)
      || text.match(/总计金额[\s\S]*?([\d,.]+)/)
      || text.match(/总金额[\s\S]*?([\d,.]+)/);
    if (amtCheck && parseFloat(amtCheck[1]) > 0) break;
  }

  const url = await page.evaluate('window.location.href');
  const info = { billId, url, ok: true };

  // --- 类型与子类型 ---
  // 注意：不在内容区匹配「对公付款」「预算审批流程」（这是侧栏菜单项）
  const typeMatch = text.match(/合同用印|员工日常报销单|差旅报销单|团建费申请|供应商结算单|投流费用申请单|员工备用金|供应商预付款|云账户支付|预算/);
  if (typeMatch) {
    info.type = typeMatch[0];
    const subMatch = (text.match(new RegExp(typeMatch[0] + '[（(]([^)）]+)[)）]')) || [])[1];
    if (subMatch) info.subType = subMatch;
  }

    // --- 投流费用申请单专用字段 ---
  if (info.type === '投流费用申请单') {
    // 部门：项目承担部门
    const tdDept = text.match(/项目承担部门\s*\n\s*([^\n]+)/);
    if (tdDept) {
      const rawDept = tdDept[1].trim();
      // 动态映射花名册
      try {
        const resolved = resolveDept(rawDept);
        info.department = resolved.display || rawDept;
        info.deptL2 = resolved.l2 || '';
        info.deptL3 = resolved.l3 || '';
        info.deptL4 = resolved.l4 || '';
        info.deptSource = resolved.source || 'unknown';
      } catch (_) {
        info.department = rawDept;
      }
    }
    // 项目：投流项目
    const tdProj = text.match(/投流项目\s*\n\s*([^\n]+)/);
    if (tdProj) info.project = tdProj[1].trim();
    // 投放平台
    const tdPlat = text.match(/投放平台\s*\n\s*([^\n]+)/);
    if (tdPlat) info.platform = tdPlat[1].trim();
    // 充值ID
    const tdCharge = text.match(/充值ID\s*\n\s*([^\n]+)/);
    if (tdCharge) info.chargeId = tdCharge[1].trim();
    // 投流账号名称
    const tdAcct = text.match(/投流账号名称\s*\n\s*([^\n]+)/);
    if (tdAcct) info.accountName = tdAcct[1].trim();
    // 金额：取总计金额(CNY) 行
    const tdAmt = text.match(/总计金额[\s\S]*?([\d,.]+)/)
            || text.match(/充值金额[\s\S]*?([\d,.]+)/);
    if (tdAmt && parseFloat(tdAmt[1].replace(/,/g, '')) > 0) {
      info.amount = parseFloat(tdAmt[1].replace(/,/g, ''));
    }
  }// --- 申请人 + 工号 ---
  // 新格式: "施璐璐 - 000806 - 厦门小题旅行科技有限公司"
  // 旧格式: "申请人 施璐璐 (000806)" 或 "李锦晶-000806-公司名"
  const appMatch0 = text.match(/(\S+)\s*[-–]\s*(\d{6})\s*[-–]\s*\S+/);
  const appMatch1 = text.match(/申请人\s+(\S+)\s*[（(](\d+)[)）]/);
  const appMatch2 = text.match(/([^\s]+)\s*[-–]\s*(\d{6})\s*[-–]/);
  if (appMatch0) {
    info.applicant = appMatch0[1];
    info.applicantId = appMatch0[2];
  } else if (appMatch1) {
    info.applicant = appMatch1[1];
    info.applicantId = appMatch1[2];
  } else if (appMatch2) {
    info.applicant = appMatch2[1];
    info.applicantId = appMatch2[2];
  }

  // --- 金额 ---
  // 格式：金额合计(CNY)\n324.50  或  报销金额(CNY) 324.50
  const amt = text.match(/金额合计[\s\S]*?([\d,.]+)/)
          || text.match(/报销金额[\s\S]*?([\d,.]+)/)
          || text.match(/申请金额[\s\S]*?([\d,.]+)/)
          || text.match(/借款金额[\s\S]*?CNY\s*([\d,.]+)/)
          || text.match(/预付款金额[\s\S]*?([\d,.]+)/)
          || text.match(/金额[：:]?\s*CNY\s*([\d,.]+)/)
          || text.match(/合同金额[\s\S]*?([\d,.]+)/)
          || text.match(/总计金额[\s\S]*?([\d,.]+)/)
          || text.match(/总金额[\s\S]*?([\d,.]+)/);
  if (amt) info.amount = parseFloat(amt[1].replace(/,/g, ''));

  // --- 事由 ---
  const sm = text.match(/事项标题\s*([^\n]+)/);
  if (sm) info.subject = sm[1].trim();
  if (!info.subject && info.type === '团建费申请') info.subject = '团建费申请';

  const teamSize = text.match(/人数\s*\n\s*(\d+)/);
  if (teamSize) info.teamSize = parseInt(teamSize[1], 10);

  // --- 部门 ---
  // 部门 — 在分摊解析之后提取（见下方）

  // --- 项目 ---
  // 项目 — 在分摊解析之后提取（见下方）

  // --- 收款账户 ---
  const ba = text.match(/(?:收款账户|银行账号?)[：:]\s*(\d{10,})/);
  if (ba) info.bankAccount = ba[1];

  // --- 吴亮状态 ---
  const wm = text.match(/吴亮\s*(审批中|已通过|已拒绝)/);
  if (wm) info.wuLiangStatus = wm[1];

  // --- 审批链 ---
  info.approvalChain = parseApprovalChain(text);

  // --- 合同用印专属 ---
  if (info.type === '合同用印') {
    const cn = text.match(/合同名称\s+([^\n]+)/);
    if (cn) info.contractName = cn[1].trim();
    const sup = text.match(/供应商\s+([^\n]+)/);
    if (sup) info.supplier = sup[1].trim();
    const cp = text.match(/合同期间\s*([^\n]+)/);
    if (cp) info.contractPeriod = cp[1].trim();
  }

  // --- 费用明细 ---
  const breakdown = parseExpenseBreakdown(text);
  if (breakdown) {
    info.expenseBreakdown = breakdown;
    info.totalInvoices = breakdown.reduce((sum, e) => sum + e.invoiceCount, 0);
  }

  // --- 分摊明细（明细模式）---
  const allocations = parseAllocations(text);
  if (allocations.length > 0) {
    info.allocations = allocations;
    // 聚合
    info.deptAgg = aggregateBy(allocations, 'dept_id');
    info.projectAgg = aggregateBy(allocations, 'project_id');

    // 部门 — 优先用分摊里的完整路径
    const allocDept = allocations.find(a => a.dept_display);
    if (allocDept) {
      info.department = allocDept.dept_display;
    }
    // 项目 — 优先用分摊里的完整项目名
    const allocProj = allocations.find(a => a.project_full);
    if (allocProj) {
      info.project = allocProj.project_full;
    }

    const allocationTotal = allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
    if ((!info.amount || info.amount === 0) && allocationTotal > 0) {
      info.amount = Math.round(allocationTotal * 100) / 100;
      info.amountSource = 'allocations_sum';
    }
  }
  // 对非投流单应用花名册映射
  if (info.type !== '投流费用申请单' && info.department && !info.deptL2) {
    try {
      const resolved = resolveDept(info.department);
      info.deptL2 = resolved.l2 || '';
      info.deptL3 = resolved.l3 || '';
      info.deptL4 = resolved.l4 || '';
      info.deptSource = resolved.source || '';
      // 如果映射出了完整路径，更新 display
      if (resolved.display && resolved.source !== 'raw_fallback') {
        info.department = resolved.display;
      }
    } catch (_) { /* 映射失败不阻断 */ }
  }

  // 部门降级：没有分摊时用承担部门行
  if (!info.department) {
    const dmFull = text.match(/承担部门\s*\n\s*([^\n]+)\n\s*([^\n]+)/);
    if (dmFull && dmFull[2].includes('|')) {
      const pathParts = dmFull[2].split('|');
      info.department = pathParts.slice(1).join(' → ');
    } else {
      const dm = text.match(/承担部门\s*\n\s*([^\n]+)/)
              || text.match(/申请部门\s*\n?\s*([^\n]+)/)
              || text.match(/借款部门\s*\n\s*([^\n]+)/);
      if (dm) info.department = dm[1].trim();
    }
  }
  // 项目降级
  if (!info.project) {
    const pm = text.match(/关联项目\s*\n?\s*([^\n]+)/)
            || text.match(/单据项目\s*\n\s*([^\n]+)/)
            || text.match(/(?:[A-Za-z]+平台)?代运营[^\n]+/)
            || text.match(/项目[名称]?\s*[：:]\s*([^\n]+)/);
    if (pm) info.project = pm[0].trim();
  }

  // --- 系统备注 ---
  const srm = text.match(/(?:备注|说明)[：:]\s*([^\n]+(?:\n(?!报销金额|通过|退回)[^\n]+)*)/);
  if (srm) info.systemRemark = srm[1].trim().replace(/\n/g, '；');

  // --- 审批进度摘要 ---
  if (info.approvalChain?.length) {
    const done = info.approvalChain.filter(a => a.status === '已通过' || a.status === '✅').length;
    const total = info.approvalChain.length;
    const myIdx = info.approvalChain.findIndex(a => a.name?.includes('吴亮'));
    info.approvalProgress = `${done}/${total}已通过`;
    if (myIdx >= 0) info.approvalProgress += `，你在第${myIdx + 1}位`;
    const next = info.approvalChain.find(a => a.status === '待审批' || a.status === '⏳');
    if (next) info.nextApprover = `${next.node}-${next.name}`;
  }

  return info;
}

/**
 * 从页面文本提取审批链。
 * 支持格式：
 *   "发起 李锦晶 ✅" / "部门 关晶、郭雪琪 ✅" / "财务 池丽梅 ⏳"
 */
function parseApprovalChain(text) {
  const chain = [];
  // 新格式：审批信息 区域
  //   发起申请 施璐璐 已申请 2026/04/30 15:11:35
  //   一级部门审批 会签 黄少莹 已通过 2026/04/30 15:12:02
  let section = text.split(/审批信息/)[1];
  if (!section) section = text.split(/审批进度|审批链|审批流程/)[1];
  if (!section) return chain;

  // 截取到下一个大标题或按钮区
  const endIdx = section.search(/报销金额|通过|退回|评论|转派/);
  if (endIdx > 0) section = section.substring(0, endIdx);

  const lines = section.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 新格式：节点名 审批方式? 审批人 状态 [时间]
    // 如 "一级部门审批 会签 黄少莹 已通过 2026/04/30 15:12:02"
    // 如 "四级部门审批节点 会签 吴亮 审批中"
    // 如 "发起申请 施璐璐 已申请 2026/04/30 15:11:35"
    const newMatch = trimmed.match(/^(\S+(?:审批节点|部门审批|发起申请)?)\s+(?:会签|依次审批|或签)?\s*(\S+)\s+(已通过|审批中|已拒绝|已申请|待审批)/);
    if (newMatch) {
      chain.push({ node: newMatch[1], name: newMatch[2], status: newMatch[3] });
      continue;
    }

    // 兜底格式：name status 对（如 "吴亮 审批中"）
    const fallback = trimmed.match(/^(\S+)\s+(审批中|已通过|已拒绝)/);
    if (fallback) {
      chain.push({ node: '', name: fallback[1], status: fallback[2] });
    }
  }

  return chain;
}

/**
 * 从页面文本提取费用明细。
 * 格式：
 *   服装道具(项目) ¥325.71 5张
 *   市内交通费(项目) ¥23.60 1张
 */
function parseExpenseBreakdown(text) {
  const breakdown = [];
  const section = text.split(/费用明细/)[1];
  if (!section) return null;

  const lines = section.split('\n');
  for (const line of lines) {
    const m = line.match(/(.+?)\s*[¥￥]\s*([\d,.]+)\s*(\d+)张/);
    if (m) {
      breakdown.push({
        category: m[1].trim(),
        amount: parseFloat(m[2].replace(/,/g, '')),
        invoiceCount: parseInt(m[3])
      });
    }
    // 也可能是表格格式
    const tm = line.match(/(\S+)\s+(\S+)\s+[¥￥]?\s*([\d,.]+)\s+(\d+)张/);
    if (tm && !m) {
      breakdown.push({
        category: tm[1].trim(),
        amount: parseFloat(tm[3].replace(/,/g, '')),
        invoiceCount: parseInt(tm[4])
      });
    }
  }

  return breakdown.length > 0 ? breakdown : null;
}

/**
 * 从页面文本解析分摊明细（明细模式）。
 * 格式：
 *   明细模式
 *   费用类别 / 部门 / 项目 / 比例 / 金额 / 不含税 / 税额 / 备注
 *   市内交通费(项目)新\t
 *   919872092-改名了吗四组
 *   厦门小题旅行科技有限公司|运营中心|运营六部|改名了吗四组
 *   \t视频平台代运营-...\t28.5362%\t92.60\t89.90\t2.70\t
 *   -
 *   ...
 *   分摊合计金额：CNY 324.50
 *
 * @param {string} text
 * @returns {Array<{dept_id:string, dept_name:string, dept_path:string, project_id:string, project_name:string, project_full:string, amount:number, amount_pretax:number, tax:number, ratio:number, category:string}>}
 */
function parseAllocations(text) {
  // 优先从「明细模式」截取，降级到「分摊」关键词
  let section = text.split(/明细模式/)[1];
  if (!section) {
    // 降级：从「费用类别」+「部门」+「项目」表头开始截
    const idx = text.search(/费用类别\s*\n\s*部门\s*\n\s*项目/);
    if (idx > 0) section = text.substring(idx);
  }
  if (!section) return [];

  const endIdx = section.search(/分摊合计金额|审批信息/);
  const allocText = endIdx > 0 ? section.substring(0, endIdx) : section;
  const lines = allocText.split('\n').map(l => l.trim()).filter(Boolean);

  const results = [];
  let current = null;

  for (const line of lines) {
    // 跳过表头、模式切换标签、列名
    if (line === '明细模式' || line === '汇总模式' ||
        line === '部门' || line === '项目' || line === '备注' ||
        line.includes('费用类别') || line.includes('承担比例') ||
        line.includes('承担金额') || line.includes('承担税额') || line.includes('不含税')) continue;

    // 费用类别行 — 匹配所有以中文/字母开头、不含数字开头的行（排除部门ID、金额等）
    if (/^[\u4e00-\u9fa5A-Za-z]/.test(line) && !/^\d/.test(line) && !line.includes('|') && !line.includes('%') && line.length < 30) {
      if (current) results.push(current);
      current = { category: line };
      continue;
    }

    if (!current) {
      // 新分摊：从部门行开始（category 复用上一条或留空）
      const deptMatch2 = line.match(/^(\d{6,12})\s*[-–]\s*(.+)/);
      if (deptMatch2) {
        const prevCategory = results.length > 0 ? results[results.length - 1].category : '';
        current = {
          category: prevCategory,
          dept_id: deptMatch2[1],
          dept_name: deptMatch2[2].trim()
        };
      }
      continue;
    }

    // 部门行: NNNNNNNNN-部门名
    const deptMatch = line.match(/^(\d{6,12})\s*[-–]\s*(.+)/);
    if (deptMatch) {
      current.dept_id = deptMatch[1];
      current.dept_name = deptMatch[2].trim();
      continue;
    }

    // 部门路径: 厦门小题旅行科技有限公司|运营中心|...
    if (/\|/.test(line) && /运营中心/.test(line)) {
      current.dept_path = line;
      continue;
    }

    // 项目行: 视频平台代运营-...-项目名-日期（前导可能有 tab）
    const projLine = line.replace(/^\t+/, '');
    if (/视频平台代运营|图文平台代运营|多平台视频代运营/.test(projLine)) {
      current.project_full = projLine;
      const parts = projLine.split('-');
      // 项目ID在第三段或第一段
      for (const p of parts) {
        if (/^\d{20,}$/.test(p)) {
          current.project_id = p;
          break;
        }
      }
      if (!current.project_id && parts.length > 2 && /^\d+/.test(parts[2])) {
        current.project_id = parts[2];
      }
      current.project_name = parts.length > 1 ? (parts[parts.length - 2] || projLine) : projLine;
      continue;
    }

    // 金额行: 比例\t金额\t不含税\t税额
    const amtMatch = line.match(/([\d.]+)%\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/);
    if (amtMatch) {
      current.ratio = parseFloat(amtMatch[1]) / 100;
      current.amount = parseFloat(amtMatch[2].replace(/,/g, ''));
      current.amount_pretax = parseFloat(amtMatch[3].replace(/,/g, ''));
      current.tax = parseFloat(amtMatch[4].replace(/,/g, ''));
      // 生成 L2-L3-L4 显示名
      if (current.dept_path && current.dept_path.includes('|')) {
        const pathParts = current.dept_path.split('|');
        current.dept_display = pathParts.slice(1).join(' → ');
      }
      results.push(current);
      current = null;
      continue;
    }

    // 备注行（单独的 -）
    if (line === '-' && current) {
      current.remark = '';
    }
  }

  // 最后一条未 push 的
  if (current && current.dept_id) results.push(current);

  return results;
}

/**
 * 按字段聚合分配明细。
 * @param {Array} allocations
 * @param {string} field - 'dept_id' | 'project_id'
 * @returns {Array<{key:string, name:string, amount:number, count:number}>}
 */
function aggregateBy(allocations, field) {
  const map = {};
  for (const a of allocations) {
    const key = a[field];
    if (!key) continue;
    if (!map[key]) {
      map[key] = {
        [field]: key,
        name: field === 'dept_id' ? a.dept_name : a.project_name,
        amount: 0,
        count: 0
      };
    }
    map[key].amount += a.amount || 0;
    map[key].count += 1;
  }
  return Object.values(map).sort((a, b) => b.amount - a.amount);
}

/**
 * 解析已审批列表（所有 tab 通用 — 提取完整 31 列）。
 * 优先从「已审批」card 提取；降级到全局表格。
 * @param {import('@jackwener/opencli/dist/src/browser/page.js').Page} page
 * @param {{tabName?: string}} opts
 * @returns {Promise<{bills: Array}>}
 */
export async function parseDoneBills(page, { tabName = '已审批' } = {}) {
  const text = await page.evaluate('document.body.innerText');

  const bills = await page.evaluate(`
    (() => {
      const results = [];
      const VALID_TYPES = /合同用印|员工日常报销单|差旅报销单|团建费申请|供应商结算单|投流费用申请单|预算审批流程|对公付款/;

      // 优先：限定在「已审批」card 内
      let rows = [];
      const cards = document.querySelectorAll('.ant-card');
      for (const card of cards) {
        if (card.textContent.includes('${tabName}')) {
          rows = card.querySelectorAll('tr.ant-table-row');
          break;
        }
      }
      // 降级：全局查找
      if (rows.length === 0) {
        rows = document.querySelectorAll('tr.ant-table-row');
      }

      for (const r of rows) {
        const tds = r.querySelectorAll('td');
        const tdCount = tds.length;

        // 新版 31 列表格 — 统一列布局（2026-05 确认）
        // [0]=checkbox, [1]=billId, [2]=subject, [3]=amount(CNY), [4]=type,
        // [5]=applicant, [6]=supplier, [7]=proxy, [8]=actualAmount,
        // [9]=projectStatus, [10]=signStatus, [11]=company, [12]=businessUnit,
        // [13]=applicantDept, [14]=dept, [15]=costCenter,
        // [16]=invoiceCount, [17]=invoiceStatus, [18]=trip,
        // [19]=approvalNode, [20]=payee, [21]=submitDate, [22]=transferTime,
        // [23]=printStatus, [24]=printCount, [25]=nodeType,
        // [26]=auditResult, [27]=relatedRecords, [28]=creator,
        // [29]=approvalSummary, [30]=actions
        if (tdCount >= 30) {
          const billId    = (tds[1]?.textContent || '').trim();
          if (!billId) continue;

          const type      = (tds[4]?.textContent || '').trim();
          if (!VALID_TYPES.test(type)) continue;

          const applicant = (tds[5]?.textContent || '').trim();
          const amountRaw = (tds[3]?.textContent || '').trim();
          const amount    = amountRaw.replace(/^CNY\s*/i, '').replace(/,/g, '');
          const subject   = (tds[2]?.textContent || '').trim();
          const dept      = (tds[14]?.textContent || '').trim();
          const submitDate = (tds[21]?.textContent || '').trim();
          const status    = (tds[26]?.textContent || '').trim();  // 智能审核结果
          const project   = (tds[9]?.textContent || '').trim();   // 单据项目状态

          results.push({
            billId, subject, amount, type, applicant,
            submitDate, department: dept, status, project
          });
          continue;
        }

        // 旧版 5 列表格（兼容）
        if (tdCount < 5) continue;
        const type     = tds[0]?.textContent?.trim() || '';
        const appDate  = tds[1]?.textContent?.trim() || '';
        const billText = tds[2]?.textContent?.trim() || '';
        const subject  = tds[3]?.textContent?.trim() || '';
        const amount   = tds[4]?.textContent?.trim() || '';

        if (!VALID_TYPES.test(type)) continue;

        const appParts = appDate.split('/');
        const applicant = appParts[0]?.trim() || '';
        const date      = appParts[1]?.trim() || '';
        const billId    = (billText.match(/单号\\\\s*(\\\\d+)/)||[])[1] || '';
        if (!billId) continue;

        results.push({ type, applicant, submitDate: date, billId, subject, amount, status: '' });
      }
      return results;
    })()
  `);

  return { bills };
}

/**
 * 审核规则检查。
 * @param {object} bill - parseBillDetail 输出
 * @param {object|null} dbRecord - findByBillId 结果
 * @returns {{ risks: string[], suggestion: string }}
 */
export function riskCheck(bill, dbRecord) {
  const risks = [];
  const projectOptionalTypes = new Set([
    '员工日常报销单',
    '团建费申请',
    '员工备用金',
    '合同用印',
  ]);
  const hasDeptAllocation = (bill.allocations || []).some(a =>
    a.dept_id || /\(部门\)/.test(String(a.category || ''))
  );

  // 重复
  if (dbRecord) risks.push('已处理(DB)');

  // 金额
  const amt = bill.amount ?? 0;
  if (amt === 0) {
    risks.push('零金额，走流程锁定编号，无资金风险');
  } else if (amt > 50000) {
    risks.push('金额>50000，需谨慎审批');
  } else if (amt > 10000) {
    risks.push('金额>10000，建议复核');
  }

  // 合同用印
  if (bill.type === '合同用印') {
    risks.push('合同用印，请核对合同条款');
  }

  // 供应商风险
  if (bill.systemRemark && /暂停合作|风险|赔付|侵权/i.test(bill.systemRemark)) {
    risks.push('供应商风险，见备注');
  }

  // 分摊部门。不要用“申请人姓名是否出现在部门名里”判断跨部门，那会把正常部门费用全部误报。
  if ((bill.deptAgg || []).length > 1) {
    risks.push('多部门分摊');
  }

  // 无项目。员工日常报销、团建、备用金等部门/人员费用允许无 CRM 项目。
  if (!bill.project && !projectOptionalTypes.has(bill.type) && !hasDeptAllocation) {
    risks.push('无项目归属');
  }

  // 多发票小金额
  if (bill.totalInvoices > 10 && amt > 0 && amt < 2000) {
    risks.push('发票较多但金额小');
  }

  // 生成建议
  let suggestion;
  if (dbRecord) {
    suggestion = '已处理，无需重复审批';
  } else if (risks.length === 0) {
    suggestion = '建议通过';
  } else if (risks.includes('零金额，走流程锁定编号，无资金风险') && risks.every(r => r.includes('零金额') || r === '合同用印，请核对合同条款')) {
    suggestion = '零金额合同，流程合规，建议通过';
  } else if (risks.some(r => r.includes('供应商风险'))) {
    suggestion = '⚠️ 供应商有风险，建议确认后通过';
  } else if (risks.some(r => r.includes('50000'))) {
    suggestion = '超大额，建议复核金额后通过';
  } else if (risks.some(r => r.includes('10000'))) {
    suggestion = '大额，建议复核金额后通过';
  } else if (risks.every(r => r === '合同用印，请核对合同条款' || r === '无项目归属' || r === '多部门分摊')) {
    suggestion = '建议核对后通过';
  } else {
    suggestion = '建议通过';
  }

  return { risks, suggestion };
}
