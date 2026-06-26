---
name: dingtalk-context
description: Read and summarize DingTalk conversation context through the cn-messaging-context MCP tools.
---

# DingTalk Context

Use this skill for DingTalk message searches, recent-context reads, and conversation summaries.

## Workflow

1. If the user named a group imprecisely, call `list_conversations` with `platform: "dingtalk"` and a query.
2. For keyword questions, call `search_messages` with `platform: "dingtalk"` plus the user's query and time window.
3. For recent activity, call `get_recent_context` with `platform: "dingtalk"`.
4. For a bounded recap, call `summarize_conversation` with `platform: "dingtalk"`.
5. For daily/group reports or "重点消息", call `create_conversation_report` with `platform: "dingtalk"`.
6. If the group is found and authorized but the report is empty, call `sync_history` with `platform: "dingtalk"`, the DingTalk `openConversationId`, a bounded `since`/`until` window, and then retry the report.
7. For cross-group daily digests, notification triage, or reply queues, switch to the daily/triage/reply skills from [../messaging-context/SKILL.md](../messaging-context/SKILL.md).
8. Explain whether the result is based on post-install message capture only or includes imported history.

## Output Shape

For summaries, prefer:

```md
**DingTalk Summary - <conversation>**
**Overview**
<1-2 sentences>

**Key Updates**
- ...

**Follow-ups**
- ...

**Coverage Notes**
- ...
```

Omit empty sections. Preserve DingTalk group names, approval references, owners, and timestamps when available.

## Safety

- Do not imply DingTalk historical coverage unless the connector has imported it.
- If authorization succeeds but no messages appear, say "这个群还没有同步到本地" before asking the user to re-authorize. Do not describe it as a missing group.
- If signature validation, bot membership, or scope looks broken, report that as an integration issue instead of guessing.
- If the user asks to reply or send, switch to [../message-reply/SKILL.md](../message-reply/SKILL.md).
- If the user asks about OA approvals, switch to [../approval-workflow/SKILL.md](../approval-workflow/SKILL.md).
