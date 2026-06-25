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
| Drafting or sending messages | [../message-reply/SKILL.md](../message-reply/SKILL.md) |
| DingTalk OA approvals | [../approval-workflow/SKILL.md](../approval-workflow/SKILL.md) |

## Supported Actions

- List authorized conversations.
- Search messages by keyword, sender, conversation, and time window.
- Read recent context for a conversation.
- Summarize bounded conversation context.
- Generate structured group-chat reports with key messages, decisions, follow-ups, and risks.
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
- Use `draft_reply` for draft-first tasks.
- Use `send_message` only through [../message-reply/SKILL.md](../message-reply/SKILL.md).
- Use DingTalk approval tools only through [../approval-workflow/SKILL.md](../approval-workflow/SKILL.md).
