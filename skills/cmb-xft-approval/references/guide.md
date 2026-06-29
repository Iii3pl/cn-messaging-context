# 薪福通审批可复现操作链

> 最后验证：2026-05-02  
> 环境：macOS + opencli v1.7.8 + Node 22+  
> 薪福通版本：2026年新版界面（31列表格）

---

## ⚠️ 审批决策规则（硬约束）

**Agent 禁止自行决定审批。** 完整流程：

1. **拉列表** → `navigate.mjs homepage`
2. **审核** → `review.mjs --batch`，检查 riskFlags
3. **呈现摘要给吴亮** → 逐条列出类型、申请人、金额、风险
4. **等吴亮决策** → 「第 X 条通过」「全部通过」「第 Y 条退回」
5. **执行** → `approve.mjs BILL_ID`

任何跳过步骤 3-4 的行为都是违规。

---

## 一、登录链路

### 首次登录
1. `opencli browser open 'https://xft.cmbchina.com/'`
2. 检测页面 → 点击「登录」链接 → 进入 `/#/index`
3. 切换到「密码登录」tab
4. 填写手机号 + 密码
5. 点击登录按钮
6. 等待滑块验证码 → **用户手动拖动**（opencli 无法自动完成）
7. 验证通过后进入 `/#/workbench`

### 登录态保持
- Cookie 存在自动化窗口独立 Chrome profile
- **服务端 30 分钟无操作自动踢人**
- keepalive cron：每 20 分钟访问 TripMainWeb 首页
- 自动化窗口 profile **不共享**用户主 Chrome 的 Cookie

### 登录态检测
```js
page.goto('https://xft.cmbchina.com/TripMainWeb/')
title 含「智能费控」→ 已登录
title 为「招商银行」（不含智能费控）→ SESSION_EXPIRED
```

### Auto-heal（桥接断连）
```
page.goto 抛 fetch failed / DAEMON_UNREACHABLE：
  → opencli daemon stop
  → sleep 2s
  → 重试（最多 3 次）
```

---

## 二、页面导航链路

### 从工作台到审批列表
```
workbench (/#/workbench)
  → 点击「智能费控」应用卡片（.FullApplication_item__3Ruc3）
  → TripMainWeb 加载
  → 审批列表 (/#/form-app/approval)
```

### 关键 URL

| 页面 | URL |
|------|-----|
| 登录 | `https://xft.cmbchina.com/#/index` |
| 工作台 | `https://xft.cmbchina.com/#/workbench` |
| 审批列表 | `https://xft.cmbchina.com/TripMainWeb/#/form-app/approval` |
| 单据详情 | `https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=...` |

---

## 三、审批列表解析

### DOM 结构（31列新版）
```
<table>
  <tr class="ant-table-row ant-table-row-level-0">
    td[0]  = checkbox
    td[1]  = 单据编号 (billId)
    td[2]  = 智能审核结果
    td[3]  = 金额 (amount)
    td[4]  = 单据类型 (type)
    td[5]  = 申请人 (applicant)
    ... 共 31 列
```

### 提取策略
```js
if (tds.length >= 30) {
  billId   = tds[1].textContent.trim()
  amount   = tds[3].textContent.trim()
  type     = tds[4].textContent.trim()
  applicant = tds[5].textContent.trim()
}
// 侧栏过滤：type 必须匹配 /合同用印|员工日常报销单|差旅报销单|.../
```

---

## 四、审批执行链路（核心）

### 两步提交机制

```
Step 1: 点击「通过」按钮
  → 元素：<button class="ant-btn ant-btn-primary">
  → 方式：button.click()（点 button 本身，不能点内部 span）
  → 效果：选中审批动作，展开确认区域

Step 2: 点击「确认」按钮
  → 元素：<button class="ant-btn ant-btn-primary guideStepOperateOkButton">
  → 方式：button.click()
  → 效果：真正提交审批，页面跳回 /#/form-app/approval
```

### ⚠️ 三大误区（2026-05-02 踩坑总结）

1. **点了 `<span>` 没点 `<button>`** — `button.ant-btn-primary` 内部有 span 子元素，`textContent` 匹配到 span，但 click 必须点在 button 上
2. **只点「通过」没点「确认」** — 新版是两步提交，只做第一步不会提交
3. **跟 Vue 无关** — `element.click()` 在 `<button>` 上直接有效，不需要 `__vue__.$emit`

### 验证标准
```
审批成功后：
  → URL 跳回 /#/form-app/approval
  → 待审批列表不再包含该 billId
  → 切换到「已审批」tab 可看到该单据
```

---

## 五、审批链解析

### 新格式
```
审批信息
发起申请 施璐璐 已申请 2026/04/30 15:11:35
一级部门审批 会签 黄少莹 已通过 2026/04/30 15:12:02
二级部门审批节点 会签 关晶 已通过 2026/04/30 22:18:21
三级部门审批节点 会签 郭雪琪 已通过 2026/05/01 11:03:36
四级部门审批节点 会签 吴亮 审批中
财务初审 会签 卢静谊
```

### 正则
```js
/^(\S+(?:审批节点|部门审批|发起申请)?)\s+(?:会签|依次审批|或签)?\s*(\S+)\s+(已通过|审批中|已拒绝|已申请|待审批)/
```

---

## 六、费用明细解析

### 新格式
```
服装道具(项目)新 分摊 325.71 部分报销 325.71 0.00 已关联5张发票
市内交通费(项目)新 分摊 23.60 22.91 0.69 已关联1张发票
```

### 正则
```js
/(.+?)新\s+分摊\s+([\d,.]+).*?已关联(\d+)张发票/
```

---

## 七、已知降级策略

| 问题 | 降级 |
|------|------|
| 滑块验证码 | 用户手动拖动 |
| SESSION_EXPIRED | 重新在自动化窗口登录 |
| 桥接断连 | daemon stop + 重试 3 次 |
| 按钮点击无效 | 检查是否点到 span 而非 button |
| 确认按钮找不到 | 等待 3s + 重试 |
| 31列 vs 5列 | 根据 tds.length 自动切换 |
