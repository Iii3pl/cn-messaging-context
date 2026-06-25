---
name: scheduled-workflows
description: Create, preview, execute, list, and cancel safe schedule records for future digests or messages.
---

# Scheduled Workflows

Use this skill when the user asks to schedule a digest, schedule a message, check due scheduled work, run scheduled work, list scheduled actions, or cancel a scheduled action.

## Safety

- `schedule_daily_digest` creates a pending schedule record.
- `run_due_scheduled_actions` previews due records by default. Use `execute: true` only when the user or a trusted worker explicitly asks to run due actions.
- `schedule_message` requires the same explicit confirmation as `send_message`.
- Never imply that a scheduled item has been delivered unless `run_due_scheduled_actions` returns a completed result.
- Scheduled messages still honor connector dry-run mode and the original user confirmation record.
- Treat customer groups, finance groups, approval groups, and broad mentions as high-impact.

## Workflow

1. For digests, call `schedule_daily_digest` with the requested scope and `scheduled_for`.
2. For messages, show the platform, destination, scheduled time, and exact message text before calling `schedule_message`.
3. Use `list_scheduled_actions` to review pending records.
4. Use `run_due_scheduled_actions` with `execute: false` to preview due records.
5. Use `run_due_scheduled_actions` with `execute: true` only after explicit instruction to run them.
6. Use `cancel_scheduled_action` to cancel by id.

## Confirmation Contract For Messages

```md
Platform: <feishu | dingtalk>
Destination: <conversation name or id>
Scheduled for: <time>
Message:
<exact text>
```
