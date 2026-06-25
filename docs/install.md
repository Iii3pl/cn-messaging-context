# Installation Guide

## Local Codex Plugin

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

3. Install the plugin into Codex from the plugin source directory.

4. Open a new Codex session so skills and MCP tools are reloaded.

## Platform Setup

### Feishu / Lark

- Create a Feishu/Lark app or bot.
- Configure event callbacks to `POST /webhooks/feishu/events`.
- Configure and store the webhook verification secret outside plugin files.
- Grant only the scopes needed for bot membership, message read/search, and message send.
- Invite the bot to authorized groups.

### DingTalk

- Create a DingTalk app or bot.
- Configure event callbacks to `POST /webhooks/dingtalk/events`.
- Configure and store the webhook secret outside plugin files.
- Grant message read/search/send scopes.
- Grant OA approval read scopes.
- Grant OA approval action scopes only when the organization has approved Codex-assisted approval actions.

## Runtime Flags

| Variable | Default | Purpose |
| --- | --- | --- |
| `CN_MESSAGING_CONNECTOR_URL` | `http://127.0.0.1:8787` | MCP server to connector URL |
| `CN_MESSAGING_DATA_DIR` | `.data` | Connector storage directory |
| `CN_MESSAGING_STORE` | `jsonl` | Use `jsonl` or `sqlite` |
| `CN_MESSAGING_DRY_RUN` | `true` | Set to `false` for real sends and approvals |
| `CN_MESSAGING_ENFORCE_AUTH` | `false` | Set to `true` to require conversation authorization records |
| `FEISHU_WEBHOOK_SECRET` | unset | Feishu webhook signature secret |
| `DINGTALK_WEBHOOK_SECRET` | unset | DingTalk webhook signature secret |

## Verification Checklist

- `check_integration_status` reports connector health.
- Feishu bot events are accepted only with valid signatures when a secret is configured.
- DingTalk bot events are accepted only with valid signatures when a secret is configured.
- `sync_history` imports a bounded time window.
- `create_conversation_report` returns key messages, decisions, follow-ups, and risks.
- `create_daily_digest`, `triage_today`, `find_reply_candidates`, `draft_reply_queue`, and `create_summary_doc` work from synced or ingested messages.
- `list_pending_dingtalk_approvals` returns visible OA items.
- `approve_dingtalk_approval` rejects calls without user confirmation.
- With dry-run enabled, sends and approvals write audit records but do not call platform write APIs.
