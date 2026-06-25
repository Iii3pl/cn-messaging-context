---
name: wechat-context
description: Read local WeChat chats through wx-cli and route them into cn-messaging-context read-only workflows.
---

# WeChat Context

Use this skill when the user asks to read local WeChat messages, sessions, unread chats, or chat history.

## Prerequisites

The local machine needs `wx-cli`:

```bash
npm install -g @jackwener/wx-cli
wx --version
sudo wx init
```

`wx init` requires desktop WeChat to be installed and logged in. On macOS it may require the WeChat re-signing steps documented by `wx-cli`.

## Workflow

1. Use `check_integration_status` when setup is unclear.
2. Use `list_wechat_sessions` when the user names a WeChat chat imprecisely.
3. Use `list_wechat_unread` when the user asks for unread WeChat chats.
4. Use `sync_history` with `platform: "wechat"` to import local WeChat search/history/new messages into the connector store.
5. After sync, use `search_messages`, `get_recent_context`, `summarize_conversation`, `create_conversation_report`, `triage_today`, and digest tools with `platform: "wechat"`.

## Sync Patterns

- Search all local WeChat messages: `sync_history` with `platform: "wechat"` and `query`.
- Read one chat history: `sync_history` with `platform: "wechat"`, `conversation_id`, time window, and limit.
- Import new local messages: `sync_history` with `platform: "wechat"` and no query/conversation.

## Boundaries

- WeChat support is local and read-only.
- Do not send WeChat messages through this plugin.
- Do not upload raw WeChat databases, keys, or wx-cli cache files.
- Explain coverage clearly: the result depends on the local desktop WeChat database and successful `wx init`.
