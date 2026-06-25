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
  "platform": "dingtalk",
  "conversation_id": "cid_xxx",
  "since": "2026-06-24T00:00:00+08:00",
  "until": "2026-06-25T00:00:00+08:00",
  "query": "预算",
  "limit": 50
}
```

Imports a bounded history window through the configured platform adapter.

### `GET /conversations`

Query parameters:

- `platform`: `feishu` or `dingtalk`
- `query`: optional text filter
- `limit`: default `50`

### `GET /messages/search`

Query parameters:

- `platform`
- `conversation_id`
- `query`
- `sender`
- `since`: ISO timestamp
- `until`: ISO timestamp
- `limit`: default `50`

### `GET /messages/recent`

Query parameters:

- `platform`
- `conversation_id`
- `limit`: default `50`

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

## Status API

### `GET /integrations/status`

Returns configured platforms, dry-run mode, data directory, and connector health.
