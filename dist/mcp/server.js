import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendQuery, jsonText } from "../shared/http.js";
const connectorUrl = process.env.CN_MESSAGING_CONNECTOR_URL ?? "http://127.0.0.1:8787";
const platformSchema = z.enum(["feishu", "dingtalk"]);
const workspaceProviderSchema = z.enum(["feishu", "dingtalk", "tencent"]);
const workspaceKindSchema = z.enum(["doc", "sheet", "base", "whiteboard", "slide", "smartcanvas", "smartsheet", "board", "mind", "flowchart"]);
const accessIdentitySchema = z.enum(["auto", "bot", "user"]);
const timestampSchema = z.string().min(1);
async function connectorRequest(path, init) {
    const response = await fetch(new URL(path, connectorUrl), {
        ...init,
        headers: {
            "content-type": "application/json",
            ...(init?.headers ?? {})
        }
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(`Connector request failed: ${response.status} ${jsonText(payload)}`);
    }
    return payload;
}
function textResult(value) {
    return {
        content: [
            {
                type: "text",
                text: jsonText(value)
            }
        ]
    };
}
const server = new McpServer({
    name: "cn-messaging-context",
    version: "0.7.0"
});
server.registerTool("list_conversations", {
    title: "List conversations",
    description: "List authorized Feishu or DingTalk conversations known to the connector service.",
    inputSchema: {
        platform: platformSchema.optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/conversations", args))));
server.registerTool("search_messages", {
    title: "Search messages",
    description: "Search normalized Feishu or DingTalk messages by platform, conversation, keyword, sender, and time window.",
    inputSchema: {
        platform: platformSchema.optional(),
        conversation_id: z.string().optional(),
        query: z.string().optional(),
        sender: z.string().optional(),
        thread_id: z.string().optional(),
        since: timestampSchema.optional(),
        until: timestampSchema.optional(),
        limit: z.number().int().min(1).max(200).default(50)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/messages/search", args))));
server.registerTool("get_recent_context", {
    title: "Get recent context",
    description: "Fetch the latest normalized messages for one authorized conversation.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string(),
        limit: z.number().int().min(1).max(200).default(50)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/messages/recent", args))));
server.registerTool("read_native_thread", {
    title: "Read native message thread",
    description: "Read a platform-native Feishu or DingTalk thread when thread/root/parent ids are available in synced messages.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string().optional(),
        thread_id: z.string().optional(),
        message_id: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(100)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/messages/thread", args))));
server.registerTool("summarize_conversation", {
    title: "Summarize conversation",
    description: "Ask the connector service for an extractive summary of a conversation and optional topic window.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string(),
        query: z.string().optional(),
        since: timestampSchema.optional(),
        until: timestampSchema.optional(),
        limit: z.number().int().min(1).max(200).default(100)
    }
}, async (args) => textResult(await connectorRequest("/messages/summarize", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("create_conversation_report", {
    title: "Create conversation report",
    description: "Create a structured group-chat report with key messages, decisions, follow-ups, and risks.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string(),
        query: z.string().optional(),
        since: timestampSchema.optional(),
        until: timestampSchema.optional(),
        limit: z.number().int().min(1).max(500).default(200)
    }
}, async (args) => textResult(await connectorRequest("/messages/report", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("draft_reply", {
    title: "Draft reply",
    description: "Draft a Feishu or DingTalk reply from supplied intent and connector context. This does not send.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string(),
        intent: z.string(),
        tone: z.string().optional(),
        context: z.string().optional()
    }
}, async (args) => textResult(await connectorRequest("/messages/draft", {
    method: "POST",
    body: JSON.stringify(args)
})));
const workflowSchema = {
    platform: platformSchema.optional(),
    conversation_ids: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
    since: timestampSchema.optional(),
    until: timestampSchema.optional(),
    limit: z.number().int().min(1).max(1000).default(500)
};
server.registerTool("create_daily_digest", {
    title: "Create daily digest",
    description: "Create a Slack-style daily digest across selected Feishu or DingTalk conversations or topics.",
    inputSchema: {
        ...workflowSchema,
        include_messages: z.boolean().default(false)
    }
}, async (args) => textResult(await connectorRequest("/workflows/daily-digest", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("triage_today", {
    title: "Triage today's messaging",
    description: "Triage recent Feishu or DingTalk activity into tasks for the user, worth skimming, and optional ignore-now items.",
    inputSchema: {
        ...workflowSchema,
        current_user: z.string().optional(),
        include_can_ignore: z.boolean().default(false)
    }
}, async (args) => textResult(await connectorRequest("/workflows/notification-triage", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("find_reply_candidates", {
    title: "Find reply candidates",
    description: "Find messages likely requiring a reply, confirmation, or follow-up.",
    inputSchema: {
        ...workflowSchema,
        current_user: z.string().optional()
    }
}, async (args) => textResult(await connectorRequest("/workflows/reply-candidates", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("draft_reply_queue", {
    title: "Draft reply queue",
    description: "Create draft-only replies for messages likely requiring the user's response. This does not send.",
    inputSchema: {
        ...workflowSchema,
        current_user: z.string().optional(),
        tone: z.string().optional()
    }
}, async (args) => textResult(await connectorRequest("/workflows/draft-reply-queue", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("create_summary_doc", {
    title: "Create summary document",
    description: "Create a Slack Canvas-style Markdown summary document from Feishu or DingTalk activity.",
    inputSchema: {
        ...workflowSchema,
        title: z.string().optional(),
        current_user: z.string().optional()
    }
}, async (args) => textResult(await connectorRequest("/workflows/summary-doc", {
    method: "POST",
    body: JSON.stringify(args)
})));
const workspaceReadSchema = {
    provider: workspaceProviderSchema,
    kind: workspaceKindSchema,
    target: z.string().optional(),
    table_id: z.string().optional(),
    sheet_id: z.string().optional(),
    range: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    output_as: z.enum(["markdown", "xml", "csv", "json", "raw", "code", "image"]).optional(),
    tencent_api_path: z.string().optional(),
    access_identity: accessIdentitySchema.default("auto"),
    allow_user_fallback: z.boolean().default(false),
    user_consent_confirmed: z.boolean().default(false),
    consent_summary: z.string().optional()
};
const workspaceWriteSchema = {
    ...workspaceReadSchema,
    title: z.string().optional(),
    content: z.string().optional(),
    mode: z.enum(["create", "append", "overwrite", "update", "insert"]).default("append"),
    parent_id: z.string().optional(),
    workspace_id: z.string().optional(),
    values: z.array(z.array(z.unknown())).optional(),
    fields: z.array(z.string()).optional(),
    rows: z.array(z.array(z.unknown())).optional(),
    records: z.array(z.unknown()).optional(),
    input_format: z.enum(["markdown", "xml", "csv", "json", "raw", "mermaid", "plantuml"]).optional(),
    confirmed_by_user: z.boolean(),
    confirmation_summary: z.string().min(10)
};
server.registerTool("check_workspace_status", {
    title: "Check workspace document status",
    description: "Check Feishu, DingTalk, and Tencent Docs document/sheet/base/whiteboard adapter availability.",
    inputSchema: {}
}, async () => textResult(await connectorRequest("/workspace/status")));
server.registerTool("read_workspace_resource", {
    title: "Read workspace resource",
    description: "Read Feishu, DingTalk, or Tencent Docs documents, sheets, bases/smartsheets, whiteboards, boards, slides, mind maps, or flowcharts through the connector adapters.",
    inputSchema: workspaceReadSchema
}, async (args) => textResult(await connectorRequest("/workspace/read", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("write_workspace_resource", {
    title: "Write workspace resource",
    description: "Create or update Feishu, DingTalk, or Tencent Docs documents, sheets, bases/smartsheets, whiteboards, boards, slides, mind maps, or flowcharts after user confirmation.",
    inputSchema: workspaceWriteSchema
}, async (args) => {
    if (!args.confirmed_by_user) {
        throw new Error("write_workspace_resource requires confirmed_by_user=true after user confirmation.");
    }
    return textResult(await connectorRequest("/workspace/write", {
        method: "POST",
        body: JSON.stringify(args)
    }));
});
server.registerTool("publish_summary_doc", {
    title: "Publish summary document",
    description: "Generate a messaging summary document and publish it to Feishu, DingTalk, or Tencent Docs after user confirmation.",
    inputSchema: {
        ...workflowSchema,
        provider: workspaceProviderSchema,
        kind: workspaceKindSchema.default("doc"),
        target: z.string().optional(),
        table_id: z.string().optional(),
        sheet_id: z.string().optional(),
        range: z.string().optional(),
        title: z.string().optional(),
        current_user: z.string().optional(),
        mode: z.enum(["create", "append", "overwrite", "update", "insert"]).default("create"),
        parent_id: z.string().optional(),
        workspace_id: z.string().optional(),
        tencent_api_path: z.string().optional(),
        confirmed_by_user: z.boolean(),
        confirmation_summary: z.string().min(10)
    }
}, async (args) => {
    if (!args.confirmed_by_user) {
        throw new Error("publish_summary_doc requires confirmed_by_user=true after user confirmation.");
    }
    return textResult(await connectorRequest("/workflows/summary-doc/publish", {
        method: "POST",
        body: JSON.stringify(args)
    }));
});
server.registerTool("map_conversation_topics", {
    title: "Map conversation topics",
    description: "Build a Slack-thread-like topic map from synced Feishu or DingTalk messages.",
    inputSchema: {
        ...workflowSchema,
        max_topics: z.number().int().min(1).max(20).default(12)
    }
}, async (args) => textResult(await connectorRequest("/workflows/topic-map", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("read_topic_thread", {
    title: "Read topic thread",
    description: "Read a bounded topic-centered message timeline with decisions and blockers, similar to a Slack thread summary.",
    inputSchema: {
        ...workflowSchema,
        topic: z.string().min(1),
        anchor_message_id: z.string().optional(),
        window_size: z.number().int().min(3).max(30).default(8)
    }
}, async (args) => textResult(await connectorRequest("/workflows/topic-thread", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("list_real_mentions", {
    title: "List real mentions",
    description: "Read platform-native messages that mention the current user from Feishu/Lark or DingTalk.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string().optional(),
        since: timestampSchema.optional(),
        until: timestampSchema.optional(),
        limit: z.number().int().min(1).max(200).default(50)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/notifications/mentions", args))));
server.registerTool("list_unread_conversations", {
    title: "List unread conversations",
    description: "Read platform-native unread conversation/feed state from Feishu/Lark or DingTalk where available.",
    inputSchema: {
        platform: platformSchema,
        limit: z.number().int().min(1).max(200).default(50)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/notifications/unread-conversations", args))));
server.registerTool("query_message_read_status", {
    title: "Query message read status",
    description: "Query platform-native message read status when the platform adapter supports it.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string(),
        message_id: z.string()
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/notifications/message-read-status", args))));
server.registerTool("schedule_daily_digest", {
    title: "Schedule daily digest",
    description: "Create a pending schedule record for a future daily digest. This does not run in the background by itself.",
    inputSchema: {
        ...workflowSchema,
        scheduled_for: timestampSchema,
        title: z.string().optional()
    }
}, async (args) => textResult(await connectorRequest("/schedules/digest", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("schedule_message", {
    title: "Schedule confirmed message",
    description: "Create a pending schedule record for a Feishu or DingTalk message after explicit user confirmation. This does not send immediately.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string(),
        conversation_name: z.string().optional(),
        text: z.string().min(1),
        scheduled_for: timestampSchema,
        confirmed_by_user: z.boolean(),
        confirmation_summary: z.string().min(10)
    }
}, async (args) => {
    if (!args.confirmed_by_user) {
        throw new Error("schedule_message requires confirmed_by_user=true after user confirmation.");
    }
    return textResult(await connectorRequest("/schedules/message", {
        method: "POST",
        body: JSON.stringify(args)
    }));
});
server.registerTool("list_scheduled_actions", {
    title: "List scheduled actions",
    description: "List pending, cancelled, or completed digest/message schedule records.",
    inputSchema: {
        status: z.enum(["pending", "cancelled", "completed", "failed"]).optional(),
        limit: z.number().int().min(1).max(200).default(50)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/schedules", args))));
server.registerTool("cancel_scheduled_action", {
    title: "Cancel scheduled action",
    description: "Cancel a pending digest or message schedule record.",
    inputSchema: {
        id: z.string().min(1)
    }
}, async (args) => textResult(await connectorRequest(`/schedules/${encodeURIComponent(args.id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({})
})));
server.registerTool("run_due_scheduled_actions", {
    title: "Run due scheduled actions",
    description: "Preview or execute due scheduled digests/messages. Message sends still honor connector dry-run and prior confirmation records.",
    inputSchema: {
        now: timestampSchema.optional(),
        execute: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50)
    }
}, async (args) => textResult(await connectorRequest("/schedules/run-due", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("sync_history", {
    title: "Sync platform history",
    description: "Fetch real Feishu or DingTalk history through the local platform adapter and store normalized messages. Feishu user permission fallback requires explicit user consent.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string().optional(),
        query: z.string().optional(),
        since: timestampSchema.optional(),
        until: timestampSchema.optional(),
        limit: z.number().int().min(1).max(200).default(50),
        access_identity: accessIdentitySchema.default("auto"),
        allow_user_fallback: z.boolean().default(false),
        user_consent_confirmed: z.boolean().default(false),
        consent_summary: z.string().optional()
    }
}, async (args) => textResult(await connectorRequest("/sync/history", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("upsert_identity_mapping", {
    title: "Upsert identity mapping",
    description: "Map one Feishu or DingTalk user id/name to a canonical person for cross-platform triage and reply routing.",
    inputSchema: {
        canonical_user: z.string().min(1),
        display_name: z.string().optional(),
        platform: platformSchema,
        platform_user_id: z.string().optional(),
        platform_user_name: z.string().optional(),
        aliases: z.array(z.string()).default([])
    }
}, async (args) => textResult(await connectorRequest("/identities", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("list_identity_mappings", {
    title: "List identity mappings",
    description: "List canonical user mappings used for cross-platform Feishu/DingTalk notification triage.",
    inputSchema: {
        platform: platformSchema.optional(),
        canonical_user: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/identities", args))));
server.registerTool("resolve_identity", {
    title: "Resolve identity",
    description: "Resolve a user alias, platform user id, or display name into canonical identity mappings.",
    inputSchema: {
        platform: platformSchema.optional(),
        value: z.string().min(1)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/identities/resolve", args))));
server.registerTool("authorize_conversation", {
    title: "Authorize conversation",
    description: "Register a tenant-authorized Feishu or DingTalk conversation before enforcing conversation-level access.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string(),
        conversation_name: z.string().optional()
    }
}, async (args) => textResult(await connectorRequest("/authorizations/conversations", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("send_message", {
    title: "Send confirmed message",
    description: "Send a Feishu or DingTalk message only after Codex has shown the destination and exact text and the user confirmed.",
    inputSchema: {
        platform: platformSchema,
        conversation_id: z.string(),
        text: z.string().min(1),
        confirmed_by_user: z.boolean(),
        confirmation_summary: z.string().min(10)
    }
}, async (args) => {
    if (!args.confirmed_by_user) {
        throw new Error("send_message requires confirmed_by_user=true after user confirmation.");
    }
    return textResult(await connectorRequest("/messages/send", {
        method: "POST",
        body: JSON.stringify(args)
    }));
});
server.registerTool("list_pending_dingtalk_approvals", {
    title: "List pending DingTalk approvals",
    description: "List pending DingTalk OA approvals visible to the configured DingTalk account.",
    inputSchema: {
        limit: z.number().int().min(1).max(100).default(20)
    }
}, async (args) => textResult(await connectorRequest(appendQuery("/approvals/dingtalk/pending", args))));
server.registerTool("get_dingtalk_approval_detail", {
    title: "Get DingTalk approval detail",
    description: "Read a DingTalk OA approval detail by process instance id.",
    inputSchema: {
        instance_id: z.string()
    }
}, async (args) => textResult(await connectorRequest(`/approvals/dingtalk/${encodeURIComponent(args.instance_id)}/detail`)));
server.registerTool("get_dingtalk_approval_tasks", {
    title: "Get DingTalk approval tasks",
    description: "Read active task ids for a DingTalk OA approval before any approve operation.",
    inputSchema: {
        instance_id: z.string()
    }
}, async (args) => textResult(await connectorRequest(`/approvals/dingtalk/${encodeURIComponent(args.instance_id)}/tasks`)));
server.registerTool("get_dingtalk_approval_records", {
    title: "Get DingTalk approval records",
    description: "Read DingTalk OA approval records to verify current workflow state and avoid stale pending-list conclusions.",
    inputSchema: {
        instance_id: z.string()
    }
}, async (args) => textResult(await connectorRequest(`/approvals/dingtalk/${encodeURIComponent(args.instance_id)}/records`)));
server.registerTool("approve_dingtalk_approval", {
    title: "Approve confirmed DingTalk approval",
    description: "Approve a DingTalk OA approval only after Codex has shown instance id, task id, remark, and the user confirmed.",
    inputSchema: {
        instance_id: z.string(),
        task_id: z.string(),
        remark: z.string().min(1),
        confirmed_by_user: z.boolean(),
        confirmation_summary: z.string().min(10)
    }
}, async (args) => {
    if (!args.confirmed_by_user) {
        throw new Error("approve_dingtalk_approval requires confirmed_by_user=true after user confirmation.");
    }
    return textResult(await connectorRequest(`/approvals/dingtalk/${encodeURIComponent(args.instance_id)}/approve`, {
        method: "POST",
        body: JSON.stringify(args)
    }));
});
server.registerTool("check_issue_reporter_status", {
    title: "Check GitHub issue reporter",
    description: "Check whether connector errors can be turned into redacted GitHub Issues.",
    inputSchema: {}
}, async () => textResult(await connectorRequest("/issue-reporter/status")));
server.registerTool("report_connector_issue", {
    title: "Report connector issue",
    description: "Create or preview a redacted GitHub Issue for a connector/plugin error.",
    inputSchema: {
        title: z.string().optional(),
        summary: z.string().optional(),
        severity: z.enum(["low", "medium", "high"]).default("medium"),
        operation: z.string().optional(),
        method: z.string().optional(),
        path: z.string().optional(),
        error: z.unknown().optional(),
        context: z.unknown().optional(),
        dry_run: z.boolean().default(true)
    }
}, async (args) => textResult(await connectorRequest("/issues/report", {
    method: "POST",
    body: JSON.stringify(args)
})));
server.registerTool("check_integration_status", {
    title: "Check integration status",
    description: "Return connector health, configured platforms, dry-run send mode, and storage status.",
    inputSchema: {}
}, async () => textResult(await connectorRequest("/integrations/status")));
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=server.js.map