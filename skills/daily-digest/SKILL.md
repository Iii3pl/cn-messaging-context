---
name: daily-digest
description: Create Slack-style daily digests from Feishu/Lark and DingTalk conversations or topics.
---

# Daily Digest

Use this skill when the user asks for a daily recap, 今日摘要, 群聊日报, digest, or "今天重点消息".

## Workflow

1. Use `sync_history` first only when the user asks for live platform history or the connector coverage is clearly stale.
2. Call `create_daily_digest` with the requested platform, conversation ids, topics, and time window.
3. If the user asks for a shareable document, call `create_summary_doc` after the digest.
4. If the user asks to send the digest to a group, switch to [../message-reply/SKILL.md](../message-reply/SKILL.md).

## Output Shape

Use this structure:

```md
**Daily Messaging Digest - YYYY-MM-DD**
**Scope**
- ...

**Summary**
...

**Topic: ...**
- ...

**Needs attention**
- ...

**Notes**
- ...
```

Keep it compact and preserve exact group names, owners, dates, amounts, approval names, and customer/project names.
