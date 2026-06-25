import express from "express";
import path from "node:path";
import {
  approveDingTalkApproval,
  checkCliStatus,
  getDingTalkApprovalDetail,
  getDingTalkApprovalRecords,
  getDingTalkApprovalTasks,
  listDingTalkPendingApprovals,
  sendMessageViaCli,
  syncHistoryFromCli
} from "./adapters/cli.js";
import { normalizeDingTalkEvent, normalizeFeishuEvent } from "./normalizers.js";
import { rawBodySaver, verifyOptionalHmacSignature } from "./security.js";
import { SqliteStore } from "./sqlite-store.js";
import { JsonlStore, type MessageStore } from "./store.js";
import type { MessageRecord, Platform } from "../shared/types.js";

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.CN_MESSAGING_DATA_DIR ?? path.resolve(process.cwd(), ".data");
const storeMode = process.env.CN_MESSAGING_STORE ?? "jsonl";
const dryRunSend = process.env.CN_MESSAGING_DRY_RUN !== "false";
const enforceAuthorization = process.env.CN_MESSAGING_ENFORCE_AUTH === "true";

const store: MessageStore = storeMode === "sqlite" ? new SqliteStore(dataDir) : new JsonlStore(dataDir);
await store.ensure();

const app = express();
app.use(express.json({ limit: "2mb", verify: rawBodySaver }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/webhooks/feishu/events", asyncRoute(async (req, res) => {
  if (!verifyOptionalHmacSignature(req, process.env.FEISHU_WEBHOOK_SECRET, ["x-lark-signature", "x-feishu-signature"])) {
    res.status(401).json({ error: "invalid_feishu_signature" });
    return;
  }

  const record = normalizeFeishuEvent(req.body);
  record.tenant_id = tenantId(req);
  const result = await store.appendMessage(record);
  await store.appendAudit({
    action: "webhook.feishu.events",
    platform: "feishu",
    conversation_id: record.conversation_id,
    status: result.inserted ? "inserted" : "duplicate",
    metadata: { message_id: record.message_id }
  });
  res.json(result);
}));

app.post("/webhooks/dingtalk/events", asyncRoute(async (req, res) => {
  if (!verifyOptionalHmacSignature(req, process.env.DINGTALK_WEBHOOK_SECRET, ["x-dingtalk-signature"])) {
    res.status(401).json({ error: "invalid_dingtalk_signature" });
    return;
  }

  const record = normalizeDingTalkEvent(req.body);
  record.tenant_id = tenantId(req);
  const result = await store.appendMessage(record);
  await store.appendAudit({
    action: "webhook.dingtalk.events",
    platform: "dingtalk",
    conversation_id: record.conversation_id,
    status: result.inserted ? "inserted" : "duplicate",
    metadata: { message_id: record.message_id }
  });
  res.json(result);
}));

app.get("/conversations", asyncRoute(async (req, res) => {
  const platform = optionalPlatform(req.query.platform);
  const conversations = await store.listConversations({
    tenant_id: tenantId(req),
    platform,
    query: optionalString(req.query.query),
    limit: optionalNumber(req.query.limit, 50)
  });
  res.json({ conversations });
}));

app.get("/messages/search", asyncRoute(async (req, res) => {
  const messages = await store.searchMessages({
    tenant_id: tenantId(req),
    platform: optionalPlatform(req.query.platform),
    conversation_id: optionalString(req.query.conversation_id),
    query: optionalString(req.query.query),
    sender: optionalString(req.query.sender),
    since: optionalString(req.query.since),
    until: optionalString(req.query.until),
    limit: optionalNumber(req.query.limit, 50)
  });
  res.json({ messages });
}));

app.get("/messages/recent", asyncRoute(async (req, res) => {
  const platform = requirePlatform(req.query.platform);
  const conversationId = requireString(req.query.conversation_id, "conversation_id");
  await requireAuthorized(req, platform, conversationId);
  const messages = await store.searchMessages({
    tenant_id: tenantId(req),
    platform,
    conversation_id: conversationId,
    limit: optionalNumber(req.query.limit, 50)
  });
  res.json({ messages });
}));

app.post("/messages/summarize", asyncRoute(async (req, res) => {
  const body = req.body as {
    platform?: Platform;
    conversation_id?: string;
    query?: string;
    since?: string;
    until?: string;
    limit?: number;
  };
  const platform = requirePlatform(body.platform);
  const conversationId = requireString(body.conversation_id, "conversation_id");
  await requireAuthorized(req, platform, conversationId);
  const messages = await store.searchMessages({
    tenant_id: tenantId(req),
    platform,
    conversation_id: conversationId,
    query: body.query,
    since: body.since,
    until: body.until,
    limit: body.limit ?? 100
  });

  res.json({
    platform,
    conversation_id: conversationId,
    message_count: messages.length,
    summary: summarizeMessages(messages),
    messages
  });
}));

app.post("/messages/report", asyncRoute(async (req, res) => {
  const body = req.body as {
    platform?: Platform;
    conversation_id?: string;
    query?: string;
    since?: string;
    until?: string;
    limit?: number;
  };
  const platform = requirePlatform(body.platform);
  const conversationId = requireString(body.conversation_id, "conversation_id");
  await requireAuthorized(req, platform, conversationId);
  const messages = await store.searchMessages({
    tenant_id: tenantId(req),
    platform,
    conversation_id: conversationId,
    query: body.query,
    since: body.since,
    until: body.until,
    limit: body.limit ?? 200
  });

  res.json({
    platform,
    conversation_id: conversationId,
    message_count: messages.length,
    report: buildConversationReport(messages, { since: body.since, until: body.until, query: body.query }),
    messages
  });
}));

app.post("/messages/draft", asyncRoute(async (req, res) => {
  const body = req.body as {
    platform?: Platform;
    conversation_id?: string;
    intent?: string;
    tone?: string;
    context?: string;
  };
  const platform = requirePlatform(body.platform);
  const conversationId = requireString(body.conversation_id, "conversation_id");
  await requireAuthorized(req, platform, conversationId);
  const intent = requireString(body.intent, "intent");
  const tone = body.tone ?? "简洁、清楚、稳妥";
  const context = body.context ? `\n\n参考上下文：${body.context}` : "";

  res.json({
    platform,
    conversation_id: conversationId,
    mode: "draft_only",
    draft: `大家好，我这边先同步一下：${intent}\n\n我会按当前口径继续跟进，如有变化我再补充。${context}`,
    tone
  });
}));

app.post("/messages/send", asyncRoute(async (req, res) => {
  const body = req.body as {
    platform?: Platform;
    conversation_id?: string;
    text?: string;
    confirmed_by_user?: boolean;
    confirmation_summary?: string;
  };
  const platform = requirePlatform(body.platform);
  const conversationId = requireString(body.conversation_id, "conversation_id");
  const text = requireString(body.text, "text");
  await requireAuthorized(req, platform, conversationId);

  if (!body.confirmed_by_user) {
    res.status(400).json({ error: "user_confirmation_required" });
    return;
  }

  const audit = await store.appendAudit({
    action: "messages.send",
    tenant_id: tenantId(req),
    platform,
    conversation_id: conversationId,
    status: dryRunSend ? "dry_run" : "submitted",
    metadata: {
      text_length: text.length,
      confirmation_summary: body.confirmation_summary
    }
  });

  if (dryRunSend) {
    res.json({
      sent: false,
      dry_run: true,
      audit_id: audit.id,
      message: "Dry-run mode recorded the send request without calling Feishu or DingTalk."
    });
    return;
  }

  const result = await sendMessageViaCli({ platform, conversation_id: conversationId, text, dry_run: dryRunSend });
  res.json({ ...result, audit_id: audit.id });
}));

app.post("/sync/history", asyncRoute(async (req, res) => {
  const body = req.body as {
    platform?: Platform;
    conversation_id?: string;
    query?: string;
    since?: string;
    until?: string;
    limit?: number;
  };
  const platform = requirePlatform(body.platform);
  const messages = await syncHistoryFromCli({
    tenant_id: tenantId(req),
    platform,
    conversation_id: body.conversation_id,
    query: body.query,
    since: body.since,
    until: body.until,
    limit: body.limit ?? 50
  });

  let inserted = 0;
  for (const message of messages) {
    const result = await store.appendMessage(message);
    if (result.inserted) {
      inserted += 1;
    }
  }

  await store.appendAudit({
    action: "sync.history",
    tenant_id: tenantId(req),
    platform,
    conversation_id: body.conversation_id,
    status: "completed",
    metadata: {
      fetched: messages.length,
      inserted,
      query: body.query,
      since: body.since,
      until: body.until
    }
  });

  res.json({ platform, fetched: messages.length, inserted, messages });
}));

app.post("/authorizations/conversations", asyncRoute(async (req, res) => {
  const body = req.body as { platform?: Platform; conversation_id?: string; conversation_name?: string };
  const platform = requirePlatform(body.platform);
  const conversationId = requireString(body.conversation_id, "conversation_id");
  if (!store.authorizeConversation) {
    res.json({ authorized: true, mode: "implicit_jsonl", platform, conversation_id: conversationId });
    return;
  }
  await store.authorizeConversation({
    tenant_id: tenantId(req),
    platform,
    conversation_id: conversationId,
    conversation_name: body.conversation_name
  });
  res.json({ authorized: true, platform, conversation_id: conversationId });
}));

app.get("/approvals/dingtalk/pending", asyncRoute(async (req, res) => {
  const limit = optionalNumber(req.query.limit, 20);
  const approvals = await listDingTalkPendingApprovals(limit);
  await store.appendAudit({
    action: "approvals.dingtalk.pending",
    tenant_id: tenantId(req),
    platform: "dingtalk",
    status: "read",
    metadata: { count: approvals.length }
  });
  res.json({ approvals });
}));

app.get("/approvals/dingtalk/:instance_id/detail", asyncRoute(async (req, res) => {
  const instanceId = requireString(req.params.instance_id, "instance_id");
  const detail = await getDingTalkApprovalDetail(instanceId);
  res.json({ instance_id: instanceId, detail });
}));

app.get("/approvals/dingtalk/:instance_id/tasks", asyncRoute(async (req, res) => {
  const instanceId = requireString(req.params.instance_id, "instance_id");
  const tasks = await getDingTalkApprovalTasks(instanceId);
  res.json({ instance_id: instanceId, tasks });
}));

app.get("/approvals/dingtalk/:instance_id/records", asyncRoute(async (req, res) => {
  const instanceId = requireString(req.params.instance_id, "instance_id");
  const records = await getDingTalkApprovalRecords(instanceId);
  res.json({ instance_id: instanceId, records });
}));

app.post("/approvals/dingtalk/:instance_id/approve", asyncRoute(async (req, res) => {
  const body = req.body as { task_id?: string; remark?: string; confirmed_by_user?: boolean; confirmation_summary?: string };
  const instanceId = requireString(req.params.instance_id, "instance_id");
  const taskId = requireString(body.task_id, "task_id");
  const remark = requireString(body.remark, "remark");
  if (!body.confirmed_by_user) {
    res.status(400).json({ error: "user_confirmation_required" });
    return;
  }

  const audit = await store.appendAudit({
    action: "approvals.dingtalk.approve",
    tenant_id: tenantId(req),
    platform: "dingtalk",
    status: dryRunSend ? "dry_run" : "submitted",
    metadata: {
      instance_id: instanceId,
      task_id: taskId,
      remark_length: remark.length,
      confirmation_summary: body.confirmation_summary
    }
  });

  const result = await approveDingTalkApproval({ instance_id: instanceId, task_id: taskId, remark, dry_run: dryRunSend });
  res.json({ ...result, audit_id: audit.id });
}));

app.get("/integrations/status", asyncRoute(async (_req, res) => {
  const conversations = await store.listConversations({});
  const cli = await checkCliStatus();
  res.json({
    ok: true,
    platforms: {
      feishu: {
        webhook_secret_configured: Boolean(process.env.FEISHU_WEBHOOK_SECRET),
        history_sync: cli.feishu,
        real_send: dryRunSend ? "dry_run" : cli.feishu
      },
      dingtalk: {
        webhook_secret_configured: Boolean(process.env.DINGTALK_WEBHOOK_SECRET),
        history_sync: cli.dingtalk,
        oa_approval: cli.dingtalk,
        real_send: dryRunSend ? "dry_run" : cli.dingtalk
      }
    },
    connector: {
      data_dir: dataDir,
      store_mode: store.mode,
      dry_run_send: dryRunSend,
      enforce_authorization: enforceAuthorization,
      conversations: conversations.length,
      audit_events: await store.auditCount()
    }
  });
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.error(`cn-messaging connector listening on http://127.0.0.1:${port}`);
});

function summarizeMessages(messages: MessageRecord[]): string {
  if (messages.length === 0) {
    return "没有找到匹配消息。";
  }

  const latest = messages[0];
  const senders = [...new Set(messages.map((message) => message.sender).filter(Boolean))].slice(0, 8);
  const highlights = messages
    .slice(0, 5)
    .map((message) => `- ${message.timestamp} ${message.sender}: ${message.text}`)
    .join("\n");

  return [
    `共找到 ${messages.length} 条消息，最近一条来自 ${latest.sender}，时间 ${latest.timestamp}。`,
    `参与者：${senders.join("、") || "未知"}。`,
    "近期要点：",
    highlights
  ].join("\n");
}

function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function buildConversationReport(messages: MessageRecord[], filters: { since?: string; until?: string; query?: string }): string {
  if (messages.length === 0) {
    return "# 群聊报告\n\n没有找到匹配消息。";
  }

  const sorted = [...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const senders = [...new Set(sorted.map((message) => message.sender).filter(Boolean))];
  const decisions = sorted.filter((message) => /决定|确认|同意|通过|口径|结论|安排/.test(message.text)).slice(0, 8);
  const todos = sorted.filter((message) => /待办|跟进|需要|请|麻烦|负责|明天|今天|截止/.test(message.text)).slice(0, 8);
  const risks = sorted.filter((message) => /风险|问题|异常|缺失|不足|延期|失败|错误/.test(message.text)).slice(0, 8);

  return [
    "# 群聊报告",
    "",
    `范围：${filters.since ?? "未限定"} 至 ${filters.until ?? "未限定"}${filters.query ? `，关键词：${filters.query}` : ""}`,
    `消息数：${messages.length}，参与者：${senders.slice(0, 12).join("、") || "未知"}`,
    "",
    "## 关键消息",
    ...sorted.slice(-10).reverse().map((message) => `- ${message.timestamp} ${message.sender}: ${message.text}`),
    "",
    "## 决策/结论",
    ...(decisions.length > 0 ? decisions.map((message) => `- ${message.sender}: ${message.text}`) : ["- 暂未识别到明确决策。"]),
    "",
    "## 待跟进",
    ...(todos.length > 0 ? todos.map((message) => `- ${message.sender}: ${message.text}`) : ["- 暂未识别到明确待办。"]),
    "",
    "## 风险/异常",
    ...(risks.length > 0 ? risks.map((message) => `- ${message.sender}: ${message.text}`) : ["- 暂未识别到明显风险。"])
  ].join("\n");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function tenantId(req: express.Request): string {
  const header = req.header("x-tenant-id");
  return header && header.length > 0 ? header : "default";
}

async function requireAuthorized(req: express.Request, platform: Platform, conversationId: string): Promise<void> {
  if (!enforceAuthorization || !store.isConversationAuthorized) {
    return;
  }
  const authorized = await store.isConversationAuthorized({
    tenant_id: tenantId(req),
    platform,
    conversation_id: conversationId
  });
  if (!authorized) {
    throw new Error("conversation_not_authorized");
  }
}

function optionalPlatform(value: unknown): Platform | undefined {
  if (value === "feishu" || value === "dingtalk") {
    return value;
  }
  return undefined;
}

function requirePlatform(value: unknown): Platform {
  const platform = optionalPlatform(value);
  if (!platform) {
    throw new Error("platform must be feishu or dingtalk");
  }
  return platform;
}
