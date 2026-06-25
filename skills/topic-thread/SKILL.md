---
name: topic-thread
description: Read Feishu/Lark and DingTalk native threads when available, or map activity into Slack-thread-like topic timelines.
---

# Topic Thread

Use this skill when the user asks to read a native thread, group messages by topic, trace a decision, or understand a topic's timeline.

## Workflow

1. If the user provides a message id, thread id, root id, or asks for "this message's thread", call `read_native_thread` first.
2. If no native thread is available, call `map_conversation_topics` to discover topics from the requested platform, conversations, topics, and time window.
3. Call `read_topic_thread` for the topic the user cares about.
4. Use `anchor_message_id` when the user points at a specific message but no native thread id exists.
5. Preserve exact group names, owners, blockers, customer names, and timestamps.

## Output Shape

Prefer:

```md
**Topic Thread - <topic>**
**Timeline**
- ...

**Decisions**
- ...

**Blockers**
- ...

**Notes**
- ...
```

Call the result a native Feishu or DingTalk thread only when `read_native_thread` returns native thread messages. Otherwise, call it a topic-centered timeline from normalized messages.
