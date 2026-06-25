import type { AccessIdentity, ApprovalRecord, MessageRecord, Platform } from "../../shared/types.js";
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
export declare function checkCliStatus(): Promise<{
    feishu: AdapterStatus;
    dingtalk: AdapterStatus;
}>;
export declare function syncHistoryFromCli(request: HistorySyncRequest): Promise<MessageRecord[]>;
export declare function sendMessageViaCli(input: {
    platform: Platform;
    conversation_id: string;
    text: string;
    dry_run: boolean;
}): Promise<SendResult>;
export declare function listDingTalkPendingApprovals(limit: number): Promise<ApprovalRecord[]>;
export declare function getDingTalkApprovalDetail(instanceId: string): Promise<unknown>;
export declare function getDingTalkApprovalTasks(instanceId: string): Promise<unknown>;
export declare function getDingTalkApprovalRecords(instanceId: string): Promise<unknown>;
export declare function approveDingTalkApproval(input: {
    instance_id: string;
    task_id: string;
    remark: string;
    dry_run: boolean;
}): Promise<SendResult>;
