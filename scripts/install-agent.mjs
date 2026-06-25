#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const pluginName = "cn-messaging-context";
const connectorUrl = "http://127.0.0.1:8787";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
if (options.guide) {
  printPlatformGuide();
  process.exit(0);
}

const targetDir = path.resolve(expandHome(options.target ?? "~/plugins/cn-messaging-context"));
const marketplacePath = path.resolve(expandHome(options.marketplace ?? "~/.claude-plugin/marketplace.json"));
const workbuddyConfigPath = path.resolve(expandHome(options.workbuddyConfig ?? path.join(targetDir, ".data/workbuddy-mcp.json")));

await main();

async function main() {
  step("检查本机环境");
  requireCommand("node");
  requireCommand("npm");

  if (options.codex) {
    requireCommand("codex");
  }

  const platformStatus = checkPlatformCliStatus();
  printPlatformStatus(platformStatus);

  if (options.checkOnly) {
    console.log("");
    console.log("检查完成。上面显示“还没装好”的项目，可以按提示逐个处理。");
    return;
  }

  if (options.installPlatformCli) {
    await installMissingPlatformCli(platformStatus);
  }

  if (!options.skipBuild) {
    step("安装依赖并构建插件");
    await run("npm", ["install"], { cwd: repoRoot });
    await run("npm", ["run", "build"], { cwd: repoRoot });
  }

  step("准备本机插件目录");
  await copyPluginRoot(repoRoot, targetDir);

  if (!options.noStartConnector) {
    step("启动或检查插件小服务");
    await ensureConnector(targetDir);
  }

  if (options.codex) {
    step("登记到 Codex 个人插件市场");
    await ensureMarketplace(marketplacePath, targetDir);
    await tryRun("codex", ["plugin", "marketplace", "add", "~"], { cwd: targetDir });
    await run("codex", ["plugin", "add", `${pluginName}@personal`], { cwd: targetDir });
  }

  if (options.workbuddy) {
    step("生成 WorkBuddy MCP 配置");
    await writeWorkBuddyConfig(workbuddyConfigPath, targetDir);
  }

  console.log("");
  console.log("安装助手完成。");
  console.log(`- 插件目录：${targetDir}`);
  console.log(`- 插件小服务：${connectorUrl}`);
  if (options.codex) {
    console.log("- Codex：已安装 cn-messaging-context@personal；新开一个 Codex 会话后生效。");
  }
  if (options.workbuddy) {
    console.log(`- WorkBuddy：MCP 配置已生成到 ${workbuddyConfigPath}`);
  }
  console.log("- 默认先预览，不会真的发送消息、写文档或通过审批。");
}

function parseArgs(args) {
  const parsed = {
    codex: true,
    workbuddy: true,
    noStartConnector: false,
    skipBuild: false,
    checkOnly: false,
    installPlatformCli: false,
    guide: false,
    help: false,
    target: undefined,
    marketplace: undefined,
    workbuddyConfig: undefined
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--codex-only") parsed.workbuddy = false;
    else if (arg === "--workbuddy-only") parsed.codex = false;
    else if (arg === "--no-start-connector") parsed.noStartConnector = true;
    else if (arg === "--skip-build") parsed.skipBuild = true;
    else if (arg === "--check-only") parsed.checkOnly = true;
    else if (arg === "--install-platform-cli") parsed.installPlatformCli = true;
    else if (arg === "--guide") parsed.guide = true;
    else if (arg.startsWith("--target=")) parsed.target = arg.slice("--target=".length);
    else if (arg.startsWith("--marketplace=")) parsed.marketplace = arg.slice("--marketplace=".length);
    else if (arg.startsWith("--workbuddy-config=")) parsed.workbuddyConfig = arg.slice("--workbuddy-config=".length);
    else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log([
    "cn-messaging-context 安装助手",
    "",
    "常用：",
    "  npm run agent:install",
    "",
    "可选：",
    "  npm run agent:install -- --codex-only",
    "  npm run agent:install -- --workbuddy-only",
    "  npm run agent:install -- --target=~/plugins/cn-messaging-context",
    "  npm run agent:install -- --no-start-connector",
    "  npm run agent:install -- --check-only",
    "  npm run agent:install -- --guide",
    "  npm run agent:install -- --install-platform-cli",
    "",
    "它会完成：安装依赖、构建插件、准备本机插件目录、启动插件小服务、安装到 Codex、生成 WorkBuddy MCP 配置。",
    "它也会检查飞书 lark-cli、钉钉 dws、腾讯文档 OpenAPI 配置，并告诉新人下一步。"
  ].join("\n"));
}

function step(message) {
  console.log(`\n> ${message}`);
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
}

function requireCommand(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(`没有找到 ${command}，请先安装或放到 PATH 里。`);
  }
}

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    ok: !result.error && result.status === 0,
    version: firstLine(result.stdout?.trim() || result.stderr?.trim() || "")
  };
}

function firstLine(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function checkPlatformCliStatus() {
  return {
    feishu: commandAvailable("lark-cli"),
    dingtalk: commandAvailable("dws", ["version"]),
    tencent: {
      ok: Boolean(process.env.TENCENT_DOCS_ACCESS_TOKEN && process.env.TENCENT_DOCS_OPEN_ID),
      version: undefined
    }
  };
}

function printPlatformStatus(status) {
  console.log("");
  console.log("平台依赖检查：");
  console.log(`- 飞书/Lark CLI：${status.feishu.ok ? `已安装 ${status.feishu.version ?? ""}` : "还没装好"}`);
  console.log(`- 钉钉 DWS CLI：${status.dingtalk.ok ? `已安装 ${status.dingtalk.version ?? ""}` : "还没装好"}`);
  console.log(`- 腾讯文档 OpenAPI：${status.tencent.ok ? "已配置基础凭据" : "还没配置 TENCENT_DOCS_ACCESS_TOKEN / TENCENT_DOCS_OPEN_ID"}`);
  if (!status.feishu.ok || !status.dingtalk.ok || !status.tencent.ok) {
    console.log("");
    console.log("新人下一步：");
    if (!status.feishu.ok) {
      console.log("- 飞书：运行 `npx @larksuite/cli@latest install`，然后运行 `lark-cli config init` 和 `lark-cli auth login --recommend`。");
    }
    if (!status.dingtalk.ok) {
      console.log("- 钉钉：运行 `npm install -g dingtalk-workspace-cli`，然后运行 `dws auth login`。如果企业还没开通 CLI 权限，按钉钉页面提示申请管理员授权。");
    }
    if (!status.tencent.ok) {
      console.log("- 腾讯文档：到腾讯文档开放平台准备 OAuth/OpenAPI 凭据，再把 `TENCENT_DOCS_ACCESS_TOKEN` 和 `TENCENT_DOCS_OPEN_ID` 放到插件小服务环境里。");
    }
    console.log("- 想看完整步骤：`npm run agent:install -- --guide`。");
  }
}

async function installMissingPlatformCli(status) {
  if (!status.feishu.ok) {
    step("安装飞书/Lark CLI");
    await run("npx", ["-y", "@larksuite/cli@latest", "install"], { cwd: repoRoot });
  }
  if (!status.dingtalk.ok) {
    step("安装钉钉 DWS CLI");
    await run("npm", ["install", "-g", "dingtalk-workspace-cli"], { cwd: repoRoot });
  }
  console.log("");
  console.log("平台 CLI 安装尝试已完成。接下来仍需要用户在浏览器里完成登录授权：");
  console.log("- 飞书：lark-cli config init && lark-cli auth login --recommend");
  console.log("- 钉钉：dws auth login && dws doctor");
}

function printPlatformGuide() {
  console.log([
    "cn-messaging-context 新人开箱安装向导",
    "",
    "第 1 步：准备基础环境",
    "- 安装 Node.js 20 或更新版本。",
    "- 确认 `node --version` 和 `npm --version` 能正常显示。",
    "- Codex 用户还需要确认 `codex --version` 能正常显示。",
    "",
    "第 2 步：安装插件本体",
    "```bash",
    "git clone https://github.com/Iii3pl/cn-messaging-context",
    "cd cn-messaging-context",
    "npm run agent:install",
    "```",
    "",
    "第 3 步：安装并登录飞书/Lark CLI",
    "```bash",
    "npx @larksuite/cli@latest install",
    "lark-cli config init",
    "lark-cli auth login --recommend",
    "lark-cli auth status",
    "lark-cli doctor",
    "```",
    "如果机器人看不到群或文档，插件会先问用户，再使用用户权限只读一次。",
    "",
    "第 4 步：安装并登录钉钉 DWS CLI",
    "```bash",
    "npm install -g dingtalk-workspace-cli",
    "dws auth login",
    "dws auth status",
    "dws doctor",
    "```",
    "如果企业还没开通 CLI 权限，按钉钉授权页面提示申请管理员开通。",
    "",
    "第 5 步：配置腾讯文档",
    "- 腾讯文档当前走 OpenAPI/OAuth 凭据或 MCP 桥接，不把密钥写进插件文件。",
    "- 在插件小服务环境里配置：",
    "```bash",
    "export TENCENT_DOCS_ACCESS_TOKEN=...",
    "export TENCENT_DOCS_OPEN_ID=...",
    "```",
    "- 然后重启插件小服务，再用 `check_workspace_status` 检查。",
    "",
    "第 6 步：验证",
    "```bash",
    "npm run agent:install -- --check-only",
    "curl http://127.0.0.1:8787/health",
    "```",
    "",
    "安全提醒：默认先预览，不会真的发送消息、写文档或通过审批。"
  ].join("\n"));
}

async function copyPluginRoot(source, target) {
  if (samePath(source, target)) {
    console.log("当前目录就是插件目录，跳过复制。");
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(source, target, {
    recursive: true,
    filter: (item) => {
      const relative = path.relative(source, item);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      return ![".git", ".data"].includes(parts[0]);
    }
  });
}

async function ensureConnector(pluginDir) {
  if (await isHealthy()) {
    console.log("插件小服务已经在运行。");
    return;
  }

  const dataDir = path.join(pluginDir, ".data");
  await mkdir(dataDir, { recursive: true });
  const logPath = path.join(dataDir, "connector.log");
  const child = spawn("npm", ["run", "start:connector"], {
    cwd: pluginDir,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      CN_MESSAGING_STORE: process.env.CN_MESSAGING_STORE ?? "sqlite",
      CN_MESSAGING_DATA_DIR: process.env.CN_MESSAGING_DATA_DIR ?? dataDir
    }
  });
  child.unref();
  await writeFile(path.join(dataDir, "connector.pid"), `${child.pid}\n`);
  await writeFile(logPath, "Connector started by install-agent. Use npm run start:connector for foreground logs.\n", { flag: "a" });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(500);
    if (await isHealthy()) {
      console.log("插件小服务已启动。");
      return;
    }
  }
  throw new Error("插件小服务启动后没有按时响应，请手动运行 npm run start:connector 查看原因。");
}

async function isHealthy() {
  try {
    const response = await fetch(`${connectorUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureMarketplace(marketplaceFile, pluginDir) {
  await mkdir(path.dirname(marketplaceFile), { recursive: true });
  const marketplace = existsSync(marketplaceFile)
    ? JSON.parse(await readFile(marketplaceFile, "utf8"))
    : {
        name: "personal",
        owner: { name: "Local" },
        metadata: {
          description: "Personal local Codex plugin marketplace.",
          version: "1.0.0"
        },
        plugins: []
      };

  marketplace.name = marketplace.name || "personal";
  marketplace.plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const entry = {
    name: pluginName,
    source: {
      source: "local",
      path: pluginDir
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL"
    },
    category: "Productivity"
  };
  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin?.name === pluginName);
  if (existingIndex >= 0) {
    marketplace.plugins[existingIndex] = entry;
  } else {
    marketplace.plugins.push(entry);
  }
  await writeFile(marketplaceFile, `${JSON.stringify(marketplace, null, 2)}\n`);
}

async function writeWorkBuddyConfig(file, pluginDir) {
  await mkdir(path.dirname(file), { recursive: true });
  const config = {
    mcpServers: {
      [pluginName]: {
        command: "node",
        args: [path.join(pluginDir, "dist/mcp/server.js")],
        env: {
          CN_MESSAGING_CONNECTOR_URL: connectorUrl
        }
      }
    }
  };
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}

async function run(command, args, options) {
  await runInternal(command, args, options, true);
}

async function tryRun(command, args, options) {
  await runInternal(command, args, options, false);
}

function runInternal(command, args, options, required) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", (error) => {
      if (required) reject(error);
      else resolve();
    });
    child.on("close", (code) => {
      if (code === 0 || !required) resolve();
      else reject(new Error(`${command} ${args.join(" ")} 失败，退出码 ${code}`));
    });
  });
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
