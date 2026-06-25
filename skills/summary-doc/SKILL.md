---
name: summary-doc
description: Create Slack Canvas-style Markdown summary documents from Feishu/Lark and DingTalk activity.
---

# Summary Document

Use this skill when the user asks for a document, canvas-style summary, shareable report, or reusable meeting/chat digest.

## Workflow

1. Call `create_summary_doc` with the requested platform, conversations, topics, and time window.
2. Return the Markdown document in chat unless the user asks to publish it elsewhere.
3. If the user asks to send the document to a group, switch to [../message-reply/SKILL.md](../message-reply/SKILL.md).

## Output

The document should include:

- Scope and coverage notes.
- Daily digest.
- Personal triage.
- Reply candidates.
- Clear caveats about unsynced messages or partial connector coverage.
