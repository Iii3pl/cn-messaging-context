export interface ConnectorIssueInput {
    title?: string;
    summary?: string;
    severity?: "low" | "medium" | "high";
    operation?: string;
    method?: string;
    path?: string;
    error?: unknown;
    context?: unknown;
    auto_report?: boolean;
    dry_run?: boolean;
}
export interface ConnectorIssueStatus {
    configured: boolean;
    repo?: string;
    auto_report_enabled: boolean;
    dry_run: boolean;
    labels: string[];
    note: string;
}
export interface ConnectorIssueResult extends ConnectorIssueStatus {
    reported: boolean;
    title: string;
    body_preview: string;
    issue_url?: string;
    reason?: string;
}
export declare function checkIssueReporterStatus(): ConnectorIssueStatus;
export declare function reportConnectorIssue(input: ConnectorIssueInput): Promise<ConnectorIssueResult>;
