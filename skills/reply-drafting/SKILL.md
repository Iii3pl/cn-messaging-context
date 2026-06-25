---
name: reply-drafting
description: Find Feishu/Lark or DingTalk messages likely requiring a response and prepare draft-only replies.
---

# Reply Drafting

Use this skill when the user asks who needs a reply, which messages need responses, or asks to prepare replies from messaging context.

## Workflow

1. Call `find_reply_candidates` for the requested platform, conversations, topics, and time window.
2. Read enough context with `search_messages` or `get_recent_context` when a candidate is ambiguous or high impact.
3. Call `draft_reply_queue` when the user wants draft text.
4. Do not send. If the user asks to send, switch to [../message-reply/SKILL.md](../message-reply/SKILL.md).

## Drafting Rules

- Keep each draft short and natural for Chinese workplace chat.
- If the source message is unclear, draft a clarifying reply instead of inventing facts.
- Preserve exact dates, owners, amounts, approval names, and commitments.
- Never promise approval, payment, delivery, or customer commitments unless the source context proves it.
