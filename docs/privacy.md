# Privacy Policy

This plugin is designed so Codex talks to a connector service instead of holding platform credentials directly.

## Data Processed

The connector may process:

- Feishu/Lark and DingTalk conversation identifiers.
- Message sender names or platform ids.
- Message text, timestamps, and raw event payloads.
- DingTalk OA approval titles, instance ids, task ids, records, and user-provided approval remarks.
- Feishu/Lark, DingTalk, and Tencent Docs workspace resource identifiers and user-requested document, sheet, base, or whiteboard content.
- Audit records for read, sync, send, and approval actions.

## Data Storage

Local development stores data under `CN_MESSAGING_DATA_DIR`. Production deployments should use managed storage with encryption at rest, backups, access controls, and retention policies.

The plugin package must not contain:

- App secrets.
- Access tokens.
- Refresh tokens.
- Webhook signing secrets.
- Tencent Docs OAuth/OpenAPI tokens, OpenID values, MCP tokens, cookies, or private keys.
- User cookies.
- Private keys.

## Access Controls

Production deployments should enable tenant and conversation authorization. By default, the connector should not read groups unless the tenant has granted access and the bot or app has platform permission.

## Retention

Retention is deployment-specific. Operators should configure message and audit retention based on company policy, legal requirements, and user expectations.

## User Confirmation

Message sends, external workspace writes, and DingTalk approval actions require explicit user confirmation. The connector records action metadata in audit logs. It should never silently send, overwrite documents, or approve on behalf of a user.
