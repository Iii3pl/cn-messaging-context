---
name: messaging-context
description: Route Feishu and DingTalk context tasks, choose the right workflow, and enforce read/write safety boundaries.
---

# Messaging Context

Use this as the router for Feishu and DingTalk work. Read the relevant context first, then switch to the most specific skill:

| Workflow | Skill |
| --- | --- |
| Feishu/Lark context search and summaries | [../feishu-context/SKILL.md](../feishu-context/SKILL.md) |
| DingTalk context search and summaries | [../dingtalk-context/SKILL.md](../dingtalk-context/SKILL.md) |
| Daily digests across channels or topics | [../daily-digest/SKILL.md](../daily-digest/SKILL.md) |
| Personal notification triage | [../notification-triage/SKILL.md](../notification-triage/SKILL.md) |
| Find and draft replies | [../reply-drafting/SKILL.md](../reply-drafting/SKILL.md) |
| Shareable summary documents | [../summary-doc/SKILL.md](../summary-doc/SKILL.md) |
| Topic/thread-style reading | [../topic-thread/SKILL.md](../topic-thread/SKILL.md) |
| Scheduled digests and messages | [../scheduled-workflows/SKILL.md](../scheduled-workflows/SKILL.md) |
| Drafting or sending messages | [../message-reply/SKILL.md](../message-reply/SKILL.md) |
| DingTalk OA approvals | [../approval-workflow/SKILL.md](../approval-workflow/SKILL.md) |

## Supported Actions

- List authorized conversations.
- Search messages by keyword, sender, conversation, and time window.
- Read recent context for a conversation.
- Summarize bounded conversation context.
- Generate structured group-chat reports with key messages, decisions, follow-ups, and risks.
- Generate Slack-style daily digests across selected conversations or topics.
- Triage messages into tasks for the user, worth-skimming items, and low-priority items.
- Find messages likely requiring replies and produce draft-only reply queues.
- Create Markdown summary documents similar to Slack Canvas summaries.
- Map messages into topic threads and read topic-centered timelines.
- Create, list, and cancel safe schedule records for future digests or messages.
- Draft replies from available context.
- Send a message only after the user confirms the exact platform, destination, and text.
- Read DingTalk OA approvals and approve only after exact user confirmation.

## Boundaries

- Do not claim workspace-wide coverage unless `check_integration_status` and the connector results support it.
- Do not invent channel names, message history, permissions, owners, or decisions.
- If a requested conversation is not visible, say that it may be disconnected, unauthorized, or missing from the connector service.
- Treat customer-facing groups, all-hands groups, finance/approval groups, and broad mentions as high-impact.
- Keep Feishu and DingTalk identifiers distinct. Do not map a DingTalk conversation to Feishu unless the connector explicitly returns that mapping.

## Tool Routing

- Use `check_integration_status` first when the user asks whether the integration is healthy.
- Use `list_conversations` when the destination or source group is ambiguous.
- Use `search_messages` for keyword or time-window searches.
- Use `get_recent_context` for "latest", "recent", or reply-thread style tasks.
- Use `summarize_conversation` for bounded summaries.
- Use `create_conversation_report` when the user asks for a daily report, group report, key messages, decisions, follow-ups, or risks.
- Use `create_daily_digest` for cross-group daily or weekly digests.
- Use `triage_today` when the user asks what needs their attention.
- Use `find_reply_candidates` and `draft_reply_queue` when the user asks what to reply to or wants prepared replies.
- Use `create_summary_doc` for shareable Markdown summaries.
- Use `map_conversation_topics` and `read_topic_thread` for Slack-thread-like topic exploration.
- Use `schedule_daily_digest`, `schedule_message`, `list_scheduled_actions`, and `cancel_scheduled_action` only through [../scheduled-workflows/SKILL.md](../scheduled-workflows/SKILL.md).
- Use `draft_reply` for draft-first tasks.
- Use `send_message` only through [../message-reply/SKILL.md](../message-reply/SKILL.md).
- Use DingTalk approval tools only through [../approval-workflow/SKILL.md](../approval-workflow/SKILL.md).
