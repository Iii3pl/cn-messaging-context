# Connector API

Default local base URL: `http://127.0.0.1:8787`

## Webhooks

### `POST /webhooks/feishu/events`

Receives Feishu/Lark bot events, verifies the optional signature secret, normalizes the message, and stores it idempotently.

### `POST /webhooks/dingtalk/events`

Receives DingTalk bot events, verifies the optional signature secret, normalizes the message, and stores it idempotently.

## Read APIs

### `POST /sync/history`

Body:

```json
{
  "platform": "feishu",
  "conversation_id": "oc_xxx",
  "since": "2026-06-24T00:00:00+08:00",
  "until": "2026-06-25T00:00:00+08:00",
  "query": "预算",
  "limit": 50,
  "access_identity": "auto",
  "allow_user_fallback": true,
  "user_consent_confirmed": true,
  "consent_summary": "User agreed to a one-time Feishu read through their account after bot access failed."
}
```

Imports a bounded history window through the configured platform adapter.

For Feishu/Lark, `access_identity` can be `auto`, `bot`, or `user`. User permission is read-only and requires `user_consent_confirmed: true`; otherwise the connector rejects the call.

For local WeChat, use `platform: "wechat"`. The connector calls `wx-cli`:

- With `query`: `wx search <query> --json`
- With `conversation_id`: `wx history <conversation_id> --json`
- Without both: `wx new-messages --json`

### `GET /conversations`

Query parameters:

- `platform`: `feishu`, `dingtalk`, or `wechat`
- `query`: optional text filter
- `limit`: default `50`

### `GET /messages/search`

Query parameters:

- `platform`
- `conversation_id`
- `query`
- `sender`
- `thread_id`
- `since`: ISO timestamp
- `until`: ISO timestamp
- `limit`: default `50`

### `GET /messages/recent`

Query parameters:

- `platform`
- `conversation_id`
- `limit`: default `50`

### `GET /messages/thread`

Query parameters:

- `platform`: `feishu`, `dingtalk`, or `wechat`
- `conversation_id`: optional but recommended for authorization and faster lookup
- `thread_id`: platform native thread/root id, when known
- `message_id`: anchor message id, used when `thread_id` is unknown
- `limit`: default `100`

Returns messages from the same native thread when the connector has thread/root/parent ids. If only `message_id` is supplied, the connector infers the thread from the anchor message.

### `POST /messages/summarize`

Body:

```json
{
  "platform": "feishu",
  "conversation_id": "oc_xxx",
  "since": "2026-06-24T00:00:00+08:00",
  "until": "2026-06-25T00:00:00+08:00",
  "query": "采购平台"
}
```

### `POST /messages/report`

Body:

```json
{
  "platform": "dingtalk",
  "conversation_id": "cid_xxx",
  "since": "2026-06-24T00:00:00+08:00",
  "until": "2026-06-25T00:00:00+08:00",
  "query": "采购平台",
  "limit": 200
}
```

Returns a structured group-chat report with key messages, decisions, follow-ups, and risks.

### `POST /messages/draft`

Body:

```json
{
  "platform": "dingtalk",
  "conversation_id": "cid_xxx",
  "intent": "确认预算口径",
  "tone": "简洁、稳妥",
  "context": "..."
}
```

## Slack-Style Workflow APIs

### `POST /workflows/daily-digest`

Body:

```json
{
  "platform": "dingtalk",
  "conversation_ids": ["cid_xxx"],
  "topics": ["预算", "交付"],
  "since": "2026-06-25T00:00:00+08:00",
  "until": "2026-06-25T18:00:00+08:00",
  "limit": 500
}
```

Returns a compact daily digest grouped by topic, with a "Needs attention" section.

### `POST /workflows/notification-triage`

Body:

```json
{
  "platform": "dingtalk",
  "current_user": "吴亮",
  "since": "2026-06-25T00:00:00+08:00",
  "until": "2026-06-25T18:00:00+08:00",
  "include_can_ignore": true
}
```

Returns a priority queue: tasks for the user, worth-skimming items, and optional low-priority items.

### `POST /workflows/reply-candidates`

Finds messages likely requiring a response, confirmation, or follow-up.

### `POST /workflows/draft-reply-queue`

Creates draft-only replies for reply candidates. This does not send messages.

### `POST /workflows/summary-doc`

Returns a Markdown document combining digest, triage, and reply candidates. This is the Feishu/DingTalk equivalent of a Slack Canvas-style recap, but it is returned as Markdown unless another publishing adapter is added.

### `POST /workflows/summary-doc/publish`

Generates the same Markdown summary document and publishes it through the workspace adapter after explicit confirmation.

```json
{
  "provider": "feishu",
  "kind": "doc",
  "mode": "create",
  "title": "今日群聊摘要",
  "platform": "dingtalk",
  "since": "2026-06-25T00:00:00+08:00",
  "until": "2026-06-25T18:00:00+08:00",
  "confirmed_by_user": true,
  "confirmation_summary": "User confirmed provider, title, and destination."
}
```

### `POST /workflows/topic-map`

Builds a topic map from normalized messages. This is the Feishu/DingTalk equivalent of looking across Slack threads, but it is inferred from message text unless a platform-specific thread id exists.

### `POST /workflows/topic-thread`

Body:

```json
{
  "platform": "dingtalk",
  "topic": "外协结算",
  "since": "2026-06-25T00:00:00+08:00",
  "until": "2026-06-25T18:00:00+08:00",
  "window_size": 8
}
```

Returns a bounded timeline with decisions and blockers for the selected topic.

## Identity APIs

### `POST /identities`

Body:

```json
{
  "canonical_user": "吴亮",
  "display_name": "吴亮",
  "platform": "dingtalk",
  "platform_user_id": "staff_xxx",
  "platform_user_name": "无量",
  "aliases": ["wuliang", "吴亮的小马"]
}
```

Creates or updates a cross-platform identity mapping. Notification triage and reply-candidate workflows use these aliases when `current_user` is supplied.

### `GET /identities`

Query parameters:

- `platform`
- `canonical_user`
- `query`
- `limit`: default `50`

### `GET /identities/resolve`

Query parameters:

- `value`: alias, display name, platform user id, or canonical user
- `platform`: optional platform filter

## Workspace Resource APIs

Workspace writes default to dry-run unless `CN_WORKSPACE_DRY_RUN=false` is set in the connector environment.

### `GET /workspace/status`

Returns availability for:

- Feishu/Lark docs, sheets, Base/smartsheet, whiteboard via `lark-cli`
- DingTalk docs, online sheets, AI tables via `dws`
- Tencent Docs OpenAPI/MCP bridge configuration via connector environment variables

### `POST /workspace/read`

Body:

```json
{
  "provider": "feishu",
  "kind": "sheet",
  "target": "spreadsheet_token_or_url",
  "sheet_id": "Sheet1",
  "range": "A1:D20",
  "allow_user_fallback": true,
  "user_consent_confirmed": true,
  "consent_summary": "User agreed to a one-time Feishu sheet read through their account."
}
```

Supported `provider`: `feishu`, `dingtalk`, `tencent`.

Supported `kind`: `doc`, `sheet`, `base`, `whiteboard`, `slide`, `smartcanvas`, `smartsheet`, `board`, `mind`, `flowchart`.

Tencent Docs calls require connector-side OAuth/OpenAPI credentials. If a deployment needs a tenant-specific Tencent endpoint, pass `tencent_api_path` or configure `TENCENT_DOCS_API_BASE`.

Feishu/Lark reads support user-approved fallback for docs, sheets, Base/smartsheets, and whiteboards. The connector records whether user permission was used in `access_identity` and `user_permission_used`.

### `POST /workspace/write`

Requires `confirmed_by_user: true`.

Examples:

```json
{
  "provider": "dingtalk",
  "kind": "sheet",
  "target": "NODE_ID",
  "sheet_id": "Sheet1",
  "range": "A1",
  "mode": "update",
  "values": [["项目", "状态"], ["采购平台", "进行中"]],
  "confirmed_by_user": true,
  "confirmation_summary": "User confirmed sheet target, range, and exact values."
}
```

```json
{
  "provider": "feishu",
  "kind": "whiteboard",
  "target": "whiteboard_token",
  "mode": "overwrite",
  "input_format": "mermaid",
  "content": "flowchart LR\\nA[消息] --> B[摘要]",
  "confirmed_by_user": true,
  "confirmation_summary": "User confirmed whiteboard target and Mermaid content."
}
```

## Native Notification APIs

### `GET /wechat/sessions`

Query parameters:

- `limit`: default `50`

Lists local WeChat sessions through `wx sessions --json`. Requires `wx-cli` to be installed and initialized on the local machine.

### `GET /wechat/unread`

Query parameters:

- `filter`: optional `private`, `group`, `official`, `folded`, or `all`
- `limit`: default `50`

Lists local WeChat unread sessions through `wx unread --json`. This is read-only and does not send WeChat messages.

### `GET /notifications/mentions`

Query parameters:

- `platform`: `feishu` or `dingtalk`
- `conversation_id`: optional
- `since`
- `until`
- `limit`

Uses `lark-cli im +messages-search --is-at-me` for Feishu/Lark and `dws chat message list-mentions` for DingTalk.

### `GET /notifications/unread-conversations`

Query parameters:

- `platform`: `feishu` or `dingtalk`
- `limit`

Uses DingTalk's unread-conversation command when available. Feishu/Lark uses the current user's feed/shortcut surfaces and returns raw adapter evidence when unread fields are present.

### `GET /notifications/message-read-status`

Query parameters:

- `platform`
- `conversation_id`
- `message_id`

Uses DingTalk `query-read-status` when available. Feishu/Lark currently returns message evidence from `messages-mget`; do not treat it as full read-receipt coverage unless the tenant adapter exposes that field.

## Schedule APIs

### `POST /schedules/digest`

Creates a pending schedule record for a future digest. This does not run in the background by itself.

### `POST /schedules/message`

Creates a pending schedule record for a confirmed future message. Requires:

```json
{
  "platform": "dingtalk",
  "conversation_id": "cid_xxx",
  "text": "明天请同步进度。",
  "scheduled_for": "2026-06-26T18:00:00+08:00",
  "confirmed_by_user": true,
  "confirmation_summary": "User confirmed destination, time, and exact text."
}
```

### `GET /schedules`

Lists scheduled action records.

### `POST /schedules/:id/cancel`

Cancels a scheduled action record.

### `POST /schedules/run-due`

Body:

```json
{
  "now": "2026-06-25T18:00:00+08:00",
  "execute": false,
  "limit": 50
}
```

Previews due records by default. Set `execute: true` only for a trusted worker or explicit user request. Digest actions are generated at run time. Scheduled messages use the original confirmation record and still honor `CN_MESSAGING_DRY_RUN`.

## Write API

### `POST /authorizations/conversations`

Body:

```json
{
  "platform": "feishu",
  "conversation_id": "oc_xxx",
  "conversation_name": "采购平台项目群"
}
```

Registers an authorized tenant/conversation pair when authorization enforcement is enabled.

### `POST /messages/send`

Body:

```json
{
  "platform": "feishu",
  "conversation_id": "oc_xxx",
  "text": "确认收到，我来跟进。",
  "confirmed_by_user": true,
  "confirmation_summary": "User confirmed platform=feishu, conversation=oc_xxx, exact text."
}
```

The local connector defaults to dry-run mode and writes an audit event. Production adapters must reject sends without explicit confirmation and must redact secrets from logs.

## DingTalk OA Approval APIs

### `GET /approvals/dingtalk/pending`

Lists pending DingTalk OA approvals visible to the configured DingTalk account.

### `GET /approvals/dingtalk/:instance_id/detail`

Reads DingTalk OA approval detail.

### `GET /approvals/dingtalk/:instance_id/tasks`

Reads actionable task ids. This should be checked before any approval action.

### `GET /approvals/dingtalk/:instance_id/records`

Reads approval records and workflow evidence. Use this to avoid stale pending-list conclusions.

### `POST /approvals/dingtalk/:instance_id/approve`

Body:

```json
{
  "task_id": "123",
  "remark": "同意",
  "confirmed_by_user": true,
  "confirmation_summary": "User confirmed approving this DingTalk OA item."
}
```

When dry-run mode is enabled, approval actions create audit events but do not call DingTalk write APIs.

## CRM CLI Read APIs

CRM access is optional and disabled by default. Enable it only in trusted local connector environments:

```bash
CN_MESSAGING_CRM_ENABLED=true
CN_MESSAGING_CRM_CLI=crm
```

### `GET /crm/status`

Returns whether read-only CRM CLI access is enabled and whether the configured CLI command is available.

### `GET /crm/projects/search?query=<keyword>&limit=10`

Runs a read-only CRM project search and returns normalized project records plus the raw CLI result.

### `GET /crm/projects/:project_id/detail`

Reads one CRM project detail by CRM project id.

### `GET /crm/users/lookup?name=<name>&limit=5`

Looks up CRM organization users by display name.

### `POST /approvals/preaudit/crm`

Runs CRM-backed read-only evidence checks for an approval payload. This never sends messages, writes CRM data, or approves anything.

Body:

```json
{
  "source": "dingtalk",
  "approval_id": "process-instance-id",
  "title": "供应商结算单",
  "amount": 5000,
  "applicant": "张三",
  "department": "运营中心 → 运营六部 → 规模2组",
  "project": "淘宝秒杀 b站4月代运营",
  "project_refs": ["淘宝秒杀 b站4月代运营"]
}
```

The response includes `checks`, `evidence`, `missing_context`, `risk_level`, `recommendation`, and optional `crm_project_match` / `applicant` records. Missing CRM data is returned as `unknown` or `warn`; it is never treated as an approval green light.

## Status API

### `GET /issue-reporter/status`

Returns whether the GitHub issue reporter is configured, whether automatic reporting is enabled, and whether it is still in preview mode.

### `POST /issues/report`

Body:

```json
{
  "title": "Feishu document read failed",
  "summary": "机器人无法读取指定飞书文档，用户希望排查权限。",
  "severity": "medium",
  "operation": "POST /workspace/read",
  "error": "permission denied",
  "context": {
    "provider": "feishu",
    "kind": "doc"
  },
  "dry_run": true
}
```

Creates or previews a redacted GitHub Issue. Preview mode is the default; set `CN_MESSAGING_ISSUE_DRY_RUN=false` for real issue creation.

### `GET /integrations/status`

Returns configured platforms, dry-run mode, data directory, connector health, optional CRM status, workspace adapter status, and GitHub issue reporter status.
