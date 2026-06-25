---
name: mention-state
description: Read platform-native @me, unread conversation, and message read-status surfaces for Feishu/Lark and DingTalk.
---

# Mention State

Use this skill when the user asks what unread messages, mentions, or read-status items need attention.

## Workflow

1. Use `list_real_mentions` for platform-native messages that mention the current user.
2. Use `list_unread_conversations` for platform-native unread conversation/feed state.
3. Use `query_message_read_status` when the user asks who has read a specific sent message.
4. Combine these tools with `triage_today` only after stating which parts came from native platform state and which parts came from text-based triage.

## Boundaries

- Do not call text search or `triage_today` a true unread state.
- Feishu/Lark unread state is exposed through feed/shortcut surfaces available to the current user; include adapter notes when coverage is partial.
- DingTalk mentions and unread conversations use `dws chat message list-mentions` and `list-unread-conversations`.
- Never mark messages as read or mutate notification settings from this skill.
