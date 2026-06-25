import express from "express";
import path from "node:path";
import { approveDingTalkApproval, checkCliStatus, getDingTalkApprovalDetail, getDingTalkApprovalRecords, getDingTalkApprovalTasks, listDingTalkPendingApprovals, sendMessageViaCli, syncHistoryFromCli } from "./adapters/cli.js";
import { checkWorkspaceStatus, listMentionMessages, listUnreadConversations, queryMessageReadStatus, readWorkspaceResource, writeWorkspaceResource } from "./adapters/workspace.js";
import { normalizeDingTalkEvent, normalizeFeishuEvent } from "./normalizers.js";
import { rawBodySaver, verifyOptionalHmacSignature } from "./security.js";
import { SqliteStore } from "./sqlite-store.js";
import { JsonlStore } from "./store.js";
const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.CN_MESSAGING_DATA_DIR ?? path.resolve(process.cwd(), ".data");
const storeMode = process.env.CN_MESSAGING_STORE ?? "jsonl";
const dryRunSend = process.env.CN_MESSAGING_DRY_RUN !== "false";
const dryRunWorkspace = process.env.CN_WORKSPACE_DRY_RUN !== "false";
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
        thread_id: optionalString(req.query.thread_id),
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
app.get("/messages/thread", asyncRoute(async (req, res) => {
    const platform = requirePlatform(req.query.platform);
    const conversationId = optionalString(req.query.conversation_id);
    const threadId = optionalString(req.query.thread_id);
    const messageId = optionalString(req.query.message_id);
    if (!threadId && !messageId) {
        res.status(400).json({ error: "thread_id or message_id is required" });
        return;
    }
    if (conversationId) {
        await requireAuthorized(req, platform, conversationId);
    }
    const messages = await readNativeThread({
        tenant_id: tenantId(req),
        platform,
        conversation_id: conversationId,
        thread_id: threadId,
        message_id: messageId,
        limit: optionalNumber(req.query.limit, 100)
    });
    res.json(messages);
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
    const currentUserTerms = await resolveUserTerms(req, body.current_user);
    const triage = buildNotificationTriage(messages, currentUserTerms, Boolean(body.include_can_ignore));
    await store.appendAudit({
        action: "workflows.notification_triage",
        tenant_id: tenantId(req),
        platform: body.platform,
        status: "read",
        metadata: { message_count: messages.length, current_user: body.current_user, current_user_terms: currentUserTerms, since: body.since, until: body.until }
    });
    res.json({ message_count: messages.length, ...triage });
}));
app.post("/workflows/reply-candidates", asyncRoute(async (req, res) => {
    const body = req.body;
    const messages = await getWorkflowMessages(req, body);
    const currentUserTerms = await resolveUserTerms(req, body.current_user);
    const candidates = findReplyCandidates(messages, currentUserTerms).slice(0, body.limit ?? 20);
    await store.appendAudit({
        action: "workflows.reply_candidates",
        tenant_id: tenantId(req),
        platform: body.platform,
        status: "read",
        metadata: { message_count: messages.length, candidates: candidates.length, current_user: body.current_user, current_user_terms: currentUserTerms }
    });
    res.json({ message_count: messages.length, candidates });
}));
app.post("/workflows/draft-reply-queue", asyncRoute(async (req, res) => {
    const body = req.body;
    const messages = await getWorkflowMessages(req, body);
    const currentUserTerms = await resolveUserTerms(req, body.current_user);
    const candidates = findReplyCandidates(messages, currentUserTerms).slice(0, body.limit ?? 10);
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
    const currentUserTerms = await resolveUserTerms(req, body.current_user);
    const triage = buildNotificationTriage(messages, currentUserTerms, false);
    const candidates = findReplyCandidates(messages, currentUserTerms).slice(0, 10);
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
app.post("/workflows/summary-doc/publish", asyncRoute(async (req, res) => {
    const body = req.body;
    if (!body.confirmed_by_user) {
        res.status(400).json({ error: "user_confirmation_required" });
        return;
    }
    const messages = await getWorkflowMessages(req, body);
    const digest = buildDailyDigest(messages, body);
    const currentUserTerms = await resolveUserTerms(req, body.current_user);
    const triage = buildNotificationTriage(messages, currentUserTerms, false);
    const candidates = findReplyCandidates(messages, currentUserTerms).slice(0, 10);
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
    const writeResult = await writeWorkspaceResource({
        ...body,
        provider: requireWorkspaceProvider(body.provider),
        kind: requireWorkspaceKind(body.kind),
        mode: body.mode ?? "create",
        title: body.title ?? `团队消息工作台摘要 ${new Date().toISOString().slice(0, 10)}`,
        content: document,
        dry_run: dryRunWorkspace
    });
    await store.appendAudit({
        action: "workspace.summary_doc.publish",
        tenant_id: tenantId(req),
        status: writeResult.dry_run ? "dry_run" : "submitted",
        metadata: {
            provider: body.provider,
            kind: body.kind,
            message_count: messages.length,
            title: body.title,
            confirmation_summary: body.confirmation_summary
        }
    });
    res.json({ message_count: messages.length, document, publish: writeResult });
}));
app.post("/workflows/topic-map", asyncRoute(async (req, res) => {
    const body = req.body;
    const messages = await getWorkflowMessages(req, body);
    const topics = buildTopicMap(messages, body.max_topics ?? 12);
    await store.appendAudit({
        action: "workflows.topic_map",
        tenant_id: tenantId(req),
        platform: body.platform,
        status: "read",
        metadata: { message_count: messages.length, topics: topics.length }
    });
    res.json({ message_count: messages.length, topics });
}));
app.post("/workflows/topic-thread", asyncRoute(async (req, res) => {
    const body = req.body;
    const topic = requireString(body.topic, "topic");
    const messages = filterMessagesByTopic(await getWorkflowMessages(req, { ...body, topics: undefined }), topic);
    const thread = buildTopicThread(messages, topic, body.anchor_message_id, body.window_size ?? 8);
    res.json({ topic, message_count: messages.length, thread });
}));
app.post("/schedules/digest", asyncRoute(async (req, res) => {
    const body = req.body;
    const scheduledFor = requireString(body.scheduled_for, "scheduled_for");
    const schedule = await appendScheduled(req, {
        action: "daily_digest",
        platform: body.platform,
        scheduled_for: scheduledFor,
        payload: {
            title: body.title,
            platform: body.platform,
            conversation_ids: body.conversation_ids,
            topics: body.topics,
            since: body.since,
            until: body.until,
            limit: body.limit
        }
    });
    res.json({ scheduled: true, schedule });
}));
app.post("/schedules/message", asyncRoute(async (req, res) => {
    const body = req.body;
    const platform = requirePlatform(body.platform);
    const conversationId = requireString(body.conversation_id, "conversation_id");
    const text = requireString(body.text, "text");
    const scheduledFor = requireString(body.scheduled_for, "scheduled_for");
    await requireAuthorized(req, platform, conversationId);
    if (!body.confirmed_by_user) {
        res.status(400).json({ error: "user_confirmation_required" });
        return;
    }
    const schedule = await appendScheduled(req, {
        action: "send_message",
        platform,
        conversation_id: conversationId,
        conversation_name: body.conversation_name,
        scheduled_for: scheduledFor,
        payload: {
            text,
            confirmation_summary: body.confirmation_summary,
            dry_run_required: dryRunSend
        }
    });
    res.json({ scheduled: true, dry_run_send: dryRunSend, schedule });
}));
app.get("/schedules", asyncRoute(async (req, res) => {
    if (!store.listScheduledActions) {
        res.json({ schedules: [], mode: "scheduled_store_unavailable" });
        return;
    }
    const status = optionalScheduleStatus(req.query.status);
    const schedules = await store.listScheduledActions({
        tenant_id: tenantId(req),
        status,
        limit: optionalNumber(req.query.limit, 50)
    });
    res.json({ schedules });
}));
app.post("/schedules/:id/cancel", asyncRoute(async (req, res) => {
    const id = requireString(req.params.id, "id");
    if (!store.cancelScheduledAction) {
        res.status(501).json({ error: "scheduled_store_unavailable" });
        return;
    }
    const schedule = await store.cancelScheduledAction({ tenant_id: tenantId(req), id });
    if (!schedule) {
        res.status(404).json({ error: "scheduled_action_not_found" });
        return;
    }
    await store.appendAudit({
        action: "schedules.cancel",
        tenant_id: tenantId(req),
        platform: schedule.platform,
        conversation_id: schedule.conversation_id,
        status: "cancelled",
        metadata: { schedule_id: schedule.id, scheduled_action: schedule.action }
    });
    res.json({ cancelled: true, schedule });
}));
app.post("/schedules/run-due", asyncRoute(async (req, res) => {
    const body = req.body;
    if (!store.listScheduledActions) {
        res.status(501).json({ error: "scheduled_store_unavailable" });
        return;
    }
    const now = body.now ?? new Date().toISOString();
    const due = (await store.listScheduledActions({
        tenant_id: tenantId(req),
        status: "pending",
        limit: optionalNumber(body.limit, 50)
    })).filter((schedule) => Date.parse(schedule.scheduled_for) <= Date.parse(now));
    const results = [];
    for (const schedule of due) {
        results.push(await runScheduledAction(req, schedule, Boolean(body.execute)));
    }
    res.json({ now, execute: Boolean(body.execute), due_count: due.length, results });
}));
app.get("/workspace/status", asyncRoute(async (_req, res) => {
    res.json(await checkWorkspaceStatus());
}));
app.post("/workspace/read", asyncRoute(async (req, res) => {
    const body = req.body;
    const result = await readWorkspaceResource({
        ...body,
        provider: requireWorkspaceProvider(body.provider),
        kind: requireWorkspaceKind(body.kind)
    });
    await store.appendAudit({
        action: "workspace.read",
        tenant_id: tenantId(req),
        status: "read",
        metadata: { provider: result.provider, kind: result.kind, target: result.target, adapter: result.adapter }
    });
    res.json(result);
}));
app.post("/workspace/write", asyncRoute(async (req, res) => {
    const body = req.body;
    if (!body.confirmed_by_user) {
        res.status(400).json({ error: "user_confirmation_required" });
        return;
    }
    const result = await writeWorkspaceResource({
        ...body,
        provider: requireWorkspaceProvider(body.provider),
        kind: requireWorkspaceKind(body.kind),
        dry_run: dryRunWorkspace
    });
    await store.appendAudit({
        action: "workspace.write",
        tenant_id: tenantId(req),
        status: result.dry_run ? "dry_run" : "submitted",
        metadata: {
            provider: result.provider,
            kind: result.kind,
            target: result.target,
            mode: body.mode,
            adapter: result.adapter,
            confirmation_summary: body.confirmation_summary
        }
    });
    res.json(result);
}));
app.get("/notifications/mentions", asyncRoute(async (req, res) => {
    const platform = requirePlatform(req.query.platform);
    const result = await listMentionMessages({
        platform,
        conversation_id: optionalString(req.query.conversation_id),
        since: optionalString(req.query.since),
        until: optionalString(req.query.until),
        limit: optionalNumber(req.query.limit, 50)
    });
    await store.appendAudit({
        action: "notifications.mentions",
        tenant_id: tenantId(req),
        platform,
        status: "read",
        metadata: { source: result.source, adapter: result.adapter, count: Array.isArray(result.normalized) ? result.normalized.length : undefined }
    });
    res.json(result);
}));
app.get("/notifications/unread-conversations", asyncRoute(async (req, res) => {
    const platform = requirePlatform(req.query.platform);
    const result = await listUnreadConversations({
        platform,
        limit: optionalNumber(req.query.limit, 50)
    });
    await store.appendAudit({
        action: "notifications.unread_conversations",
        tenant_id: tenantId(req),
        platform,
        status: "read",
        metadata: { source: result.source, adapter: result.adapter, count: Array.isArray(result.normalized) ? result.normalized.length : undefined }
    });
    res.json(result);
}));
app.get("/notifications/message-read-status", asyncRoute(async (req, res) => {
    const platform = requirePlatform(req.query.platform);
    const result = await queryMessageReadStatus({
        platform,
        conversation_id: requireString(req.query.conversation_id, "conversation_id"),
        message_id: requireString(req.query.message_id, "message_id")
    });
    await store.appendAudit({
        action: "notifications.message_read_status",
        tenant_id: tenantId(req),
        platform,
        conversation_id: optionalString(req.query.conversation_id),
        status: "read",
        metadata: { message_id: req.query.message_id, adapter: result.adapter }
    });
    res.json(result);
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
app.post("/identities", asyncRoute(async (req, res) => {
    if (!store.upsertIdentityMapping) {
        res.status(501).json({ error: "identity_store_unavailable" });
        return;
    }
    const body = req.body;
    const mapping = await store.upsertIdentityMapping({
        tenant_id: tenantId(req),
        canonical_user: requireString(body.canonical_user, "canonical_user"),
        display_name: body.display_name,
        platform: requirePlatform(body.platform),
        platform_user_id: body.platform_user_id,
        platform_user_name: body.platform_user_name,
        aliases: body.aliases ?? []
    });
    await store.appendAudit({
        action: "identities.upsert",
        tenant_id: tenantId(req),
        platform: mapping.platform,
        status: "updated",
        metadata: { canonical_user: mapping.canonical_user, platform_user_id: mapping.platform_user_id }
    });
    res.json({ mapping });
}));
app.get("/identities", asyncRoute(async (req, res) => {
    if (!store.listIdentityMappings) {
        res.json({ mappings: [], mode: "identity_store_unavailable" });
        return;
    }
    const mappings = await store.listIdentityMappings({
        tenant_id: tenantId(req),
        platform: optionalPlatform(req.query.platform),
        canonical_user: optionalString(req.query.canonical_user),
        query: optionalString(req.query.query),
        limit: optionalNumber(req.query.limit, 50)
    });
    res.json({ mappings });
}));
app.get("/identities/resolve", asyncRoute(async (req, res) => {
    if (!store.resolveIdentity) {
        res.json({ mappings: [], mode: "identity_store_unavailable" });
        return;
    }
    const value = requireString(req.query.value, "value");
    const mappings = await store.resolveIdentity({
        tenant_id: tenantId(req),
        platform: optionalPlatform(req.query.platform),
        value
    });
    res.json({ value, mappings });
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
    const workspace = await checkWorkspaceStatus();
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
            dry_run_workspace: dryRunWorkspace,
            enforce_authorization: enforceAuthorization,
            conversations: conversations.length,
            audit_events: await store.auditCount()
        },
        workspace
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
function buildNotificationTriage(messages, currentUserTerms, includeCanIgnore) {
    const tasks = findAttentionItems(messages)
        .filter((message) => !isCurrentUserSender(message, currentUserTerms))
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
function findReplyCandidates(messages, currentUserTerms) {
    const sorted = [...messages].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const candidates = [];
    for (const message of sorted) {
        if (isCurrentUserSender(message, currentUserTerms)) {
            continue;
        }
        const reason = replyReason(message, currentUserTerms);
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
function buildTopicMap(messages, maxTopics) {
    const topics = groupTopics(messages).slice(0, Math.min(Math.max(maxTopics, 1), 20));
    return topics.map((topic) => {
        const sorted = [...topic.messages].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
        const conversations = [...new Set(sorted.map((message) => message.conversation_name ?? message.conversation_id))].slice(0, 8);
        return {
            topic: topic.name,
            message_count: sorted.length,
            conversations,
            latest_timestamp: sorted[0]?.timestamp,
            summary: `${topic.name} 相关 ${sorted.length} 条消息，主要出现在 ${conversations.join("、") || "未知会话"}。`,
            sample_messages: sorted.slice(0, 5).map((message) => ({
                timestamp: message.timestamp,
                sender: message.sender,
                text: trimText(message.text, 180),
                conversation_name: message.conversation_name,
                conversation_id: message.conversation_id
            }))
        };
    });
}
function buildTopicThread(messages, topic, anchorMessageId, windowSize) {
    if (messages.length === 0) {
        return `# Topic Thread: ${topic}\n\n没有找到匹配消息。`;
    }
    const sorted = [...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const anchorIndex = anchorMessageId ? sorted.findIndex((message) => message.message_id === anchorMessageId) : -1;
    const safeWindow = Math.min(Math.max(windowSize, 3), 30);
    const start = anchorIndex >= 0 ? Math.max(0, anchorIndex - safeWindow) : 0;
    const end = anchorIndex >= 0 ? Math.min(sorted.length, anchorIndex + safeWindow + 1) : Math.min(sorted.length, safeWindow * 2);
    const windowMessages = sorted.slice(start, end);
    const decisions = windowMessages.filter((message) => /决定|确认|同意|通过|口径|结论|安排/.test(message.text));
    const blockers = windowMessages.filter((message) => /风险|问题|异常|失败|错误|延期|卡点|缺失|超时/.test(message.text));
    return [
        `# Topic Thread: ${topic}`,
        "",
        `消息数：${messages.length}，当前窗口：${windowMessages.length} 条${anchorMessageId ? `，锚点：${anchorMessageId}` : ""}`,
        "",
        "## Timeline",
        ...windowMessages.map((message) => `- ${message.timestamp}｜${message.conversation_name ?? message.conversation_id}｜${message.sender}: ${trimText(message.text, 220)}`),
        "",
        "## Decisions",
        ...(decisions.length > 0 ? decisions.map((message) => `- ${message.sender}: ${trimText(message.text, 180)}`) : ["- 暂未识别到明确决策。"]),
        "",
        "## Blockers",
        ...(blockers.length > 0 ? blockers.map((message) => `- ${message.sender}: ${trimText(message.text, 180)}`) : ["- 暂未识别到明确卡点。"])
    ].join("\n");
}
async function appendScheduled(req, input) {
    if (!store.appendScheduledAction) {
        throw new Error("scheduled_store_unavailable");
    }
    const schedule = await store.appendScheduledAction({
        tenant_id: tenantId(req),
        ...input
    });
    await store.appendAudit({
        action: `schedules.${input.action}.create`,
        tenant_id: tenantId(req),
        platform: input.platform,
        conversation_id: input.conversation_id,
        status: "scheduled",
        metadata: { schedule_id: schedule.id, scheduled_for: input.scheduled_for }
    });
    return schedule;
}
async function readNativeThread(input) {
    if (input.thread_id) {
        const messages = await store.searchMessages({
            tenant_id: input.tenant_id,
            platform: input.platform,
            conversation_id: input.conversation_id,
            thread_id: input.thread_id,
            limit: input.limit
        });
        return {
            platform: input.platform,
            conversation_id: input.conversation_id,
            thread_id: input.thread_id,
            message_count: messages.length,
            mode: messages.length > 0 ? "native_thread" : "not_found",
            messages: messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        };
    }
    const scan = await store.searchMessages({
        tenant_id: input.tenant_id,
        platform: input.platform,
        conversation_id: input.conversation_id,
        limit: Math.max(input.limit, 500)
    });
    const anchor = scan.find((message) => message.message_id === input.message_id);
    if (!anchor) {
        return {
            platform: input.platform,
            conversation_id: input.conversation_id,
            thread_id: input.message_id ?? "unknown",
            message_count: 0,
            mode: "not_found",
            messages: []
        };
    }
    const threadId = anchor.thread_id ?? anchor.parent_message_id ?? anchor.message_id;
    const messages = scan.filter((message) => message.message_id === threadId ||
        message.message_id === anchor.message_id ||
        message.thread_id === threadId ||
        message.parent_message_id === threadId).slice(0, input.limit);
    return {
        platform: input.platform,
        conversation_id: input.conversation_id ?? anchor.conversation_id,
        thread_id: threadId,
        message_count: messages.length,
        mode: anchor.thread_id || anchor.parent_message_id ? "native_thread" : "anchor_inferred",
        messages: messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    };
}
async function runScheduledAction(req, schedule, execute) {
    const base = {
        id: schedule.id,
        action: schedule.action,
        platform: schedule.platform,
        conversation_id: schedule.conversation_id,
        scheduled_for: schedule.scheduled_for
    };
    try {
        if (schedule.action === "daily_digest") {
            const payload = schedule.payload;
            const messages = execute ? await getWorkflowMessages(req, payload) : [];
            const digest = execute ? buildDailyDigest(messages, payload) : undefined;
            if (execute) {
                await store.updateScheduledActionStatus?.({
                    tenant_id: tenantId(req),
                    id: schedule.id,
                    status: "completed",
                    result_summary: `daily_digest generated with ${messages.length} messages`
                });
                await store.appendAudit({
                    action: "schedules.daily_digest.run",
                    tenant_id: tenantId(req),
                    platform: schedule.platform,
                    status: "completed",
                    metadata: { schedule_id: schedule.id, message_count: messages.length }
                });
            }
            return {
                ...base,
                status: execute ? "completed" : "preview_due",
                message_count: messages.length,
                digest
            };
        }
        const text = requireString(schedule.payload.text, "payload.text");
        const platform = requirePlatform(schedule.platform);
        const conversationId = requireString(schedule.conversation_id, "conversation_id");
        if (!execute) {
            return { ...base, status: "preview_due", text_length: text.length };
        }
        const audit = await store.appendAudit({
            action: "schedules.send_message.run",
            tenant_id: tenantId(req),
            platform,
            conversation_id: conversationId,
            status: dryRunSend ? "dry_run" : "submitted",
            metadata: { schedule_id: schedule.id, text_length: text.length }
        });
        const sendResult = dryRunSend
            ? { sent: false, dry_run: true, adapter: "schedule-worker" }
            : await sendMessageViaCli({ platform, conversation_id: conversationId, text, dry_run: false });
        await store.updateScheduledActionStatus?.({
            tenant_id: tenantId(req),
            id: schedule.id,
            status: "completed",
            result_summary: dryRunSend ? "message dry-run recorded" : "message submitted"
        });
        return { ...base, status: "completed", dry_run: dryRunSend, audit_id: audit.id, send_result: sendResult };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (execute) {
            await store.updateScheduledActionStatus?.({
                tenant_id: tenantId(req),
                id: schedule.id,
                status: "failed",
                result_summary: message
            });
            await store.appendAudit({
                action: `schedules.${schedule.action}.run`,
                tenant_id: tenantId(req),
                platform: schedule.platform,
                conversation_id: schedule.conversation_id,
                status: "failed",
                metadata: { schedule_id: schedule.id, error: message }
            });
        }
        return { ...base, status: "failed", error: message };
    }
}
async function resolveUserTerms(req, currentUser) {
    if (!currentUser) {
        return [];
    }
    const terms = [currentUser];
    if (store.resolveIdentity) {
        const mappings = await store.resolveIdentity({ tenant_id: tenantId(req), value: currentUser });
        for (const mapping of mappings) {
            terms.push(mapping.canonical_user, mapping.display_name ?? "", mapping.platform_user_id ?? "", mapping.platform_user_name ?? "", ...mapping.aliases);
        }
    }
    return uniqueStrings(terms);
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
    return messages.filter((message) => filters.some((topic) => messageMatchesTopic(message, topic)));
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
function filterMessagesByTopic(messages, topic) {
    return messages.filter((message) => messageMatchesTopic(message, topic));
}
function messageMatchesTopic(message, topic) {
    const haystack = `${message.conversation_name ?? ""} ${message.text}`;
    if (haystack.includes(topic)) {
        return true;
    }
    const aliases = [
        { topic: /项目|客户|交付|需求/, pattern: /客户|项目|需求|交付|反馈|执行|对接|规划|合作/ },
        { topic: /内容|短视频|矩阵|达人|脚本/, pattern: /达人|矩阵|视频|脚本|素材|剪辑|拍摄|小红书|快手|1688|即梦/ },
        { topic: /外协|结算|财务|报销|预算/, pattern: /外协|账单|报销|费用|发票|付款|结算|云账户|预算/ },
        { topic: /审批|确认|决策/, pattern: /审批|确认|同意|通过|决定|结论|口径/ },
        { topic: /工具|系统|自动化|dws|MCP|机器人/, pattern: /dws|飞书|钉钉|系统|接口|插件|机器人|自动化|token|MCP|CRM/ },
        { topic: /风险|异常|卡点|问题|延期|阻塞/, pattern: /风险|问题|异常|失败|错误|延期|卡点|缺失|超时/ }
    ];
    return aliases.some((alias) => alias.topic.test(topic) && alias.pattern.test(haystack));
}
function findAttentionItems(messages) {
    return messages.filter((message) => {
        const text = message.text;
        return /@|请|麻烦|需要|确认|看看|处理|跟进|回复|审批|通过|截止|今天|明天|风险|问题|卡点|异常/.test(text);
    });
}
function replyReason(message, currentUserTerms) {
    const text = message.text;
    if (mentionsCurrentUser(message, currentUserTerms)) {
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
function isCurrentUserSender(message, currentUserTerms) {
    if (currentUserTerms.length === 0) {
        return false;
    }
    return currentUserTerms.some((term) => term === message.sender || term === message.sender_id);
}
function mentionsCurrentUser(message, currentUserTerms) {
    if (currentUserTerms.length === 0) {
        return false;
    }
    return currentUserTerms.some((term) => message.text.includes(`@${term}`) ||
        message.text.includes(term) ||
        Boolean(message.mentions?.some((mention) => mention === term)));
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
function optionalScheduleStatus(value) {
    if (value === "pending" || value === "cancelled" || value === "completed") {
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
function requireWorkspaceProvider(value) {
    if (value === "feishu" || value === "dingtalk" || value === "tencent") {
        return value;
    }
    throw new Error("provider must be feishu, dingtalk, or tencent");
}
function requireWorkspaceKind(value) {
    if (value === "doc" ||
        value === "sheet" ||
        value === "base" ||
        value === "whiteboard" ||
        value === "slide" ||
        value === "smartcanvas" ||
        value === "smartsheet" ||
        value === "board" ||
        value === "mind" ||
        value === "flowchart") {
        return value;
    }
    throw new Error("kind must be doc, sheet, base, whiteboard, slide, smartcanvas, smartsheet, board, mind, or flowchart");
}
//# sourceMappingURL=server.js.map