# Session 自愈机制技术细节

## 问题

薪福通 cookie 在闲置一段时间后自然过期。过去：
- 用户说"审批列表" → Agent 拉薪福通 → 发现过期 → 让用户手动修
- 修复过程打断工作流，且经常是用户已经等了很久才发现

SkillOpt 第一轮 Rollout 确认：**session 过期是当前 #1 瓶颈**，不是 skill 文本问题，是运维可靠性问题。

## 解决方案：三层自愈

### 架构

```
health-check.mjs（诊断层）
  ├─ Layer 1: lsof 查 daemon 端口 + curl /status 验证响应
  ├─ Layer 2: sendCommand('exec', '1+1') 验证 bridge 连通
  └─ Layer 3: window.location.href 导航 + 检测 title/bodyText

self-heal.mjs（恢复层）
  ├─ Stage 0: healDaemon() — dead→restart, hung→kill-9+restart
  ├─ Stage 1: bridgeAlive() — sendCommand 验证
  └─ Stage 2: checkAndRecoverSession()
       ├─ 导航 → 检测 title
       ├─ 已登录 → 静默返回
       ├─ 登录页 → tryAutoLogin()
       │    ├─ 检测 captcha → 放弃 → 通知
       │    ├─ 填表（setter + dispatchEvent）
       │    ├─ 点击登录
       │    └─ 等待跳转 (10×2s)
       └─ 失败 → 输出修复指令
```

### 关键实现决策

**为什么不直接用 Page.goto()?**
`sendCommand('goto', ...)` 在 opencli daemon-client 中不是有效 action。正确做法是用 `sendCommand('exec', {code: 'window.location.href = "..."'})` 做 JS 导航，配合 `sleep` 等待渲染。

**为什么 --notify 模式输出纯文本而非 JSON?**
Cron agent 需要直接转发到钉钉。`--notify` 模式输出钉钉 Markdown 格式文本，agent 只需 pipe 到 send_message 即可。

**为什么 self-heal 静默成功、仅失败通知?**
避免噪音。每小时 2 次 cron，如果每次都发"✅ 正常"会淹没真正需要关注的消息。只在需要人工介入时才通知。

### 通知路由

**⚠️ 硬约束（2026-06-06）**：通知**只能发到吴亮 DM**，禁止推送到运营中心小群或任何其他群。用户明确要求「和我的对话不要乱发到别的群」。

| 条件 | 行为 | 目标 |
|------|------|------|
| Session 正常 | exit 0，不通知 | — |
| 自动登录成功 | exit 0，不通知 | — |
| 验证码阻断 | exit 1，通知 + 修复指令 | 吴亮 DM |
| Daemon hung/dead | exit 1，通知 + 修复指令 | 吴亮 DM |
| Bridge 不通 | exit 1，通知 + 扩展重启指令 | 吴亮 DM |

### Cron 配置

```
xft-session-selfheal: every 30m, deliver=origin (→ 吴亮 DM)
  → agent 跑 self-heal.mjs --notify
  → exit 0 = 静默
  → exit ≠ 0 = 通知吴亮 DM（⚠️ 不推群）

薪福通每日全栈健康检查: 0 10 * * *, deliver=origin (→ 吴亮 DM)
  → agent 跑 health-check.mjs
  → 解析 JSON 格式化推送（⚠️ 不推群）
```

> **历史**：v1 版本中两个 cron 分别配置为 deliver=local + prompt 内推群、deliver=dingtalk 推 home channel，导致自愈报告骚扰运营中心小群。2026-06-06 已暂停，恢复时须按 deliver=origin 重新配置。

### 脚本超时诊断模式（2026-06-07 确认）

当 `self-heal.mjs` 或 `health-check.mjs` **超时挂死**（>120s 无输出），而非返回错误时，按以下顺序排查：

```
1. 清理残留进程
   pkill -f "self-heal.mjs"; pkill -f "health-check.mjs"; pkill -f "health.mjs"

2. 独立验证 daemon + bridge（绕过脚本，直接问 opencli）
   opencli doctor                          # daemon + extension 双检
   opencli browser <session> eval "1+1"    # bridge 可达性

3. 如果 doctor + eval 都 OK → 浏览器页面卡在 loading/登录态检测循环
   → 快速确认 session 状态：
   opencli browser <session> eval "document.body.innerText.includes('登录') ? 'EXPIRED' : 'OK'"

4. 如果返回 EXPIRED → root cause = session 过期 + CAPTCHA 阻断
   → 修复：open -a "Google Chrome" "https://xft.cmbchina.com/"
   → 不要浪费时间重跑脚本（它们在 session 过期时会一直等待登录跳转）
```

**关键教训**：脚本超时 ≠ bridge 断连。先独立验证，不要直接采信脚本输出的原因。

### 手动排障速查

```bash
# 全栈诊断
node scripts/health-check.mjs | python3 -m json.tool

# 手动自愈
node scripts/self-heal.mjs

# 仅查 daemon
lsof -ti :19825 && curl -s -m 2 http://127.0.0.1:19825/status

# 快速 session 状态（绕过所有脚本，直接 eval）
opencli browser uz3357c8 eval "document.body.innerText.includes('登录') ? 'SESSION_EXPIRED' : 'SESSION_OK'"

# 前台手动登录（终极方案）
open -a "Google Chrome" "https://xft.cmbchina.com/"
```
