# Feishu / DingTalk Context Plugin

`cn-messaging-context` is a Codex plugin pattern for Chinese workplace messaging and approvals:

- Codex plugin metadata and skills expose the user experience.
- A stdio MCP server exposes bounded tools to Codex.
- A separate connector service owns webhooks, token refresh, storage, search, and send adapters.

This keeps long-running platform work out of Codex sessions while still letting Codex sync history, search, summarize, generate group-chat reports, create Slack-style daily digests, triage notifications, find reply candidates, draft reply queues, create summary documents, map topic threads, create safe schedule records, safely send confirmed messages, and read or approve confirmed DingTalk OA items.

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
- `summarize_conversation`
- `create_conversation_report`
- `create_daily_digest`
- `triage_today`
- `find_reply_candidates`
- `draft_reply_queue`
- `create_summary_doc`
- `map_conversation_topics`
- `read_topic_thread`
- `schedule_daily_digest`
- `schedule_message`
- `list_scheduled_actions`
- `cancel_scheduled_action`
- `draft_reply`
- `sync_history`
- `authorize_conversation`
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
- Topic map/thread: group messages into topic-centered timelines with decisions and blockers.
- Scheduled workflows: create pending records for future digests or confirmed messages.

These workflows operate only on messages already captured or synced into the connector. Use `sync_history` first when live history coverage is required.

Scheduled records are not a background runner by themselves. Production deployments should add a worker that reads pending records, regenerates the digest or message at execution time, and still preserves the send/approval confirmation model.

## CodeBuddy / WorkBuddy

CodeBuddy can use `.codebuddy-plugin/plugin.json`, the shared `skills/`, and the same `.mcp.json`. WorkBuddy can use this package as a plain MCP server by pointing its MCP settings to `dist/mcp/server.js` and the running connector service. See [docs/codebuddy-workbuddy.md](./docs/codebuddy-workbuddy.md).

## Connector API

See [docs/connector-api.md](./docs/connector-api.md).

## Security

See [docs/security.md](./docs/security.md). Do not put app secrets, tokens, webhook secrets, cookies, or private keys into plugin files or Codex context.
