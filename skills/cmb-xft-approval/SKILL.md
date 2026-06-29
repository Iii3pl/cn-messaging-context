---
name: cmb-xft-approval
description: 招商银行薪福通智能费控审批 — 通过 opencli Chrome 桥接复用登录态，打通钉钉待办→薪福通详情→审核分析→审批执行→数据库记录的完整闭环。v3 重构：逐 td 提取、侧栏过滤、Vue 多策略点击、auto-heal 桥接、INSERT OR IGNORE 去重、审核模块。触发词：薪福通、CMB、招行审批、智能费控、报销单、合同用印、差旅报销、对公付款审批、xft、xft approval、薪福通审批、招行薪福通、cmb xft、CMB薪福通、我的薪福通、查薪福通、批薪福通、薪福通报销、费控审批、招行费控、智能费控审批、xft.cmbchina。
---

# 薪福通智能费控审批 v3

## 概述

薪福通（xft.cmbchina.com）是招商银行的企业费控系统。每笔审批操作自动落入本地 SQLite 数据库。

> 金额解析注意：薪福通详情页偶发金额抽取异常（如主页列表为 CNY 2,000.00，详情/review 抽成 amount=7）。当主页列表金额与详情金额冲突时，审批风险分层和对用户展示优先以主页待审批列表金额为准；详见 `references/detail-amount-anomaly.md`。

### ⚠️ 审批决策规则（硬约束）

**Agent 在任何情况下禁止自行决定审批。** 违反即红线。

必须遵循：

1. `navigate.mjs homepage` 拉待审批列表
2. `review.mjs --batch` 逐条审核 + riskFlags
3. 呈现**完整审核摘要**给吴亮——每一条都要包含：类型、申请人、金额、事由、部门、项目、发票张数、审批链、风险标记、建议
4. **等吴亮明确指定「第 X 条通过」「全部通过」「第 Y 条退回」后**，才执行 `approve.mjs`
5. **只批吴亮指定范围的单据**——未指定的不得批

**禁止行为：**
- 不得在用户未指定时自行批量通过剩余单据
- 不得以"测试""验证""试运行"为名绕过审批决策流程
- 不得在审核摘要中省略字段（department/project/allocations等），这会导致用户无法做出完整判断
- 不得擅自扩大审批范围（如：用户说批 #1，你却连 #2 #3 一起批了）——2026-05-02 曾违规，不可再犯
- 不得在同一会话中对同一返回 0 的审批系统重复查询超过 2 轮——如果钉钉返回 0 且用户反复追问"审批列表"，主动提示检查薪福通

## 浏览器登录注意事项

- **桌面浏览器登录时会弹出「启动薪福通客户端」对话框**（含 Close 按钮），点掉后表单方可操作。注意：该对话框**每次登录都会重新弹出**，点掉→登录可能触发对话框再次出现→需要再次点掉→再次点登录。
- **登录按钮点击后可能触发滑块验证码**。无滑块时直接跳转即可。
- **登录态过期判定**：`review.mjs --batch` 或 `navigate.mjs` 返回 `SESSION_EXPIRED` / `BILL_NOT_FOUND`（且该 bill 确在 homepage 列表中）时，需重新登录。
- **自动化窗口不在前台时**：用户反馈「看不到窗口」，最快的办法是 `open -a "Google Chrome" "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"` 直接在前台打开。opencli bridge 复用同一个 Chrome 实例的 cookie，用户在默认 Chrome 登录后 navigate.mjs 即可工作。无需反复折腾 `opencli browser open`。
- **browser-harness 登录需两步**：填表 → 点掉「启动薪福通客户端」弹窗(Close) → 再点登录。弹窗可能在登录按钮点击后再次出现，需反复点掉直到页面跳转。如果登录后仍停留在登录页且无错误提示，检查 console 是否有 `theme-getEnterpriseThemeRes-error`（密码错误/风控）。
- **登录成功后**：opencli 脚本（navigate.mjs / approve.mjs / review.mjs）即可正常工作——cookie 通过同一 Chrome 实例共享。

### 🔴 共享已有 opencli session 名（2026-06-22 实战）

用户已有的 opencli browser session 名（如 `gxs46xbg` / `tvrvbmjk` / `uz3357c8`）可能已经连接了 Chrome 并登录。**第一优先级是询问/使用用户提供的 session 名**，而不是：

1. ❌ 跑 `opencli daemon restart` / `opencli doctor`（浪费时间）
2. ❌ 跑 `navigate.mjs homepage`（这脚本内部 auto-heal 会失败）
3. ❌ 走 self-heal.mjs（验证码阻断后无法恢复）

**正确流程**（2026-06-22 D8→X1 切换时实战）：
```bash
# 用户："gxs46xbg opencli已经连接了"
# Step 1: 用提供的 session 名直接 eval
opencli browser gxs46xbg eval "document.title"
# → "智能费控·薪福通" 立刻生效

# Step 2: opencli 提 URL
opencli browser gxs46xbg open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 3

# Step 3: eval 验证 rows
opencli browser gxs46xbg eval "document.querySelectorAll('tr.ant-table-row').length"
# → 16（生效）
```

**判定标准**（2026-06-22 + 2026-06-23 实测修正）：
- `document.title` 立刻返应用名（如「智能费控·薪福通」）+ `location.href` 含 xft 域名 → session **有效**，跳过所有诊断
- `document.title` 返空 + `location.href` 含 xft 域名 → SPA 异步渲染中，等 2-3 秒再 eval
- `document.title` 返空 + `location.href` 含**其他应用**（如 `deepseek.com`）→ session tab 上跑的不是 XFT，需要 `opencli browser <s> open <xft_url>` 切回去
- `document.title` 返空 + `location.href` 是 `about:blank` → session tab 死了,需要 `opencli browser <s> open <xft_url>` + `sleep 6-8` 等 SPA 挂载,**不要**走 self-heal.mjs（已验证直接 open + sleep 就能恢复，比 self-heal 快得多）

**快速恢复脚本**（无需 self-heal / bind）:
```bash
S=gxs46xbg
opencli browser $S eval "location.href" 2>&1 | tail -1
# 返 about:blank 或非 xft 域名:
opencli browser $S open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval" 2>&1 | tail -1
sleep 8
opencli browser $S eval "document.title + ' | rows=' + document.querySelectorAll('tr.ant-table-row').length" 2>&1 | tail -1
# 应返 "智能费控·薪福通 | rows=N" (N>0)
```

**坑**：`opencli browser <s> open <url>` 只把 URL 写到 tab 地址栏,Vue SPA 不会自动启动 → 必须 sleep 6-8s 等 SPA 挂载（页签完全加载后 rows 才会出现）。

**坑**：`opencli browser <s> open <url>` 只把 URL 写到 tab 地址栏，Vue SPA 不会自动启动 → 必须 sleep 3-5s 等 SPA 挂载。

### XFT 行级「通过」+ 弹窗堆叠循环确认（2026-06-22 实战 4 单批量）

XFT 新版主页行级「通过」按钮**单步直接生效**（无弹窗），但**部分类型仍走两步**（弹窗 + 确认 + toast）。批量点行内「通过」后弹窗可能**堆叠**：

```bash
# 2026-06-22 实战 X1-X4 一次性 4 个 click 后弹窗堆叠 4 个
# 错误做法：一次性点"通过"→ sleep → 点"确认"×1
# 正确做法：循环检查 + 循环点"确认"，直到 dialog 消失
for i in 1 2 3 4 5; do
  state=$(opencli browser <s> eval "
JSON.stringify({
  dialog: !!document.querySelector('.ant-modal'),
  rows: document.querySelectorAll('tr.ant-table-row').length
})
")
  echo "Round $i: $state"
  
  hasDialog=$(echo "$state" | python3 -c "import sys,json; print(json.load(sys.stdin)['dialog'])")
  [ "$hasDialog" != "True" ] && { echo "No more dialogs!"; break; }
  
  opencli browser <s> eval "
Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '确认')?.click();
'ok'
"
  sleep 3
done
```

**判定真批成功的硬信号**（参考下方「点完行级按钮不等于真批成功」章节）：
1. `dialog` 已消失 + `rows` 减少（每条单批后 `rows` 减 1）
2. 不要一次 eval 出"rows 12→11"就报成功——SPA 短暂重排也算
3. 必须 sleep 5s 后**重新 navigate.mjs homepage** 验证 billId 真的消失

## Session 自愈机制（2026-06-05 新增）

薪福通 session 会在闲置一段时间后过期（cookie 超时）。过去依赖「出问题时再手工修」，已升级为**自动检测 + 自动恢复 + 失败通知**。

### 三层自愈流水线

| 层级 | 脚本 | 频率 | 做什么 |
|------|------|------|--------|
| L1 全栈检查 | `health-check.mjs` | 手动/每日 | daemon → bridge → session 三层诊断 |
| L2 自动恢复 | `self-heal.mjs` | 每 30min (cron) | 愈合 daemon → 自动登录 → 验证 |
| L3 每日报告 | cron 健康检查 | 每日 10:00 | 推送到钉钉运营小群 |

### 工作流程

```
self-heal.mjs (每 30min)
  ├─ Stage 0: Daemon 检测 → 僵死则 force restart
  ├─ Stage 1: Bridge 验证 → 不通则重启扩展
  └─ Stage 2: Session 检测
       ├─ 正常 → 静默（exit 0）
       ├─ 过期 → 自动填表登录
       │    ├─ 成功 → 静默（exit 0）
       │    └─ 失败（验证码）→ 推送钉钉通知吴亮手动登录
       └─ 其他异常 → 推送钉钉
```

### 手动命令

```bash
# 全栈健康检查
node scripts/health-check.mjs

# 手动自愈
node scripts/self-heal.mjs

# 自愈 + 输出钉钉格式通知
node scripts/self-heal.mjs --notify
```

### 通知触发条件

仅在**自动恢复失败**时发送钉钉通知（避免噪音）：
- 滑块验证码阻断 → 通知吴亮手动拖滑块
- Daemon 无法启动 → 通知 + 修复指令
- Bridge 不通 → 通知 + 扩展重启用指令

### ⚠️ self-heal.mjs 输出可能误导（2026-06-06/07 实测）

当 session 过期且自动登录被滑块验证码阻断时，`self-heal.mjs --notify` 可能输出 **"Bridge 不通, daemon: none"**，但实际上 bridge 和 daemon 完全正常。原因可能有两类：
1. 脚本在长时间等待登录跳转时内部状态判断偏差；
2. opencli v1.8.3 后 `daemon-client.js sendCommand('exec', ...)` 需要传 `{session:'self-heal', surface:'browser'}`，旧参数 `{workspace:'self-heal'}` 会导致 bridgeAlive 探测挂起/误报失败。

**Agent 收到 self-heal 失败报告后，必须交叉验证**，不要直接采信脚本输出的原因：

```bash
# 1. 独立验证 daemon + bridge
opencli doctor

# 2. 独立验证 bridge 可达性（优先用 doctor 输出的 profile/session，例如 uz3357c8）
opencli browser <session> eval "document.title"

# 3. 如果 CLI eval OK，但脚本内 daemon-client 探测失败/超时，验证统一 resolver
node --input-type=module -e "import { loadSendCommand, getOpencliInfo } from './scripts/shared/opencli.mjs'; const sendCommand=await loadSendCommand(); console.log(getOpencliInfo(), await sendCommand('exec', {code:'1+1', session:'self-heal', surface:'browser'}))"

# 4. 如果 doctor 和 eval 都 OK → bridge 正常，真实原因通常是 session 过期 + 验证码阻断
# 5. 只有 doctor 也报错时才走 bridge 修复流程
```

**通知消息修正**：如果 self-heal 说 bridge 不通但 doctor 正常，通知吴亮时应改为「Session 过期，需手动拖滑块登录」，不要照搬脚本的 "Bridge 不通" 误报。若交叉验证发现页面停在 `/#/index?redirectUrl=...` 且正文包含「手机号登录/密码登录/启动薪福通客户端」，即使 `hasSlider=false`，也按「登录态过期；自动登录后可能触发验证码」处理。

**脚本超时挂死也是过期信号**：self-heal.mjs / health-check.mjs / health.mjs 超时（>120s 无输出）≠ bridge 断连。先 `pkill` 清残留进程，再 `opencli doctor` + `opencli browser <s> eval` 独立验证。详见 [`session-self-heal.md`](references/session-self-heal.md)「脚本超时诊断模式」。

### 相关 cron

- `xft-session-selfheal`（每 30min）：静默自愈，失败时通知
- `薪福通每日全栈健康检查`（每日 10:00）：每日状态报告

> **Connection error 排查**：cron 报 `RuntimeError: Connection error.` 时，先区分是 XFT session 过期还是 LLM API 不通。手动跑 `navigate.mjs homepage` 验证 session；如果 session 正常但 cron 仍报错，检查 cron 的 model/provider 是否继承自主配置（`model: null`）且在切换模型后断了。详见 `references/cron-connection-error-model-isolation.md`。

## 架构

```
scripts/
├── shared/
│   ├── opencli.mjs  ← 统一解析当前 OpenCLI 包（避免 CLI/daemon/脚本版本漂移）
│   ├── session.mjs   ← 登录检测 + 首页导航 + 桥接 auto-heal
│   ├── db.mjs        ← SQLite 操作（增强 schema + INSERT OR IGNORE）
│   └── extract.mjs   ← 逐 td 提取 + 完整字段 + 审核规则
├── navigate.mjs      ← 首页待审批列表 + 单据详情 + 分页 + 幽灵过滤
├── review.mjs        ← 单笔/批量审核（不执行审批）
├── approve.mjs       ← 审批执行（Vue 多策略点击 + 双重验证）
├── fast-approve.mjs  ← 行级按钮快速通过；默认 dry-run，真实执行必须 --yes
├── health.mjs        ← 桥接连通性检查（轻量）
├── health-check.mjs  ← 🆕 全栈健康检查（daemon→bridge→session 三层）
├── self-heal.mjs     ← 🆕 Session 自愈流水线（自动登录 + 恢复 + 通知）
└── ghost-clear.mjs   ← 🆕 幽灵单据诊断/清理（opencli CDP 硬刷新，2026-06-06）
```

数据流：

```
                  ┌─ health-check.mjs ──→ 全栈诊断报告
                  ├─ self-heal.mjs    ──→ 自动愈合 → 失败时钉钉通知
自愈层（cron）     └─ (每 30min 静默运行)

钉钉待办 → navigate.mjs → 查看列表/详情
         → review.mjs   → 审核分析（riskFlags + suggestion）
         → approve.mjs  → 审核摘要 → 自动滚动 → Vue 点击 → 验证 → DB
```

## ⚠️ 关键规则：SPA 空结果必须重试

薪福通列表页是 SPA 异步渲染。**单次 `navigate.mjs homepage` 返回 `pending=0` 不可信**——尤其在刚批完一波之后，页面可能还在渲染或缓存旧状态。硬规则：
0. **返回 0 时先检查浏览器是否在 about:blank**（`opencli browser <session> eval "location.href"`）— 若为 `about:blank`，页面根本没加载，跑 `self-heal.mjs` 或手动 `open -a "Google Chrome"` 登录，不要盲目重试
1. **返回 0 且页面正常时重试一次**（SPA 渲染时序）
2. **用户质疑 0 结果时再重试一次**（如「不对吧，薪福通0？」）——刚批完一批后页面状态不稳定，需要额外等待
3. 两次重试后仍为 0，检查是否为登录态过期（见下方 BILL_NOT_FOUND 诊断）。`health.mjs` 超时 ≠ session 过期——先跑 `opencli doctor` + `self-heal.mjs` 交叉验证
4. 若同时出现 `BILL_NOT_FOUND` 错误，优先走登录态过期流程而非继续重试

本会话中已验证：批完 18/20 后首次返回 0，用户质疑后重试显示 14 条真实待审批；后续批到一半返回 0 且伴随 BILL_NOT_FOUND = 登录态过期。

## 快速开始

### 1. 自动化窗口登录薪福通

```bash
opencli browser open 'https://xft.cmbchina.com/'
# 手动输入手机号+密码登录
# Cookie 在自动化 window profile 中持久化
```

### 2. 查看待审批列表

```bash
node scripts/navigate.mjs homepage
node scripts/navigate.mjs homepage --page 2          # 翻页
node scripts/navigate.mjs homepage --filter-ghosts    # 🆕 幽灵过滤
```

### 3. 查看单据详情

```bash
node scripts/navigate.mjs bill 2026043047396427
```

### 4. 审核分析（🆕，不执行审批）

```bash
node scripts/review.mjs 2026043047396427         # 单笔审核
node scripts/review.mjs --batch                  # 批量审核
node scripts/review.mjs --batch --type 合同用印   # 按类型筛选
node scripts/review.mjs 2026043047396427 --no-preaudit-cache  # 强制刷新预审缓存
```

审核输出包含：riskFlags、suggestion、审批链、发票明细、费用拆分。预审默认使用 24 小时 SQLite 缓存；需要强制重新查 CRM/Databoard 时加 `--no-preaudit-cache`。

### 5. 执行审批

```bash
node scripts/approve.mjs 2026043047396427 agree "同意"
node scripts/approve.mjs 2026043047396427 reject "退回原因"
node scripts/fast-approve.mjs --ids 2026043047396427 --dry-run  # 行级快速通过预览
node scripts/fast-approve.mjs --ids 2026043047396427 --yes      # 真实行级快速通过
```

执行流程：
1. 登录检测 + 查 DB 去重
2. 自动滚动到底部按钮区
3. Vue 实例方法 → MouseEvent → 兜底报错（三重尝试）
4. URL 变化 + 文本变化双重验证
5. INSERT OR IGNORE 写入 DB

`fast-approve.mjs` 仅用于吴亮已明确指定通过的 billId。它不打开详情页，直接在审批列表按 billId 定位行内「通过」按钮；默认 dry-run，不加 `--yes` 不会点击。

### 6. 查询审批记录

```bash
sqlite3 /Users/wuliang/.hermes/data/cmb_approvals.db "SELECT * FROM approvals ORDER BY approved_at DESC LIMIT 20;"
```

### 7. Session 健康检查与自愈

```bash
# 全栈健康检查（daemon → bridge → session）
node scripts/health-check.mjs

# 手动自愈（daemon 愈合 → 自动登录 → 验证）
node scripts/self-heal.mjs

# 自愈 + 钉钉格式通知（供 cron 使用）
node scripts/self-heal.mjs --notify
```

健康检查输出 JSON：`{ok, daemon:{state,pid}, bridge:{ok}, session:{ok,reason}, fix[]}`。
自愈仅在恢复失败时主动通知（验证码阻断等），正常/自动恢复成功则静默。

## 数据库

路径：`/Users/wuliang/.hermes/data/cmb_approvals.db`

### 完整表结构（v3 增强）

| 字段 | 类型 | 说明 |
|------|------|------|
| bill_id | TEXT UNIQUE | 单号 |
| bill_type | TEXT | 合同用印/员工日常报销单/差旅报销单/... |
| sub_type | TEXT | 🆕 子类型（供应商/客户等） |
| applicant_name | TEXT | 申请人 |
| applicant_id | TEXT | 🆕 工号 |
| amount | REAL | 金额 |
| subject | TEXT | 事由 |
| department | TEXT | 部门 |
| project | TEXT | 关联项目 |
| bank_account | TEXT | 🆕 收款账户 |
| approval_chain | TEXT(JSON) | 🆕 审批链 [{node,name,status}] |
| expense_breakdown | TEXT(JSON) | 🆕 费用明细 [{category,amount,invoiceCount}] |
| contract_name | TEXT | 🆕 合同名称（合同用印专属） |
| supplier | TEXT | 🆕 供应商 |
| contract_period | TEXT | 🆕 合同期间 |
| system_remark | TEXT | 🆕 系统备注 |
| approved_at | TEXT | 审批时间 |
| approved_by | TEXT | 审批人 |
| action | TEXT | agree/reject |
| remark | TEXT | 审批意见 |

## 审核规则

| 规则 | 触发条件 | 标记 |
|------|---------|------|
| 零金额 | amount = 0 | `零金额，走流程锁定编号，无资金风险` |
| 大额 | amount > 10000 | `金额>10000，建议复核` |
| 超大额 | amount > 50000 | `金额>50000，需谨慎审批` |
| 合同用印 | type = 合同用印 | `合同用印，请核对合同条款` |
| 供应商风险 | systemRemark 含风险关键词 | `供应商风险，见备注` |
| 跨部门 | 申请人≠承担部门 | `跨部门报销` |
| 无项目 | 无项目关联 | `无项目归属` |
| 多发票小金额 | totalInvoices > 10 且 amount < 2000 | `发票较多但金额小` |
| 重复 | DB 已有同 billId | `已处理(DB)` |

## v3 核心改进

### 🔴 已修复的 Bug
1. **侧栏污染**：限定 `.ant-card` 内查找 + 类型校验降级
2. **按钮找不到**：进详情自动 `scroll('down', 5000)` + 等待渲染
3. **Vue @click 不触发** → **根因是点了内部 `<span>` 而非 `<button>`**，`b.click()` 在 button 元素上直接有效。**2026-06-05 增强**：见 [button-click-strategy.md](references/button-click-strategy.md)——3 层搜索策略 + 多文本匹配 + BUTTON_NOT_FOUND 硬退出。
4. **桥接断连**：`ensureLoggedIn` 内置 `opencli daemon stop` + 3 次重试
5. **字段粘连**：逐 td 提取，兼容 31 列新版 + 5 列旧版
6. **BILL_NOT_FOUND**：先查 DB，返回 `alreadyProcessed`
7. **重复覆盖**：`INSERT OR IGNORE` 替代 `INSERT OR REPLACE`
8. **点击不提交** → **必须两步：点「通过」→ 点「确认」**，只点「通过」不会提交

### 🔴 已修复的 Bug（2026-05-02 第二轮优化）

9. **review.mjs 批量审核在错误页面解析**：`ensureLoggedIn` 导航到旧首页 `/#/trip-app/homepage`，但审批列表在新 URL `/#/form-app/approval`。批量入口和循环内现在都显式 `page.goto(APPROVAL_LIST)`。
10. **extract.mjs 硬编码项目名**：`/视频平台代运营/` 正则只匹配一个产品线，已改为通用模式 `/(?:[A-Za-z]+平台)?代运营/` + 兜底 `项目名称：`。
11. **system_remark 截断**：`备注：xxx` 只捕获 1 行，已改为多行捕获（遇到「报销金额/通过/退回」停止），多行用 `；` 拼接。
12. **approve.mjs 死代码**：声明 `guide` 变量未使用，已清理。

13. **详情页类型误匹配**：侧栏导航「对公付款」菜单项污染了 `document.body.innerText`，导致类型匹配优先抓到「对公付款」而非「员工日常报销单」。修复：`text` 提取改为限定 `.ant-layout-content` 内容区；类型匹配正则移除「对公付款」「预算审批流程」。
14. **金额匹配缺漏**：实际格式为 `金额合计(CNY) 324.50`，旧正则只匹配 `报销金额(CNY)`。已补齐。
15. **部门截断**：旧正则 `/承担部门\\s*\\n\\s*\\d+\\s*[-–]\\s*([^\\n]+)/` 丢失部门编号前缀，已改为完整抓取 `承担部门\\s*\\n\\s*([^\\n]+)`。
16. **SPA 骨架渲染导致金额为 0**：点击行进入详情页时，SPA 先渲染骨架（金额=0.00），再异步加载真实数据。旧代码 `sleep(5000)` 后直接提取文本，抓到的是骨架。修复：重试循环（20×500ms），等 `金额合计` 后的数字 > 0 才认为页面就绪。

17. **DB schema 不兼容旧表**：`openDb()` 使用 `CREATE TABLE IF NOT EXISTS`，旧表缺 v3 增强字段（sub_type, approval_chain 等）导致 `recordApproval` 写入失败。修复：`openDb()` 新增自动迁移逻辑 — `PRAGMA table_info` 检测缺失列 → `ALTER TABLE ADD COLUMN`。
18. **DB 写入失败但审批已提交**：若 `recordApproval` 抛异常（如 schema 不兼容），审批点击实际已生效但无记录。修复：`try-catch` 包裹 DB 写入 → 失败时降级到核心字段重试 → 仍失败则输出 `manualFix` SQL。
19. **批量审核缺字段**：`review.mjs --batch` 输出缺少 `department` / `project`，需单独跑单笔才能看到。已补全。

### 🔴 已修复的 Bug（2026-05-02 第三轮：分摊明细）

20. **分摊明细丢失**：v3 `parseBillDetail` 只取第一个 department/project，丢失了多分摊结构。修复：新增 `parseAllocations()` 逐行解析明细模式，返回 `allocations[]`（dept_id, project_id, amount, ratio 等完整字段）+ 聚合 `deptAgg[]` / `projectAgg[]`。
21. **分摊解析只取到1条**：`if (!current) continue` 导致第二笔分摊后的 DEPT 行被跳过。修复：`current==null` 时检测 DEPT 行自动初始化新 current（category 复用上一条）。
22. **表头行/模式标签干扰**：`部门`/`项目`/`承担金额`/`汇总模式` 等行混入解析。修复：显式跳过这些行。

### 🔴 修复（2026-06-05：按钮/字段/幽灵）

26. **clickApproveAndConfirm 按钮定位太窄**：只搜 `button.ant-btn` + `"通过"`，不同单据按钮 class/text 不同 → 备用金/投流/预付款实际未批但误报通过。**修复**（`approve.mjs`）：3 层策略（ant-btn → ant-btn-primary → 模糊）+ 文本扩展（通过/同意/提交）+ button-not-found 硬退出。`--force` 重批已验证全部生效。
27. **parseBillDetail 字段漏提**（`extract.mjs`）：类型正则补 4 种（备用金/预付款/云账户/预算）、金额补借款/预付款、部门补借款部门、项目补单据项目。验证：备用金 type/amount/dept/project 全正确。
28. **幽灵单据过滤**（`navigate.mjs`）：新增 `--filter-ghosts`，交叉比对待审批/已审批 tab，标记 `ghost:true`。输出含 `realPending` / `ghostCount`。

### 🔴 已知行为：DB 写入失败手动补录模式（2026-06-02→06-03 持续确认）

23. **供应商结算单 / 供应商预付款 / 预算 / 员工备用金 DB 写入失败**：`review.mjs` 对上述四种类型返回 `type: undefined`，导致 `approve.mjs` 的 `recordApproval` 写入 SQLite 时 `bill_type` 字段绑定失败（`Provided value cannot be bound to SQLite parameter 2`）。**审批已生效**（`clickVerified=true`）但 DB 无记录。

**完整影响范围**（2026-06-03 批量 20 条审批确认）：

| 类型 | 触发样本 |
|---|---|
| 供应商预付款 | 张婷、叶龙 |
| 预算 | 姚齐纳涵、初智炜 |
| 员工备用金 | 石欣玉 ×2 |
| 供应商结算单 | 陈泽松（大额 ✅ dbSaved）、方彦博（零金额 ✅ dbSaved） |

> 注意：供应商结算单不总是失败——陈泽松 ¥52,500 和方彦博 ¥125 均 dbSaved=true。只有零金额/锁定编号的通过 button-not-found 路径正常写入。

**Agent 应对流程**：
1. approve.mjs 返回 `dbSaved: false` + `dbError: "Provided value cannot be bound..."` → 审批已生效
2. approve.mjs 同时输出 `manualFix` SQL
3. Agent **立即补录**：`sqlite3 /Users/wuliang/.hermes/data/cmb_approvals.db "INSERT INTO approvals(bill_id,bill_type,applicant_name,amount,action,approved_at) VALUES('<billId>','<正确类型>','<申请人>',<金额>,'agree',datetime('now','localtime'));"`
4. **批量补录**：多条 DB 失败时可合并为单条 `sqlite3` 命令用分号分隔，一次性补完

### 🔴 已知行为：零金额供应商结算单 button-not-found（2026-06-03 新增）

24. **零金额供应商结算单 clickMethod: button-not-found**：供应商结算单如果 review.mjs 解析为 amount=0，approve.mjs 返回 clickMethod: button-not-found 但 clickVerified: true + dbSaved: true。这是预期行为，不要判定为失败。

### 🔴 parseBillDetail 类型正则已同步（2026-06-05 修复）

25. **parseBillDetail 类型识别不全**（✅ 已修复）：`extract.mjs` 两处类型正则不同步。`parseBillDetail` 的 typeMatch（line 128）已补全为与 `VALID_BILL_TYPES`（line 15）一致：`合同用印|员工日常报销单|差旅报销单|供应商结算单|投流费用申请单|员工备用金|供应商预付款|云账户支付|预算`。

### 🆕 新增能力
- `review.mjs`：单笔/批量审核
- 分页支持
- 完整字段（审批链、费用明细、合同信息等）
- 9 条审核规则
- 两步提交机制（自动点击「通过」→「确认」）
- **GUIDE.md**：完整可复现操作链文档
- **分摊明细解析**：`parseAllocations()` 逐行解析明细模式，输出 `allocations[]` + 按部门/项目聚合（`deptAgg[]`, `projectAgg[]`）
- **DB 自动迁移**：`openDb()` 检测缺失列自动 `ALTER TABLE ADD COLUMN`

**新版页面适配（2026-05）**
| 项目 | 旧版 | 新版 |
|------|------|------|
| 审批列表 URL | `/#/trip-app/homepage` | `/#/form-app/approval` |
| 表格列数 | 5 列 | 31 列 |
| 列表提取 | td[0]=type, td[1]=applicant/date | td[1]=billId, td[3]=amount, td[4]=type, td[5]=applicant |
| 审批流 | 一步点击 | **两步**：通过 → 确认 |
| 确认按钮 | 无 | `button.ant-btn-primary.guideStepOperateOkButton`；弹窗确认也可能是「同意」而非「确认」（2026-06-16 发现）或 **「知道了」**（通知型弹窗，2026-06-25 发现）。详见 `references/dialog-variant-zhi-dao-le.md` |

## 登录态维护

- 薪福通 Cookie 在 opencli bridge 使用的 Chrome 实例中持久化。
- **opencli bridge 复用用户默认 Chrome 的 cookie 域**——在默认 Chrome 登录同样对脚本有效（已验证：用户 `open -a "Google Chrome"` 登录后 navigate.mjs 直接可用）。
- browser-harness（浏览器助手）与 opencli bridge **可能**独立（browser-harness 走 CDP 独立 session），但平时不用 browser-harness 版，无需关心。
- 如果返回 SESSION_EXPIRED，优先让用户在前台 Chrome 中手动刷新/登录——大部分情况 5 秒解决。
- 自动登录会填表+点击，但滑块验证码会阻断，**需用户在可见窗口中手动拖滑块**。

## 已知限制

### 🔴 三重验证硬规则（2026-06-22 实测总结）

`approve.mjs` 返 `success:true` **不等于审批已生效**。`dbSaved:true` **不等于列表已消除**。`navigate.mjs homepage` 返 pending 减 1 **不等于吴亮节点已完成**。

**判定真批成功必须三个信号同时满足**：
1. **DB 落地**：`SELECT FROM approvals WHERE bill_id=? AND action='agree'` 命中
2. **list 状态**：`navigate.mjs homepage` 的 `bills[]` 不含该 billId（**特殊**：吴亮是中间节点的预算/合同用印，列表保留是预期，不算失败）
3. **吴亮 taskStatus=COMPLETED, result=AGREE**（最权威）

**反例（2026-06-22 同日三起）**：
- X1 武欣荣 dou+ ¥20,000：单看 dbSaved=true 误报成功，实际弹窗点击未真提交
- X5 王子昕 ¥5,000：DB 已有 agree 但 list 仍显示（缓存未消），单看 list 误报没批
- X4 吴秋霞 ¥0 预算：opencli eval 兜底，list 消除但 DB 无记录（opencli 路径不写本地 DB）

**汇报模板**：每条审批汇报必须包含三项信号的具体值，**禁止只说"已通过"**。详见 `references/verify-rule.md`。

### 预算单批量批准的行级按钮模式（2026-06-22 实测）

`approve.mjs` 对 ¥0 预算单固定返 `BUTTON_NOT_FOUND`（按钮文字 `通 过` 带空格，approve.mjs 默认搜 `通过` 不带空格），但**主页行级「通过」按钮仍可点**（同样带空格的 `通 过`），且每点一次会弹确认对话框。

**最稳的批量模式**（已验证 4 单连过）：
- 不打开 budgetapprovaldetail 详情页，直接在 `/#/form-app/approval` 主页行内点「通 过」
- 每条单点完 sleep 3-4s 让弹窗出现，再点「确认」
- **不要**一次性循环点 4 条再统一点确认——弹窗会堆叠，挨个处理时序容易乱
- 每条用 IIFE 隔离变量：(function(){ const tr = ...; tr.click(); return 'X clicked'; })()

**禁止**：用 `navigate.mjs bill <budgetId>` 拿预算详情，navigate.mjs 显式不支持预算单。

### 连续 parseBillDetail 的 Page session 问题（2026-06-05 发现，已确认修复）

在同一个 `Page` 对象上循环调用 `parseBillDetail()` 时，只有第一条正常返回完整数据（department/project），后续调用返回空对象（`{subject:"", project:""}`）。

**根因**：`parseBillDetail` 通过点击 row 进入详情 → SPA 导航后返回列表页，Page 对象的导航状态可能未完全重置，导致后续 billId 的 row 搜索失败。

**确认有效的修复**：每单新建 `Page` 对象。已验证批量拉取 5 条详情全部成功返回完整数据：已验证批量拉取 5 条详情全部成功返回完整数据：
```js
for (const bid of ids) {
  const page = new Page('cmb-detail-' + bid.slice(-6));
  await ensureLoggedIn(page);
  const d = await parseBillDetail(page, bid);
  // ✅ 每条都正常返回 department/project/amount
}
```
不要尝试在同一个 Page 上循环复用——即使加 `sleep()` 等额外延迟也无效。

### 审核脚本依赖

- `review.mjs --batch` 会调用 `scripts/shared/dept-mapper.mjs`，再通过 `python3` + `openpyxl` 读取运营中心花名册做部门映射。
- 如果出现 `ModuleNotFoundError: No module named 'openpyxl'`，先执行：
  ```bash
  python3 -m pip install openpyxl
  ```
- 缺少 `openpyxl` 时审核仍可能继续跑，但部门映射会失败、输出大量 traceback，并显著拖慢批量审核；不要直接把这类结果当完整审核依据。

### 花名册路径失效噪音（2026-06-09 确认）

- dept-mapper 硬编码路径 `/Volumes/运营中心-SU/.../运营中心各部门花名册_20260125.xlsx` 可能因花名册更新/路径变更而失效，报 `FileNotFoundError`。
- **这是已知噪音，不影响审批执行**。`approve.mjs` / `review.mjs` / `navigate.mjs` 都会触发此 traceback，但核心数据（amount/type/applicant/project/allocations）仍然正常返回。
- Agent 在展示结果时忽略此噪音即可，不要汇报为"审批失败"或"需要修复"。
- 如需修复路径，在 `scripts/shared/dept-mapper.mjs` 中更新花名册路径。

### 展开详情颗粒度（2026-06-06 强化）

用户说「展开」时，**必须用 `navigate.mjs bill <billId>` 获取完整页面数据**，不做截断。返回字段含：部门全路径（L2→L3→L4）、分摊明细（category/dept/amount/ratio/tax）、审批链节点状态、费用类别、合同信息（合同用印专属）、项目归属。`review.mjs` 仅用于快速风险检查，项目/分摊解析不完整。

**差旅报销单专项注意**：差旅报销单的页面结构与员工日常报销单不同。`navigate.mjs bill` 可能返回 `project: null`，但分摊中的 `dept_name` 和 `dept_path` 字段有值。项目信息在差旅单中可能嵌入在事由描述中（如「海信电视赛里木湖出差」→ 项目可能为海信电视），需要结合花名册和部门归属向用户确认。合同用印的 `approvalChain` 同样可能为空。

### BILL_NOT_FOUND + session 健康 = 幽灵单据（2026-06-06）

当 `health.mjs` / `self-heal.mjs` 确认 session 正常，但 `approve.mjs` 和 `navigate.mjs bill` 都返回 BILL_NOT_FOUND，且 navigate.mjs homepage 列表中仍可见该单据 → **判定为幽灵单据**（根因 C）。不要继续重试，直接告诉用户「需手动处理」并跳过。

诊断工具：`node scripts/ghost-clear.mjs` 通过 opencli CDP 尝试硬刷新+清 storage+重导航，输出 pendingBefore/pendingAfter 供判断。已验证客户端手段无效（服务端数据一致性问题）。详见 [`references/ghost-clear.md`](references/ghost-clear.md)。

**重要修正（2026-06-10，2026-06-11 补充）**：`--filter-ghosts` 标记 `ghost:true` / `realPending=0` 只能说明该单同时出现在待审批/已审批数据面，属于缓存/数据面异常候选，**不等于一定不可审批**。处理规则：先 `navigate.mjs bill <billId>` 展开；如果详情页可打开且显示吴亮「审批中」/页面存在「通过→确认」按钮，在用户明确指定后可以尝试 `approve.mjs <billId> agree "同意"`，以点击返回 + 列表是否消除为准。只有 `approve.mjs` / `review.mjs` / `navigate.mjs bill` 均返回 `BILL_NOT_FOUND`，或详情页无审批按钮，才判定为不可处理幽灵，不再重试。已验证：多条 `ghost:true` 单据在用户明确指定后成功通过并从列表消除。

**幽灵行级审批补充（2026-06-11）**：部分幽灵单 `navigate.mjs bill` / 直接详情 URL 会跳回列表或页面底部残留 `系统异常！请联系管理员。` toast，但列表行本身仍有「通过/退回」按钮并可成功提交。不要仅凭 `document.body.innerText.includes('系统异常')` 判失败；应精确匹配当前 `billId` 所在 `tr.ant-table-row`，点击该行内按钮，再点「确认」。此路径已验证可处理：投流、供应商结算、员工报销等幽灵候选。

**幽灵行级按钮兜底（2026-06-11，2026-06-12 补充）**：若详情页/全页文本中有「系统异常」toast 残留，禁止用 `document.body.innerText.includes('系统异常')` 直接判定不可操作；薪福通页面还会出现「系统设置」等全页污染。正确做法是回到审批列表，按 `billId` 精确匹配 `tr.ant-table-row`，只在该行内找「通过」按钮并点击，再点弹窗「确认」。弹窗可能已经出现但 `opencli click <ref>` 后未提交，此时用页面内 JS 精确点击确认按钮更稳：`Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '确认')?.click()`，然后回查 `dialogExists=false` 且该 `billId` 从列表消失。详见 [`references/ghost-row-level-approval.md`](references/ghost-row-level-approval.md)。

### 🔴 统一双步确认弹窗回归（2026-06-26 实测覆盖全部类型）

**2026-06-18 曾观察到部分员工日常报销单走单步（无弹窗直接消除）。但 2026-06-26 实测 7 条（员工日常报销单 ¥72~¥371、云账户支付 ¥42,490.76）全部出现统一的确认弹窗。当前稳定行为是：所有类型均走双步（弹窗「确认」+ toast「同意成功」），不再有单步路径。**

实测弹窗内容（7/7 一致）：
```
同意
最近意见： 客户月权责在70W量级，较为关键。望领导批准
情况属实，项目较为特殊，望领导批复
[常用语] [上传图片] [上传附件]
[取消] [确认]
```

**硬规则**（2026-06-26 起强制执行）：
1. 点行内「通过」后 **必须 sleep 4s 等弹窗出现**，不要立即回查 row 是否消失
2. 弹窗 `.ant-modal` 出现 → 搜 `button.innerText.trim() === '确认'` 点击
3. sleep 3s → 回查 rows 不含该 billId → 成功
4. 如果 4s 回查 STILL → sleep 再 2s 重查（SPA 重排缓冲）

**逐步废弃**: 2026-06-18 的「单步判定流程」已失效。所有类型统一走双步，不存在「先等单步再降级」的优化路径。直接按双步执行。

**其他类型弹窗变种**：
- 合同用印→「知道了」弹窗（见下方独立章节）
- 预算 ¥0 → 按钮文字 `通 过` 带空格（见预算审批章节）

**旧样本保留供参考**（2026-06-18 曾出现过单步，但 2026-06-26 起不再复现）：
- 陈泽松 ¥168 日常报销 → 曾单步生效
- 陈诗云 ¥0 预算（billId 2026061763202065）→ 曾双步
- 陈诗云 ¥0 预算（billId 2026061863452498）→ 曾双步

### navigate.mjs bill 超时/SPA-skeleton 恢复（2026-06-25 实战）

当 `navigate.mjs bill <billId>` 超时（>30s）或返回 `amount: 0`（SPA 骨架渲染）时，**不要重试 navigate.mjs**——已知 供应商结算单 / 差旅报销单 类型可能连续超时或返回 skeleton 金额。

**恢复路径**（已验证 X6 方彦博 ¥3,748.75 供应商结算单 + X7 马羽霏 ¥480 差旅报销单）：

```bash
# 1. opencli 直接导航到详情页（绕过 Playwright Page 对象）
opencli browser cmb-nav open "https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=<billId>&viewType=APPROVE_PEND"
sleep 8    # Vue SPA 挂载需要时间

# 2. eval 提取关键字段
opencli browser cmb-nav eval "
(function(){
const t = document.body.innerText;
const lines = t.split('\n').filter(l => l.trim());
let result = {};
const pairs = [
  ['amount', /金额合计[^\\n]+\\n([\\d,\\.]+)/],
  ['type', /(员工日常报销单|供应商结算单|合同用印|差旅报销单|投流费用申请单|预算)/],
  ['dept', /承担部门[^\\n]+\\n([^\\n]+)/],
  ['subject', /事项标题[^\\n]+\\n([^\\n]+)/],
  ['supplier', /相对方[^：:]*[：:]([^\\n]+)/],
  ['contractPeriod', /合同有效期[^\\n]+\\n([^\\n]+)/],
  ['contractName', /合同名称[^\\n]+\\n([^\\n]+)/]
];
pairs.forEach(([k, re]) => {
  const m = t.match(re);
  if(m) result[k] = m[1].trim();
});
return JSON.stringify(result);
})()
"

# 3. 导航回审批列表页
opencli browser cmb-nav open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 6
# 验证
opencli browser cmb-nav eval "document.title + ' | rows=' + document.querySelectorAll('tr.ant-table-row').length"
```

**判定**：navigate.mjs bill 返 amount=0 不一定是 SPA 未加载——差旅报销单的 `金额合计(CNY)` 字段在骨架渲染后可能仍为 0。用 opencli eval 拿 `金额合计(CNY)` 后的数字最稳。navigate.mjs bill 返 project=null 时分摊明细的 `dept_name` 仍可能有值，不要仅凭 project=null 判为空。

**禁止**：
- 不要对超时 bill 反复重试 navigate.mjs → 单次超时后大概率连续超时
- 不要因为 amount=0 判定后端无数据 → 以列表 navigate.mjs homepage 的 amount 为准

### 已知行为：供应商结算单 toast 假阳性 → approve.mjs salvage（2026-06-23 新发现）

**症状**：opencli eval 行级点「通过」+ 弹窗「确认」+ toast「同意成功」出现，但 **row 持续不消失**（重试 3 次仍 STILL）。这与"点完行级按钮不等于真批成功"不同——toast 确实出现了，但后端未真接收。

**判定**：连续 2 次 toast=true + row STILL → 真未批。不要继续用 opencli eval 重试（每次都会重复同样的假阳性）。

**唯一有效 salvage**：
```bash
node scripts/approve.mjs <billId> agree '同意' --force --skip-preaudit
```
`approve.mjs` 走 Playwright Page 独立 context + Vue 多策略点击，对供应商结算单的详情页按钮匹配比 opencli eval 行级更可靠。

**已验证样本**（2026-06-23）：黄靖玮 ¥2,968 供应商结算单（billId 2026061562097669）——opencli eval ×3 全部 toast=true 但 row STILL；`approve.mjs --force --skip-preaudit` 一次成功（`ok=true clickVerified=true dbSaved=true`），DB 新记录 `04:31:17`，列表随后消除。

**当前行级路径对照表**（2026-06-26 更新：所有类型统一双步）：

| 路径 | 适用 | 弹窗 | toast | 真批硬信号 |
|---|---|---|---|---|
| 行级「通过」+「确认」双步 ✅ 当前标准 | **所有类型**（员工日常/差旅/供应商结算/投流/云账户/预算/合同用印/招待申请） | ✅ `.ant-modal` | 「同意成功」+ rows 减少 | 弹窗关闭 + toast + rows 不含该 billId |
| 行级「通过」+「知道了」变种 | 合同用印（部分） | ✅ `.ant-modal` 含「知道了」| 「同意成功」+ rows 减少 | 点「知道了」+ rows 不含 |
| 行级「通过」单步 ❌ 2026-06-26 后未再现 | 曾偶尔见于员工日常报销 | ❌ | 隐式消失 | DOM 重排后 billId 不再出现 |

**旧假设（已废弃）**：~~2026-06-18 到 2026-06-23 期间，普通报销偶尔走单步。2026-06-26 实测该模式已消失，全量归于双步。**直接按双步执行**，不要再先试单步再降级。~~

### 🔴 投流费用申请单：跳过 approve.mjs，但 opencli eval 行级 可行（2026-06-26 修正）

**`approve.mjs` 对投流费用申请单 100% 返 `BUTTON_NOT_FOUND`**（详情页结构差异）。已验证多条全部如此，不是偶发。**一旦从 `navigate.mjs homepage` 确认类型为「投流费用申请单」，不要走 approve.mjs 详情页路径**。重试 approve.mjs 只会多浪费 30-60s 并产出 `BUTTON_NOT_FOUND`。

**修正结论（2026-06-26 实战）**：本会话 X11(陈祎楠 ¥7,476.64) + X2(沈煜 ¥1,980.20) 投流单都通过 **opencli eval 主页行级 + 弹窗「确认」双步** 成功。**投流 主页行级 走与普通报销相同的双步路径**，不依赖详情页结构。

**正确路径**（按优先级）：
1. ✅ `opencli browser <s> eval` 主页行级 click「通过」 + 弹窗「确认」（本会话验证）
2. ❌ `navigate.mjs bill <投流billId>`（结构差异，常 timeout）
3. ❌ `approve.mjs <投流billId>`（100% BUTTON_NOT_FOUND，详情页按钮找不到）

**完整脚本示例**见 `references/opencli-eval-fallback.md`「🆕 投流费用申请单 — opencli eval 行级 可行」章节。

**重要修正（2026-06-26）**：上述规则仅在 opencli eval 路径**正常工作**时成立。当 opencli eval 路径出现「操作异常-没有权限」弹窗（详见 `references/permission-error-modal.md`）→ **降级到 `approve.mjs --force --skip-preaudit`**，Playwright Page 路径对投流单的按钮匹配仍能成功（已验证 X2/X3 沈煜 ¥1,980.20 / ¥9,900.99）。

### 🔴 行级回查的「4s 假阳性」窗口（2026-06-23 实测，2026-06-24 实战校验）

行级「通过」+ 弹窗「确认」点完，**第一次 eval 回查（sleep 4s 后）可能返 `STILL_THERE`，但实际已批**——SPA 短暂重排 + 行未及时从 DOM 移除。整个会话已验证 20+ 单，约 10% 出现此模式。

**判定流程修正**：
1. 第一次回查 `STILL_THERE` → **不要**立即重试（可能实际已批 = SPA 重排）
2. 重新 sleep 2s + eval 重查一次（总等待 ≈ 6-7s）→ 真 GONE = 已批；STILL = 弹窗没消/未生效
3. 第二次仍 STILL → 检查 `.ant-modal` 是否还在；如已消但行仍存 → 真未生效，重走行级「通过」+「确认」
4. 仍 STILL 且 modal 已消 → `approve.mjs <billId> agree --force --skip-preaudit` 兜底

**禁止**：
- 不要 sleep 4s 看到 STILL_THERE 就重批 → 双批风险
- 不要 sleep 8s+ 单次回查 → 浪费 token
r1=$(opencli browser $SESS eval "...find row by billId... return tr?'STILL':'GONE'")
[ "$r1" = "GONE" ] && echo "OK @ 4s" && exit 0
sleep 2  # 总 6s
r2=$(opencli browser $SESS eval "...")
[ "$r2" = "GONE" ] && echo "OK @ 6s (was SPA重排 at 4s)" && exit 0
echo "真未生效 - 检查弹窗状态 + 重试"
```

**禁止**：
- 不要 sleep 4s 看到 STILL_THERE 就重批 → 双批风险（DB 写两条 + 实际只通过一次）
- 不要 sleep 8s+ 单次回查 → 浪费 token

### 🔴「点完行级按钮」不等于「真批成功」（2026-06-18 实测补充）

**坑**：第一次点行级「通过」按钮后，DOM 短暂 reload 导致 `tr.innerText.includes('<billId>')` 返回 false，但**实际只是 DOM 重排，审批未真生效**——单凭「行消失」就报"已批"会误判。后续重批时同 row 仍在（因为第一次没真批出去），如果不信再点一次「通过」+「确认」+ 看到 `同意成功` toast，才是真批。

**opencli tab vs Playwright Page 双 context 坑**（2026-06-22 实测）：`navigate.mjs` 走 Playwright Page，opencli bridge 是另一个 tab。navigate.mjs 跑完后 opencli tab 仍卡 `about:blank`，直接 eval 返 0 rows。必须 `opencli browser <s> open <url>` + `sleep 6` 重写 URL 等 SPA 挂载，不要靠 `location.reload()`（SPA 没挂载时 reload 也无效）。详见 [`references/ghost-row-level-approval.md`](references/ghost-row-level-approval.md) 「opencli tab vs Playwright Page」章节。

**opencli eval 共享 JS context 坑**（2026-06-22 实测）：连续两次 eval 用 `const tr = ...`，第二次会 SyntaxError "Identifier 'tr' has already been declared"，返回的 `'clicked'` 实际是上一轮缓存。用 IIFE 包起来避免顶层 `const` 重复。详见同 reference 章节。

**同一 billId 列表残留判定坑**（2026-06-22 实测）：A 轮点行级通过后 billId 仍在 `navigate.mjs homepage` 列表里，B 轮要先查 DB `SELECT FROM approvals WHERE bill_id=<bid>` 确认落地，DB 有记录 = 列表缓存不要重批；DB 无记录 = 真未批重走行级。详见同 reference 章节。

**真批的硬信号**（满足全部才算生效）：
1. 点击行级「通过」按钮后 `sleep 4` 内 DOM row **再次刷新后** 仍不包含该 billId（SPA 短暂重排不算消失）
2. **弹窗出现** `.ant-modal` 且点「确认」后 toast `同意成功` 出现（即使无弹窗也要 toast 才算）
3. 或：新版本直接无弹窗情况下，必须同时验证 toast `同意成功` 出现 + 列表最终不含该 billId

**误判反例**（本次踩坑）：单次点完报"已批，rows 12→11"，实际是 DOM 重排误判，第二次跑时 row 还在，能再次点击「通过」并出现弹窗+「同意成功」toast——才确认真批。

**新症状（2026-06-18 第 7 条 ¥258.90 吴祝昱实测）**：点行级「通过」后 eval 报 `NO_DIALOG`(无 `.ant-modal`)，紧接着再 eval 发现 `document.querySelectorAll('tr.ant-table-row').length === 0`(整页 rows 清空)。这**不是 DOM 重排**——是 SPA 把整个列表组件卸载了(可能跳转到别处或挂起渲染)。这也不是真批。

**根因**：行级按钮点击触发了 SPA 路由切换或组件卸载，但审批提交本身没完成(可能等用户后续操作或后端超时未响应)。此时 `navigate.mjs homepage` 回查会发现该 billId 仍留在待审批列表(rows 数没真正减少)，证明未真批。

**恢复流程**：
1. **不要重试**「通过」按钮——SPA 状态已污染
2. 跑 `node scripts/self-heal.mjs` 确认 session 正常(避免误判为登录过期)
3. 跑 `node scripts/navigate.mjs homepage` 走 Playwright Page 重新渲染 SPA
4. 验证 `opencli browser <s> eval "document.querySelectorAll('tr.ant-table-row').length"` > 0 + `location.href` 含 `/form-app/approval`
5. 用 `navigate.mjs homepage` 输出对比上一轮 rows:该 billId 仍在 → **未批**,需重走行级「通过」+「确认」+ toast 三件套
6. 该 billId 已消失 → 已批(这种 SPA 卸载有时碰巧真提交成功)

**保险做法**:行级点完按钮,无论 DOM 是否短暂清空,**sleep 5s 后必须用 `navigate.mjs homepage` 回查**(而不是 opencli eval),才能拿到权威状态;opencli eval 看的是当前 tab 状态,SPA 卸载时 tab 内容已不可信。

### 🔴 主页行级「操作」按钮非「通过」 = 页面在错误 tab（2026-06-23 新增）

**症状**：opencli eval 行级按钮 `tr.querySelectorAll('button')` 返 `["操作"]` 而不是 `["通过","退回"]`，且 `location.hash` 是 `#/trip-app/homepage` 而非 `#/form-app/approval`。

**根因**：SPA 页面导航到了旧版首页（`/#/trip-app/homepage`），该页面视图只展示各类型汇总 tab 的文字描述，没有审批操作按钮。

**恢复流程**：
```bash
SESS=cmb-nav
opencli browser $SESS open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 6
# 验证挂载
opencli browser $SESS eval "document.title + ' | rows=' + document.querySelectorAll('tr.ant-table-row').length + ' | hash=' + location.hash"
# 确认按钮文本
opencli browser $SESS eval "Array.from(document.querySelectorAll('tr.ant-table-row')).slice(0,1).map(tr => Array.from(tr.querySelectorAll('button')).map(b=>JSON.stringify(b.innerText.trim())).join(','))"
# 应返 "通过","退回"
```

**预防**：每次 `opencli browser <s> eval` 操作行级按钮前，先检查 `location.hash` 是否含 `/form-app/approval`：
```bash
HASH=$(opencli browser $SESS eval "location.hash" 2>&1 | tail -1)
if ! echo "$HASH" | grep -q "form-app/approval"; then
  # 导航修复
fi
```

**禁止**：
- 不要看到「操作」按钮就判定页面改版/不可操作——99% 是 tab 错了
- 不要重试 opencli eval——hash 不对时重试 100 次也一样
- 不要用 `location.reload()`——SPA 在错误路由上 reload 也无效

**纠正 skill 旧假设**：本会话实测发现**预算单在主页审批列表中**也有行级「通过」/「否决」按钮（与普通报销相同位置），不是 skill 旧描述说的「没有行级按钮」。

**重新验证的口径**（按 billId 精确匹配行 + 该行内找按钮）：
```js
const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('<billId>'));
const btn = Array.from(tr.querySelectorAll('button')).find(b => b.innerText.replace(/\s+/g,'') === '通过');
btn.click();
### 🔴 预算单行级从主页列表通过（2026-06-24 验证为主路径）

**已修正旧假设**：预算 ¥0 单（subType=业务部门负责人）的「通 过」按钮在主页审批列表 `/#/form-app/approval` 的行内即有，**不需要**跳转详情页。本会话 4 条预算单全部从主页行级成功通过。

**操作**（与普通报销相同流程，只是按钮文本用空格正则）：
```bash
# 1. 定位行，按钮正则匹配
eval "Array.from(tr.querySelectorAll('button')).find(b => {
  const t = b.innerText.replace(/\\s+/g,'');
  return t==='通过' || (t.includes('通') && t.includes('过'));
})"
# 2. 通过 → sleep 4 → 确认 → sleep 4 → 回查 row 消失
```

**按钮文本差异**：预算 `"通 过"`（中间空格），非预算 `"通过"`（无空格）。用 `includes('通') && includes('过')` 统一匹配。

**通过后列表消除**：本会话实测预算单通过后 row 直接从列表消除（吴亮是最后节点）。旧假设「预算通过后列表不消除」不总是成立——取决于预算审批链长度。以实际 row 是否消失为准。

**降级路径**：主页行级失败（无弹窗/row 不消失）时，才走详情页 `/#/budget-app/budgetapprovaldetail?billId=<id>&viewType=APPROVE_PEND` 兜底。

> **历史陷阱未消**：如果主页行级「通过」单步路径不通（rows 不减少 + 无 toast），**再降级**到预算详情页：
>
> `/#/budget-app/budgetapprovaldetail?billId=<id>&viewType=APPROVE_PEND`
>
> 按文本归一化（去空格）匹配 `通 过`，再点弹窗 `确认`。每条预算单用独立 Page 对象 + URL 追加 `&_=${Date.now()}` 防 SPA 缓存污染（详见 `references/budget-approval.md`）。

### 🔴 按钮文字空格坑（2026-06-08 发现，已验证）

**薪福通预算审批页面的按钮文字是 `通 过`（中间有空格），不是 `通过`！**

- ❌ `b.innerText.trim() === '通过'` → 永远找不到
- ✅ `b.innerText.includes('通') && b.innerText.includes('过')` → 正确匹配
- 同样 `否 决`、`确 认` 也有空格

**影响范围**：预算审批页本身。`approve.mjs` 的普通按钮策略可能仍漏掉预算页，因为它默认匹配 `通过/同意/提交`，预算按钮实际为 `通 过`。预算单若普通 `approve.mjs` 返回未生效或列表不消除，必须改用预算专用 Page/opencli eval 兜底：直接打开 `/#/budget-app/budgetapprovaldetail?billId=<id>&viewType=APPROVE_PEND`，按文本归一化（去空格）匹配 `通 过`，再点弹窗 `确认`。

**预算详情提取**：`navigate.mjs bill` 不支持预算单类型。预算详情需走独立 Page 会话打开 `/#/budget-app/budgetapprovaldetail?billId=<id>&viewType=APPROVE_PEND` 手动提取文本。参见 [`references/budget-approval.md`](references/budget-approval.md)（含 SPA 缓存污染修复、审批链差异、解析流程）。

**批准后列表不消除**：预算单吴亮节点通过后，待审批列表仍可能显示该单——这是预期行为（后续有财务/CFO/CEO 节点）。判定标准以回查详情页吴亮节点是否变为「已通过」为准，不是以列表消除为准。

**SPA 缓存污染**：同一个 Page 会话连续打开不同预算单详情时，页面可能显示上一单的数据（已验证申请人字段错乱）。修复：每条预算单用独立 Page 对象 + URL 追加 `&_=${Date.now()}` 时间戳防缓存。详见 [`references/budget-approval.md`](references/budget-approval.md)。

**已验证样本**（2026-06-08）：邱靖雯、程舒敏、王适、江小玲 四条预算 ¥0 单据，页面按钮均为 `通 过`。

### 批处理效率技巧

- **小额单据（< ¥1,000）**：吴亮通常直接通过，无需 `review.mjs` 展开详情
- **零金额预算单**：展开确认项目归属后即可通过
- **新类型首次出现**：须展开详情核实（供应商预付款、云账户支付等类型在 DB 写入时可能因类型未注册而失败，但 clickVerified=true 即审批已生效）
- **token 过期**：长会话中钉钉 token 可能过期，跨系统切换时需刷新

### 钉钉 DM 表格渲染（2026-06-06）

Hermes 适配层到钉钉 DM 的 markdown 表格渲染不可靠。展示审批列表表格时，用 `dws chat message send --user 2267566123688378 --title "审批列表" --text "..."` 走钉钉原生 IM API 发送，绕过适配层。简短回复（无表格）仍走 Hermes 默认通道。

### 大列表分层呈现（≥10 条时启用）

当待审批列表 ≥10 条时，按金额降序排列后平铺展示，不拆成 🟢🟡🔴 子组（用户偏好：平铺 flat table，见 `approval-workflow` skill「展示格式」章节）。

格式参考（flat table，不分层）：

```
| # | 申请人 | 类型 | 金额 | 事由 |
|---:|--------|------|----:|------|
| X1 | 黄靖玮 | 供应商预付款 | ¥300 | 6.22投屏器1台预付 |
| X11 | 武欣荣 | 云账户支付 | ¥21,165.43 | 运营四部外协云账户 |
...

共 N 条 | 合计 ¥XXX | 说编号操作
```

### 🔴 navigate.mjs bill 后 tab URL 漂移（2026-06-24 实战）

`node scripts/navigate.mjs bill <billId>` 跑完后，opencli tab 的 URL 会停留在详情页（`/#/budget-app/budgetapprovaldetail?billId=...` 或 `/#/trip-app/billDetail?billId=...`），**不再指向审批列表页**。此时如果直接用 opencli eval 做行级通过操作，会找不到 rows（因为页面不再是审批列表）。

**恢复流程**：
```bash
opencli browser cmb-nav open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 6
# 验证挂载
opencli browser cmb-nav eval "document.title + ' | rows=' + document.querySelectorAll('tr.ant-table-row').length + ' | hash=' + location.hash"
```

**预防**：在执行 opencli eval 行级操作前，总是先检查 `location.hash` 是否含 `/form-app/approval`。
**禁止**：不要因为行级操作找不到 rows 就判定 session 过期或单据不可操作——先检查 URL。

- **审批是两步操作**（2026-05-02 实测）：点击「通过」(ref:191) → 点击「确认」(ref:285)。只点一步不会提交。详见 [页面结构参考 v2](references/cmb-page-structure-v2.md)。
- **页面结构已变更**：待审批列表从旧版 5 列变为 31 列 `ant-table-row-level-0`，旧 parser 不适用。详见 [页面结构参考 v2](references/cmb-page-structure-v2.md)。
- **登录可能触发滑块验证码**：opencli 无法自动拖拽滑块，需用户手动完成。详见 [登录流程参考](references/login-flow.md)。
- **登录按钮改为 div**（2026-05-27 确认）：登录按钮从 `<button>` 变为 `<div data-x-track-id="密码-登录" class="PasswordLogin_loginBtn__yuCsm">`。`session.mjs` 已适配：表单检测 + 点击逻辑兼容 div 形式（MouseEvent 触发 + `btn.click()`）。但点击后仍触发滑块验证码阻断。
- **HOMEPAGE ≠ APPROVAL_LIST**：`session.mjs` 的 `HOMEPAGE` (`/#/trip-app/homepage`) 仅用于登录态检测；实际审批列表在新 URL `APPROVAL_LIST` (`/#/form-app/approval`)。`ensureLoggedIn` 后必须显式 `page.goto(APPROVAL_LIST)` 才能解析列表。
- 审批链解析依赖页面文本格式，格式变化时可能不完整
- 批量审核逐笔翻详情，耗时与待审批数量成正比
- **SPA 异步加载**：详情页先渲染骨架（金额=0.00），再异步填充真实数据。`parseBillDetail` 内置重试循环等 amt>0，最长 10s。
- **投流费用申请单金额解析异常**：review.mjs 对投流单的金额解析可能抓到骨架（列表显示 ¥9,345.79 但详情为 0）。原因：投流单的金额字段格式（`总计金额（CNY）`）不同于报销单（`报销金额(CNY)`），导致重试循环检测的金额字段不匹配，始终认为页面未就绪。→ 需适配 `总计金额` 正则。
  - **投流费用申请单受影响**（2026-05-03 实测）：详情页 amt=0、project=null、allocations=[]，但列表显示 ¥9,345.79。需同样走重试逻辑。
  - **投流费用申请单金额小数/个位数误解析（2026-06-15 复现）**：列表显示大额投流（如 ¥40,000 / ¥18,691.59），`approve.mjs` / 预审摘要可能输出 `amount: 7`，但点击审批仍可成功（`clickVerified=true` / `dbSaved=true`）。展示与决策时以 `navigate.mjs homepage` 列表金额为准，并在回报中说明“详情/预审金额解析异常，以列表金额为准”；不要因为 `amount: 7` 把大额投流误归为小额。
  - **browser-harness 版不受影响**：直接从 `document.body.innerText` 抓文本，等页面完全加载后再抓。
- **browser-harness 版与 opencli 版登录态**：opencli bridge 复用用户默认 Chrome 的 cookie，两者实际互通（已验证）。`open -a "Google Chrome"` 登录后脚本直接可用。browser-harness 走 CDP，可能独立，但不常用。
- **分摊明细默认汇总模式**：详情页默认只显示合并后的 department/project，丢失多分摊信息。需切到「明细模式」才能看到所有分摊行。v3 仅抓首个 department/project。详见 [references/allocation-detail-mode.md](references/allocation-detail-mode.md)。
- **已审批单据无法直接 URL 访问**：`/trip-app/billDetail?billId=...` 对已批单据返回「系统异常」。需从审批列表点击「已审批」tab → 点击行进入。
- **审批通过后可能还有后续节点**：吴亮审批通过不代表整个审批流结束（如后续有财务初审、CFO 等节点）。需检查审批链完整状态。
- **VALID_BILL_TYPES 白名单可能遗漏新单据类型**：`extract.mjs` 的 `VALID_BILL_TYPES` 正则定义了已知审批类型，薪福通新增类型（如 2026-05-31 遇到的「员工备用金」）会被静默过滤。**症状**：`navigate.mjs homepage` 返回 `pending>0, bills=[]` 且 `review.mjs --batch` 返回 0 条。**修复**：在 `extract.mjs` 第 15 行正则末尾追加 `|新类型名`。当前完整白名单见 [references/type-whitelist.md](references/type-whitelist.md)。**2026-06-26 新增已知类型**：`招待申请单` —— navigate.mjs 列表返回 `pending=14, bills=13`（白名单缺此类型），需在 `VALID_BILL_TYPES` 正则末尾追加 `|招待申请单`。
- **`.ant-card` 选择器在部分页面版本中失效**（2026-05-31 实测）：`parseHomepageBills` 优先在 `.ant-card` 含「待审批」标题的卡片内查找 `tr.ant-table-row`，但当前页面已无 `.ant-card` 元素（`cardInfo: []`）。实际生效的是全局回退 `document.querySelectorAll('tr.ant-table-row')`。若未来全局选择器也失效，列表提取会完全中断。
- **员工备用金详情解析异常**（2026-05-31 实测）：`review.mjs` 对员工备用金类型解析失败（类型错误、金额错误、事由丢失、部门 null）。优先级信任 `navigate.mjs` 列表数据。详见 [references/employee-reserve-fund-parsing.md](references/employee-reserve-fund-parsing.md)。
- **`review.mjs --batch` 偶发返回 0 条**（2026-05-31 实测）：`navigate.mjs homepage` 正常返回 pending bills，但紧接着 `review.mjs --batch` 返回 `total:0`。根因：列表页 SPA 异步渲染——`parseHomepageBills` 在 `tr.ant-table-row` 渲染完成前执行，抓到空 DOM。**修复**：重试一次即可（`review.mjs --batch` 重跑通常能正常解析）。单笔 `review.mjs <billId>` 不受影响（直接跳详情页，不走列表解析）。与 bug #16（详情页骨架）同属于 SPA 时序问题——区别是这次出在列表页而非详情页。

## 诊断：pending>0 但 bills=[]

当 `navigate.mjs homepage` 返回 `{"pending":N,"bills":[]}` 时，按以下顺序排查：

**0. 先跑诊断脚本，区分类型/时序问题**（强制第一步）：
```bash
node scripts/_debug_parse.mjs
```
- 如果 `matched==total && mismatched==0` → **不是白名单问题，是 SPA 时序**。跳转到步骤 3（重试即可，通常一次就够）。
- 如果 `mismatched>0` → 是白名单遗漏，进入步骤 1。
- 如果 `matched==total && mismatched==0` → **不是白名单问题，是 SPA 时序**。跳转到步骤 3（重试即可，通常一次就够）。
- 如果 `mismatched>0` → 是白名单遗漏，进入步骤 1。

1. **类型白名单遗漏**：`mismatchedTypes` 中的类型不在 `VALID_BILL_TYPES` 中。在 `extract.mjs` 第 15 行正则末尾追加 `|新类型名`。详见 [references/type-whitelist.md](references/type-whitelist.md)。
2. **`.ant-card` 选择器失效** + 全局回退也失败：页面结构大改，`tr.ant-table-row` 不再存在。运行 `node -e "..." querySelectorAll` 验证 DOM。
3. **SPA 异步渲染时序**（`_debug_parse` 全匹配但 navigate 返回空时）：列表页 SPA 先渲染空 DOM，`parseHomepageBills` 抓到了空的 `tr.ant-table-row`。**直接用 `_debug_parse.mjs` 展示列表**，不要再重试 navigate。后续 `review.mjs <billId>` 和 `approve.mjs <billId>` 不受影响（走详情页而非列表解析）。
4. **登录态过期**：`pending` 仍可能从缓存 DOM 读取到旧数据——先确认 `SESSION_EXPIRED` 未出现。

### Health check `title:""` 灰色地带

`node scripts/health.mjs` 返回 `{"ok":true,"title":""}` 是**已知无害状态**——桥接正常、daemon 响应，但页面 title 未被抓取（可能是导航后未充分等待、或 HOMEPAGE 重定向中）。这不影响后续 `navigate.mjs homepage` 或 `review.mjs` 的执行。不要仅凭 `title:""` 就判定 session 过期。

## 诊断：列表有单但 review/approve 返回 BILL_NOT_FOUND（2026-06-03 新增，2026-06-05 更新）

当 `navigate.mjs homepage` 正常返回 bills，但对某条 `review.mjs <billId>` 或 `approve.mjs <billId>` 返回 `BILL_NOT_FOUND` 时，有两种根因：

**根因 A（最常见）**：登录态过期/部分失效——列表页可能缓存或 SPA 部分渲染，但详情页 URL 需要有效 session。

**根因 B（2026-06-05 新发现）**：单据已审批完成，但 SPA 列表缓存未刷新。`parseBillDetail` 点击 row 进入详情后搜不到「通过」按钮 → 误报 BILL_NOT_FOUND。已验证样本：张志娟 ¥8,858 (2026060257501211)、付蓉 ¥22,500 (2026051952883569)、张志娟 ¥29,187 (2026052053248008)——直接 URL 导航确认审批链节点全部「已通过」。

**根因 D（2026-06-09 新发现）**：approve.mjs 对**全部单据**返回 BILL_NOT_FOUND，但 session 健康检查全部正常（self-heal 报告 SESSION_VALID，opencli doctor 全绿），navigate.mjs homepage 列表可见。这是 approve.mjs 内部导航/解析逻辑与当前薪福通页面的兼容性问题，不是 session 过期。**唯一解法：放弃 approve.mjs，改用 opencli eval 逐条直接导航+点击。**
→ 详见 [`references/eval-batch-workflow.md`](references/eval-batch-workflow.md)

**排查顺序**：
1. 运行 `node scripts/health.mjs` — 如果 `ok:true` 但 `title:""`，登录态可能处于灰色地带
2. 尝试 `node scripts/navigate.mjs bill <billId>` — 同样返回 `BILL_NOT_FOUND` 可确认是 session 问题
3. **🆕 直接 URL 导航诊断**（区分根因 A vs B，绕过 row-click 逻辑）：
   ```js
   await page.evaluate(`window.location.hash = '#/trip-app/billDetail?billId=${billId}&viewType=APPROVED&reserveTab=true'`);
   await sleep(4000);
   const text = await page.evaluate('document.body.innerText');
   // 如果 text 含「已通过」且无「通过」按钮 → 根因 B，单据实际已批
   // 如果 text 含「系统异常」或空 → 根因 A，登录态过期
4. 用 `node scripts/review.mjs --batch` 交叉验证——如果批量审核也全部失败，登录态已彻底过期

**根因 A 修复**：
```bash
open -a "Google Chrome" "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
```
用户手动登录后脚本即可恢复。

**根因 B 修复**：无需操作——单据已审批完成。使用 `navigate.mjs homepage --filter-ghosts` 可自动标记幽灵单据（交叉比对待审批/已审批两个 tab）。

**根因 C（2026-06-06 新增）**：批量操作中**部分成功、后续连续 BILL_NOT_FOUND**，但 session 健康检查正常。这是幽灵单据——不在待审批数据面，不是 session 超时。判定方法：数字验证（pending 减少量 = 成功批完条数）、health check、approve.mjs 对同一单也返回 BILL_NOT_FOUND。
→ 详见 [`references/batch-session-vs-ghost.md`](references/batch-session-vs-ghost.md)

## OpenCLI Bridge 断连恢复流程

当 `opencli doctor` 显示 `Extension: not connected` 时：

1. `opencli daemon stop`
2. `opencli doctor` — 如果扩展仍不连 → 第 3 步
3. 打开 `chrome://extensions`，找到 **OpenCLI** 扩展 → **关闭再打开**（强制重连 WebSocket）
4. `opencli doctor` 验证 `Extension: connected`
5. 如扩展消失 → 重新加载解包的扩展目录

仅 `opencli daemon stop && opencli doctor` 不足以修复扩展断连（daemon 会自动重启但扩展可能处于崩溃状态）。

**执行验证优先级（2026-06-12 补充，2026-06-16 强化）**：`approve.mjs`/预审模块可能返回 `PREAUDIT_BLOCKED`，或 `--force` 后出现 `ok:false` / `clickVerified:false` 但 `clickMethod` 显示已点击「通过→确认」且 DB 写入成功。此时不要只按脚本 JSON 判失败；必须立即重新拉 `navigate.mjs homepage --filter-ghosts` 或 opencli 列表，若该 `billId` 已从待审批列表消失，则按“用户节点已处理/列表已消除”汇报。用户已明确说“过/通过”的单据，预审阻断不等于禁止执行；可在明确授权范围内用 `--force` 或行级按钮兜底，但仍只处理指定 billId。

**日志截断坑**：执行审批时不要用 `| head`/截断输出作为成功依据，`approve.mjs` 的最终 `ok/clickVerified/dbSaved/PREAUDIT_BLOCKED` 常在后半段；若为了降噪截断了日志，必须随后按 billId 回查 homepage 列表，未消除的指定单据要读取完整输出并按上条规则处理。

**"ok:false 但 alreadyProcessed:true" 反直觉信号（2026-06-18 实测确认）**：`approve.mjs <billId> agree --force --skip-preaudit` 在以下三种情况都可能返回 `ok:false`，但**实际已批成功**：
1. **前次批过 + SQLite 已有记录** → `ok:true` + `alreadyProcessed:true`（正常）
2. **批流程异常被截但 DB 已写** → `ok:false` + `clickVerified:false`，但 SQLite 仍有新记录
3. **重试命中 SQLite 缓存** → `ok:false` + `alreadyProcessed:true`（如武欣荣 2026061762930072 案例：首轮 `ok:false`/`clickVerified:false`，ghost-clear 后再批返 `ok:true,alreadyProcessed:true,approvedAt` 完整）

**判定真失败的硬信号**（满足任一才算没批成功）：
- `ok:false` + `clickVerified:false` + SQLite 无该 billId 记录
- `error: BILL_NOT_FOUND` + SQLite 无记录
- `BUTTON_NOT_FOUND`（零金额预算页等特殊情况除外，详见上方 24 号）
- 列表 `navigate.mjs homepage` 回查时该 billId 仍在待审批列表

**实战判定流程**：
```bash
# 1. 跑批（不用 grep 判 ok，单看 SQLite 落地）
node approve.mjs <billId> agree --force --skip-preaudit 2>&1 | tail -3

# 2. SQLite 回查（最权威）
sqlite3 ~/.hermes/data/cmb_approvals.db "SELECT approved_at, action FROM approvals WHERE bill_id='<billId>';"

# 3. 列表回查（最直观）
node navigate.mjs homepage | jq '.bills[] | select(.billId=="<billId>")'
# 返回空 → 已消除 = 成功；返回还在 = 真失败
```

**grep 解析反逻辑坑（2026-06-18 实测）**：批处理中常见 `out=$(node approve.mjs ... | grep -E '"ok":|...')`，然后 `if echo "$out" | grep -q '"ok":true'` 判定。但 `approve.mjs` 输出多行 JSON 时（同时含 `ok:false` 的中间字段 + `clickVerified:true`/`alreadyProcessed:true` 的尾部字段），grep 抓到 `"ok":true` 反而漏报真失败；反之 grep `"ok":false` 也会匹配到 OK 输出中的告警字符串。**正确做法**：不要 grep 判 ok，直接 SQLite 查记录 + 列表回查 billId 是否消除。

**批处理 timeout 切割坑（2026-06-18 实测）**：单 shell 循环跑 20+ 条 `approve.mjs` 时，terminal 默认 5min 超时可能切断在第 10-15 条，导致前面已批但后续没跑。**对策**：分批跑（如 8 条/批），每批结束跑 `sqlite3 ... WHERE approved_at > datetime('now','-5 minutes')` 验落地数。

## 参考文档

- **GUIDE.md** — 完整可复现操作链（登录→导航→解析→审批→验证）
- **SPEC.md** — v3 优化规格书
- **SPEC-V4.md** — v4 计划：完整字段提取 + 费用分摊 + 部门/项目聚合
- [页面结构参考 v2](references/cmb-page-structure-v2.md) — 31 列表格、登录流程、审批按钮结构、opencli 命令速查
- [分摊明细模式 vs 汇总模式](references/allocation-detail-mode.md) — 🆕 详情页分摊的两种显示模式，决定能否完整提取部门/项目/金额
- [页面结构参考（旧版）](references/cmb-page-structure.md) — 5 列表格（可能已过时）
- [OpenCLI Bridge 诊断](references/opencli-bridge-troubleshooting.md) — daemon↔扩展 断连修复流程
- [批量行级 click 实战 (2026-06-22)](references/batch-row-click-2026-06-22.md) — 4 单连续行级「通过」+ 弹窗堆叠循环确认完整序列
- [错误目录](references/error-catalog.md) — 完整错误码索引
- [BILL_NOT_FOUND 直接 URL 诊断](references/bill-not-found-direct-url-diagnosis.md) — 🆕 区分「登录态过期」vs「已审批但列表缓存」的诊断脚本 + 判定逻辑
- [单据类型字段标签映射](references/bill-type-field-mapping.md) — 🆕 不同单据类型（备用金/预付款/投流等）的字段标签差异对照表 + parseBillDetail 类型正则同步规则
- [类型白名单诊断](references/type-whitelist.md) — 🆕 VALID_BILL_TYPES 白名单 + pending>0 bills=[] 排查
- [SPA 时序诊断](references/spa-timing-diagnosis.md) — 🆕 `_debug_parse.mjs` 全匹配但 navigate 返回空的根因：SPA 异步渲染时序，重试即可
- [幽灵单据诊断与清理](references/ghost-clear.md) — 🆕 ghost-clear.mjs 脚本说明 + 判定流程 + 结论（客户端无解）
- [审批工作流模式](references/approval-workflow-patterns.md) — 🆕 吴亮审批决策习惯 + shell脚本坑（UID只读变量、token安全过滤）
- [复合指令处理](references/compound-instructions.md) — 🆕 "展开+通过"混合指令的并行处理模式
- [复合指令 + 预算单 eval 审批验证补充](references/compound-budget-verify-2026-06-12.md) — `1234通过5展开` 这类指令中，预算单 `通 过` 兜底点击、`about:blank` 后的列表验证、以及展开必须补跑 `navigate.mjs bill` 的完整口径。
- **Session 自愈机制技术细节**（[session-self-heal.md](references/session-self-heal.md)）:三层自愈架构 + cron 配置 + 通知路由
- **opencli browser eval 兜底审批**（[opencli-eval-fallback.md](references/opencli-eval-fallback.md)）:预算/幽灵单据 opencli eval 直点按钮兜底方案
- **三重验证硬规则**（[verify-rule.md](references/verify-rule.md)）:DB + list + taskStatus 三信号判定真批成功,缺一不可(2026-06-22 实战)
- [opencli eval 批量审批工作流](references/eval-batch-workflow.md) — 🆕 当 approve.mjs 全部 BILL_NOT_FOUND 时的批量 eval 替代方案（2026-06-09 验证 46/47） — 🆕 当 approve.mjs 全部 BILL_NOT_FOUND 时的批量 eval 替代方案（2026-06-09 验证 46/47）
- [账单详情深度展开](references/bill-detail-deep-expand.md) — 🆕 当用户说"展开更多细节"/"还不够完整"时，遍历审批链、合同条款、费用明细、项目归属的全量页面提取流程
- [幽灵单据行级审批兜底](references/ghost-row-level-approval.md) — ghost:true/approve.mjs 找不到按钮时，按 billId 精确匹配行内「通过」+「确认」兜底；含 opencli tab 跟 Playwright Page 双 context 坑、opencli eval 共享 JS context 坑（`const` 重复声明）、同 billId 列表残留 vs 真未批的 DB 判定流程
- [预算审批专项](references/budget-approval.md) — 🆕 2026-06-22 补充：¥0 预算 + `approve.mjs` 返 `BUTTON_NOT_FOUND` 的完整 7 步 opencli eval 兜底流程（不要加 `--force`）+ 预算批准后列表是否消除的精确判定（吴亮是最后节点 → 消除；吴亮之后还有财务/CFO 节点 → 不消除）
- [预算页批量行级 click 实战 (2026-06-22)](references/budget-batch-row-click-2026-06-22.md) — 4 条 ¥0 预算连过完整 batch 序列（每条 IIFE 隔离 + 单条 sleep 3-4s 避免弹窗堆叠）+ 与普通报销 batch 模式差异对照（按钮带空格 / DB 不落地 / 列表残留判定）
- [审批链 AI 节点 (2026-06-29)](references/approval-chain-ai-nodes.md) — 财智能体/用金核销等非人类节点的解析
- [评论/回复/意见提取](references/comment-extraction-detail-page.md) — 用户问"是否回复了我的评论"时的 opencli eval 提取流程
- ["X~Y 展开" 动作歧义陷阱 (2026-06-29)](references/2026-06-29-expand-not-approve-pitfall.md) — 复合指令误读事故复盘
- [2026-06-26 统一双步确认弹窗回归](references/2026-06-26-dialog-regression.md) — 🆕 所有类型统一走弹窗确认双步的实测记录（含弹窗内容、操作硬规则、7/7 批量验证结果）
- [2026-06-26 行级批量批准稳定模式](references/2026-06-26-batch-row-level.md) — 🆕 整合 4/4 一次 GONE 的通用 batch 函数 + 失败诊断表 + opencli eval vs approve.mjs 路径对照
- [2026-06-26 新增类型：招待申请单](references/2026-06-26-type-additions.md) — 🆕 白名单遗漏的招待申请单类型说明 + 修复指引
- [2026-06-29 approve.mjs BUTTON_NOT_FOUND 兜底（差旅/云账户）](references/2026-06-29-approve-button-not-found-fallback.md) — 🆕 差旅报销/云账户支付 approve.mjs 100% BUTTON_NOT_FOUND 时，opencli eval 行级 + 弹窗双步的完整兜底序列
- [2026-06-29 "X~Y 展开" 动作歧义陷阱](references/2026-06-29-expand-not-approve-pitfall.md) — 🆕 复合指令中动作动词歧义导致误批的复盘 + 4 步解析流程

## 与钉钉待办联动

1. 先在薪福通执行审批（approve.mjs）
2. 再到钉钉待办标记完成（dingtalk-todo skill）
3. 两者独立记录，approve.mjs 输出会提示 dingtalkHint

## 复合指令 + 列表漂移陷阱（2026-06-22 实战，重要）

**用户对"按位置盲批已过单"零容忍。** 复合指令（如"X2 4 展开"、"X1 2 4 通过"）必须先重新拉主页列表 → 按 **billId / 申请人 / 类型 / 金额** 身份匹配用户上一轮看到的目标 → 跳过已不在列表 / 已批过的单 → 对仍存在的目标执行。

**绝对禁止**直接按用户报的序号走当次最新列表——列表是实时流入的，"X2 4 展开"中的 X2/X4 可能是上一轮已过、当前已不存在的单。

### 🔴 "X~Y 展开" 动作歧义陷阱（2026-06-29 事故复盘）

**用户原话**："x8~9 展开，X12 通过"。Agent 误读为"X8/X9/X12 全部通过"，用 `approve.mjs --force --skip-preaudit` 把 X8/X9 也批了出去（X9 合同用印 ¥12,400 后端审批链已置 AGREE 不可撤回）。

**硬规则**：
1. 任何包含"展开/详情/看下/review/拉一下"的指令，**绝对不得调用 `approve.mjs`**
2. 复合指令解析流程：先扫"通过"关键词归集"通过集合" → 剩余 X 编号默认走"展开" → 即使是 `X~Y` 范围也不得批
3. 模糊场景（如"X1~5"无明确动作词）→ 必须询问用户

完整事故分析 + 补救流程 + 自检 prompt 详见 [`references/2026-06-29-expand-not-approve-pitfall.md`](references/2026-06-29-expand-not-approve-pitfall.md)

### 实战反例（2026-06-22）

用户："X2 4 展开" —— 上一轮 X2 (陈小香 ¥16,152) 和 X4 (吴秋霞 ¥0 预算) **已经通过**，但用户用 "X2 4" 复指。Agent 没重新交叉验证，按当次列表的"X2"实际指代 (叶龙 ¥4,000)，误把"已批过"当成"展开"执行；后用户指出 "X2 4 上一轮已过"。

**正确动作**：
1. 重新拉主页（navigate.mjs homepage）—— 拿当次 billId/申请人/类型/金额
2. 对每个用户指定的序号，**先在 SQLite 查 DB**：`SELECT bill_id, applicant_name, action, approved_at FROM approvals WHERE bill_id IN (...) AND approved_at > datetime('now','-1 hour')` —— 命中即说明本会话内已批过
3. 命中 + 当次列表已不含 → **跳过，告知用户"该单本会话已通过（DB 记录 + 列表已消除）"**，不重批
4. 命中 + 当次列表仍含 → 大概率是预算单（¥0）或"已审未消"缓存残留，**优先** opencli eval 行级兜底（不依赖 approve.mjs）
5. 未命中 → 走正常身份匹配 → 确认列表标题/申请人/类型与用户指令一致 → 才执行

### 实战：X5/X8 同 billId 误判陷阱

**症状**：approve.mjs 返回 `ok:true, dbSaved:true`，DB 也有 agree 记录，但**主页列表仍显示该 billId**。Agent 容易误判为"已批 + 列表缓存残留"而不再处理，实际可能是：

- **真情况 A**：吴亮节点已通过，审批链后续还有财务/CFO 节点，列表不消除是预期。skill 文档已说明。
- **真情况 B（更常见）**：上一轮脚本返回成功但实际**点击未真生效**（SPA 路由跳走 + 弹窗未提交 + DB 写入是 INSERT OR IGNORE 缓存命中），DB 写入假象。**辨别方法**：
  - `navigate.mjs homepage` 重新拉一次，**列表仍含该 billId**
  - `opencli browser <s> eval "Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('<billId>'))"` → 找到 row → **row 内「通过」按钮是否可点**（disabled=false）
  - 按钮仍可点 → 上次未真生效，需重批
  - 按钮不可点 / row 已 AGREE → 真已过

**预防**：单条批完 + 回查 DB + 回查列表 + opencli eval 三重确认；不要仅看 `dbSaved:true` 就汇报"已过"。

## 批量执行结果判定（2026-06-22 实战 patch）

**坑 1：approve.mjs 输出截尾 JSON 解析**。批量跑 `approve.mjs` 时，每条返回 stdout 含：
- 中间段 `preaudit` 大块（含 checks[] 数组）
- 末尾段 `{"ok":..., "action":..., "clickVerified":..., "dbSaved":..., "preaudit":{...}}`

**错误算法**：用 `last_json = json.loads(out.splitlines()[-1])` —— 抓到最后一行，但最后一行经常是 `}` 截断片段（多行 JSON 字符串拼接）或 `null,` 等孤立字段，json.loads 失败 → Agent 误判"parse err, 实际未生效"。

**正确算法**（三重判定，必须都用）：
```python
# 1. 反向 brace-counting 找末尾完整 JSON
start = out.rfind('\n{\n')
last_json = json.loads(out[start+1:].strip()) if start >= 0 else None

# 2. SQLite DB 回查（最权威）
conn.execute("SELECT action, approved_at FROM approvals WHERE bill_id=?", (bid,))
# 命中 + action='agree' → DB 已写

# 3. 列表回查（最直观）
navigate.mjs homepage → bills[] 是否含 billId
# 不含 → 列表已消除 = 真生效；含 → 可能是预算/幽灵/未生效
```

**坑 2：批量 timeout 切断**。terminal 默认 5min timeout，20+ 条 `approve.mjs` 串行跑到第 10-15 条可能被切断。**对策**：
- 分批 5-8 条/批，批间 `sleep 1`
- 每批结束跑 SQLite `SELECT COUNT(*) FROM approvals WHERE approved_at > datetime('now','-5 minutes')` 验落地数
- 任何一条 approve 返回 `BILL_NOT_FOUND` 或 `BUTTON_NOT_FOUND` —— **不要**换其他路径重试到死，先报用户后等指令

**坑 3：BUTTON_NOT_FOUND 不是"没批"信号**。`approve.mjs` 对部分类型（预算 "通 过" 带空格 / 投流详情结构 / 大额供应商预付款）会返 `BUTTON_NOT_FOUND`。这意味着 approve.mjs 的按钮匹配规则失败，**审批实际未提交**。**不要**把 BUTTON_NOT_FOUND 汇报为"已批"。

**BUTTON_NOT_FOUND 兜底流程**（已验证可用）：
1. `opencli browser <s> open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"` + `sleep 6` 让 SPA 挂载
2. `eval "document.querySelectorAll('tr.ant-table-row').length"` 确认 rows > 0
3. 精确定位 row：`Array.from(...).find(r => r.innerText.includes('<billId>'))`
4. 找按钮：预算用 `b.innerText.includes('通') && b.innerText.includes('过')`，普通用 `b.innerText.trim() === '通过'`
5. 点 + sleep 4 + 弹窗 `.ant-modal` 出现 + 点「确认」 + sleep 4 + 回查 rows 不含该 billId + SQLite 写入
6. 三件套硬信号（必须全有）：弹窗消失 + rows 不含该 billId + `document.body.innerText.includes('同意成功')` toast

### 🔴 opencli tab 旧版 URL 漂移：按钮文字从「通过」变「操作」（2026-06-23 新发现）

**症状**：opencli eval 行级点「通过」返回 `BTN_NOT_FOUND`，但 rows > 0。检查按钮文本发现所有行的按钮文字都是 `"操作"` 而不是预期的 `"通过"` 和 `"否决"/"退回"`。

**根因**：opencli tab 的 URL 在某个操作后从 `/#/form-app/approval`（新版审批列表）漂移到了 `/#/trip-app/homepage`（旧版首页）。旧版首页的表格行按钮文字是 `"操作"`，没有 `"通过/退回"` 按钮。

**典型触发场景**（本会话实测）：
- `navigate.mjs homepage` 跑完后，opencli tab 停留在旧版 URL
- 批量点完一批后刷新或 navigate.mjs 异常后，tab URL 被重置到首页
- 会话中某些脚本内部导航到 `/trip-app/homepage` 后没切回来

**恢复流程**：
1. 先检查 `location.href` 或 `location.hash`：如果 hash 是 `#/trip-app/homepage`，说明在旧版页
2. `opencli browser <s> open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"`
3. `sleep 6` 等 SPA 挂载
4. 验证 `eval "document.title + ' | rows=' + document.querySelectorAll('tr.ant-table-row').length"` 返 `智能费控·薪福通 | rows=N` (N>0)
5. 验证按钮：`eval "Array.from(document.querySelectorAll('tr.ant-table-row')).slice(0,1).map(t=>Array.from(t.querySelectorAll('button')).map(b=>b.innerText.trim()))"` 应含 `"通过"` 或 `"否决"`

**判定标准**（同共享 session 判定标准节）：
- hash 含 `/form-app/approval` → 新版审批列表 ✅
- hash 含 `/trip-app/homepage` → 旧版首页 ❌，需重导航
- hash 含 `about:blank` → SPA 未挂载，需重导航 + sleep

**禁止**：
- 不要因为 BTN_NOT_FOUND 就直接判定单据不可操作——先检查 URL
- 不要跑 self-heal.mjs——session 正常，只是 tab URL 不对
- 不要跑 `navigate.mjs homepage`——它走 Playwright 独立 context，不影响 opencli tab 的 URL

### 🔴 opencli tab vs Playwright Page 双 context 切换（2026-06-22 实战）

**核心约束**：`navigate.mjs` / `approve.mjs` / `review.mjs` 走的是 **Playwright Page 对象**（独立 context）；`opencli browser <s> eval` 走的是 **Chrome 扩展桥接的另一个 tab**。两者**不共享 DOM**。

**症状**：
- `navigate.mjs homepage` 跑完，`opencli browser <s> eval "document.querySelectorAll('tr.ant-table-row').length"` 仍返 0
- `opencli browser <s> eval "location.href"` → `about:blank`（opencli tab 一直没加载薪福通 SPA）
- `self-heal.mjs` 报 session 正常（它走 Playwright 检测），但 opencli tab 还是 about:blank

**正确切换流程**（approve.mjs 失败后切 opencli eval 兜底）：
1. `opencli browser <s> open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"` 写入 URL
2. `sleep 6`（Vue SPA 需要时间挂载）
3. `eval "location.href"` 确认 URL 已生效（不是 about:blank）
4. `eval "document.querySelectorAll('tr.ant-table-row').length"` 确认 rows > 0
5. 这时才能用 opencli eval 操作行级按钮

**反向**：opencli eval 跑完一批后，**想用 navigate.mjs 验证列表**也要重新跑 navigate（它有独立 context），eval 看到的 DOM 不影响 navigate 的结果。

**不要做**：
- 不要 `opencli browser <s> open <url>` 写完 URL 不 sleep 就 eval —— SPA 没挂载
- 不要 `eval "location.reload()"` —— SPA 未挂载时 reload 也无效
- 不要因为 opencli tab about:blank 就判定 session 过期 —— 走 `self-heal.mjs` 交叉验证（它走 Playwright，独立判定）


## 优化记录

### 2026-06-29 行级批量通过脚本（已验证可工作）

`scripts/fast-approve-batch.py` 行级「通过」+ 弹窗「确认」+ 三件套验证（dialog 消失 + row 消失 + toast「同意成功」）的 Python 批量实现。

**2026-06-29 修复**：原版混入 JS 语法（`b.innerText.replace(/\\s+/g,'')` 直接写在 Python 源文件，导致 `SyntaxError`），现改为 Python 端的 JS 表达式字符串 + `subprocess.run` 调用 opencli eval。已验证语法正确，可直接运行。

适用：用户已明确指定通过的 billId 列表（预算/报销/合同用印等通用）。

```bash
python3 scripts/fast-approve-batch.py <billId1> <billId2> ...
# 或
python3 scripts/fast-approve-batch.py --file billIds.txt
```

实测 2026-06-29：3 条预算 ¥0 单（X5/X6/X7）一次过 3/3。

### 2026-06-22 速度优化：OpenCLI 统一入口 + fast approve + 预审缓存

#### 1. OpenCLI 统一入口

- 新增 `scripts/shared/opencli.mjs`，运行时解析当前可用的 `@jackwener/opencli` 包，优先使用 Hermes node 全局包，再回退 PATH / Homebrew / nvm 路径。
- 核心脚本已从硬编码 `/opt/homebrew/lib/node_modules/...` 改为 `createPage()` / `loadSendCommand()`：`navigate.mjs`、`review.mjs`、`approve.mjs`、`preaudit.mjs`、`health*.mjs`、`self-heal.mjs`、`keepalive.mjs`、`_debug_parse.mjs`、`budget-detail-extract.mjs`。
- 2026-06-22 验证：`opencli --version`、daemon、脚本 resolver 均为 `1.8.4`。

#### 2. 行级快速通过

- 新增 `scripts/fast-approve.mjs`：按 billId 定位审批列表行，点击行内「通过」，循环处理可能堆叠的确认弹窗，再回查行状态。
- 安全默认：不加 `--yes` 永远 dry-run，不点击按钮；真实执行必须显式 `--yes`，且只处理传入的 `--ids`。
- 适用：吴亮已经明确指定通过的小额/已审核单据；不适用需要展开详情或人工复核的大额、招聘、采购等红灯项。

#### 3. 预审缓存

- `db.mjs` 新增 `preaudit_cache` 表。`review.mjs`、`approve.mjs`、`preaudit.mjs` 默认复用 24 小时缓存，减少同一 bill/project 反复查 CRM 和 Databoard。
- 强制刷新：加 `--no-preaudit-cache`，或设置 `CMB_XFT_PREAUDIT_CACHE_HOURS` 调整缓存时长。

### 2026-06-06 opencli browser eval 兜底审批 + 钉钉表格渲染 + opencli 升级

#### 1. opencli browser eval 兜底审批（预算 + 幽灵救活）

`approve.mjs` / `review.mjs` 返回 `BILL_NOT_FOUND` 或 `BUTTON_NOT_FOUND`时，若列表仍有该单且直接 URL 导航能打开 → 用 `opencli browser eval` 直点按钮。`approve.mjs` 超时（>30s）时同样适用此兜底路径，详见 [`references/approve-timeout-eval-fallback.md`](references/approve-timeout-eval-fallback.md)。

**预算审批** — 按钮文字为 `"通 过"`（中间有空格，⚠️ 不是 `"通过"`），与 approve.mjs 不匹配。流程：`open 导航 → eval click ant-btn-primary（匹配 includes('通')&&includes('过')） → sleep → eval click guideStepOperateOkButton`。

**普通审批** — 底部倒数第二个 ant-btn-primary 是"通过"。先 eval 列出按钮索引定位。

详见 [`references/opencli-eval-fallback.md`](references/opencli-eval-fallback.md)。

#### 2. 钉钉 DM 表格渲染

Hermes→钉钉 DM 的 pipe 表格不可靠。含表格内容用 `dws chat message send --user 2267566123688378 --title "审批列表" --text "..."` 走原生 IM API。纯文本走 Hermes 正常通道。

#### 3. opencli 1.8.3 升级与语法变更

- CLI: `npm install -g @jackwener/opencli --prefix /opt/homebrew`
- Extension: GitHub Releases zip → `chrome://extensions` 加载
- 语法: `--session`→位置参数 `opencli browser <session> <cmd>`
- 新增 `ghost-clear.mjs` 诊断脚本

### 2026-05-27 登录页适配 + 滑块验证码检测

#### 登录按钮从 button 改为 div
- 登录页改版：提交按钮从 `<button>` → `<div data-x-track-id="密码-登录">`
- `session.mjs` 两处修复：
  1. 表单检测（`tryAutoLogin`）：新增 `[data-x-track-id*="登录"]`, `div[class*="loginBtn"]` 选择器
  2. 点击逻辑：先 `MouseEvent` 触发（div 无原生 click 行为），再 `btn.click()`

#### 滑块验证码检测增强
- 新增文字检测：`bodyText.includes('向右拖动滑块')` / `bodyText.includes('按住左方滑块')`
- `tryAutoLogin` 等待跳转循环中增加滑块验证码检测，匹配后立即返回 false

#### 当前状态
- 桥接正常（daemon running, extension connected）
- 登录态已过期，自动登录因滑块验证码阻断
- **需用户在自动化窗口中手动完成滑块验证**

#### 1. --force 强制审批
```bash
node scripts/approve.mjs <billId> agree "同意" --force
```
- 跳过 DB 去重检查，删除旧记录后重新走点击流程
- 适用场景：首次点击未生效、DB 已存但薪福通后端仍显示待审批

#### 2. 投流费用申请单独立解析
- `parseBillDetail()` 检测到 `type === '投流费用申请单'` 时走专用解析路径
- 字段映射：
  - 部门 ← 项目承担部门
  - 项目 ← 投流项目
  - 金额 ← 总计金额(CNY) / 充值金额
  - 平台 ← 投放平台
  - 充值ID ← 充值ID
  - 账号名 ← 投流账号名称

#### 3. 花名册动态部门映射
- `scripts/shared/dept-mapper.mjs` — 每次运行读花名册 Excel 构建映射表
- 映射策略：
  1. 完整路径（含 `|`）→ 直接解析 L2-L3-L4
  2. 精确匹配（组名 = 花名册 L3/L4）
  3. 模糊匹配（子串匹配）
  4. 降级返回原始值，不阻断审批
- 5 分钟缓存，花名册更新后自动跟随

### 2026-06-05 按钮定位修复 + 类型扩展 + 幽灵过滤

#### 1. clickApproveAndConfirm 多策略按钮搜索
- **旧**：只搜 `button.ant-btn` + 文本 `"通过"`
- **新**：3 层策略
  1. `button.ant-btn` 精确匹配 `["通过","同意","提交"]`
  2. `button.ant-btn-primary` 精确匹配
  3. 所有 `button` 模糊匹配（含 `ant-btn` class）
- **确认按钮**：扩展为 `["确认","同意","确定","提交"]`
- **失败处理**：按钮未找到时硬退出（`BUTTON_NOT_FOUND`），不再静默 → 误报通过

#### 2. parseBillDetail 类型识别扩展
- `extract.mjs` L128 类型正则追加：`员工备用金|供应商预付款|云账户支付|预算`
- 金额提取追加：`借款金额.*CNY`、`预付款金额`
- 部门降级追加：`借款部门`
- 项目降级追加：`单据项目`

#### 3. navigate.mjs --filter-ghosts 幽灵过滤
- 交叉比对「待审批」和「已审批」两个 tab
- 同时出现在两个 tab 的单据标记 `ghost: true`
- 输出新增 `realPending` 和 `ghostCount` 字段
- 用法：`node navigate.mjs homepage --filter-ghosts`

#### 4. BILL_NOT_FOUND 根因 B 确认
- 部分单据审批链节点全部「已通过」但仍显示在待审批列表
- 直接 URL 导航诊断法可区分 session 过期 vs 实际已批
- 详见上述「诊断」章节
- **🚨 预算按钮文字「通 过」带空格（2026-06-08 发现）**：薪福通预算审批按钮的内文本是 `"通 过"`（中间有空格），而不是 `"通过"`。用 `querySelectorAll` + `innerText.includes('通过')` 或 `=== '通过'` 都会漏掉。正确写法：`b.innerText.includes('通') && b.innerText.includes('过')` 或匹配 `/通\s+过/`。**这个坑已导致多次误判为 BUTTON_NOT_FOUND，不可再犯。** 其他单据类型的「通过」按钮不带空格，仅预算页面有此特性。
  - **预算批量批后列表不消除**：14条预算用 approve.mjs 逐条处理后仍在待审批列表 — 这是预期行为，因为零金额预算没有审批按钮、薪福通后端不会生成审批记录。不需重复批。用户说「绿色过」时，零金额预算计入 🟢，处理后直接告知「预算已锁定编号，列表不消除属正常」。
  - **批处理 JSON 污染**：`approve.mjs 2>&1 | python3 -c` 管道会把 stderr 的 `ExperimentalWarning: SQLite` 混入 stdout → JSON 解析失败。批处理时直接逐条运行，不要通过管道解析 JSON。
- **幽灵单据特征**：审批链显示吴亮「审批中」但页面无「通过」按钮（只有打印/评论/分享）。常见于会签节点 + 撤回重提历史。目前无法通过脚本解决，需用户手动处理。
- 部门变更无需修改代码

### 2026-06-05 SkillOpt 集成 + 会话可靠性

#### SkillOpt 自动化优化
- SkillOpt（微软 Research）已安装至 `~/.hermes/skills/skillopt/`
- 看板：`skillopt-cmb-xft-approval`，测试套件：`~/.hermes/SkillOpt/cmb-xft-approval/test-suite.json`
- 每日健康检查 cron：`0 10 * * *`，推钉钉
- 用法：`bash ~/.hermes/skills/skillopt/scripts/run-phase.sh --board skillopt-cmb-xft-approval --phase rollout --epoch N --exec`

#### opencli 长连接超时是 #1 可靠性瓶颈
SkillOpt rollout 确认：长时间审批会话后 opencli bridge 自然超时，导致 `navigate.mjs homepage` 返回 pending=0。**非代码问题，运维问题。**

**已通过 Session 自愈机制解决**（见上方「Session 自愈机制」章节）：
- `health-check.mjs`：全栈诊断，精确定位失效层级
- `self-heal.mjs`（每 30min cron）：自动愈合 daemon → 自动填表登录 → 验证
- 仅在自动恢复失败（验证码等）时才推送钉钉通知
- 手动备选：`open -a "Google Chrome"` 前台登录

### Bind 模式（用户前台 Chrome 手动登录后接管，2026-06-22 新增）

薪福通自动登录被滑块验证码阻断时，让用户自己在前台 Chrome 登录后用 `bind` 模式接管，避免用户在 automation window 找登录页的尴尬。

**完整 3 步恢复流程 + 失败模式对照** → 详见 [`references/session-recovery-bind-flow.md`](references/session-recovery-bind-flow.md)

关键步骤：
```bash
# 1. 用户在前台 Chrome 打开 https://xft.cmbchina.com 并完成登录
# 2. 告诉 agent "我开好了"
# 3. Agent 跑：
opencli browser xft-bind bind
opencli browser xft-bind state    # 验证接管成功，title 应为 "智能费控·薪福通"
# 4. 跑 navigate.mjs homepage 让 Vue SPA 真的挂载（state OK 仍可能 DOM 为空）
node scripts/navigate.mjs homepage
# 5. 切到审批列表 + 等 SPA 挂载
opencli browser xft-bind open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 7
# 6. 之后所有 navigate.mjs / approve.mjs / review.mjs / fast-approve.mjs 都能正常工作
#    （前台 Chrome cookie 与 opencli bridge 共享）
```

**坑**（2026-06-29 实测）：bind 后 `state` 返 URL+title 正确，但 `eval` 可能返空字符串（DOM 未挂载）。必须先跑 `navigate.mjs homepage` 用 Playwright 渲染 SPA，再 eval 拿数据。**不要在 bind 后立刻跑 fast-approve.mjs / approve.mjs**——它们会触发 `ensureLoggedIn` 重新走滑块登录流程。

**机制**（OpenCLI 文档）：
- `opencli browser <session> bind` 把用户已登录的 tab 绑定到指定 session
- 绑定的 session 不接管 tab 生命周期（用户可以继续切换）
- 但 session 内的 page.goto() 仍可以操作该 tab

**XFT skill 集成**（`scripts/shared/session.mjs`）：
- `ensureLoggedIn` 自动登录失败时打印 `userManualLoginPrompt()` 引导文案
- 导出 `bindToUserTab(sessionName)` 给 agent 直接调
- 注意：bind 后 `ensureLoggedIn` 的 cookie 检测仍能识别已登录态

### Sysexits 退出码（2026-06-22 起对齐 opencli）

approve.mjs / navigate.mjs 退出码遵循 [sysexits.h](https://man.openbsd.org/sysexits)：

| Code | 含义 | Agent 动作 |
|---:|---|---|
| 0 | 成功 | 报告成功 |
| 1 | 通用错误 / 业务阻断 | 看 JSON.error 细分 |
| 66 | 无数据 / 已处理 | 跳过，列下一条 |
| 75 | 临时失败 | 重试 1-2 次 |
| 77 | 登录态过期 | 走 bind 模式，提示用户 |
| 78 | 参数错误 | 停止，提示用户修正 |

详见 `references/sysexits-handling.md`。

### 默认后台窗口模式（2026-06-22 新增）

`scripts/shared/opencli.mjs` 的 `createPage(name, opts)` 默认 `windowMode: 'background'`，**不会**抢用户前台 Chrome 焦点。

覆盖：
```bash
OPENCLI_XFT_WINDOW=foreground node scripts/approve.mjs ...   # 强制前台（调试/验证码时）
```

- **审批工作流模式**（Agent 会话标准流程）

当用户说"审批列表"时，默认**同时查询钉钉 + 薪福通**，合并展示。

### 空列表验真（钉钉 OA）

不要只凭旧 curl `topapi/process/workrecord/task/query` 返回 `result.has_more=false` 且无 `list` 就汇报「钉钉审批为空」。确认钉钉 OA 为空前，需走当前权威 MCP 路径交叉验证：
1. `dingtalk-oa-approval.list_pending_approvals`
2. `dingtalk-oa-approval.list_pending_approvals_for_me`
3. `dingtalk-oa-approval.get_todo_tasks`（吴亮 userId）

三者均为空，且无页面截图/用户事实反证时，才可汇报「钉钉 OA 待审批 0 条」。如果 `skill_view(name="dingtalk-approval")` 因重名报 ambiguous，不要循环重试；直接使用 `/Users/wuliang/.openclaw/workspace/skills/dingtalk-approval-exec/SKILL.md` 或本技能流程。详见 `references/approval-list-empty-verification.md`。

### 审批分层规则

| 层级 | 金额/条件 | 操作 |
|------|----------|------|
| 🟢 | < ¥500 或 加班/调休 | 用户说"绿灯通过" → 批量批 |
| 🟡 | ¥500 - ¥5,000 | 先展开详情，用户说"黄灯通过" → 批量批 |
| 🔴 | > ¥5,000 / 合同用印 / 招聘 / 采购 / 云账户 | 逐条展开，用户逐条指定 |
| 🔒 | 预算 ¥0 | ⚠️ 按钮文字为「通 过」（中间有空格），搜 innerText 不能用 === '通过'，须用 includes('通')&&includes('过') |

### 会话指令速查

| 用户指令 | 含义 |
|----------|------|
| `审批列表` | 拉钉钉 + 薪福通，合并展示 |
| `展开` / `展开这X条` | 拉详情（部门/项目/风险标记） |
| `绿灯通过` / `驴打滚通过` | 批量批所有 🟢 |
| `黄灯通过` | 批量批所有 🟡 |
| `投流费用都通过` | 按类型批量批 |
| `大额通过，中额展开` / `🔴通过，🟡展开` | 按上一轮分层列表的金额层级执行：先用上一轮 billId/申请人/类型/金额做身份匹配，只审批用户明确指定通过的层级；随后展开用户要求展开的层级。不要把未指定层级顺手批掉。 |
| `X到Y过` | 按序号范围批（重新拉列表确认序号） |
| `134通过，其他展开` / `1、3、4通过，其他展开` | 复合指令：先用**上一轮展示列表**确定 1/3/4 的 billId；重新拉当前 homepage 后按 billId/申请人/类型/金额做身份匹配，只通过这些明确指定项；“其他”仅指上一轮列表中未指定且仍存在的条目，**不包含处理过程中实时新流入的单据** |
| `X1过 / X5过 / x9展开` | 按上一轮展示的 XFT 序号执行；执行前必须重新拉当前 homepage，用上一轮 billId/申请人/类型做身份匹配，不能只按当前位置 |
| `D1、5通过 / D6展开` | 按上一轮钉钉 OA 序号执行；执行前重新拉 OA 列表并按标题/类型/申请人匹配 |
| `剩下的再展开` | 展开上一轮剩余未处理的；如果回查出现新流入单据，要单独提示“新流入，未纳入本次其他/剩下范围”，不要顺手展开或审批 |

### MouseEvent dispatch 兜底（2026-06-26 实测）

部分确认弹窗的 `btn.click()` 不触发 Vue 事件，需降级 `dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,view:window}))`。详见 [`references/mouseevent-dialog-confirm.md`](references/mouseevent-dialog-confirm.md)。

### 🔴「知道了」弹窗替代「确认」弹窗（2026-06-25 实测）

**症状**：行级点「通过」后，弹窗 `.ant-modal` 出现，但内含文字是「提示」+「取消」+「知道了」，不是标准的「确认」按钮。点「知道了」后审批生效，列表消除。

**触发场景**：合同用印（供应商）类型（已验证 X4 李碧 ¥6,000 合同用印）。

**正确流程**：
1. 行级点「通过」→ sleep 4 → `.ant-modal` 出现
2. 搜 `确认` 按钮 → 不存在（NO_CONFIRM_BTN）
3. **降级搜** `知道了` 按钮：`Array.from(document.querySelectorAll('button,span')).find(b => b.innerText.trim() === '知道了')?.click()`
4. 点后 sleep 3-4 → 回查 `stillThere` 和 `rows`
5. 列表消除 = 真生效

**判定逻辑**：
```
if dialog exists:
  1. 先搜 '确认' → CLICK → sleep → verify
  2. NO_CONFIRM_BTN → 搜 '知道了' → CLICK → sleep → verify
  3. 仍 NO → 检查 dialog 文本，搜 '知道了'/'关闭'/'确定'
  4. 全找不到 → 判定为不可消除弹窗，报告用户
```

**禁止**：  
- 不要因为 NO_CONFIRM_BTN 就判定 dialog 不可消除并放弃审批  
- 不要刷新页面——这个 dialog 是正常流程提示，点掉就行

### 🟡 Confirm 按钮 `btn.click()` 不提交 → dispatchEvent 降级（2026-06-26 发现）

偶尔 `btn.click()` 调用 Vue dialog 的「确认」按钮返回成功但不实际提交（dialog 仍在、row 不消失）。**根因**：Vue 事件代理不响应原生 `.click()`，只响应 `dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}))`。

**判定流程**：先 `btn.click()` → sleep 3 → row 仍 STILL → dialog 仍在 → `dispatchEvent(MouseEvent)` on confirm → sleep 3 → row 消失 ✅

**已验证样本**：江灵星 ¥1,055.76 员工日常报销单（2026-06-26），`btn.click()` × 2 都失败，MouseEvent dispatch 一次成功。

详见 [`references/confirm-button-mouseevent-fallback.md`](references/confirm-button-mouseevent-fallback.md)。

## 🔴 `--force --skip-preaudit` 是红线开关（2026-06-29 误批事故新增）

**事故**：用户说「x8~9 展开，X12 通过」。我误读成「X8~X12 全部通过」，跑 `approve.mjs --force --skip-preaudit` 把 X8/X9/X12 三条全批了。X8/X9 后端节点已置 AGREE，**无法撤回**——只能清本地 DB 记录。

**`--force --skip-preaudit` 使用硬规则**：

1. **绝不**用于范围模糊或动作动词不明确时（`X1~5`、`X1、X3`、复合指令等）
2. **绝不**在用户没明确说「过/通过」时调用——`展开/看下/详情` 类动词只走 `navigate.mjs bill` 或 `review.mjs`，不走 approve.mjs
3. **仅**在以下场景使用：
   - 用户明确指定单 billId 通过（"X5 通过"且身份匹配 OK）
   - opencli eval 行级反复 STILL + dialog 已消（真未生效，兜底）
   - 投流单/大额供应商单 opencli 弹「操作异常-没有权限」时（替代 opencli eval）
4. **默认应该**：「先 review.mjs / navigate.mjs bill 拉详情，等用户决策」再执行
5. 即使 opencli 桥接挂了（Extension not connected），也**不要降级**到 `--force` 自动批——回到等用户决策

**事故后补救流程**：
```bash
# 1. 备份 DB
cp /Users/wuliang/.hermes/data/cmb_approvals.db /tmp/cmb_approvals_backup_$(date +%s).db
# 2. 删除误批记录（仅清本地 DB；薪福通后端吴亮节点可能已 AGREE，无法撤回）
sqlite3 /Users/wuliang/.hermes/data/cmb_approvals.db "DELETE FROM approvals WHERE bill_id IN ('<id1>','<id2>',...);"
# 3. 立刻向用户汇报：哪几条误批、哪几条用户真要过、后端状态、是否需要走驳回重提
```

**预防性判断（执行前必须自检 3 问）**：
- 这条消息里每个 X{n} 后面跟的动词是什么？（展开 vs 通过 vs 退回）
- 有没有「~」范围 + 模糊动词的组合？
- 我准备调用的脚本是 review.mjs / navigate.mjs bill 还是 approve.mjs？脚本选错 = 误批

## 🔴 「操作异常-没有权限进行当前操作」弹窗陷阱（2026-06-26 新发现）

**症状**：行级「通过」+ 弹窗「确认」双步走完后 `.ant-modal` 实际变成一个新的「错误提示」dialog（`.ant-modal-confirm-warning`），内容是「操作异常-没有权限进行当前操作，请刷新后重试！」，只有一个「关闭」按钮（无「确认」/「取消」）。

**根因**：薪福通后端对当前 Chrome tab/cookie 的某个权限检查失败（常见于长时间 opencli eval 反复操作同一 session 后权限被收紧，或审批人节点切换中）。opencli eval 路径走 Chrome 扩展桥接的 tab，跟 Playwright Page 走的 cookie 上下文可能不一致。

**判定**：
```bash
# 查 dialog body 文本
"操作异常" in dialog_text OR "没有权限" in dialog_text
```

**唯一有效 recovery**（已验证 2026-06-26 X2/X3 沈煜投流单 ¥1,980.20 + ¥9,900.99）：
1. **放弃 opencli eval 路径**——重复点「确认」/「关闭」无法恢复
2. 走 `node scripts/approve.mjs <billId> agree "同意" --force --skip-preaudit`（Playwright Page 独立 context）
3. approve.mjs 返回 `ok=true, clickVerified=true, dbSaved=true` + SQLite 落地 → 真批成功
4. 列表回查 billId 已消除

**已推翻的旧假设**：
- ❌ 旧 skill：「`approve.mjs` 对投流费用申请单 100% 返 `BUTTON_NOT_FOUND`，不要浪费时间跑 approve.mjs」
- ✅ 修正：**仅当 opencli eval 路径出现「操作异常-没有权限」时才回退 approve.mjs**；非权限错误时仍可走 opencli eval。投流单 `approve.mjs` 失败根因常是权限/cookie 上下文问题，不是按钮匹配问题。

**禁止**：
- 不要反复点「关闭」/「确认」/「取消」——dialog 关不掉，session 状态已污染
- 不要跑 `self-heal.mjs` / `opencli daemon restart`——session 健康，权限问题在 tab 上下文层
- 不要 `location.reload()` / `opencli browser <s> open` 重写 URL——仍走同一权限上下文
- 唯一有效：直接走 `approve.mjs` Playwright Page 路径，绕开 opencli tab 上下文

**硬规则**：当 `eval "Array.from(document.querySelectorAll('.ant-modal-confirm-btns button')).map(b=>b.innerText.trim()).join(',')"` 返 `["关闭"]`（不是 `["确认","取消"]`）→ 立即停止 opencli eval 操作，**降级到 `approve.mjs --force --skip-preaudit`**。

详见 [`references/permission-error-modal.md`](references/permission-error-modal.md)。

### 🚨 钉钉 DM 格式输出（2026-06-06 发现，已验证）

**Hermes 适配层 → 钉钉 DM 的 Markdown 表格（pipe `|col|col|`）渲染不稳定，用户多次反馈格式不对（「表格的渲染还是不正确」）。** 根因是 Hermes 消息通道与钉钉原生 IM API 的 Markdown 渲染引擎不同。

**✅ 解决：带表格的审批列表用 `dws chat message send` 走钉钉原生 IM API，绕过 Hermes 适配层。**

```bash
# 吴亮 userId = 2267566123688378
dws chat message send --user 2267566123688378 \
  --title "审批列表" \
  --text "## 🟢 小额 <¥500（3条）

| # | 申请人 | 类型 | 金额 | 事由 |
|---:|---|---:|---|
| 1 | 郭郡 | 差旅报销 | ¥480 | KOS差旅 |

🟢 合计 ¥480" \
  --format json
```

**使用规则**：
- 含表格的审批列表 → `dws chat message send --user 2267566123688378`
- 纯文本回复（确认/报错/简短通知）→ Hermes 正常回复
- dws 发送后 Hermes 只回简短确认，避免内容重复
- 表格 ≤5 列，单条消息过长时分批发送

**备用（dws 不可用）**：emoji 分层 + 纯文本编号列表。

### 🆕 opencli 升级流程（2026-06-06）

opencli CLI 和 Chrome Extension 需分别升级：

```bash
# CLI: npm prefix 可能≠homebrew路径，显式指定
npm install -g @jackwener/opencli --prefix /opt/homebrew
opencli daemon restart && opencli --version

# Extension: 从 GitHub Releases 下载 zip → chrome://extensions 加载已解压
# 升级后必须 opencli daemon restart
```

### 🔴 `navigate.mjs homepage` 返 0 + opencli eval 兜底是稳定回退（2026-06-18 再验证）

`navigate.mjs homepage` 偶发返 `pending:0`（SPA 异步渲染时序 + `.ant-card` 选择器失效的混合坑），但页面 DOM 实际有 9-12 条 `tr.ant-table-row`。**当 `navigate.mjs` 返 0 但 `opencli browser <s> eval "document.querySelectorAll('tr.ant-table-row').length"` > 0 时，放弃 navigate 走 opencli eval 直批**——已稳定验证批完 4 条。

**稳定兜底流程**（适用于「navigate 卡 0 + session 健康 + 主页行级按钮在」组合）：

```bash
# 1. 验证 navigate 返 0
node scripts/navigate.mjs homepage  # → pending:0
# 2. opencli eval 验证主页真实条数
opencli browser <s> eval "document.querySelectorAll('tr.ant-table-row').length"
# 3. 拉取所有行 billId
opencli browser <s> eval "Array.from(document.querySelectorAll('tr.ant-table-row')).map((tr,i)=>{const tds=Array.from(tr.querySelectorAll('td')).map(td=>td.innerText.replace(/\s+/g,' ').trim());return i+':'+(tds[1]||'')+'|'+(tds[3]||'')+'|'+(tds[4]||'')}).join('\n')"
# 4. 按 billId 精确匹配 tr + 点行内「通过」 + sleep 4s + 回查 rows 是否仍含该 billId
# 5. 预算单走双步（弹窗+确认+toast），普通报销走单步
# 6. 完成后用 eval 回查 rows 总数
```

**决策点**：
- `navigate.mjs homepage` 返 0 + 浏览器非 `about:blank` + opencli eval rows > 0 → 走 eval 兜底
- 浏览器 `about:blank` → 先 `opencli browser <s> open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"` 重导航
- `opencli doctor` 不全绿（daemon/extension 异常）→ 走 self-heal.mjs 修复

**已知不影响**：
- 主页 `pendingTab: '待审批 N'` 文本与 `tr.ant-table-row.length` 数字会一致（已验证 N=9 → rows=9，N=12 → rows=12）
- `health.mjs` 返 `title:""` 是灰色地带，不影响本路径（已验证）

### 🔴 `opencli browser <s> open <url>` 写 hash 但 SPA 不解析 → about:blank（2026-06-18 实测）

**坑**：`opencli browser <s> open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"` 调用表面返 `{url: "...", page: "..."}` 看似成功，但**当前 tab 实际停在 `about:blank`**，SPA 框架未启动（`document.body.innerText.length=0`）。

**症状**：
- `opencli browser <s> eval "location.href"` → `about:blank`
- `document.title` → `""`
- `document.querySelectorAll('tr.ant-table-row').length` → 0
- `location.reload()` 也救不了（SPA 实例都没初始化）
- `window.location.hash = '#/form-app/approval'` 同样救不了

**根因**：opencli `open` 命令只把 URL 写到 tab 地址栏，但薪福通的 Vue SPA 需要完整的 nav history + 鉴权态才挂载根组件；tab 空闲时 Vue 实例没启动，URL 改写对 SPA 来说等于无效输入。

**唯一可靠恢复流程**（按顺序）：
1. 跑 `node scripts/self-heal.mjs`——确认 session 仍是 OK（AUTO_LOGIN_OK 或 SESSION_VALID）
2. 跑 `node scripts/navigate.mjs homepage`——这个脚本走的是 Playwright Page 对象 `page.goto(URL)`，**真渲染 SPA**，不是 hash 改写
3. 回查 `opencli browser <s> eval "document.querySelectorAll('tr.ant-table-row').length"` > 0 + `location.href` 含 `/form-app/approval` 才算恢复

**不要做**：
- 不要靠 `opencli browser <s> open <url>` 反复重试——同一个根因
- 不要靠 `eval "location.reload()"`——SPA 未挂载时 reload 也无效
- 不要直接放弃走 opencli eval 兜底——先按上面 3 步恢复，eval 兜底是 navigate.mjs 返 0 但页面 OK 时的下一步

**已验证样本**：2026-06-18 同一会话连续遇到两次，`self-heal` + `navigate.mjs` 后 `rows > 0` 立即可用。

### 🚨 "DB 已 agree 残留"不重批硬规则（2026-06-22 实战确认）

当 `navigate.mjs homepage` 列表里仍显示某单，但 SQLite `approvals` 表中**已有 agree 记录**，**绝对不要再次 approve**。

**判定信号（任一满足即视为残留）**：
- `sqlite3 ~/.hermes/data/cmb_approvals.db "SELECT * FROM approvals WHERE bill_id='<id>'"` 有 agree 记录
- approve.mjs 第二次返 `ok:false` + `alreadyProcessed:true`
- 列表持续显示同一单 + DB 有 agree 记录 + approve.mjs 返 `clickVerified=true dbSaved=true`

**user-facing 表述**：
- 「DB 已落地（agree at <时间戳>），节点已处理，列表待后续节点流转消除」
- 不要再次 approve；不要再 warn "列表没消除"——这是预期行为

**实战样本**：
- 王子昕 ¥3,500 员工备用金：DB 有 agree，多次出现在列表里（已批但残留）
- 郑颖 ¥8,000 员工备用金：DB 有 agree at 12:35:36，列表里仍显示

### 真批成功的硬信号（2026-06-22 实战补充）

`approve.mjs` 返 `ok=true + clickVerified=true + dbSaved=true` **不一定**真生效，必须满足以下任一硬信号：

1. **SQLite 有新记录**：`SELECT * FROM approvals WHERE bill_id='<id>' AND approved_at > datetime('now', '-5 minutes')` 有返回
2. **列表最终不含该 billId**：等待 3-5s 后 `navigate.mjs homepage` 列表**最终**不含该单
3. **detail 页吴亮节点变 COMPLETED/AGREE**

**矛盾样本**（2026-06-22）：
- approve.mjs 返 `ok=true clickVerified=true dbSaved=true`，但 navigate.mjs 列表仍含该单 + DB 有新记录 → **是真批成功，列表残留属正常**（后续节点未消）
- approve.mjs 返 `ok:false` 但 DB 有新记录 → **是真批成功**（已批过重试命中 SQLite 缓存）

**禁止**：
- 仅凭 approve.mjs JSON 返 `ok:true` 就说"已批"
- 仅凭 navigate.mjs 列表里仍有该单就说"未生效"
- 看到矛盾就反复重试（结果一致时按上述口径汇报，矛盾时按"DB + 节点"为准）

### approve.mjs 返回的"假阳性"陷阱（2026-06-22 实战确认）

实战中多次遇到：approve.mjs 返 `ok=true + clickVerified=true + dbSaved=true + method=clicked ant-btn: 通过 → clicked confirm: 确认`，但**实际上 list-pending 仍显示该单**。

**根因**：薪福通后续审批链还有节点（财务/CFO/CEO），吴亮节点已过但实例未彻底结束，list-pending 显示的是当前需要处理的节点 + 历史节点的混合。

**判定流程**：
1. approve.mjs 返 ok=true → 不要立即回查 list（避免误判残留）
2. 等 3-5s 后用 SQLite 查 `SELECT * FROM approvals WHERE bill_id='<id>'`：
   - 有记录 → **真批成功**，按"DB 已落地，节点已过"汇报
   - 无记录 → 降级 opencli eval 行级"通过"+"确认"或 ts-node execute-approval-task
3. **不要**用 navigate.mjs 主页 list 是否消除作为唯一判据（依赖 list 缓存）

### 主页行级批的"submit + verify"循环模式（2026-06-22 实战，2026-06-24 patch）

**🔴 每批操作前强制 pre-check**（2026-06-24 强化）：opencli tab 在 >5min 空闲后几乎必然死到 `about:blank`。**在任何 opencli eval 操作前，必须先做 1 秒健康检查**：
```bash
ROWS=$(opencli browser <s> eval "document.querySelectorAll('tr.ant-table-row').length" 2>&1 | tail -1)
if ! [[ "$ROWS" =~ ^[0-9]+$ ]] || [ "$ROWS" = "0" ]; then
    opencli browser <s> open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
    sleep 6
fi
```
跳过 pre-check 直接开跑 → 必出 NO_ROW → 每轮浪费 20-30s 恢复。不要在 about:blank 时判定 session 过期——走 self-heal.mjs 交叉验证。

`opencli browser <s> open https://xft.cmbchina.com/TripMainWeb/#/form-app/approval` → `sleep 6` → 验证 `document.querySelectorAll('tr.ant-table-row').length > 0` + `location.href` 含 `/form-app/approval`（SPA 已挂载）→ 后续行级"通过/通 过"+"确认"操作。

**关键修正（2026-06-22）**：
- 之前假设 `navigate.mjs homepage` 返 0 + opencli eval rows>0 走 eval 兜底是稳定路径
- 实测 navigate.mjs 经常**超时**（Playwright 独立 context 与 opencli tab 分离），不再可靠
- **改用**：navigate.mjs 拉一次后看 list 数据；用 SQLite 查 DB 落地作为真批硬信号；opencli eval 仅用于预算/差旅/某些情况下行级批兜底

### opencli tab about:blank 恢复（2026-06-22 实战补充）

`opencli browser <s> open <url>` 只把 URL 写到 tab 地址栏但**不启动 Vue SPA**。session 正常但 tab 死 about:blank 时：
1. 先跑 `node scripts/self-heal.mjs` 确认 session 是 `SESSION_VALID`（不要被它的"Bridge 不通"误报迷惑）
2. 跑 `node scripts/navigate.mjs homepage`（这个脚本内部用 Playwright Page `goto(URL)` 真渲染）
3. 如果 navigate 也 timeout，**用 opencli open + sleep 6 + eval `document.querySelectorAll('tr.ant-table-row').length`** 验证 SPA 已挂载
4. 仍未挂载 → 跑 `node scripts/ghost-clear.mjs` 强刷

### 钉钉加班/调休

加班申请、调休工时登记 → 🟢 可直接批量过。需先拉详情确认非残留尾节点（标题/正文类型一致，吴亮独占 activityId 而非并行会签）。
