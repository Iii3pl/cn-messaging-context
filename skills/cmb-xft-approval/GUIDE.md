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

## 一、登录链路

### 首次登录
```
用户：提供手机号 + 密码
Agent：
  1. opencli browser open 'https://xft.cmbchina.com/'
  2. 检测页面状态 → 点击「登录」链接 → 进入登录页
  3. 切换到「密码登录」tab
  4. opencli browser type [手机输入框ref] '手机号'
  5. opencli browser type [密码输入框ref] '密码'
  6. opencli browser click [登录按钮ref]
  7. 等待滑块验证码 → 用户手动拖动
  8. 验证通过后进入 /#/workbench
```

### 登录态保持
- Cookie 存在自动化窗口的独立 Chrome profile（`opencli browser` 专用）
- **服务端 30 分钟无操作自动踢人**
- keepalive cron：每 20 分钟访问 TripMainWeb 首页

### 登录态检测
```js
page.goto('https://xft.cmbchina.com/TripMainWeb/')
title 含「智能费控」→ 已登录
title 为「招商银行」（不含智能费控）→ SESSION_EXPIRED
```

### Auto-heal（桥接断连）
```
如果 page.goto 抛 fetch failed / DAEMON_UNREACHABLE：
  → opencli daemon stop
  → sleep 2s
  → 重试（最多 3 次）
```

---

## 二、页面导航链路

### 从工作台到审批列表
```
workbench (/#/workbench)
  → 点击「智能费控」应用卡片
  → TripMainWeb 加载
  → 审批列表 (/#/form-app/approval)
```

### 直接访问
```
https://xft.cmbchina.com/TripMainWeb/#/form-app/approval
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

### DOM 结构
```
<table> 31列
  <tr class="ant-table-row ant-table-row-level-0">
    td[0]  = checkbox
    td[1]  = 单据编号 (billId)
    td[2]  = 智能审核结果（"未违规"等）
    td[3]  = 单据类型 (type)
    td[4]  = 申请人 (applicant)
    td[5]  = 供应商
    td[6]  = 是否代理审批
    td[7]  = 企业实付金额
    td[8]  = 单据项目状态
    ... 共 31 列
```

### 提取策略
```js
if (tds.length >= 30) {
  billId   = tds[1].textContent.trim()
  amount   = tds[3].textContent.trim()   // 注意：不是 tds[2]
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
  → 按钮元素：<button class="ant-btn ant-btn-primary">
  → 点击方式：b.click()（点击 button 本身，不能点内部 span）
  → 效果：选中审批动作，展开确认区域

Step 2: 点击「确认」按钮  
  → 按钮元素：<button class="ant-btn ant-btn-primary guideStepOperateOkButton">
  → 点击方式：b.click()
  → 效果：真正提交审批，页面跳回审批列表
```

### ⚠️ 关键发现

1. **必须点击 `<button>` 元素本身**，不能点内部的 `<span>` 子元素
   - `button.querySelector('span').click()` → 无效
   - `button.click()` → 有效

2. **只点「通过」不会提交**，必须再点「确认」
   - 之前所有失败都是因为只做了第一步

3. **Vue 原因不是主因**，`element.click()` 在 `<button>` 上直接有效
   - 不需要 `__vue__.$emit` 或 MouseEvent dispatch
   - 之前的误区是点了错误的元素

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
财务复审节点 依次审批 池丽梅
CFO/副总裁审批节点 依次审批 李伟伟
```

### 正则
```js
/^(\S+(?:审批节点|部门审批|发起申请)?)\s+(?:会签|依次审批|或签)?\s*(\S+)\s+(已通过|审批中|已拒绝|已申请|待审批)/
```

---

## 六、费用明细解析

### 新格式
```
费用信息
费用模式 发票模式
金额合计(CNY) 880.32
税额(CNY) 0.69
不含税金额(CNY) 879.63
发票张数 12
发票金额(CNY) 908.02

服装道具(项目)新 分摊 325.71 部分报销 325.71 0.00 已关联5张发票 2026-04-16 ...
市内交通费(项目)新 分摊 23.60 22.91 0.69 已关联1张发票 2026-04-16 ...
餐饮费(项目)新 分摊 136.40 136.40 0.00 已关联1张发票 2026-04-16 ...
```

### 正则
```js
/(.+?)新\s+分摊\s+([\d,.]+).*?已关联(\d+)张发票/
```

---

## 七、已知问题与降级

| 问题 | 降级策略 |
|------|---------|
| 滑块验证码 | 用户手动拖动，Agent 等待页面变更 |
| SESSION_EXPIRED | 自动化窗口重新登录 |
| 桥接断连 | `opencli daemon stop` + 重试 3 次；仍失败则需手动重载扩展 |
| 按钮点击无效 | 检查是否点到 span 而非 button |
| 确认按钮找不到 | 等待 3s + 多策略查找 |
| 31列 vs 5列 | 根据 tds.length 自动切换提取逻辑 |
| 侧栏「对公付款」污染 | 正文匹配被侧栏菜单干扰 → 正则排除侧栏项 |
| SPA 骨架渲染 | 详情页先 0.00 骨架再异步加载 → 重试等 amt>0（最长 10s） |
| DB schema 不兼容 | 旧表缺 v3 列 → `openDb()` 自动迁移 |
| DB 写入失败但审批已提交 | try-catch 降级 + manualFix SQL |

---

## 八、快速测试命令

```bash
# 健康检查
node scripts/health.mjs

# 拉审批列表
node scripts/navigate.mjs homepage

# 看单据详情
node scripts/navigate.mjs bill 2026043047511696

# 执行审批
node scripts/approve.mjs 2026043047511696 agree "同意"

# 审核分析
node scripts/review.mjs 2026043047511696

# 查审批记录
sqlite3 ~/.hermes/data/cmb_approvals.db "SELECT * FROM approvals ORDER BY approved_at DESC LIMIT 5;"
```
