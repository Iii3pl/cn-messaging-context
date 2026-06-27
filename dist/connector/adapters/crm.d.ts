import type { CrmApprovalPreauditRequest, CrmApprovalPreauditResult, CrmProjectRecord, CrmStatus, CrmUserRecord } from "../../shared/types.js";
interface CommandResult {
    stdout: string;
    stderr: string;
    code: number | null;
}
type CommandRunner = (command: string, args: string[], options: {
    timeoutMs: number;
    input?: string;
}) => Promise<CommandResult>;
export interface CrmAdapterOptions {
    enabled?: boolean;
    command?: string;
    timeoutMs?: number;
    runner?: CommandRunner;
}
export interface CrmAdapter {
    status(): Promise<CrmStatus>;
    searchProjects(input: {
        query: string;
        limit?: number;
    }): Promise<{
        projects: CrmProjectRecord[];
        raw_result: unknown;
    }>;
    getProjectDetail(projectId: string | number): Promise<{
        project: CrmProjectRecord;
        raw_result: unknown;
    }>;
    lookupUsers(input: {
        name: string;
        limit?: number;
    }): Promise<{
        users: CrmUserRecord[];
        raw_result: unknown;
    }>;
    preauditApproval(input: CrmApprovalPreauditRequest): Promise<CrmApprovalPreauditResult>;
}
export declare function createCrmAdapter(options?: CrmAdapterOptions): CrmAdapter;
export declare function checkCrmStatus(): Promise<CrmStatus>;
export declare function searchCrmProjects(input: {
    query: string;
    limit?: number;
}): Promise<{
    projects: CrmProjectRecord[];
    raw_result: unknown;
}>;
export declare function getCrmProjectDetail(projectId: string | number): Promise<{
    project: CrmProjectRecord;
    raw_result: unknown;
}>;
export declare function lookupCrmUsers(input: {
    name: string;
    limit?: number;
}): Promise<{
    users: CrmUserRecord[];
    raw_result: unknown;
}>;
export declare function preauditApprovalWithCrm(input: CrmApprovalPreauditRequest): Promise<CrmApprovalPreauditResult>;
export declare function parseJsonFromText(text: string): unknown;
export {};
