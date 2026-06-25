import type { AuditEvent, ConversationRecord, MessageRecord, Platform } from "../shared/types.js";
import type { MessageStore } from "./store.js";
export declare class SqliteStore implements MessageStore {
    private readonly dataDir;
    readonly mode = "sqlite";
    private db?;
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
    authorizeConversation(record: {
        tenant_id: string;
        platform: Platform;
        conversation_id: string;
        conversation_name?: string;
    }): Promise<void>;
    isConversationAuthorized(filters: {
        tenant_id: string;
        platform: Platform;
        conversation_id: string;
    }): Promise<boolean>;
    appendAudit(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent>;
    auditCount(): Promise<number>;
    private database;
}
