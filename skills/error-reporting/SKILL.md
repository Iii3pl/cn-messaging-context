---
name: error-reporting
description: Turn connector or plugin errors into redacted GitHub Issues for later debugging.
---

# Error Reporting

Use this skill when a cn-messaging-context tool or connector route fails and the user wants the error captured for later repair.

## Workflow

1. Use `check_issue_reporter_status` when setup is unclear.
2. Summarize the error in human language: what the user was trying to do, what failed, and whether the action changed anything.
3. Call `report_connector_issue` with a concise title, summary, operation, error text, and safe context.
4. Keep `dry_run: true` unless the user or connector configuration clearly asks to create a real GitHub Issue.
5. If a real Issue is created, show the Issue link.

## Privacy

- Do not include full message text, document content, tokens, cookies, webhook signatures, app secrets, or private keys.
- Prefer counts, platform names, route names, resource kind, and time window over raw payloads.
- Keep the user-facing explanation simple: say "我已把这个错误整理成一个待修的问题单" instead of technical transport details.
