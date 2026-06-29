# 薪福通预算审批专项

## 预算单与其他审批类型的区别

| 维度 | 普通审批（报销/结算/预付款等） | 预算单 |
|------|-------------------------------|--------|
| URL 模式 | `/#/form-app/approval` → 列表行点击 | `/#/budget-app/budgetapprovaldetail?billId=<id>&viewType=APPROVE_PEND` |
| navigate.mjs bill | ✅ 正常返回详情 | ❌ 不支持 |
| approve.mjs | ✅ 正常通过 | ⚠️ 按钮文本不同（见下），但 approve.mjs 的 ant-btn-primary 策略已验证可工作 |
| 按钮文本 | `通过`（无空格） | `通 过`（中间有空格） |
| 确认按钮 | `确认`（与普通审批同） | `确认`（与普通审批同） |
| 审核输出 | 标准字段（金额/部门/项目/分摊等） | 自定义脚本提取 |
| 表格结构 | 费用明细/分摊 3-10 列 | **60+ 列**（按月为周期，第1-60期） |

## 预算单详情解析

预算详情页 URL：
```
https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId=<billId>&viewType=APPROVE_PEND
```

> 注意：`APPROVE_PEND` 和 `APPROVED` 两种 viewType 都可以尝试。不建议用 `/#/index?redirectUrl=...` 形式，可能导致跳转到审批首页而非预算单详情。

### 关键字段提取

基本信息区块（页面文本）：`预算单号`、`申请人`、`预算方案`（项目预算等）、`预算区间`（如 2025-01-01 至 2029-12-31）、`周期类型`（月度）、`说明`、`调整后预算总额（CNY）`

表格数据（主表 table[0]）：
- 预算组织（预算组织 ID → 项目全称）
- 预算科目（其他成本/外部分包成本/成本等）
- 第N期 调整金额/调整后金额（每期一列，共 60 列）
- 状态

### 审批链特点

预算单的审批链与普通审批不同：

```
发起申请 → 部门审批节点（会签/依次） → 项目预算（业务部门负责人）自选
  → 财务审批节点 → CFO/副总裁审批节点 → CEO
```

关键差异：
- **「项目预算（业务部门负责人）自选」节点**：未设置审批人时**系统自动通过**，显示为「自动通过」「未找到审批人，系统自动通过」
- **吴亮节点**：预算单的吴亮节点在「部门审批节点」内（如第 3/3 个审批人），批完后系统自动过「项目预算自选」节点，然后到财务审批

## 预算批准后页面状态（2026-06-22 修正）

原经验「预算批准后列表不消除」是**部分对**——精确规则是看**吴亮节点之后还有没有 RUNNING 节点**：

| 吴亮节点位置 | 列表是否消除 | 判定硬信号 |
|--------------|:-----------:|-----------|
| 还有 财务/CFO/CEO 等后续 RUNNING 节点（2026-06-15 实测）| ❌ 不消除（预期） | 详情页吴亮节点变 `已通过` |
| 吴亮是最后一个 RUNNING 节点（如 ¥0 + subType=`业务部门负责人`，2026-06-22 吴秋霞 `2026061662744505` 实测）| ✅ 消除（`pending` 减 1）| 列表消除就是硬信号 |

**判定优先级**：
1. 详情页吴亮节点变 `已通过`（最权威）
2. 列表消除（吴亮是最后节点时是真信号）
3. 不要因为"预算单列表不消除"就误判为没批成功——吴亮之后还有节点的情况属正常
4. **不要在吴亮是最后节点时反复重试**——列表消除已经够了，再点会触发「单据已审批」类错误

已验证样本（2026-06-22）：吴秋霞 ¥0 预算（subType=`业务部门负责人`，billId `2026061662744505`）→ `approve.mjs` 返 `BUTTON_NOT_FOUND` → 降级 `opencli browser <s> open <budget_url>` + eval 点「通 过」+「确认」→ pending 从 7 减到 5 → 真消除。

## ⚠️ SPA 缓存污染（2026-06-15 发现并修复）

### 现象
在同一个 `Page` 会话中连续打开不同预算单详情时，页面可能显示**上一个预算单的数据**而非当前预算单。

### 已验证样本
钱天雨预算单详情打开后，`申请人` 字段显示为「商贤」而非「钱天雨」，表格数据也是商贤预算的调整内容。

### 修复方法
1. **每个预算单使用独立的 `Page` 对象**（session name 用不同的后缀，如 `cmb-budget-<billId后6位>`）
2. **追加时间戳防缓存**：在 URL 末尾加 `&_=${Date.now()}`
3. **触发 hashchange**：load 后执行 `window.dispatchEvent(new HashChangeEvent('hashchange'))`
4. **提取后验证**：先检查 `text.includes(billId)` 再提取，不匹配时换另一个 viewType 重试

```js
// 正确的打开模式
const url = `https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId=${billId}&viewType=APPROVE_PEND&_=${Date.now()}`;
await page.goto(url, {waitUntil:'load', settleMs:3000});
await sleep(5000);
await page.evaluate(`window.dispatchEvent(new HashChangeEvent('hashchange'))`);
await sleep(2000);
const text = await page.evaluate(`document.body.innerText`);
if (!text.includes(billId)) {
  // SPA 缓存污染，换 viewType 重试
}
```

## ¥0 预算 + approve.mjs BUTTON_NOT_FOUND 兜底（2026-06-22 实测）

### 现象
- `node scripts/approve.mjs <budget_billId> agree "同意"` 返 `BUTTON_NOT_FOUND`
- 加 `--force` 仍然 `BUTTON_NOT_FOUND`
- 原因：`approve.mjs` 默认搜 `button.ant-btn` 文本为 `通过`（无空格），但预算页实际是 `通 过`（带空格），匹配不上
- **opencli bridge tab 同时卡在 about:blank**（虽然 `self-heal.mjs` 报告 SESSION_VALID，因为 Playwright 走的是独立 Page 对象检测）

### 正确兜底流程（不要走 approve.mjs --force，不要走 navigate.mjs homepage 反复重试）

```bash
# 1. 确认 session 健康（如果 self-heal 报告 OK 跳过这步）
cd /Users/wuliang/.hermes/skills/openclaw-imports/cmb-xft-approval
node scripts/self-heal.mjs  # 期望 summary: "✅ 薪福通 session 正常"

# 2. 直接 opencli open 预算详情页（这次会真渲染，不需要 page.goto）
SESS=gxs46xbg  # 用用户已连接的 session 名
opencli browser $SESS open "https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId=2026061662744505&viewType=APPROVE_PEND"
sleep 5

# 3. 验证页面已挂载（不是 about:blank）
opencli browser $SESS eval "location.href"
# 期望含 "/budget-app/budgetapprovaldetail"
opencli browser $SESS eval "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.replace(/\s+/g,' ').trim()).join('|')"
# 期望包含 "通 过"（带空格）

# 4. 点「通 过」（注意 includes('通') && includes('过)，不用 === '通过'）
opencli browser $SESS eval "Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('通') && b.innerText.includes('过'))?.click(); 'clicked 通过'"
sleep 3

# 5. 验证弹窗出现
opencli browser $SESS eval "!!document.querySelector('.ant-modal')"
# 期望 true

# 6. 点「确认」
opencli browser $SESS eval "Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '确认')?.click(); 'clicked 确认'"
sleep 4

# 7. 验证列表已消除（¥0 + 业务部门负责人 subtype 时）
node scripts/navigate.mjs homepage
# 期望该 billId 不在 bills 数组里
```

### 为什么直接 `opencli open <budget_url>` 能成功，而 `navigate.mjs` 不行

- `navigate.mjs` 走 Playwright `page.goto()`，对 budget URL 支持不完整（`navigate.mjs bill` 显式说"不支持预算单类型"）
- `opencli open` 是直接把 URL 写到 tab 地址栏，**对预算 URL 触发的 SPA 路由是 OK 的**（与主页 list URL 不同——list URL 需要完整 nav history + 鉴权态才挂载）
- 这是 URL 模式差异：list 走 `/#/form-app/approval`（要 Vue 根组件挂载），budget 走 `/#/budget-app/budgetapprovaldetail`（直接渲染预算子组件）

### 与已有「SPA Blank Recovery」章节的关系

`references/opencli-eval-fallback.md` 末尾的「SPA Blank Recovery」说恢复方法是 `navigate.mjs homepage`。**对预算单不适用**——`navigate.mjs bill <budgetId>` 不会渲染预算页（明确不支持），`navigate.mjs homepage` 跳回 list 页，预算按钮「通 过」也不会出现在 list 行的「通过」按钮上（list 行级只显示「通过/否决」，不带空格，但批的是普通审批节点，不是预算的"业务部门负责人"子节点）。

**正确的预算单恢复路径就是上面 7 步**，不要绕到 `navigate.mjs homepage`。

## 预算调整核心判断逻辑

预算单的本质是**预算科目结构调整**，不是新增总额。判断口径：

| 场景 | 正确理解 |
|------|---------|
| 其他成本 +¥10,000，外部分包成本 -¥10,000 | 科目间预算平移，总额不变 |
| 成本 -¥300，其他成本 +¥300 | 科目间微调，总额不变 |
| 某科目调整金额 = -原有金额/新金额 | 可能是科目间拆分或合并 |
| 调整后总额 > 原总额 | 新增预算，需重点关注 |

**风险判断**：
- ✅ 科目间平移（增 A = 减 B）：低风险，重点是项目归属是否正确
- ⚠️ 总额新增：中高风险，需关注新增预算用途和来源
- ❌ 跨项目平移：高风险，需确认项目归属
