---
name: installation-agent
description: Install cn-messaging-context into Codex or WorkBuddy with the one-command local install agent.
---

# Installation Agent

Use this skill when the user asks to install, set up, reinstall, or share a simple installation path for `cn-messaging-context`.

## Default Workflow

Run from the repository root:

```bash
npm run agent:install
```

This installs dependencies, builds the plugin, prepares the local plugin directory, starts the small connector service, registers the Codex personal marketplace entry, installs `cn-messaging-context@personal`, and writes a WorkBuddy MCP config file.

## Variants

- Codex only: `npm run agent:install -- --codex-only`
- WorkBuddy only: `npm run agent:install -- --workbuddy-only`
- Do not start the connector service: `npm run agent:install -- --no-start-connector`
- Custom plugin directory: `npm run agent:install -- --target=/absolute/path/cn-messaging-context`

## User-Facing Language

Say:

- "一条命令会帮你装依赖、构建插件、启动插件小服务，并安装到 Codex。"
- "WorkBuddy 会得到一份 MCP 配置，可以直接复制到它的设置里。"
- "默认先预览，不会真的发送消息、写文档或通过审批。"

Avoid making users reason about `marketplace.json`, cache folders, or local ports unless they ask for debugging details.
