# 幽灵单据行级审批兜底（2026-06-11 起，2026-06-22 强化）

## 触发场景

`navigate.mjs homepage --filter-ghosts` 标记 `ghost:true`，或 `approve.mjs` 对某 billId 返回 `BUTTON_NOT_FOUND` / `PREAUDIT_BLOCKED`，但列表行内仍有「通过 / 退回」按钮。这类单据可能：

- 详情页可打开，但直接详情页按钮定位不稳定；
- 或详情页/列表页正文中出现「系统异常」toast 文案残留；
- 但列表行本身仍有「通过 / 退回」按钮。

## 关键坑

不要用 `document.body.innerText.includes('系统异常')` 作为不可操作判定。

薪福通页面正文常含有：

- 左侧菜单「系统设置」
- 历史 toast「系统异常！请联系管理员。」

这些文案会污染全页文本，导致脚本误判详情页不可操作。正确判断是：**按 billId 精确找到列表行，再看该行内是否存在「通过」按钮**。

## ⚠️ opencli tab vs Playwright Page 是两个 context（2026-06-22 实测）

`navigate.mjs` 走 Playwright Page（独立 browser context），opencli bridge 是另一个 tab。
跑完 `navigate.mjs homepage` 后**opencli tab 仍卡在 `about:blank`**，直接 eval 会返 0 rows。

**正确恢复**：
```bash
# 1. opencli tab 重写 URL（不要靠 location.reload，SPA 没挂载时 reload 也无效）
opencli browser <s> open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 6   # 关键：等 Vue SPA 挂载，至少 5s

# 2. 验证 SPA 已挂载
opencli browser <s> eval "document.querySelectorAll('tr.ant-table-row').length"
# 返 N>0 → 恢复成功

# 3. 此时再按下方流程找行 + 点按钮
```

**反例**：`navigate.mjs homepage` 返 12 条 + `opencli browser <s> eval "rows.length"` 返 0 → 几乎肯定是 tab 没刷新。

## ⚠️ opencli eval 中 `const` 重复声明会 SyntaxError（2026-06-22 实测）

opencli eval 每次执行是**共享同一 JS context**，不是 sandboxed。连续两次 eval：

```js
// 第一次
const tr = Array.from(...).find(...);  // 成功
// 第二次
const tr = Array.from(...).find(...);  // ❌ SyntaxError: Identifier 'tr' has already been declared
```

第二次 eval 静默失败，**返回的 `'clicked'` 实际是上一轮缓存的 eval 结果**。后续回查会发现 rows 没减少 + billId 仍在。

**修复**：用 IIFE 包起来避免顶层 `const`：
```js
(function(){
  const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes(billId));
  const btn = Array.from(tr.querySelectorAll('button')).find(b => b.innerText.trim() === '通过');
  btn?.click();
  return 'clicked';
})()
```

## ⚠️ 「同一 billId 列表残留」vs 「真未批」必须 DB 交叉验证（2026-06-22 实战）

场景：A 轮点行内「通过」+「确认」+ 弹窗消失，rows 减少；B 轮 `navigate.mjs homepage` 又看到同 billId 出现。

**判定流程**：
1. **先看 DB**（最权威）：
   ```bash
   sqlite3 ~/.hermes/data/cmb_approvals.db "SELECT approved_at, action FROM approvals WHERE bill_id='<bid>'"
   ```
   - 有 agree 记录 + `clickVerified=true` → **审批已生效，列表残留是缓存**，**不要重批**
   - 无记录 → 重新走行级通过流程
2. **再看 clickVerified 字段**：approve.mjs 返 `ok:true/clickVerified:true/dbSaved:true` 但弹窗后续没真提交（如 X3 差旅报销），需走 opencli eval 行级
3. **再回查 `navigate.mjs homepage`**：billId 仍在 + DB 无记录 = 真未批

**实战反例**（2026-06-22）：X8（X5 billId `2026061963666421`）A 轮 approve.mjs 黄灯通过，DB 写入 agree；B 轮 `审批列表` 仍显示同 billId。我误判为"X8 已通过，DB 落地"，B 轮汇报时只说"X5 = X8 重复，不要重批"是必要的；如果看到 DB 无记录 + 列表还在，必须重走 opencli eval 行级，不能纯按"上次说过已批"判定。

## 推荐流程

1. 先回到审批列表页：

```js
location.href = 'https://xft.cmbchina.com/TripMainWeb/#/form-app/approval'
```

2. 按 `billId` 精确匹配 `tr.ant-table-row`：

```js
const rows = [...document.querySelectorAll('tr.ant-table-row')]
const row = rows.find(tr => (tr.innerText || '').includes(billId))
```

3. 只在该行内找按钮，不扫全页：

```js
const btn = [...row.querySelectorAll('button')]
  .find(b => ((b.innerText || '').replace(/\s+/g, '').trim()) === '通过')
```

4. 点击该行「通过」后，再点击弹窗「确认」：

```js
btn.scrollIntoView({ block: 'center' })
btn.click()
// wait 1-2s
const confirm = [...document.querySelectorAll('button')]
  .find(b => ((b.innerText || '').replace(/\s+/g, '').trim()).includes('确认'))
confirm.click()
```

5. 回查：

```bash
node scripts/navigate.mjs homepage --filter-ghosts
```

注意：有些幽灵行点击成功后仍可能留在列表且显示「已通过」，但 `pending/ghostCount` 通常会减少；以重新拉列表结果为准。

## 操作边界

- 只处理用户明确指定的序号 / billId。
- 未指定的幽灵单据不动。
- 行级按钮存在时可走此兜底；若行不存在或行内无「通过」按钮，停止并汇报不可自动处理。

## 已知生效样本

- 2026-06-11 多个 ghost 投流/供应商结算/员工报销
- 2026-06-22 X3 方彦博差旅报销 `2026061763052857`（approve.mjs 返 BUTTON_NOT_FOUND，行级「通过」+「确认」后 rows 3→2，billId 0 个匹配，DB 后续可走 fast-approve 或 approve 补录）
- 2026-06-22 X4 吴秋霞 ¥0 预算 `2026061662744505`（opencli tab 加载 budgetapprovaldetail URL，按钮文字"通 过"带空格，行级"通 过"+"确认"，弹窗消失，列表消除，**DB 无记录**——¥0 预算走流程锁定编号属正常）
