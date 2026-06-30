import { spawn } from "node:child_process";
import type { AccessIdentity, ApprovalRecord, MessageRecord, Platform, WritablePlatform } from "../../shared/types.js";

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
  access_identity?: AccessIdentity;
  allow_user_fallback?: boolean;
  user_consent_confirmed?: boolean;
  consent_summary?: string;
}

export async function checkCliStatus(): Promise<{ feishu: AdapterStatus; dingtalk: AdapterStatus; wechat: AdapterStatus }> {
  const [lark, dws, wx] = await Promise.all([commandExists("lark-cli"), commandExists("dws"), commandExists("wx")]);
  return {
    feishu: { cli: lark ? "available" : "missing", command: "lark-cli" },
    dingtalk: { cli: dws ? "available" : "missing", command: "dws" },
    wechat: { cli: wx ? "available" : "missing", command: "wx" }
  };
}

export async function syncHistoryFromCli(request: HistorySyncRequest): Promise<MessageRecord[]> {
  if (request.platform === "feishu") {
    return syncFeishuHistory(request);
  }
  if (request.platform === "wechat") {
    return syncWechatHistory(request);
  }
  return syncDingTalkHistory(request);
}

export async function sendMessageViaCli(input: {
  platform: WritablePlatform;
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
      const warning = "dws_detail_returned_business_error_but_expPayload_was_recovered";
      const isSaNodeError = isSaNodeParseError(error);
      return {
        warning,
        _saNode_parse_error: isSaNodeError,
        _fallback_hint: isSaNodeError
          ? "Use get_dingtalk_approval_detail_raw for full form_component_values. Requires app credentials with qyapi_aflow permission."
          : undefined,
        recovered
      };
    }
    throw error;
  }
}

/**
 * Fallback for when dws oa approval detail fails with saNode parse error.
 * Calls the DingTalk old OpenAPI (oapi.dingtalk.com) directly via dws api.
 * Requires: dws auth login with app credentials (AppKey+AppSecret) and qyapi_aflow permission.
 */
export async function getDingTalkApprovalDetailRaw(instanceId: string): Promise<unknown> {
  return runJson("dws", [
    "api",
    "POST",
    "/topapi/processinstance/get",
    "--base-url",
    "https://oapi.dingtalk.com",
    "--data",
    JSON.stringify({ process_instance_id: instanceId }),
    "--format",
    "json"
  ]);
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
  assertUserAccessConsent(request);
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

  const { raw, accessIdentity, userPermissionUsed } = await runWithFeishuAccessFallback({
    args,
    request,
    operation: "feishu_history_sync"
  });
  return extractArray(raw).map((item) => ({
    ...normalizeCliMessage("feishu", item, request.tenant_id),
    raw_payload: {
      item,
      access_identity: accessIdentity,
      user_permission_used: userPermissionUsed,
      consent_summary: userPermissionUsed ? request.consent_summary : undefined
    }
  }));
}

async function syncDingTalkHistory(request: HistorySyncRequest): Promise<MessageRecord[]> {
  const end = request.until ?? new Date().toISOString();
  const start = request.since ?? new Date(Date.parse(end) - 24 * 60 * 60 * 1000).toISOString();
  const args = buildDingTalkHistoryArgs(request, start, end);

  try {
    const raw = await runJson("dws", args);
    return extractDingTalkMessages(raw).map((item) => normalizeCliMessage("dingtalk", item, request.tenant_id));
  } catch (error) {
    throw improveDingTalkHistoryError(error, args);
  }
}

function buildDingTalkHistoryArgs(request: HistorySyncRequest, start: string, end: string): string[] {
  if (request.query) {
    const args = ["chat", "message", "search", "--format", "json", "--limit", String(request.limit ?? 50), "--keyword", request.query, "--start", start, "--end", end];
    if (request.conversation_id) {
      args.push("--group", request.conversation_id);
    }
    return args;
  }

  if (request.conversation_id) {
    return [
      "chat",
      "message",
      "list",
      "--format",
      "json",
      "--limit",
      String(request.limit ?? 50),
      "--group",
      request.conversation_id,
      "--time",
      dingTalkCliDateTime(start)
    ];
  }

  return [
    "chat",
    "message",
    "list-all",
    "--format",
    "json",
    "--limit",
    String(request.limit ?? 50),
    "--start",
    dingTalkCliDateTime(start),
    "--end",
    dingTalkCliDateTime(end)
  ];
}

async function syncWechatHistory(request: HistorySyncRequest): Promise<MessageRecord[]> {
  const args = request.query
    ? ["search", request.query, "--json"]
    : request.conversation_id
      ? ["history", request.conversation_id, "--json", "-n", String(request.limit ?? 50)]
      : ["new-messages", "--json"];

  if (request.query && request.conversation_id) {
    args.push("--in", request.conversation_id);
  }
  if (request.since) {
    args.push("--since", request.since);
  }
  if (request.until) {
    args.push("--until", request.until);
  }

  const raw = await runWechatJson(args);
  return extractArray(raw).slice(0, request.limit ?? 50).map((item) => {
    const message = normalizeCliMessage("wechat", item, request.tenant_id);
    if (request.conversation_id && message.conversation_id.startsWith("unknown-wechat")) {
      message.conversation_id = request.conversation_id;
    }
    return message;
  });
}

export async function listWechatSessions(limit: number): Promise<unknown> {
  const raw = await runWechatJson(["sessions", "--json"]);
  return { sessions: extractArray(raw).slice(0, limit), raw_result: raw };
}

export async function listWechatUnread(limit: number, filter?: string): Promise<unknown> {
  const args = ["unread", "--json"];
  if (filter) {
    args.push("--filter", filter);
  }
  const raw = await runWechatJson(args);
  return { unread: extractArray(raw).slice(0, limit), raw_result: raw };
}

async function runWechatJson(args: string[]): Promise<unknown> {
  try {
    const output = await run("wx", args, { parseJson: true, timeoutMs: 180000 });
    return JSON.parse(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/file is not a database|not a database|no such table|database disk image is malformed|密钥|decrypt|database/i.test(message)) {
      throw new Error("微信本地数据库还不能读取。请确认桌面微信已登录，然后运行 `sudo wx init --force` 重新初始化 wx-cli。");
    }
    throw error;
  }
}

function normalizeCliMessage(platform: Platform, item: unknown, tenantId: string | undefined): MessageRecord {
  const data = item as Record<string, unknown>;
  const conversationId = firstString(data.conversation_id, data.conversationId, data.chat_id, data.chatId, data.openConversationId, data.username, data.talker, data.chat, data.room_id, data.roomId);
  const messageId = firstString(data.message_id, data.messageId, data.msgId, data.msg_id, data.openMessageId, data.local_id, data.localId, data.server_id, data.serverId, data.id);
  const threadId = firstString(data.thread_id, data.threadId, data.root_id, data.rootId, data.parent_id, data.parentMessageId, data.parentMsgId);
  const parentMessageId = firstString(data.parent_message_id, data.parentMessageId, data.parentMsgId, data.parent_id, data.root_id, data.rootId);
  const sender = firstString(data.sender, data.senderNick, data.sender_name, data.senderName, data.from, data.from_user, data.fromUser, data.senderUserId, data.senderStaffId, data.senderOpenDingTalkId, data.sender_username, data.senderUsername, data.talker);
  const text = firstString(data.text, data.content, data.message, data.msg, data.body, nestedText(data.content), nestedText(data.text));
  const timestamp = firstString(data.timestamp, data.create_time, data.createTime, data.createAt, data.sendTime, data.time, data.datetime);
  const replyCount = firstNumber(data.reply_count, data.replyCount, data.replies);

  return {
    tenant_id: tenantId,
    platform,
    conversation_id: conversationId ?? `unknown-${platform}-conversation`,
    conversation_name: firstString(data.conversation_name, data.conversationTitle, data.chat_name, data.chatName, data.nickname, data.remark, data.title, data.name),
    message_id: messageId ?? `${platform}-${JSON.stringify(item).length}-${Date.now()}`,
    thread_id: threadId,
    parent_message_id: parentMessageId,
    reply_count: replyCount,
    is_thread_parent: replyCount === undefined ? undefined : replyCount > 0,
    sender: sender ?? "unknown",
    sender_id: firstString(data.sender_id, data.senderUserId, data.senderStaffId, data.sender_username, data.senderUsername, data.from_user, data.fromUser),
    mentions: extractMentions(data),
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

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function extractMentions(data: Record<string, unknown>): string[] | undefined {
  const raw = data.mentions ?? data.atUsers ?? data.at_users ?? data.mentionedUsers;
  const values: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        values.push(item);
      } else if (item && typeof item === "object") {
        values.push(...[
          firstString((item as Record<string, unknown>).name, (item as Record<string, unknown>).userName),
          firstString((item as Record<string, unknown>).userId, (item as Record<string, unknown>).staffId, (item as Record<string, unknown>).openId)
        ].filter((value): value is string => Boolean(value)));
      }
    }
  }
  return values.length > 0 ? [...new Set(values)] : undefined;
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

function dingTalkCliDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function improveDingTalkHistoryError(error: unknown, args: string[]): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/unknown flag: --group|flag provided but not defined:.*group/i.test(message) && args.includes("list-all")) {
    return new Error("钉钉群消息同步用了旧的全局历史命令。请升级 cn-messaging-context；新版会用 `dws chat message list --group <群ID>` 读取指定群。");
  }
  return error instanceof Error ? error : new Error(message);
}

function isSaNodeParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /saNode\s+parse\s+output\s+error/i.test(message);
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

function assertUserAccessConsent(request: Pick<HistorySyncRequest, "access_identity" | "allow_user_fallback" | "user_consent_confirmed">): void {
  if ((request.access_identity === "user" || request.allow_user_fallback) && !request.user_consent_confirmed) {
    throw new Error("需要先得到你的同意，才能用你的飞书账号权限读取群聊或文档。");
  }
}

async function runWithFeishuAccessFallback(input: {
  args: string[];
  request: Pick<HistorySyncRequest, "access_identity" | "allow_user_fallback" | "user_consent_confirmed" | "consent_summary">;
  operation: string;
}): Promise<{ raw: unknown; accessIdentity: AccessIdentity; userPermissionUsed: boolean }> {
  const primaryIdentity = input.request.access_identity ?? "auto";
  try {
    return {
      raw: await runJson("lark-cli", [...input.args, ...accessArgs(primaryIdentity)]),
      accessIdentity: primaryIdentity,
      userPermissionUsed: primaryIdentity === "user"
    };
  } catch (error) {
    if (primaryIdentity === "user" || !input.request.allow_user_fallback || !isPermissionLikeError(error)) {
      throw error;
    }
    assertUserAccessConsent(input.request);
    return {
      raw: await runJson("lark-cli", [...input.args, ...accessArgs("user")]),
      accessIdentity: "user",
      userPermissionUsed: true
    };
  }
}

function accessArgs(identity: AccessIdentity): string[] {
  if (identity === "auto") {
    return [];
  }
  return ["--as", identity];
}

function isPermissionLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /permission|forbidden|unauthori[sz]ed|scope|access denied|no access|无权限|权限不足|没有权限|未授权|91403|99991663/i.test(message);
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
