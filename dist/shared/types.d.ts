export type Platform = "feishu" | "dingtalk";
export interface MessageRecord {
    tenant_id?: string;
    platform: Platform;
    conversation_id: string;
    conversation_name?: string;
    message_id: string;
    sender: string;
    sender_id?: string;
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
export interface ApprovalRecord {
    platform: "dingtalk";
    instance_id: string;
    title?: string;
    originator?: string;
    status?: string;
    create_time?: string;
    raw_payload?: unknown;
}
