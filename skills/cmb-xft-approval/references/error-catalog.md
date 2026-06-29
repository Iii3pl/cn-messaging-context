# cmb-xft-approval 错误目录

> 来源：v2 → v3 开发 + 2026-05-02 生产执行日志

---

## 🔴 致命（阻断审批）

### E001: SESSION_EXPIRED
- **症状**：页面 title 为「招商银行」不含「智能费控」，或 body 为空
- **根因**：自动化窗口 Cookie 独立于用户 Chrome / 服务端 30 分钟超时
- **修复**：在自动化窗口重新登录（opencli browser open → 输入手机号+密码）
- **预防**：keepalive cron 每 20 分钟刷 TripMainWeb 首页

### E002: 桥接断连（DAEMON_UNREACHABLE / fetch failed）
- **症状**：所有 opencli 命令报 fetch failed 或 extension not connected
- **根因**：opencli daemon 与 Chrome 扩展失联
- **修复**：`opencli daemon stop` → sleep 2s → 触发任意浏览器命令
- **代码**：`shared/session.mjs` 内置 auto-heal（3 次重试）

### E003: 点击按钮无效
- **症状**：click() 返回 true 但页面无变化
- **根因（2026-05-02 确认）**：点击了内部 `<span>` 而非 `<button>` 本身
- **修复**：始终点击 `button` 元素，使用 `b.click()` 或 opencli ref
- **额外发现**：薪福通新版是**两步提交**（通过→确认），只点一步不会提交

### E004: 滑块验证码
- **症状**：登录时出现「按住左方滑块，向右拖动滑块完成拼图」
- **根因**：薪福通反爬机制
- **修复**：用户手动拖动，Agent 等待页面变更
- **不可自动化**：opencli 无法拖拽滑块

---

## 🟡 严重（功能损坏）

### E005: 侧栏菜单污染审批列表
- **症状**：parseHomepageBills 返回「对公付款」「基础档案」等菜单项
- **根因**：`querySelectorAll('tr.ant-table-row')` 匹配了侧栏里的 `<tr>`
- **修复**：限定 `.ant-card` 内查找 + 类型校验降级

### E006: 30 分钟超时
- **症状**：长时间不用后 SESSION_EXPIRED
- **预防**：keepalive cron 每 20 分钟刷首页

---

## 🟢 轻微（数据不准）

### E007: 字段粘连
- **症状**：旧版 `textContent.replace(/\s+/g,'')` 后正则拆分失败
- **修复**：v3 改为逐 td 提取

### E008: BILL_NOT_FOUND 误报
- **症状**：已处理单据被报 NOT_FOUND
- **修复**：先查 DB，返回 `alreadyProcessed: true`

### E009: INSERT OR REPLACE 覆盖历史
- **症状**：重复审批静默覆盖旧记录
- **修复**：改为 `INSERT OR IGNORE`

---

## 📐 页面结构变更（兼容性）

### P001: 表格从 5 列变为 31 列
- **影响**：navigate.mjs 的 td 索引全变
- **适配**：根据 `tds.length >= 30` 自动切换新旧提取逻辑

### P002: 审批列表 URL 变更
- **旧**：`/#/trip-app/homepage`
- **新**：`/#/form-app/approval`
- **适配**：`shared/session.mjs` 新增 `APPROVAL_LIST` 常量

### P003: 确认按钮出现
- **旧版**：无确认按钮，点击「通过」直接提交
- **新版**：`button.ant-btn-primary.guideStepOperateOkButton`（ref:285）
- **适配**：`approve.mjs` 改为两步点击

---

## 🟡 第二轮优化新增（2026-05-02）

### E010: review.mjs 在错误页面解析
- **症状**：批量审核时 parseHomepageBills 返回空或错误数据
- **根因**：循环内只调 `ensureLoggedIn(page)`（导航到旧首页 `/#/trip-app/homepage`），未导航到 `/#/form-app/approval`
- **修复**：批量入口和循环内都显式 `page.goto(APPROVAL_LIST, …)`

### E011: OpenCLI Bridge 扩展失联（daemon 正常）
- **症状**：`opencli doctor` 显示 `[OK] Daemon: running` 但 `[MISSING] Extension: not connected`
- **诊断**：`curl localhost:19825/logs` 被拒绝（Forbidden），说明 daemon 健康但 WebSocket 无客户端
- **根因**：Chrome 扩展进程崩溃或 WebSocket 断开后未重连
- **修复流程**：
  1. `opencli doctor` 确认状态
  2. `opencli daemon stop`
  3. 打开 `chrome://extensions/` → 找到 OpenCLI → 关闭再打开（强制重连）
  4. `opencli doctor` 验证 `[OK] Extension: connected`
- **详见**：`references/opencli-bridge-troubleshooting.md`
