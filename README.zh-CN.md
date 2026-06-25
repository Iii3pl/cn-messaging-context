# 飞书 / 钉钉 / 腾讯文档上下文插件

[English](./README.md) | 中文

`cn-messaging-context` 是一个把 Codex / WorkBuddy 接入飞书、钉钉和腾讯文档工作上下文的插件包。

它的目标不是让 Codex 自己长期跑在聊天软件里，而是把能力分成三层：

- Codex Plugin：提供技能说明、用户体验和安全规则。
- MCP 工具层：让 Codex / WorkBuddy 能调用“查消息、总结、草拟、发送、审批、读写文档”等工具。
- 独立连接器服务：负责飞书/钉钉事件接收、历史同步、消息存储、权限检查、文档读写、审计和报错上报。

## 能做什么

- 查询飞书 / Lark、钉钉群聊和单聊消息。
- 生成群聊日报、重点消息、决策、待办和风险。
- 找出今天真正需要你看的 @ 消息、未读会话和待回复项。
- 根据上下文草拟回复，但默认不发送。
- 用户确认后发送飞书或钉钉消息。
- 查询钉钉 OA 待审批、详情、任务和审批流水。
- 用户确认后通过钉钉 OA 审批。
- 发布摘要到飞书文档、钉钉文档、在线表格、多维表格 / AI 表格、白板等工作区资源。
- 读取腾讯文档资源，当前通过连接器侧 OpenAPI/OAuth 凭据或 MCP 桥接。
- 当飞书机器人/应用权限读不到群聊或文档时，先询问用户，再用用户权限只读本次请求。
- 把连接器错误脱敏整理成 GitHub Issues，方便后续排查。
- 给新人提供一键安装和 step-by-step 环境检查。

## 一键安装

```bash
git clone https://github.com/Iii3pl/cn-messaging-context
cd cn-messaging-context
npm run agent:install
```

安装助手会自动完成：

- 安装依赖。
- 构建插件。
- 启动本机插件小服务。
- 写入 Codex 个人插件市场。
- 安装 `cn-messaging-context@personal`。
- 生成 WorkBuddy MCP 配置。
- 检查飞书 CLI、钉钉 DWS CLI、腾讯文档 OpenAPI 配置。

只检查环境：

```bash
npm run agent:install -- --check-only
```

打印完整新人向导：

```bash
npm run agent:install -- --guide
```

更多新人开箱说明见 [docs/onboarding.md](./docs/onboarding.md)。

## 平台依赖

### 飞书 / Lark

安装飞书 CLI：

```bash
npx @larksuite/cli@latest install
```

登录和检查：

```bash
lark-cli config init
lark-cli auth login --recommend
lark-cli auth status
lark-cli doctor
```

参考：[Lark/Feishu CLI](https://github.com/larksuite/cli)、[飞书开放平台文档](https://open.feishu.cn/document/)。

### 钉钉

安装钉钉 DWS CLI：

```bash
npm install -g dingtalk-workspace-cli
```

登录和检查：

```bash
dws auth login
dws auth status
dws doctor
```

参考：[dingtalk-workspace-cli on npm](https://www.npmjs.com/package/dingtalk-workspace-cli)。

### 腾讯文档

腾讯文档当前走连接器侧 OpenAPI/OAuth 凭据或 MCP 桥接，不把密钥写进插件文件。

常用环境变量：

```bash
export TENCENT_DOCS_ACCESS_TOKEN=...
export TENCENT_DOCS_OPEN_ID=...
```

可选：

```bash
export TENCENT_DOCS_CLIENT_ID=...
export TENCENT_DOCS_API_BASE=https://docs.qq.com
export TENCENT_DOCS_MCP_TOKEN=...
```

配置后重启连接器，再检查：

```bash
curl http://127.0.0.1:8787/workspace/status
```

## Codex 使用方式

一键安装成功后，新开一个 Codex 会话即可使用。

可以这样问：

- “总结飞书里昨天关于采购平台的讨论。”
- “从钉钉项目群找最近三天的预算调整消息。”
- “整理今天真正需要我看的钉钉消息。”
- “看看钉钉 OA 有哪些待审批，先不要通过。”
- “根据飞书上下文帮我起草回复，先别发。”
- “把今天群聊摘要发布到飞书文档，先预览。”

如果需要手动安装：

```bash
npm install
npm run build
CN_MESSAGING_STORE=sqlite npm run start:connector
codex plugin add cn-messaging-context@personal
```

## WorkBuddy 使用方式

把它作为普通 MCP server 接入 WorkBuddy。

安装助手会生成一份可复制的配置，形如：

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

同时保持连接器服务运行：

```bash
CN_MESSAGING_STORE=sqlite npm run start:connector
```

## 安全边界

- 默认先预览，不会真的发送消息、写文档或通过审批。
- 发送消息必须先展示平台、目标群/人和完整正文，并获得用户确认。
- 写文档、表格、白板等外部资源前必须先确认目标、模式和内容摘要。
- 通过钉钉 OA 审批前必须先展示审批标题、实例、任务和备注，并获得用户确认。
- 飞书用户权限只用于只读补救，并且必须在当前任务里得到用户同意。
- 密钥、令牌、Cookie、app secret、webhook secret 不要写入插件文件，也不要发到 Codex 对话里。
- GitHub Issue 报错上报会脱敏，默认只预览，不真提交。

## 项目结构

```text
.codex-plugin/plugin.json     Codex 插件描述
.codebuddy-plugin/plugin.json CodeBuddy 插件描述
.mcp.json                     MCP server 入口
skills/                       Codex / WorkBuddy 技能说明
src/mcp/                      MCP 工具层
src/connector/                本机连接器服务
scripts/install-agent.mjs     一键安装和新人引导
docs/                         安装、API、架构、安全和审计文档
```

## 相关文档

- [新人开箱安装](./docs/onboarding.md)
- [安装指南](./docs/install.md)
- [Codex / CodeBuddy / WorkBuddy 打包](./docs/codebuddy-workbuddy.md)
- [连接器 API](./docs/connector-api.md)
- [安全说明](./docs/security.md)
- [架构说明](./docs/architecture.md)
