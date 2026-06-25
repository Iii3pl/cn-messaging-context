import type { AuditEvent, ConversationRecord, MessageRecord, Platform } from "../shared/types.js";
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
    appendAudit(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent>;
    auditCount(): Promise<number>;
}
export declare class JsonlStore implements MessageStore {
    private readonly dataDir;
    readonly mode = "jsonl";
    private readonly messagePath;
    private readonly auditPath;
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
    auditCount(): Promise<number>;
    private readMessages;
    private readJsonl;
    private appendJsonl;
    private ensureFile;
}
