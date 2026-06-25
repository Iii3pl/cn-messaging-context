export type Platform = "feishu" | "dingtalk" | "wechat";
export type WritablePlatform = "feishu" | "dingtalk";
export type WorkspaceProvider = Platform | "tencent";
export type AccessIdentity = "auto" | "bot" | "user";
export type WorkspaceResourceKind = "doc" | "sheet" | "base" | "whiteboard" | "slide" | "smartcanvas" | "smartsheet" | "board" | "mind" | "flowchart";
export interface MessageRecord {
    tenant_id?: string;
    platform: Platform;
    conversation_id: string;
    conversation_name?: string;
    message_id: string;
    thread_id?: string;
    parent_message_id?: string;
    reply_count?: number;
    is_thread_parent?: boolean;
    sender: string;
    sender_id?: string;
    mentions?: string[];
    text: string;
    timestamp: string;
    raw_payload?: unknown;
    context_summary?: string;
}
export interface ConversationRecord {
    tenant_id?: string;
    platform: Platform;
    conversation_id: string;
    conversation_name?: string;
    latest_timestamp?: string;
    message_count: number;
}
export interface AuditEvent {
    id: string;
    action: string;
    tenant_id?: string;
    platform?: Platform;
    conversation_id?: string;
    timestamp: string;
    status: string;
    metadata?: Record<string, unknown>;
}
export interface ScheduledActionRecord {
    id: string;
    tenant_id?: string;
    action: "daily_digest" | "send_message";
    platform?: Platform;
    conversation_id?: string;
    conversation_name?: string;
    scheduled_for: string;
    status: "pending" | "cancelled" | "completed" | "failed";
    created_at: string;
    last_run_at?: string;
    result_summary?: string;
    payload: Record<string, unknown>;
}
export interface IdentityMappingRecord {
    id: string;
    tenant_id?: string;
    canonical_user: string;
    display_name?: string;
    platform: Platform;
    platform_user_id?: string;
    platform_user_name?: string;
    aliases: string[];
    created_at: string;
    updated_at: string;
}
export interface ApprovalRecord {
    platform: "dingtalk";
    instance_id: string;
    title?: string;
    originator?: string;
    status?: string;
    create_time?: string;
    raw_payload?: unknown;
}
export interface WorkspaceResourceResult {
    provider: WorkspaceProvider;
    kind: WorkspaceResourceKind;
    action: "read" | "write" | "publish";
    dry_run: boolean;
    adapter: string;
    access_identity?: AccessIdentity;
    user_permission_used?: boolean;
    target?: string;
    raw_result?: unknown;
    diagnostic?: string;
}
export interface MentionStateResult {
    platform: Platform;
    source: "mentions" | "unread_conversations" | "read_status";
    adapter: string;
    raw_result: unknown;
    normalized?: unknown[];
}
