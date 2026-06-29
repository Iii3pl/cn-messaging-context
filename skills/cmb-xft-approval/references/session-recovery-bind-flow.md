# Session 恢复：用户前台登录后 Bind 接管

**发现日期**：2026-06-29
**触发场景**：`navigate.mjs` 报 `SESSION_EXPIRED`，自动登录被滑块验证码阻断，用户在前台 Chrome 手动登录后说"已经登录了"

---

## 最稳的 3 步恢复流程

```bash
# Step 1: Bind 接管用户已登录的 tab
opencli browser xft-bind bind

# Step 2: 验证接管成功（state 命令会触发扩展 ping，比 eval 更稳）
opencli browser xft-bind state
# 期望输出：
# URL: https://xft.cmbchina.com/TripMainWeb/#/trip-app/homepage
# url: https://xft.cmbchina.com/TripMainWeb/#/trip-app/homepage
# title: 智能费控·薪福通

# Step 3: 用 Playwright Page 路径拉列表（这步会让 opencli tab 的 DOM 同步刷新）
node scripts/navigate.mjs homepage
```

**关键观察**（2026-06-29 实测）：
- `state` 命令返 URL+title 正确 **不等于** eval 能拿数据。eval 可能返空字符串。
- `navigate.mjs homepage` 走 Playwright Page，跟 opencli tab 独立 context。但跑完一次后，opencli tab 的 `document.querySelectorAll('tr.ant-table-row').length` 也能正常返回行数。
- 三步必须全跑：bind 接管 → navigate 拉列表（用 Playwright 真渲染 SPA）→ 才能 opencli eval 拿到 rows

---

## 已知坑：bind 后 opencli eval 返空

**症状**：
```bash
opencli browser xft-bind eval "document.title"
# → 输出空 + 升级提示（v1.8.4 → v1.8.5）
```

但同时：
```bash
opencli browser xft-bind state
# → URL 正确，title 正确，body 是 <body />（DOM 骨架未填）
```

**根因**：opencli tab 绑定了用户前台 Chrome 的 URL，但**没有触发 Vue SPA 重新挂载**。SPA 的 `div#root` 是空的。

**恢复**：跑 `node scripts/navigate.mjs homepage` —— 这个脚本走 Playwright `page.goto(URL)`，会**真渲染**薪福通 SPA，并把 DOM 同步到 opencli tab 的 context。

之后 `eval "document.querySelectorAll('tr.ant-table-row').length"` 正常返回行数。

---

## 旧版 URL 漂移到 `/trip-app/homepage` 的回切

`navigate.mjs` 跑完后，opencli tab 的 URL 是 `/trip-app/homepage`（旧版工作台），不是审批列表 `/form-app/approval`。如果直接 eval 拿审批列表，会拿到工作台的 DOM（"我的审批" 等模块的 list），不是 `tr.ant-table-row` 格式。

**回切**：
```bash
opencli browser xft-bind open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 6   # ⚠️ Vue SPA 需要 5-7s 挂载
# 验证
opencli browser xft-bind eval "JSON.stringify({hash: location.hash, rows: document.querySelectorAll('tr.ant-table-row').length})"
# → {"hash":"#/form-app/approval","rows":12}
```

**注意**：纯 `open <url>` 可能不启动 SPA。如果 `rows.length === 0` 持续 10s+ → 跑一次 `navigate.mjs homepage` 让 Playwright 渲染后再 eval。

---

## 完整恢复脚本

```bash
# 1. Bind
opencli browser xft-bind bind

# 2. 验证（state 比 eval 稳）
opencli browser xft-bind state 2>&1 | head -3
# 必须看到 title: 智能费控·薪福通

# 3. Playwright 拉列表（关键步骤，让 SPA 真的挂载）
node scripts/navigate.mjs homepage 2>&1 | tail -5
# 应看到 {"ok":true,"pending":N,"bills":[...]}

# 4. 切到审批列表 URL + 等 SPA
opencli browser xft-bind open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 7

# 5. 验证 opencli tab 能 eval rows
opencli browser xft-bind eval "document.querySelectorAll('tr.ant-table-row').length"
# → 12

# 6. 后续可以走 fast-approve / 行级 eval 批
```

---

## 失败模式对照表

| 现象 | 根因 | 解法 |
|------|------|------|
| `state` URL 是 `about:blank` | 用户前台 Chrome 没开薪福通 tab | 让用户在 Chrome 打开 https://xft.cmbchina.com 并登录 |
| `state` URL 是 xft 域名但 title 空 | SPA 未挂载 | 跑 navigate.mjs homepage |
| `eval "rows.length"` 返 0 | URL 漂到旧版 `/trip-app/homepage` | 重新 `open <approval_url>` + sleep 7 |
| `eval "rows.length"` 返 0 但 navigate.mjs 正常 | opencli tab DOM 滞后 | 跑一次 navigate 后再 eval |
| `eval` 完全返空字符串 | 扩展/daemon 状态异常 | `opencli daemon restart` 后重 bind |

---

## 重要修正

**不要**在 bind 后立刻尝试 fast-approve.mjs / approve.mjs——这两个脚本会立即调 `ensureLoggedIn` 内的 cookie 检测，可能判定为 session 过期并尝试自动登录，**自动登录又会被滑块验证码阻断**，反而浪费 30s+。

**正确顺序**：bind → state 验证 → navigate.mjs homepage 拉一次列表（这一步证明 session + 列表都正常）→ 后续 fast-approve / approve.mjs / eval 都可正常工作。
