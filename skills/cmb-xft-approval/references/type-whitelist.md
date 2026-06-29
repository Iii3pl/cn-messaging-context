# 单据类型白名单

## VALID_BILL_TYPES（extract.mjs L15）

当前已注册类型（正则 OR 组）：

```
合同用印|员工日常报销单|差旅报销单|供应商结算单|投流费用申请单|员工备用金|供应商预付款|云账户支付|预算|招待申请单
```

## 新增历史

| 日期 | 新增类型 | 发现方式 |
|------|---------|---------|
| 2026-05-31 | 员工备用金 | navigate.mjs 返 pending>0 但 bills=[] |
| 2026-06-05 | 预算 | navigate.mjs 返 pending>0 但 bills=[] |
| 2026-06-26 | 招待申请单 | 列表 14 行但 navigate 只解析 13 行 |

## 排查流程

当 `navigate.mjs homepage` 返 `pending>0, bills=[]` 或 bill 数 < pending 数时：

1. 跑 `node scripts/_debug_parse.mjs`
2. 若 `mismatched>0` → 新类型，追加到 VALID_BILL_TYPES
3. 若 `matched==total` → SPA 时序问题，重试即可

## opencli eval 绕过

白名单过滤只影响 navigate.mjs / review.mjs 的解析。白名单外的单据**仍可通过 opencli eval 行级操作**（点「通过」+「确认」）。示例：

```bash
SESS=gxs46xbg
# 按 billId 找 row
ROW=$(opencli browser $SESS eval "Array.from(document.querySelectorAll('tr.ant-table-row')).find(r=>r.innerText.includes('<billId>'))")
# 点行内按钮（文本含 通过）
BTN=$(opencli browser $SESS eval "Array.from(tr.querySelectorAll('button')).find(b=>b.innerText.replace(/\\s+/g,'')==='通过')")
btn.click()
```
