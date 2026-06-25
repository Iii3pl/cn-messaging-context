# New User Setup Guide

This guide is for teammates who want to use `cn-messaging-context` with Codex or WorkBuddy.

## Fast Path

```bash
git clone https://github.com/Iii3pl/cn-messaging-context
cd cn-messaging-context
npm run agent:install
```

The install agent will:

- Install package dependencies.
- Build the plugin.
- Start the small local connector service.
- Register and install the Codex personal plugin.
- Generate a WorkBuddy MCP config file.
- Check Feishu/Lark CLI, DingTalk DWS CLI, and Tencent Docs OpenAPI configuration.

To only check your environment:

```bash
npm run agent:install -- --check-only
```

To print the full step-by-step guide in the terminal:

```bash
npm run agent:install -- --guide
```

## 1. Base Dependencies

Install these first:

- Node.js 20 or newer.
- npm, bundled with Node.js.
- Git.
- Codex CLI, if you want Codex plugin installation.

Check:

```bash
node --version
npm --version
git --version
codex --version
```

## 2. Feishu / Lark CLI

Install:

```bash
npx @larksuite/cli@latest install
```

Initialize and sign in:

```bash
lark-cli config init
lark-cli auth login --recommend
lark-cli auth status
lark-cli doctor
```

Useful checks:

```bash
lark-cli im --help
lark-cli docs --help
lark-cli sheets --help
lark-cli base --help
lark-cli whiteboard --help
```

Notes:

- The plugin uses bot/app access first.
- If bot/app access cannot read a Feishu group or document, Codex asks before using user permission for a one-time read.
- Do not paste app secrets or tokens into Codex chat. Keep them in the CLI/keychain or connector environment.

Reference: [Lark/Feishu CLI GitHub](https://github.com/larksuite/cli), [Feishu Open Platform Docs](https://open.feishu.cn/document/).

## 3. DingTalk DWS CLI

Install:

```bash
npm install -g dingtalk-workspace-cli
```

Sign in and check:

```bash
dws auth login
dws auth status
dws doctor
```

Useful checks:

```bash
dws chat --help
dws doc --help
dws sheet --help
dws aitable --help
dws oa --help
```

Notes:

- DingTalk group messages, docs, sheets, AI tables, and OA approvals depend on the permissions available to the signed-in DingTalk account and organization.
- If OA approval actions are enabled, keep plugin preview-first mode on until the organization has tested the workflow.
- `approve_dingtalk_approval` still requires the user to confirm the exact approval and remark.

Package reference: [dingtalk-workspace-cli on npm](https://www.npmjs.com/package/dingtalk-workspace-cli).

## 4. Tencent Docs

Tencent Docs support currently uses connector-side OpenAPI/OAuth credentials or a future MCP bridge. It is not stored in plugin files.

Set these in the connector service environment:

```bash
export TENCENT_DOCS_ACCESS_TOKEN=...
export TENCENT_DOCS_OPEN_ID=...
```

Optional:

```bash
export TENCENT_DOCS_CLIENT_ID=...
export TENCENT_DOCS_API_BASE=https://docs.qq.com
export TENCENT_DOCS_MCP_TOKEN=...
```

Restart the connector service after setting credentials, then check:

```bash
curl http://127.0.0.1:8787/workspace/status
```

Reference: [Tencent Docs](https://docs.qq.com/).

## 5. Codex Installation

The install agent handles this automatically. Manual steps are:

```bash
npm install
npm run build
CN_MESSAGING_STORE=sqlite npm run start:connector
codex plugin add cn-messaging-context@personal
```

If Codex cannot find the plugin, run the install agent again:

```bash
npm run agent:install -- --codex-only
```

Then open a new Codex session.

## 6. WorkBuddy Installation

The install agent writes a WorkBuddy MCP config file under the plugin data directory. It looks like:

```json
{
  "mcpServers": {
    "cn-messaging-context": {
      "command": "node",
      "args": [
        "/absolute/path/to/cn-messaging-context/dist/mcp/server.js"
      ],
      "env": {
        "CN_MESSAGING_CONNECTOR_URL": "http://127.0.0.1:8787"
      }
    }
  }
}
```

Copy that block into WorkBuddy's MCP settings and keep the connector service running.

## 7. First Test Prompts

Try read-only tasks first:

- "检查插件连接状态。"
- "列出今天真正 @ 我的飞书和钉钉消息。"
- "看看钉钉有哪些待审批，先不要通过。"
- "读取这份腾讯文档在线表格并总结。"

Then try write or action tasks only after confirming preview-first mode:

- "把今天群聊摘要发布到飞书文档，先预览。"
- "根据钉钉上下文草拟回复，先别发。"

## Safety Defaults

- Sending messages, writing docs/sheets, and approving OA items require user confirmation.
- Preview-first mode is on by default.
- Secrets stay in CLI/keychain, environment variables, or a secret manager, not in plugin files.
- GitHub issue reporting redacts secrets and defaults to preview mode.
