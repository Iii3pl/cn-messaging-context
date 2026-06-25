---
name: notification-triage
description: Triage Feishu/Lark and DingTalk activity into tasks for the user, worth-skimming items, and low-priority items.
---

# Notification Triage

Use this skill when the user asks what they need to read, reply to, decide, approve, or follow up from Feishu/Lark or DingTalk.

## Workflow

1. Use the user's requested time window. For "today", use the user's local day.
2. Call `triage_today`.
3. Pass `current_user` when the user name is known or provided.
4. If the triage identifies reply-worthy messages and the user asks for replies, call `draft_reply_queue`.
5. If an item is an OA approval, switch to [../approval-workflow/SKILL.md](../approval-workflow/SKILL.md) before any approve action.

## Output Shape

Use this structure:

```md
**Messaging Notification Triage - YYYY-MM-DD**
**Overview**
...

**Tasks for you**
- ...

**Worth skimming**
- ...

**Can ignore for now**
- ...

**Notes**
- ...
```

Do not imply exact unread state. This is a best-effort priority queue from available connector data.
