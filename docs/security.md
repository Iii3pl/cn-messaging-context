# Security Notes

- Do not store platform secrets, app tokens, refresh tokens, webhook secrets, cookies, or private keys in plugin files.
- Keep secrets in a secret manager or encrypted connector-service configuration.
- The MCP server should only call the connector API and should not hold Feishu or DingTalk credentials.
- Default to authorized conversations only. Production deployments must enforce user, tenant, bot, and conversation authorization.
- Require user confirmation before sending. Show the platform, destination, and exact text.
- Require user confirmation before writing or overwriting external workspace resources. Show the provider, resource type, target, mode, and content/data summary.
- Require user confirmation before approving DingTalk OA items. Show the title or instance id, task id, and exact remark.
- Audit read and write actions: actor, platform, destination, action type, timestamp, and result.
- Redact message payloads in operational logs unless explicitly needed for debugging in a secure environment.
- Deduplicate webhook events by `platform + message_id` to avoid repeated storage or repeated actions.
- Store only work identity handles needed for routing when using identity mappings. Do not store private phone numbers, tokens, cookies, or unrelated personal data as aliases.
- Keep Tencent Docs OAuth/OpenAPI credentials and MCP tokens in connector-service environment or secret storage only.

## Workspace Write Safety

Workspace writes default to dry-run via `CN_WORKSPACE_DRY_RUN`. Production deployments must:

- Keep dry-run enabled during onboarding and test against non-sensitive documents first.
- Require explicit confirmation for doc/sheet/base/whiteboard writes.
- Avoid overwriting existing resources unless the user explicitly confirms overwrite mode.
- Log target ids, resource kinds, action type, and content length, not full secrets or tokens.
- Treat broad-access docs, finance sheets, customer-facing docs, and base schema changes as high-impact.

## Schedule Safety

Scheduled digests and messages are stored as pending records. This package does not start a hidden background sender. Workers must:

- Preview due records first unless the caller explicitly sets `execute: true`.
- Re-check permissions and destination before execution.
- Preserve the original confirmation summary for scheduled messages.
- Keep broad mentions and high-impact groups behind explicit review.
- Mark execution result in audit logs.

## Approval Safety

For DingTalk OA approvals:

- Read pending list, detail, tasks, and records separately.
- Treat stale pending-list membership as possible until task and record checks confirm the current state.
- Reject approval calls without `confirmed_by_user`.
- Keep dry-run mode enabled until the organization validates the workflow.
- Store task id, remark length, and confirmation summary in audit metadata, not platform credentials.
