# Bill Detail Deep-Expand (合同用印/大额单据)

## When to use

User says "展开更多详情", "还不够完整", "再看看里面是什么", or similar signals that the initial `navigate.mjs bill` summary is insufficient.

## What they want

The **full picture** — not just amount/type/applicant/department, but also:
- 审批链 (谁批了、谁还没批、当前节点)
- 合同具体条款 (数量、时长、发布账号、合同编号、供应商全称)
- 分摊明细 (类别、部门、项目、金额)
- 项目全路径
- 附件信息

## Workflow

### 1. Navigate to bill detail page

```bash
opencli browser <session> open \
  "https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=<billId>&viewType=APPROVE_PEND"
sleep 8  # wait for Vue SPA to mount
```

### 2. Extract structured info

Use opencli eval with IIFE to avoid `const` redeclaration:

```javascript
(function(){
const t = document.body.innerText;
const lines = t.split('\n').filter(l => l.trim());

// Target sections by keyword
const targets = [
  '合同名称','供应商','合同金额','合同有效期','合同编号','合同附件',
  '承担部门','是否关联项目','单据项目','公司名称','合作内容备注',
  '合同付款条款','审批信息','审批链','事项标题','事由备注',
  '金额合计','费用类别','发票张数','发票金额'
];

const results = [];
targets.forEach(k => {
  const idx = lines.findIndex(l => l.includes(k));
  if(idx >= 0) {
    const ctx = lines.slice(idx, Math.min(lines.length, idx + 6)).join(' → ');
    results.push(ctx);
  }
});

return results.slice(0, 20).join('\n---\n');
})()
```

### 3. Extract 审批链 specifically

The审批链 is often in a section starting with "审批信息" or containing "审批中/已通过/已退回":

```javascript
(function(){
const t = document.body.innerText;
const lines = t.split('\n').filter(l => l.trim());
const idx = lines.findIndex(l => l.includes('审批信息') || l.includes('发起申请'));
if(idx < 0) return 'NOT_FOUND';
return lines.slice(idx, Math.min(lines.length, idx + 30)).join(' | ');
})()
```

### 4. Extract 合同金额/费用合计

```javascript
(function(){
const t = document.body.innerText;
const lines = t.split('\n').filter(l => l.trim());
return lines.filter(l => l.includes('合计') || l.includes('金额')).slice(0, 15).join(' || ');
})()
```

### 5. Navigate back to approval list

**CRITICAL** — must do this before any row-level approve/reject operations:

```bash
opencli browser <session> open \
  "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 6
# Verify
opencli browser <session> eval \
  "document.querySelectorAll('tr.ant-table-row').length" | tail -1
```

## Pitfalls

- **opencli `const` redeclaration**: Always wrap eval JS in `(function(){...})()` — the same variable name used in consecutive evals triggers `SyntaxError: Identifier 'X' has already been declared`.
- **SPA mount time**: `sleep 8` minimum for bill detail pages with large forms/complex审批链. Use `sleep 6` for approval list.
- **navigate.mjs bill timeouts**: For 供应商结算单/大额单据, `navigate.mjs bill` often times out (>45s). Fall back to opencli eval on the detail page directly.
- **审批准链 text noise**: The full page text includes sidebar navigation items. Narrow to `.ant-layout-content` or use keyword-targeted extraction. Ignore "系统设置/工作台/数据报表" etc.
- **合同用印 expanded fields**: Always extract: 合同名称, 供应商全称, 合同金额, 有效期, 合同编号, 是否关联项目, 单据项目, 合同附件文件名, 合作内容备注(含视频数量/时长/发布账号/发布要求), 审批链完整节点（含退回重提历史）。
