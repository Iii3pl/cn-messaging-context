# Changelog

## v3.1 (2026-06-22)

### 优化（基于 OpenCLI 文档 + 实操经验）

#### 默认后台窗口模式
- `scripts/shared/opencli.mjs` 的 `createPage(name, opts)` 现在默认传 `windowMode: 'background'`
- 用户前台 Chrome 不再被 automation window 抢焦点
- 覆盖方式：
  - `OPENCLI_XFT_WINDOW=foreground node scripts/approve.mjs ...` 强制前台
  - 或 `OPENCLI_WINDOW=foreground` 走上游 opencli 默认

#### Bind 模式（用户前台 Chrome 手动登录后接管）
- 新增 `scripts/shared/session.mjs` 导出 `bindToUserTab(sessionName)` 和 `userManualLoginPrompt()`
- 自动登录失败时（多半是滑块验证码）打印 prompt，提示用户在前台 Chrome 登录后让 agent 跑：
  ```
  opencli browser xft-bind bind
  ```
- 详见 SKILL.md「Bind 模式」章节

#### Sysexits 退出码
- `scripts/approve.mjs` 引入 `EXIT` 常量字典，exit code 与 opencli 语义对齐
- 退出码表：
  - `0` EX_OK       — 成功
  - `1` EX_ERR      — 通用错误 / 业务阻断（看 JSON.error）
  - `66` EX_NO_DATA — 单据没数据 / 已审批
  - `75` EX_TEMPFAIL — 临时失败（重试）
  - `77` EX_NOPERM  — 登录态过期
  - `78` EX_CONFIG  — 参数错误
- 详见 `references/sysexits-handling.md`
- 上层 agent 可 fast-path：`if [ $? -eq 77 ]; then prompt_user_manual_login; fi`

### 文档
- 新增 `references/sysexits-handling.md`（退出码处理 + 旧/新对比）
- SKILL.md 关键章节已同步更新

## v3.0 (2026-06-22)

- 引入 `scripts/shared/opencli.mjs` 统一 OpenCLI 包解析
- 引入 fast-approve.mjs 行级快速通过
- 引入 preaudit 24 小时缓存
- 详见 SPEC-V3.md
