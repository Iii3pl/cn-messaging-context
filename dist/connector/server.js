import express from "express";
import path from "node:path";
import { approveDingTalkApproval, checkCliStatus, getDingTalkApprovalDetail, getDingTalkApprovalRecords, getDingTalkApprovalTasks, listDingTalkPendingApprovals, sendMessageViaCli, syncHistoryFromCli } from "./adapters/cli.js";
import { normalizeDingTalkEvent, normalizeFeishuEvent } from "./normalizers.js";
import { rawBodySaver, verifyOptionalHmacSignature } from "./security.js";
import { SqliteStore } from "./sqlite-store.js";
import { JsonlStore } from "./store.js";
const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.CN_MESSAGING_DATA_DIR ?? path.resolve(process.cwd(), ".data");
const storeMode = process.env.CN_MESSAGING_STORE ?? "jsonl";
const dryRunSend = process.env.CN_MESSAGING_DRY_RUN !== "false";
const enforceAuthorization = process.env.CN_MESSAGING_ENFORCE_AUTH === "true";
const store = storeMode === "sqlite" ? new SqliteStore(dataDir) : new JsonlStore(dataDir);
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
    const body = req.body;
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
    const body = req.body;
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
    const body = req.body;
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
app.post("/workflows/daily-digest", asyncRoute(async (req, res) => {
    const body = req.body;
    const messages = await getWorkflowMessages(req, body);
    const digest = buildDailyDigest(messages, body);
    await store.appendAudit({
        action: "workflows.daily_digest",
        tenant_id: tenantId(req),
        platform: body.platform,
        status: "read",
        metadata: { message_count: messages.length, since: body.since, until: body.until, topics: body.topics }
    });
    res.json({ message_count: messages.length, digest, messages: messages.slice(0, body.include_messages ? messages.length : 0) });
}));
app.post("/workflows/notification-triage", asyncRoute(async (req, res) => {
    const body = req.body;
    const messages = await getWorkflowMessages(req, body);
    const triage = buildNotificationTriage(messages, body.current_user, Boolean(body.include_can_ignore));
    await store.appendAudit({
        action: "workflows.notification_triage",
        tenant_id: tenantId(req),
        platform: body.platform,
        status: "read",
        metadata: { message_count: messages.length, current_user: body.current_user, since: body.since, until: body.until }
    });
    res.json({ message_count: messages.length, ...triage });
}));
app.post("/workflows/reply-candidates", asyncRoute(async (req, res) => {
    const body = req.body;
    const messages = await getWorkflowMessages(req, body);
    const candidates = findReplyCandidates(messages, body.current_user).slice(0, body.limit ?? 20);
    await store.appendAudit({
        action: "workflows.reply_candidates",
        tenant_id: tenantId(req),
        platform: body.platform,
        status: "read",
        metadata: { message_count: messages.length, candidates: candidates.length, current_user: body.current_user }
    });
    res.json({ message_count: messages.length, candidates });
}));
app.post("/workflows/draft-reply-queue", asyncRoute(async (req, res) => {
    const body = req.body;
    const messages = await getWorkflowMessages(req, body);
    const candidates = findReplyCandidates(messages, body.current_user).slice(0, body.limit ?? 10);
    const drafts = candidates.map((candidate) => ({
        candidate,
        draft: draftCandidateReply(candidate, body.tone)
    }));
    res.json({
        mode: "draft_only",
        message_count: messages.length,
        drafts
    });
}));
app.post("/workflows/summary-doc", asyncRoute(async (req, res) => {
    const body = req.body;
    const messages = await getWorkflowMessages(req, body);
    const digest = buildDailyDigest(messages, body);
    const triage = buildNotificationTriage(messages, body.current_user, false);
    const candidates = findReplyCandidates(messages, body.current_user).slice(0, 10);
    const document = buildSummaryDocument({
        title: body.title,
        messages,
        digest,
        triage,
        candidates,
        since: body.since,
        until: body.until,
        topics: body.topics
    });
    res.json({ message_count: messages.length, document });
}));
app.post("/messages/send", asyncRoute(async (req, res) => {
    const body = req.body;
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
    const body = req.body;
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
    const body = req.body;
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
    const body = req.body;
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
app.use((error, _req, res, _next) => {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
});
app.listen(port, "127.0.0.1", () => {
    console.error(`cn-messaging connector listening on http://127.0.0.1:${port}`);
});
function summarizeMessages(messages) {
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
function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}
function buildConversationReport(messages, filters) {
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
async function getWorkflowMessages(req, body) {
    const tenant_id = tenantId(req);
    const limit = Math.min(Math.max(body.limit ?? 500, 1), 1000);
    const conversationIds = body.conversation_ids?.filter(Boolean);
    const topicQuery = body.topics?.filter(Boolean).join(" ");
    if (conversationIds && conversationIds.length > 0) {
        const results = [];
        for (const conversation_id of conversationIds.slice(0, 30)) {
            if (body.platform) {
                await requireAuthorized(req, body.platform, conversation_id);
            }
            const messages = await store.searchMessages({
                tenant_id,
                platform: body.platform,
                conversation_id,
                since: body.since,
                until: body.until,
                limit
            });
            results.push(...messages);
        }
        return filterWorkflowTopics(uniqueMessages(results), body.topics).slice(0, limit);
    }
    const messages = await store.searchMessages({
        tenant_id,
        platform: body.platform,
        query: body.topics?.length === 1 ? topicQuery : undefined,
        since: body.since,
        until: body.until,
        limit
    });
    return filterWorkflowTopics(uniqueMessages(messages), body.topics);
}
function buildDailyDigest(messages, request) {
    if (messages.length === 0) {
        return [
            `**Daily Messaging Digest - ${dateLabel(request.since)}**`,
            "**Scope**",
            `- ${scopeLine(request)}`,
            "",
            "**Summary**",
            "没有找到匹配消息。",
            "",
            "**Notes**",
            "- 可能尚未同步对应平台/群聊的历史消息，或筛选范围过窄。"
        ].join("\n");
    }
    const topics = groupTopics(messages);
    const attention = findAttentionItems(messages).slice(0, 8);
    const volume = summarizeVolume(messages);
    return [
        `**Daily Messaging Digest - ${dateLabel(request.since)}**`,
        "**Scope**",
        `- ${scopeLine(request)}`,
        "",
        "**Summary**",
        `${volume}。重点集中在 ${topics.slice(0, 3).map((topic) => topic.name).join("、") || "日常协作"}。`,
        "",
        ...topics.slice(0, 4).flatMap((topic) => [
            `**Topic: ${topic.name}**`,
            ...topic.messages.slice(0, 4).map((message) => `- ${message.conversation_name ?? message.conversation_id}｜${message.sender}: ${trimText(message.text, 120)}`),
            ""
        ]),
        ...(attention.length > 0
            ? ["**Needs attention**", ...attention.map((item) => `- ${item.conversation_name ?? item.conversation_id}｜${item.sender}: ${trimText(item.text, 130)}`), ""]
            : []),
        "**Notes**",
        "- 摘要基于连接器当前已入库消息；未同步的群聊或历史窗口不会出现在结果中。"
    ].join("\n").trim();
}
function buildNotificationTriage(messages, currentUser, includeCanIgnore) {
    const tasks = findAttentionItems(messages)
        .filter((message) => !currentUser || message.sender !== currentUser)
        .slice(0, 12);
    const skim = messages
        .filter((message) => !tasks.includes(message))
        .filter((message) => /决定|确认|客户|风险|延期|预算|结算|审批|卡点|反馈|明天|截止/.test(message.text))
        .slice(0, 10);
    const ignore = includeCanIgnore
        ? messages.filter((message) => !tasks.includes(message) && !skim.includes(message)).slice(0, 8)
        : [];
    const triage = [
        `**Messaging Notification Triage - ${new Date().toISOString().slice(0, 10)}**`,
        "**Overview**",
        tasks.length > 0
            ? `找到 ${tasks.length} 条可能需要你阅读、回复或跟进的消息。`
            : "没有识别到明确需要你处理的消息。",
        "",
        "**Tasks for you**",
        ...(tasks.length > 0 ? tasks.map((message) => `- ${formatMessagePointer(message)}：${trimText(message.text, 130)}`) : ["- 暂无明确待处理项。"]),
        "",
        "**Worth skimming**",
        ...(skim.length > 0 ? skim.map((message) => `- ${formatMessagePointer(message)}：${trimText(message.text, 130)}`) : ["- 暂无。"]),
        ...(includeCanIgnore ? ["", "**Can ignore for now**", ...(ignore.length > 0 ? ignore.map((message) => `- ${formatMessagePointer(message)}：${trimText(message.text, 110)}`) : ["- 暂无。"])] : []),
        "",
        "**Notes**",
        "- 这是基于文本规则和已同步消息的辅助分诊；审批、客户群和财务群建议再看原上下文。"
    ].join("\n");
    return { triage, tasks_for_you: tasks, worth_skimming: skim, can_ignore_for_now: ignore };
}
function findReplyCandidates(messages, currentUser) {
    const sorted = [...messages].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const candidates = [];
    for (const message of sorted) {
        if (currentUser && message.sender === currentUser) {
            continue;
        }
        const reason = replyReason(message, currentUser);
        if (!reason) {
            continue;
        }
        candidates.push({
            platform: message.platform,
            conversation_id: message.conversation_id,
            conversation_name: message.conversation_name,
            message_id: message.message_id,
            sender: message.sender,
            timestamp: message.timestamp,
            text: message.text,
            reason,
            priority: /@|紧急|今天|截止|确认|审批|客户|风险|卡点/.test(message.text) ? "high" : "medium"
        });
    }
    return candidates;
}
function draftCandidateReply(candidate, tone = "简洁、稳妥、职场自然") {
    const prefix = candidate.sender ? `${candidate.sender}，` : "";
    const action = /确认|是否|吗|？|\?/.test(candidate.text)
        ? "我确认一下后同步你。"
        : /风险|问题|卡点|异常|失败|延期/.test(candidate.text)
            ? "我先看一下具体卡点，稍后给处理建议和下一步安排。"
            : "收到，我来跟进。";
    return `${prefix}${action}\n\n我会按当前口径推进，有变化再及时补充。`;
}
function buildSummaryDocument(input) {
    const title = input.title ?? `团队消息工作台摘要 ${new Date().toISOString().slice(0, 10)}`;
    return [
        `# ${title}`,
        "",
        `范围：${input.since ?? "未限定"} 至 ${input.until ?? "未限定"}${input.topics?.length ? `；主题：${input.topics.join("、")}` : ""}`,
        `消息数：${input.messages.length}`,
        "",
        "## 每日摘要",
        input.digest,
        "",
        "## 个人分诊",
        input.triage.triage,
        "",
        "## 待回复候选",
        ...(input.candidates.length > 0
            ? input.candidates.map((candidate) => `- [${candidate.priority}] ${candidate.conversation_name ?? candidate.conversation_id}｜${candidate.sender}: ${trimText(candidate.text, 140)}\n  建议回复：${draftCandidateReply(candidate)}`)
            : ["- 暂无明确待回复候选。"]),
        "",
        "## 覆盖说明",
        "- 本文档由连接器基于已入库消息生成，可复制到飞书文档、钉钉文档或群聊发送草稿。"
    ].join("\n");
}
function uniqueMessages(messages) {
    const seen = new Set();
    const unique = [];
    for (const message of messages) {
        const key = `${message.platform}:${message.message_id}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(message);
    }
    return unique.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
function filterWorkflowTopics(messages, topics) {
    const filters = topics?.filter(Boolean);
    if (!filters || filters.length === 0) {
        return messages;
    }
    return messages.filter((message) => filters.some((topic) => `${message.conversation_name ?? ""} ${message.text}`.includes(topic)));
}
function groupTopics(messages) {
    const definitions = [
        { name: "项目/客户推进", pattern: /客户|项目|需求|交付|反馈|执行|对接|规划|合作/ },
        { name: "内容/短视频/矩阵", pattern: /达人|矩阵|视频|脚本|素材|剪辑|拍摄|小红书|快手|1688|即梦/ },
        { name: "外协/结算/财务", pattern: /外协|账单|报销|费用|发票|付款|结算|云账户|预算/ },
        { name: "审批/确认/决策", pattern: /审批|确认|同意|通过|决定|结论|口径/ },
        { name: "工具/系统/自动化", pattern: /dws|飞书|钉钉|系统|接口|插件|机器人|自动化|token|MCP|CRM/ },
        { name: "风险/异常/卡点", pattern: /风险|问题|异常|失败|错误|延期|卡点|缺失|超时/ }
    ];
    const buckets = definitions.map((definition) => ({
        name: definition.name,
        messages: messages.filter((message) => definition.pattern.test(`${message.conversation_name ?? ""} ${message.text}`))
    })).filter((bucket) => bucket.messages.length > 0);
    const matched = new Set(buckets.flatMap((bucket) => bucket.messages.map((message) => `${message.platform}:${message.message_id}`)));
    const other = messages.filter((message) => !matched.has(`${message.platform}:${message.message_id}`));
    if (other.length > 0) {
        buckets.push({ name: "其他协作动态", messages: other });
    }
    return buckets.sort((a, b) => b.messages.length - a.messages.length);
}
function findAttentionItems(messages) {
    return messages.filter((message) => {
        const text = message.text;
        return /@|请|麻烦|需要|确认|看看|处理|跟进|回复|审批|通过|截止|今天|明天|风险|问题|卡点|异常/.test(text);
    });
}
function replyReason(message, currentUser) {
    const text = message.text;
    if (currentUser && (text.includes(`@${currentUser}`) || text.includes(currentUser))) {
        return "提到当前用户";
    }
    if (/请|麻烦|帮忙|看看|确认|回复|处理|跟进/.test(text)) {
        return "包含明确请求";
    }
    if (/吗|？|\?|是否|能不能|可以不|有没有/.test(text)) {
        return "包含问题";
    }
    if (/审批|通过|同意|结算|付款|报销|风险|卡点/.test(text)) {
        return "高影响事项可能需要确认";
    }
    return undefined;
}
function summarizeVolume(messages) {
    const conversations = new Set(messages.map((message) => `${message.platform}:${message.conversation_id}`));
    const senders = new Set(messages.map((message) => message.sender));
    return `共 ${messages.length} 条消息，覆盖 ${conversations.size} 个会话、${senders.size} 位发送者`;
}
function formatMessagePointer(message) {
    return `${message.timestamp}｜${message.platform}｜${message.conversation_name ?? message.conversation_id}｜${message.sender}`;
}
function trimText(value, length) {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}
function dateLabel(value) {
    const explicitDate = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    return explicitDate ?? new Date().toISOString().slice(0, 10);
}
function scopeLine(request) {
    const parts = [
        request.platform ? `平台：${request.platform}` : "平台：全部",
        request.conversation_ids?.length ? `会话：${request.conversation_ids.length} 个` : "会话：已入库范围",
        `时间：${request.since ?? "未限定"} 至 ${request.until ?? "未限定"}`
    ];
    if (request.topics?.length) {
        parts.push(`主题：${request.topics.join("、")}`);
    }
    return parts.join("；");
}
function optionalString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function requireString(value, name) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${name} is required`);
    }
    return value;
}
function optionalNumber(value, fallback) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}
function tenantId(req) {
    const header = req.header("x-tenant-id");
    return header && header.length > 0 ? header : "default";
}
async function requireAuthorized(req, platform, conversationId) {
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
function optionalPlatform(value) {
    if (value === "feishu" || value === "dingtalk") {
        return value;
    }
    return undefined;
}
function requirePlatform(value) {
    const platform = optionalPlatform(value);
    if (!platform) {
        throw new Error("platform must be feishu or dingtalk");
    }
    return platform;
}
//# sourceMappingURL=server.js.map