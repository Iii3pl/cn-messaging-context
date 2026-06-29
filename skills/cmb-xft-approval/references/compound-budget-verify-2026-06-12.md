# 复合指令 + 预算单 eval 审批验证补充（2026-06-12）

## 场景

用户给出类似：

> 1234通过5展开

上一轮薪福通列表为：
1. 预算 ¥0
2. 供应商结算单 ¥520
3. 供应商预付款 ¥20,000
4. 预算 ¥0
5. 供应商结算单 ¥4,650

## 正确处理顺序

1. **按上一轮展示的 billId 身份匹配**，不要按实时列表位置盲批。
2. 对用户指定的 `1-4` 执行通过。
3. 对用户指定的 `5` 执行展开，不自动通过。
4. 先执行能脚本化的普通单据；预算单如果 `approve.mjs` 返回 `BUTTON_NOT_FOUND`，走预算 eval 兜底。
5. 审批后必须回查：
   - `node scripts/navigate.mjs homepage --filter-ghosts`
   - 以 `realPending` / 指定 billId 是否从真实待审批消除为准。

## 预算单 eval 兜底细节

预算详情页 URL：

```text
https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId=<BILL_ID>&viewType=APPROVE_PEND
```

按钮文字是 `通 过`，可能有空格。点击逻辑应做文本归一化：

```js
const norm = s => (s || '').replace(/\s+/g, '');
const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
const pass = buttons.find(b => norm(b.innerText || b.textContent || '') === '通过')
  || buttons.find(b => b.innerText.includes('通') && b.innerText.includes('过'));
pass?.click();
```

确认按钮同理：

```js
const ok = document.querySelector('button.guideStepOperateOkButton')
  || Array.from(document.querySelectorAll('button')).find(b => ['确认','确定','提交','同意'].includes(norm(b.innerText || b.textContent || '')));
ok?.click();
```

## 重要验证口径

预算单点击「通 过」并确认后，页面可能跳到 `about:blank`。这不等于失败。

正确判断：

- 点击结果显示命中 `通 过`
- 确认结果显示命中 `确认`
- 回查 `homepage --filter-ghosts` 后，该 billId 不在 `realPending` 中

若普通 `homepage` 仍显示若干条，但 `--filter-ghosts` 显示 `realPending: 0`，应汇报为：

> 指定单据已从真实待审批消除；普通列表剩余为 ghost/缓存候选，未自动处理。

## 展开粒度

用户说「5展开」时，`review.mjs` 的预审摘要不够；必须补跑：

```bash
node scripts/navigate.mjs bill <BILL_ID>
```

汇报字段至少包含：类型、申请人、金额、事由、项目、吴亮节点状态、分摊明细、部门聚合、预审风险。若 `review.mjs` 已给 CRM/经营数据，也可补充毛利率和低毛利风险，但要标明来自预审/databoard。