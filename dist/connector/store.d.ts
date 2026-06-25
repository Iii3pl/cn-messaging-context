import type { AuditEvent, ConversationRecord, MessageRecord, Platform, ScheduledActionRecord } from "../shared/types.js";
export interface MessageStore {
    readonly mode: string;
    ensure(): Promise<void>;
    appendMessage(record: MessageRecord): Promise<{
        inserted: boolean;
        record: MessageRecord;
    }>;
    searchMessages(filters: {
        tenant_id?: string;
        platform?: Platform;
        conversation_id?: string;
        query?: string;
        sender?: string;
        since?: string;
        until?: string;
        limit?: number;
    }): Promise<MessageRecord[]>;
    listConversations(filters: {
        tenant_id?: string;
        platform?: Platform;
        query?: string;
        limit?: number;
    }): Promise<ConversationRecord[]>;
    authorizeConversation?(record: {
        tenant_id: string;
        platform: Platform;
        conversation_id: string;
        conversation_name?: string;
    }): Promise<void>;
    isConversationAuthorized?(filters: {
        tenant_id: string;
        platform: Platform;
        conversation_id: string;
    }): Promise<boolean>;
    appendScheduledAction?(record: Omit<ScheduledActionRecord, "id" | "created_at" | "status">): Promise<ScheduledActionRecord>;
    listScheduledActions?(filters: {
        tenant_id?: string;
        status?: ScheduledActionRecord["status"];
        limit?: number;
    }): Promise<ScheduledActionRecord[]>;
    cancelScheduledAction?(filters: {
        tenant_id?: string;
        id: string;
    }): Promise<ScheduledActionRecord | undefined>;
    appendAudit(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent>;
    auditCount(): Promise<number>;
}
export declare class JsonlStore implements MessageStore {
    private readonly dataDir;
    readonly mode = "jsonl";
    private readonly messagePath;
    private readonly auditPath;
    private readonly scheduledPath;
    constructor(dataDir: string);
    ensure(): Promise<void>;
    appendMessage(record: MessageRecord): Promise<{
        inserted: boolean;
        record: MessageRecord;
    }>;
    searchMessages(filters: {
        tenant_id?: string;
        platform?: Platform;
        conversation_id?: string;
        query?: string;
        sender?: string;
        since?: string;
        until?: string;
        limit?: number;
    }): Promise<MessageRecord[]>;
    listConversations(filters: {
        tenant_id?: string;
        platform?: Platform;
        query?: string;
        limit?: number;
    }): Promise<ConversationRecord[]>;
    appendAudit(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent>;
    appendScheduledAction(record: Omit<ScheduledActionRecord, "id" | "created_at" | "status">): Promise<ScheduledActionRecord>;
    listScheduledActions(filters: {
        tenant_id?: string;
        status?: ScheduledActionRecord["status"];
        limit?: number;
    }): Promise<ScheduledActionRecord[]>;
    cancelScheduledAction(filters: {
        tenant_id?: string;
        id: string;
    }): Promise<ScheduledActionRecord | undefined>;
    auditCount(): Promise<number>;
    private readMessages;
    private readJsonl;
    private appendJsonl;
    private ensureFile;
}
