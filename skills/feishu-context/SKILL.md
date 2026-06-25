---
name: feishu-context
description: Read and summarize Feishu/Lark conversation context through the cn-messaging-context MCP tools.
---

# Feishu Context

Use this skill for Feishu/Lark message searches, recent-context reads, and conversation summaries.

## Workflow

1. If the user named a group imprecisely, call `list_conversations` with `platform: "feishu"` and a query.
2. For keyword questions, call `search_messages` with `platform: "feishu"` plus the user's query and time window.
3. For "latest" or "recent" questions, call `get_recent_context` with `platform: "feishu"`.
4. For summary requests, call `summarize_conversation` with `platform: "feishu"` and the bounded time/topic scope.
5. Report the result with clear caveats when the connector returned sparse or partial data.

## Output Shape

For summaries, prefer:

```md
**Feishu Summary - <conversation>**
**Overview**
<1-2 sentences>

**Decisions**
- ...

**Open Items**
- ...

**Risks / Gaps**
- ...
```

Omit empty sections. Keep exact group names, timestamps, owners, and message links or IDs when the connector provides them.

## Safety

- Do not read or infer from unauthorized groups.
- Do not present connector-local summaries as complete historical truth unless the connector status proves historical sync coverage.
- If the user asks to reply or send, switch to [../message-reply/SKILL.md](../message-reply/SKILL.md).
- If the user asks for daily digests, attention triage, reply queues, or summary documents, switch through [../messaging-context/SKILL.md](../messaging-context/SKILL.md).
