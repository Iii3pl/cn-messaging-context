---
name: topic-thread
description: Map Feishu/Lark and DingTalk activity into Slack-thread-like topics and read bounded topic timelines.
---

# Topic Thread

Use this skill when the user asks to group messages by topic, read a thread-like discussion, trace a decision, or understand a topic's timeline.

## Workflow

1. Call `map_conversation_topics` to discover topics from the requested platform, conversations, topics, and time window.
2. Call `read_topic_thread` for the topic the user cares about.
3. Use `anchor_message_id` when the user points at a specific message.
4. Preserve exact group names, owners, blockers, customer names, and timestamps.

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

Do not call this a native Feishu or DingTalk thread unless the platform adapter provides a real thread id. This skill creates a bounded topic-centered timeline from normalized messages.
