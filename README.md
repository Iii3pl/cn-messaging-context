# Feishu / DingTalk Context Plugin

`cn-messaging-context` is a Codex plugin pattern for Chinese workplace messaging and approvals:

- Codex plugin metadata and skills expose the user experience.
- A stdio MCP server exposes bounded tools to Codex.
- A separate connector service owns webhooks, token refresh, storage, search, and send adapters.

This keeps long-running platform work out of Codex sessions while still letting Codex sync history, search, summarize, generate group-chat reports, create Slack-style daily digests, triage notifications, find reply candidates, draft reply queues, create summary documents, publish summaries to Feishu/Lark, DingTalk, or Tencent Docs resources, read/write docs/sheets/bases/whiteboards, read native mention/unread state, read native or topic-inferred threads, map cross-platform identities, run due schedule records, safely send confirmed messages, and read or approve confirmed DingTalk OA items.

## Structure

```text
.codex-plugin/plugin.json     Codex plugin manifest
.codebuddy-plugin/plugin.json CodeBuddy plugin manifest
.mcp.json                     MCP server entrypoint for Codex
assets/                       Public listing assets
skills/                       Codex workflow instructions
src/mcp/                      stdio MCP tools used by Codex
src/connector/                local connector service API
docs/                         API, architecture, and security notes
```

## Local Development

```bash
npm install
npm run build
CN_MESSAGING_DATA_DIR=.data npm run start:connector
CN_MESSAGING_CONNECTOR_URL=http://127.0.0.1:8787 npm run start:mcp
```

The connector defaults to dry-run sending and dry-run approvals. It records outgoing requests in an audit log but does not send real messages or approve OA items until platform adapters are configured and `CN_MESSAGING_DRY_RUN=false` is set.

Set `CN_MESSAGING_STORE=sqlite` to use the production-style local SQLite store with conversation authorization metadata and search indexes. The JSONL store remains the default for quick development.

## MCP Tools

- `list_conversations`
- `search_messages`
- `get_recent_context`
- `read_native_thread`
- `summarize_conversation`
- `create_conversation_report`
- `create_daily_digest`
- `triage_today`
- `find_reply_candidates`
- `draft_reply_queue`
- `create_summary_doc`
- `check_workspace_status`
- `read_workspace_resource`
- `write_workspace_resource`
- `publish_summary_doc`
- `map_conversation_topics`
- `read_topic_thread`
- `list_real_mentions`
- `list_unread_conversations`
- `query_message_read_status`
- `schedule_daily_digest`
- `schedule_message`
- `list_scheduled_actions`
- `cancel_scheduled_action`
- `run_due_scheduled_actions`
- `draft_reply`
- `sync_history`
- `authorize_conversation`
- `upsert_identity_mapping`
- `list_identity_mappings`
- `resolve_identity`
- `send_message`
- `list_pending_dingtalk_approvals`
- `get_dingtalk_approval_detail`
- `get_dingtalk_approval_tasks`
- `get_dingtalk_approval_records`
- `approve_dingtalk_approval`
- `check_integration_status`

`send_message` and `approve_dingtalk_approval` require `confirmed_by_user: true` plus a human-readable confirmation summary. The skills also require Codex to show the platform, destination/action target, and exact outgoing text or approval remark before acting.

## Slack-Style Workflows

The plugin includes Slack-inspired workflows adapted for Feishu/Lark and DingTalk:

- Daily digest: cross-conversation summary grouped by topic.
- Notification triage: tasks for the user, worth-skimming items, and optional low-priority items.
- Reply drafting: find likely response candidates and prepare draft-only replies.
- Summary document: Markdown document similar to a Slack Canvas recap.
- Workspace publishing: publish reports or structured data to Feishu/Lark docs, sheets, Base/smartsheet, whiteboards; DingTalk docs, sheets, AI tables; and Tencent Docs resources through OpenAPI/MCP bridge configuration.
- Native mention state: read platform-native @me, unread conversation/feed state, and message read-status surfaces where supported.
- Native/thread map: read platform-native threads when thread/root ids are available, or fall back to topic-centered timelines with decisions and blockers.
- Identity mapping: connect Feishu/Lark and DingTalk user ids or display names to one canonical person for cross-platform triage.
- Scheduled workflows: create, preview, execute, list, and cancel records for future digests or confirmed messages.

These workflows operate only on messages already captured or synced into the connector. Use `sync_history` first when live history coverage is required.

`run_due_scheduled_actions` can be called by a cron/worker or manually from Codex. It previews due records by default; execution requires `execute: true`, and message sends still honor the connector dry-run setting plus the original confirmation record.

Workspace writes default to dry-run through `CN_WORKSPACE_DRY_RUN`. Real writes require `CN_WORKSPACE_DRY_RUN=false`, platform credentials in the connector environment, and explicit user confirmation in the MCP call.

Tencent Docs support is implemented as a connector-side adapter boundary. Configure Tencent Docs OAuth/OpenAPI credentials with `TENCENT_DOCS_ACCESS_TOKEN` and `TENCENT_DOCS_OPEN_ID`; optional `TENCENT_DOCS_CLIENT_ID`, `TENCENT_DOCS_API_BASE`, and `TENCENT_DOCS_MCP_TOKEN` can be used for tenant-specific deployments or an official Tencent Docs MCP bridge.

## CodeBuddy / WorkBuddy

CodeBuddy can use `.codebuddy-plugin/plugin.json`, the shared `skills/`, and the same `.mcp.json`. WorkBuddy can use this package as a plain MCP server by pointing its MCP settings to `dist/mcp/server.js` and the running connector service. See [docs/codebuddy-workbuddy.md](./docs/codebuddy-workbuddy.md).

## Connector API

See [docs/connector-api.md](./docs/connector-api.md).

## Security

See [docs/security.md](./docs/security.md). Do not put app secrets, tokens, webhook secrets, cookies, or private keys into plugin files or Codex context.
