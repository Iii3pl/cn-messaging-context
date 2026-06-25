---
name: workspace-docs
description: Read, write, and publish Feishu/Lark, DingTalk, and Tencent Docs documents, sheets, bases/smartsheets, whiteboards, boards, slides, mind maps, and flowcharts.
---

# Workspace Docs

Use this skill when the user asks to publish a messaging summary, read or write a collaborative document, update an online sheet, append records to a base/smartsheet, or update a whiteboard/board.

## Supported Providers

- Feishu/Lark: docs, sheets, Base/smartsheet, whiteboard.
- DingTalk: docs, online sheet, AI table/base. Whiteboard-like content depends on the current `dws` product surface.
- Tencent Docs: OpenAPI/OAuth or Tencent Docs MCP bridge configured in the connector environment; supports Tencent Docs resource families such as Word/Excel/PPT, smart document, smartsheet, mind map, flowchart, and board-style resources when the tenant API exposes them.

## Workflow

1. Use `check_workspace_status` when setup or provider coverage is unclear.
2. Use `read_workspace_resource` for reads.
3. For writes, show the provider, resource type, target, mode, and content/data summary first.
4. Call `write_workspace_resource` only after explicit user confirmation.
5. For messaging reports, use `publish_summary_doc` after confirming the destination and title.

## Feishu User Permission Fallback

For Feishu/Lark docs, sheets, Base/smartsheets, and whiteboards, the bot may not have enough access even when the user can open the resource. If a read fails because of access, ask:

```md
机器人现在看不到这个飞书资源。要不要我用你的飞书账号权限只读这一次？
我不会写入或修改内容。
```

After the user agrees, call `read_workspace_resource` with `access_identity: "auto"`, `allow_user_fallback: true`, `user_consent_confirmed: true`, and a short `consent_summary`. Do not use user permission for writes unless a future adapter explicitly supports and documents that flow.

## Confirmation Contract

```md
Provider: <feishu | dingtalk | tencent>
Resource: <doc | sheet | base | whiteboard | ...>
Target: <target id/url or new document>
Mode: <create | append | overwrite | update | insert>
Summary:
<what will be written>
```

## Boundaries

- Do not store platform tokens or Tencent Docs credentials in plugin files or Codex context.
- Do not use user permission for Feishu reads unless the user explicitly agrees in the current task.
- Do not claim Tencent Docs is connected until `check_workspace_status` shows credentials or a bridge are configured.
- Do not overwrite external documents, sheets, bases, or boards without explicit confirmation.
- For sheets and bases, use real field/table/sheet ids returned by the platform; do not invent ids.
