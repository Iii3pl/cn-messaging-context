# Installation Guide

## Local Codex Plugin

Recommended for new users:

```bash
git clone https://github.com/Iii3pl/cn-messaging-context
cd cn-messaging-context
npm run agent:install
```

This starts a guided install that prepares Codex and WorkBuddy, checks platform CLIs and local WeChat `wx-cli`, and keeps write actions in preview-first mode. See [New User Setup Guide](./onboarding.md).

Useful installer variants:

```bash
npm run agent:install -- --check-only
npm run agent:install -- --guide
npm run agent:install -- --codex-only
npm run agent:install -- --workbuddy-only
npm run agent:install -- --install-platform-cli
```

Manual flow:

1. Build the package:

```bash
npm install
npm run build
```

2. Start the connector service:

```bash
CN_MESSAGING_STORE=sqlite \
CN_MESSAGING_DATA_DIR=.data \
npm run start:connector
```

In plain language: this starts the small local helper service that Codex talks to when it wants to use plugin tools. The browser address is `http://127.0.0.1:8787`, but users do not need to remember that address; it just means "the helper service running on this computer."

3. Install the plugin into Codex from the plugin source directory.

4. Open a new Codex session so skills and MCP tools are reloaded.

## Platform Setup

### Feishu / Lark

- Create a Feishu/Lark app or bot.
- Configure event callbacks to `POST /webhooks/feishu/events`.
- Configure and store the webhook verification secret outside plugin files.
- Grant only the scopes needed for bot membership, message read/search, and message send.
- Invite the bot to authorized groups.
- Optional user-approved read fallback: configure Feishu/Lark OAuth user credentials in the connector environment if your deployment supports them. Codex must ask the user before using this path for a one-time group or document read.
- CLI install for new users: `npx @larksuite/cli@latest install`, then `lark-cli config init`, `lark-cli auth login --recommend`, `lark-cli doctor`.

### DingTalk

- Create a DingTalk app or bot.
- Configure event callbacks to `POST /webhooks/dingtalk/events`.
- Configure and store the webhook secret outside plugin files.
- Grant message read/search/send scopes.
- Grant OA approval read scopes.
- Grant OA approval action scopes only when the organization has approved Codex-assisted approval actions.
- CLI install for new users: `npm install -g dingtalk-workspace-cli`, then `dws auth login`, `dws auth status`, `dws doctor`.

### Tencent Docs

- Tencent Docs uses connector-side OpenAPI/OAuth credentials or a tenant MCP bridge.
- Set `TENCENT_DOCS_ACCESS_TOKEN` and `TENCENT_DOCS_OPEN_ID` in the connector service environment.
- Optional: `TENCENT_DOCS_CLIENT_ID`, `TENCENT_DOCS_API_BASE`, `TENCENT_DOCS_MCP_TOKEN`.
- Restart the connector after changing credentials, then run `check_workspace_status`.

### Local WeChat

- Install `wx-cli`: `npm install -g @jackwener/wx-cli`.
- Desktop WeChat must be installed and logged in.
- First-time setup: `sudo wx init`.
- Verify with `wx sessions --json`.
- WeChat support is local and read-only. It does not send messages.

## Runtime Flags

| Variable | Default | Purpose |
| --- | --- | --- |
| `CN_MESSAGING_CONNECTOR_URL` | `http://127.0.0.1:8787` | MCP server to connector URL |
| `CN_MESSAGING_DATA_DIR` | `.data` | Connector storage directory |
| `CN_MESSAGING_STORE` | `jsonl` | Use `jsonl` or `sqlite` |
| `CN_MESSAGING_DRY_RUN` | `true` | Friendly meaning: preview first, do not really send or approve yet |
| `CN_WORKSPACE_DRY_RUN` | `true` | Friendly meaning: preview first, do not really write documents or sheets yet |
| `CN_MESSAGING_ENFORCE_AUTH` | `false` | Set to `true` to require conversation authorization records |
| `CN_MESSAGING_GITHUB_ISSUES_REPO` | `Iii3pl/cn-messaging-context` | GitHub repo for redacted connector error reports |
| `CN_MESSAGING_AUTO_ISSUES` | `false` | Friendly meaning: when enabled, connector errors are automatically prepared for GitHub |
| `CN_MESSAGING_ISSUE_DRY_RUN` | `true` | Friendly meaning: preview the GitHub problem report without creating a real Issue |
| `CN_MESSAGING_ISSUE_LABELS` | `connector-error,automated-report` | Labels added to created GitHub Issues |
| `FEISHU_WEBHOOK_SECRET` | unset | Feishu webhook signature secret |
| `DINGTALK_WEBHOOK_SECRET` | unset | DingTalk webhook signature secret |

## Verification Checklist

- `check_integration_status` reports connector health.
- Feishu bot events are accepted only with valid signatures when a secret is configured.
- DingTalk bot events are accepted only with valid signatures when a secret is configured.
- `sync_history` imports a bounded time window.
- `sync_history` with `platform: "wechat"` imports local WeChat history/search/new messages through `wx-cli`.
- `list_wechat_sessions` and `list_wechat_unread` return local WeChat session surfaces.
- Feishu/Lark user fallback refuses to run unless the user has agreed in the current task.
- `check_issue_reporter_status` and `report_connector_issue` can preview a redacted GitHub problem report.
- `create_conversation_report` returns key messages, decisions, follow-ups, and risks.
- `create_daily_digest`, `triage_today`, `find_reply_candidates`, `draft_reply_queue`, and `create_summary_doc` work from synced or ingested messages.
- `map_conversation_topics` and `read_topic_thread` return topic-centered timelines.
- `schedule_daily_digest`, `schedule_message`, `list_scheduled_actions`, and `cancel_scheduled_action` create and manage schedule records without background execution.
- `list_pending_dingtalk_approvals` returns visible OA items.
- `approve_dingtalk_approval` rejects calls without user confirmation.
- With preview-first mode enabled, sends, approvals, and workspace writes record what would happen but do not actually change Feishu, DingTalk, or Tencent Docs.

## Human-Friendly Status Phrases

- Say "插件的小服务没开" instead of "127.0.0.1:8787 failed".
- Say "默认先预览，不会真的发送/审批/写文档" instead of "dry-run".
- Say "写入前会先问你" instead of "confirmation gate".
- Say "钉钉详情接口有一部分字段读不出来" instead of raw platform parser errors.
- Say "机器人看不到这个飞书群/文档，要不要用你的账号只读这一次？" instead of "permission fallback".
- Say "我已把这个错误整理成一个待修的问题单" instead of "auto issue report".
