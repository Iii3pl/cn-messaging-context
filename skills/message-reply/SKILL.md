---
name: message-reply
description: Draft or send Feishu and DingTalk messages with explicit destination and user confirmation safeguards.
---

# Message Reply

Use this skill whenever the task involves writing outbound Feishu or DingTalk content.

## Intent Rules

- If the user asks for a draft, call `draft_reply` or write the draft in chat. Do not send.
- If the user asks to send, first show the platform, destination, and exact message text unless those were already confirmed in the latest user message.
- Call `send_message` only after explicit user confirmation.
- Never send to an unresolved or ambiguous destination.

## Confirmation Contract

Before sending, Codex must present:

```md
Platform: <feishu | dingtalk>
Destination: <conversation name or id>
Message:
<exact text>
```

Then wait for confirmation such as "确认发送", "可以发", or an equivalent direct approval.

When calling `send_message`, set:

- `confirmed_by_user: true`
- `confirmation_summary`: a short plain-language record of what the user confirmed

## Formatting

- Keep replies concise and natural for Chinese workplace chat.
- Preserve concrete dates, owners, amounts, approval names, and commitments from the source context.
- Do not invent decisions, approvals, or promises.
- Avoid broad mentions unless the user explicitly asked for them.

## High-Impact Sends

Pause for confirmation even if the user sounded casual when the destination is:

- customer-facing
- leadership or all-hands
- finance, legal, approval, or HR
- any group with broad mentions or external participants
