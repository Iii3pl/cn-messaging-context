import { spawn } from "node:child_process";
import type { ApprovalRecord, MessageRecord, Platform } from "../../shared/types.js";

export interface AdapterStatus {
  cli: "available" | "missing";
  command: string;
}

export interface SendResult {
  sent: boolean;
  dry_run: boolean;
  adapter: string;
  raw_result?: unknown;
}

export interface HistorySyncRequest {
  platform: Platform;
  tenant_id?: string;
  conversation_id?: string;
  query?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export async function checkCliStatus(): Promise<{ feishu: AdapterStatus; dingtalk: AdapterStatus }> {
  const [lark, dws] = await Promise.all([commandExists("lark-cli"), commandExists("dws")]);
  return {
    feishu: { cli: lark ? "available" : "missing", command: "lark-cli" },
    dingtalk: { cli: dws ? "available" : "missing", command: "dws" }
  };
}

export async function syncHistoryFromCli(request: HistorySyncRequest): Promise<MessageRecord[]> {
  if (request.platform === "feishu") {
    return syncFeishuHistory(request);
  }
  return syncDingTalkHistory(request);
}

export async function sendMessageViaCli(input: {
  platform: Platform;
  conversation_id: string;
  text: string;
  dry_run: boolean;
}): Promise<SendResult> {
  if (input.dry_run) {
    return { sent: false, dry_run: true, adapter: "cli" };
  }

  if (input.platform === "feishu") {
    const raw = await runJson("lark-cli", [
      "im",
      "+messages-send",
      "--chat-id",
      input.conversation_id,
      "--text",
      input.text,
      "--format",
      "json"
    ]);
    return { sent: true, dry_run: false, adapter: "lark-cli", raw_result: raw };
  }

  const raw = await runJson("dws", [
    "chat",
    "message",
    "send",
    "--group",
    input.conversation_id,
    "--title",
    "Codex 消息",
    "--text",
    input.text,
    "--format",
    "json"
  ]);
  return { sent: true, dry_run: false, adapter: "dws", raw_result: raw };
}

export async function listDingTalkPendingApprovals(limit: number): Promise<ApprovalRecord[]> {
  const raw = await runJson("dws", ["oa", "approval", "list-pending", "--size", String(limit), "--format", "json"]);
  return extractArray(raw).map(normalizeApproval).slice(0, limit);
}

export async function getDingTalkApprovalDetail(instanceId: string): Promise<unknown> {
  try {
    return await runJson("dws", ["oa", "approval", "detail", "--instance-id", instanceId, "--format", "json"]);
  } catch (error) {
    const recovered = recoverDwsExpPayload(error);
    if (recovered) {
      return {
        warning: "dws_detail_returned_business_error_but_expPayload_was_recovered",
        recovered
      };
    }
    throw error;
  }
}

export async function getDingTalkApprovalTasks(instanceId: string): Promise<unknown> {
  return runJson("dws", ["oa", "approval", "tasks", "--instance-id", instanceId, "--format", "json"]);
}

export async function getDingTalkApprovalRecords(instanceId: string): Promise<unknown> {
  return runJson("dws", ["oa", "approval", "records", "--instance-id", instanceId, "--format", "json"]);
}

export async function approveDingTalkApproval(input: {
  instance_id: string;
  task_id: string;
  remark: string;
  dry_run: boolean;
}): Promise<SendResult> {
  if (input.dry_run) {
    return { sent: false, dry_run: true, adapter: "dws" };
  }

  const raw = await runJson("dws", [
    "oa",
    "approval",
    "approve",
    "--instance-id",
    input.instance_id,
    "--task-id",
    input.task_id,
    "--remark",
    input.remark,
    "--format",
    "json"
  ]);
  return { sent: true, dry_run: false, adapter: "dws", raw_result: raw };
}

async function syncFeishuHistory(request: HistorySyncRequest): Promise<MessageRecord[]> {
  const args = [
    "im",
    "+messages-search",
    "--format",
    "json",
    "--page-size",
    String(request.limit ?? 50)
  ];
  if (request.conversation_id) {
    args.push("--chat-id", request.conversation_id);
  }
  if (request.query) {
    args.push("--query", request.query);
  }
  if (request.since) {
    args.push("--start", request.since);
  }
  if (request.until) {
    args.push("--end", request.until);
  }

  const raw = await runJson("lark-cli", args);
  return extractArray(raw).map((item) => normalizeCliMessage("feishu", item, request.tenant_id));
}

async function syncDingTalkHistory(request: HistorySyncRequest): Promise<MessageRecord[]> {
  const args = ["chat", "message", request.query ? "search" : "list-all", "--format", "json", "--limit", String(request.limit ?? 50)];
  const end = request.until ?? new Date().toISOString();
  const start = request.since ?? new Date(Date.parse(end) - 24 * 60 * 60 * 1000).toISOString();

  if (request.conversation_id) {
    args.push("--group", request.conversation_id);
  }
  if (request.query) {
    args.push("--keyword", request.query);
  }
  args.push("--start", start, "--end", end);

  const raw = await runJson("dws", args);
  return extractDingTalkMessages(raw).map((item) => normalizeCliMessage("dingtalk", item, request.tenant_id));
}

function normalizeCliMessage(platform: Platform, item: unknown, tenantId: string | undefined): MessageRecord {
  const data = item as Record<string, unknown>;
  const conversationId = firstString(data.conversation_id, data.conversationId, data.chat_id, data.chatId, data.openConversationId);
  const messageId = firstString(data.message_id, data.messageId, data.msgId, data.openMessageId, data.id);
  const sender = firstString(data.sender, data.senderNick, data.sender_name, data.from, data.senderUserId, data.senderStaffId, data.senderOpenDingTalkId);
  const text = firstString(data.text, data.content, data.message, nestedText(data.content), nestedText(data.text));
  const timestamp = firstString(data.timestamp, data.create_time, data.createTime, data.createAt, data.sendTime);

  return {
    tenant_id: tenantId,
    platform,
    conversation_id: conversationId ?? `unknown-${platform}-conversation`,
    conversation_name: firstString(data.conversation_name, data.conversationTitle, data.chat_name, data.chatName, data.title),
    message_id: messageId ?? `${platform}-${JSON.stringify(item).length}-${Date.now()}`,
    sender: sender ?? "unknown",
    sender_id: firstString(data.sender_id, data.senderUserId, data.senderStaffId),
    text: text ?? "",
    timestamp: timestampToIso(timestamp),
    raw_payload: item
  };
}

function normalizeApproval(item: unknown): ApprovalRecord {
  const data = item as Record<string, unknown>;
  return {
    platform: "dingtalk",
    instance_id: firstString(data.instance_id, data.instanceId, data.processInstanceId, data.id) ?? "unknown",
    title: firstString(data.title, data.name, data.processInstanceTitle, data.processName, data.approvalName),
    originator: firstString(data.originator, data.originatorName, data.submitter, data.userName),
    status: firstString(data.status, data.workflowStatus, data.processInstanceStatus, data.result),
    create_time: timestampToIso(firstString(data.create_time, data.createTime, data.createAt, data.gmtModified, data.startedAt)),
    raw_payload: item
  };
}

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  const data = raw as Record<string, unknown>;
  for (const key of ["items", "list", "records", "messages", "processInstanceList", "result", "data"]) {
    const value = data?.[key];
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      const nested = extractArray(value);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  return [];
}

function extractDingTalkMessages(raw: unknown): unknown[] {
  const data = raw as { result?: { conversationMessagesList?: Array<Record<string, unknown>> } };
  const conversations = data.result?.conversationMessagesList;
  if (!Array.isArray(conversations)) {
    return extractArray(raw);
  }

  return conversations.flatMap((conversation) => {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    return messages.map((message) => ({
      ...(message as Record<string, unknown>),
      openConversationId: conversation.openConversationId,
      title: conversation.title,
      singleChat: conversation.singleChat
    }));
  });
}

function nestedText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return firstString(parsed.text, parsed.content);
  } catch {
    return undefined;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

function timestampToIso(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function recoverDwsExpPayload(error: unknown): unknown | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) {
    return undefined;
  }

  try {
    const payload = JSON.parse(message.slice(jsonStart)) as { error?: { technical_detail?: string } };
    const detail = payload.error?.technical_detail;
    const marker = "expPayload: ";
    const markerIndex = detail?.indexOf(marker) ?? -1;
    if (!detail || markerIndex < 0) {
      return undefined;
    }

    const raw = detail.slice(markerIndex + marker.length).trim();
    try {
      return JSON.parse(raw);
    } catch {
      return {
        partial: true,
        processInstanceId: matchFirst(raw, /"processInstanceId":"([^"]+)"/),
        title: matchFirst(raw, /"title":"([^"]+)"/),
        businessId: matchFirst(raw, /"businessId":"([^"]+)"/),
        processCode: matchFirst(raw, /"processCode":"([^"]+)"/),
        technical_detail_preview: detail.slice(0, 1200)
      };
    }
  } catch {
    return undefined;
  }
}

function matchFirst(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1];
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await run(command, ["--help"], { parseJson: false, timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function runJson(command: string, args: string[]): Promise<unknown> {
  const output = await run(command, args, { parseJson: true, timeoutMs: 60000 });
  return JSON.parse(output);
}

function run(command: string, args: string[], options: { parseJson: boolean; timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, options.timeoutMs);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}: ${err || out}`));
        return;
      }
      if (options.parseJson && out.length === 0) {
        reject(new Error(`${command} returned empty output`));
        return;
      }
      resolve(out);
    });
  });
}
