export type Platform = "feishu" | "dingtalk" | "wechat";
export type WritablePlatform = "feishu" | "dingtalk";
export type WorkspaceProvider = Platform | "tencent";
export type AccessIdentity = "auto" | "bot" | "user";
export type WorkspaceResourceKind =
  | "doc"
  | "sheet"
  | "base"
  | "whiteboard"
  | "slide"
  | "smartcanvas"
  | "smartsheet"
  | "board"
  | "mind"
  | "flowchart";

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

export interface CrmStatus {
  enabled: boolean;
  cli: "available" | "missing" | "disabled";
  command: string;
  timeout_ms: number;
}

export interface CrmProjectRecord {
  source: "crm.project.list" | "crm.project.detail";
  crm_project_id?: number;
  project_unique_sn?: string;
  project_name?: string;
  project_full_name?: string;
  amount_yuan?: number;
  project_begin_at?: string;
  project_end_at?: string;
  status?: string | number;
  approval_status?: string | number;
  approval_status_str?: string;
  charge_department_name?: string;
  charge_department_path?: string;
  project_owner_names?: string;
  contract_order_id?: string | number;
  order_name?: string;
  order_sn?: string;
  sub_order_sn?: string;
  order_amount_yuan?: number;
  order_customer_name?: string;
  raw_payload?: unknown;
}

export interface CrmUserRecord {
  source: "crm.org.users";
  name?: string;
  job_number?: string;
  title?: string;
  department_name?: string;
  department_path?: string;
  user_id?: string | number;
  raw_payload?: unknown;
}

export interface ApprovalPreauditCheck {
  id: string;
  status: "pass" | "warn" | "fail" | "unknown";
  severity: "info" | "yellow" | "red";
  message: string;
  evidence?: Record<string, unknown>;
}

export interface CrmApprovalPreauditRequest {
  source?: "dingtalk" | "cmb_xft" | "external";
  approval_id?: string;
  title?: string;
  process_name?: string;
  amount?: number;
  applicant?: string;
  department?: string;
  project?: string;
  project_refs?: string[];
  raw_detail?: unknown;
}

export interface CrmApprovalPreauditResult {
  ok: boolean;
  risk_level: "green" | "yellow" | "red" | "unknown";
  recommendation: "pass" | "manual_review" | "reject_or_return" | "unknown";
  confidence: "high" | "medium" | "low" | "unknown";
  checks: ApprovalPreauditCheck[];
  evidence: Array<{ source: string; kind: string; data: Record<string, unknown> }>;
  missing_context: string[];
  crm_project_match?: {
    matched: boolean;
    confidence: "high" | "medium" | "low";
    score: number;
    reasons: string[];
    candidate?: CrmProjectRecord;
    normalized_project?: string;
  };
  applicant?: CrmUserRecord;
  summary: string;
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
