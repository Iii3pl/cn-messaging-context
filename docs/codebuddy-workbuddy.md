# CodeBuddy and WorkBuddy Packaging

This project includes both Codex and CodeBuddy plugin manifests while keeping the same MCP server and skills.

## CodeBuddy

CodeBuddy plugin packaging follows the same shape used here:

- `.codebuddy-plugin/plugin.json` for plugin metadata.
- `.mcp.json` for MCP server startup.
- `skills/` for workflow instructions.

Build once, then install or reference the package from CodeBuddy according to its plugin installation flow.

New teammates can run:

```bash
npm run agent:install
```

The installer prepares the shared build and writes a WorkBuddy MCP config file.

## WorkBuddy

If WorkBuddy only needs MCP access, use this package as a plain MCP server and keep the connector service running.

The fastest path is:

```bash
npm run agent:install -- --workbuddy-only
```

It writes a ready-to-copy MCP config under the plugin data directory.

Example MCP configuration:

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

Run the connector beside it:

```bash
CN_MESSAGING_STORE=sqlite \
CN_MESSAGING_DATA_DIR=/secure/path/cn-messaging-context \
npm run start:connector
```

## Shared Safety Rules

- Leave `CN_MESSAGING_DRY_RUN=true` until platform write actions have been tested.
- Enable `CN_MESSAGING_ENFORCE_AUTH=true` for tenant or group-level authorization.
- Require explicit user confirmation before `send_message` or `approve_dingtalk_approval`.
- Keep secrets in the connector deployment environment, never in plugin manifests.
- Use the Slack-style workflow tools for daily digests, personal triage, reply queues, and summary documents before deciding whether anything should be sent.
- Use [New User Setup Guide](./onboarding.md) for Feishu/Lark CLI, DingTalk DWS CLI, and Tencent Docs OpenAPI setup.
