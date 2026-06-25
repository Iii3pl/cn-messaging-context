import type { AccessIdentity, MentionStateResult, Platform, WorkspaceProvider, WorkspaceResourceKind, WorkspaceResourceResult } from "../../shared/types.js";
export interface WorkspaceStatus {
    feishu: {
        cli: "available" | "missing";
        command: "lark-cli";
        docs: boolean;
        sheets: boolean;
        base: boolean;
        whiteboard: boolean;
    };
    dingtalk: {
        cli: "available" | "missing";
        command: "dws";
        doc: boolean;
        sheet: boolean;
        aitable: boolean;
    };
    tencent: {
        openapi_configured: boolean;
        mcp_token_configured: boolean;
        api_base: string;
        note: string;
    };
}
export interface WorkspaceReadInput {
    provider: WorkspaceProvider;
    kind: WorkspaceResourceKind;
    target?: string;
    table_id?: string;
    sheet_id?: string;
    range?: string;
    query?: string;
    limit?: number;
    output_as?: "markdown" | "xml" | "csv" | "json" | "raw" | "code" | "image";
    tencent_api_path?: string;
    access_identity?: AccessIdentity;
    allow_user_fallback?: boolean;
    user_consent_confirmed?: boolean;
    consent_summary?: string;
}
export interface WorkspaceWriteInput extends WorkspaceReadInput {
    title?: string;
    content?: string;
    mode?: "create" | "append" | "overwrite" | "update" | "insert";
    parent_id?: string;
    workspace_id?: string;
    values?: unknown[][];
    fields?: string[];
    rows?: unknown[][];
    records?: unknown[];
    input_format?: "markdown" | "xml" | "csv" | "json" | "raw" | "mermaid" | "plantuml";
    dry_run: boolean;
}
export interface MentionListInput {
    platform: Platform;
    conversation_id?: string;
    since?: string;
    until?: string;
    limit?: number;
}
export interface ReadStatusInput {
    platform: Platform;
    conversation_id: string;
    message_id: string;
}
export declare function checkWorkspaceStatus(): Promise<WorkspaceStatus>;
export declare function readWorkspaceResource(input: WorkspaceReadInput): Promise<WorkspaceResourceResult>;
export declare function writeWorkspaceResource(input: WorkspaceWriteInput): Promise<WorkspaceResourceResult>;
export declare function listMentionMessages(input: MentionListInput): Promise<MentionStateResult>;
export declare function listUnreadConversations(input: {
    platform: Platform;
    limit?: number;
}): Promise<MentionStateResult>;
export declare function queryMessageReadStatus(input: ReadStatusInput): Promise<MentionStateResult>;
