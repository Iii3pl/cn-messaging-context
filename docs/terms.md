# Terms of Service

`cn-messaging-context` is a developer plugin template for connecting Codex-compatible agents with Feishu/Lark, DingTalk, and DingTalk OA workflows.

## Operator Responsibility

The operator is responsible for:

- Configuring platform apps, bot permissions, callback URLs, and secrets.
- Ensuring the connector only accesses authorized tenants and conversations.
- Reviewing legal, HR, finance, and approval policies before enabling write actions.
- Monitoring audit logs and investigating suspicious use.

## High-Impact Actions

DingTalk OA approval actions and message sends may affect business workflows. Keep dry-run mode enabled until the organization has validated permissions, confirmation UX, and audit logging.

## No Warranty

This project is provided as a reference implementation. Validate all platform adapters and approval flows against your own environment before production use.
