---
name: scheduled-workflows
description: Create, list, and cancel safe schedule records for future digests or messages.
---

# Scheduled Workflows

Use this skill when the user asks to schedule a digest, schedule a message, list scheduled actions, or cancel a scheduled action.

## Safety

- `schedule_daily_digest` creates a pending schedule record. It does not run by itself unless a deployment adds a scheduler.
- `schedule_message` requires the same explicit confirmation as `send_message`.
- Never imply that a scheduled item has been delivered unless a future executor marks it completed.
- Treat customer groups, finance groups, approval groups, and broad mentions as high-impact.

## Workflow

1. For digests, call `schedule_daily_digest` with the requested scope and `scheduled_for`.
2. For messages, show the platform, destination, scheduled time, and exact message text before calling `schedule_message`.
3. Use `list_scheduled_actions` to review pending records.
4. Use `cancel_scheduled_action` to cancel by id.

## Confirmation Contract For Messages

```md
Platform: <feishu | dingtalk>
Destination: <conversation name or id>
Scheduled for: <time>
Message:
<exact text>
```
