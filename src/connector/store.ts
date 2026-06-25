import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AuditEvent, ConversationRecord, IdentityMappingRecord, MessageRecord, Platform, ScheduledActionRecord } from "../shared/types.js";

export interface MessageStore {
  readonly mode: string;
  ensure(): Promise<void>;
  appendMessage(record: MessageRecord): Promise<{ inserted: boolean; record: MessageRecord }>;
  searchMessages(filters: {
    tenant_id?: string;
    platform?: Platform;
    conversation_id?: string;
    query?: string;
    sender?: string;
    thread_id?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<MessageRecord[]>;
  listConversations(filters: { tenant_id?: string; platform?: Platform; query?: string; limit?: number }): Promise<ConversationRecord[]>;
  authorizeConversation?(record: { tenant_id: string; platform: Platform; conversation_id: string; conversation_name?: string }): Promise<void>;
  isConversationAuthorized?(filters: { tenant_id: string; platform: Platform; conversation_id: string }): Promise<boolean>;
  upsertIdentityMapping?(record: Omit<IdentityMappingRecord, "id" | "created_at" | "updated_at">): Promise<IdentityMappingRecord>;
  listIdentityMappings?(filters: { tenant_id?: string; platform?: Platform; canonical_user?: string; query?: string; limit?: number }): Promise<IdentityMappingRecord[]>;
  resolveIdentity?(filters: { tenant_id?: string; platform?: Platform; value: string }): Promise<IdentityMappingRecord[]>;
  appendScheduledAction?(record: Omit<ScheduledActionRecord, "id" | "created_at" | "status">): Promise<ScheduledActionRecord>;
  listScheduledActions?(filters: { tenant_id?: string; status?: ScheduledActionRecord["status"]; limit?: number }): Promise<ScheduledActionRecord[]>;
  cancelScheduledAction?(filters: { tenant_id?: string; id: string }): Promise<ScheduledActionRecord | undefined>;
  updateScheduledActionStatus?(filters: {
    tenant_id?: string;
    id: string;
    status: ScheduledActionRecord["status"];
    result_summary?: string;
  }): Promise<ScheduledActionRecord | undefined>;
  appendAudit(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent>;
  auditCount(): Promise<number>;
}

export class JsonlStore implements MessageStore {
  readonly mode = "jsonl";
  private readonly messagePath: string;
  private readonly auditPath: string;
  private readonly scheduledPath: string;
  private readonly identityPath: string;

  constructor(private readonly dataDir: string) {
    this.messagePath = path.join(dataDir, "messages.jsonl");
    this.auditPath = path.join(dataDir, "audit.jsonl");
    this.scheduledPath = path.join(dataDir, "scheduled-actions.jsonl");
    this.identityPath = path.join(dataDir, "identity-mappings.jsonl");
  }

  async ensure(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.ensureFile(this.messagePath);
    await this.ensureFile(this.auditPath);
    await this.ensureFile(this.scheduledPath);
    await this.ensureFile(this.identityPath);
  }

  async appendMessage(record: MessageRecord): Promise<{ inserted: boolean; record: MessageRecord }> {
    await this.ensure();
    const messages = await this.readMessages();
    const exists = messages.some((message) => message.platform === record.platform && message.message_id === record.message_id);

    if (exists) {
      return { inserted: false, record };
    }

    await this.appendJsonl(this.messagePath, record);
    return { inserted: true, record };
  }

  async searchMessages(filters: {
    tenant_id?: string;
    platform?: Platform;
    conversation_id?: string;
    query?: string;
    sender?: string;
    thread_id?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<MessageRecord[]> {
    const messages = await this.readMessages();
    const query = filters.query?.toLowerCase();
    const sender = filters.sender?.toLowerCase();
    const since = filters.since ? Date.parse(filters.since) : undefined;
    const until = filters.until ? Date.parse(filters.until) : undefined;

    return messages
      .filter((message) => !filters.tenant_id || message.tenant_id === filters.tenant_id)
      .filter((message) => !filters.platform || message.platform === filters.platform)
      .filter((message) => !filters.conversation_id || message.conversation_id === filters.conversation_id)
      .filter((message) => !filters.thread_id || message.thread_id === filters.thread_id || message.parent_message_id === filters.thread_id)
      .filter((message) => !query || message.text.toLowerCase().includes(query))
      .filter((message) => !sender || message.sender.toLowerCase().includes(sender) || message.sender_id?.toLowerCase().includes(sender))
      .filter((message) => {
        const value = Date.parse(message.timestamp);
        return (since === undefined || value >= since) && (until === undefined || value <= until);
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, filters.limit ?? 50);
  }

  async listConversations(filters: { tenant_id?: string; platform?: Platform; query?: string; limit?: number }): Promise<ConversationRecord[]> {
    const messages = await this.readMessages();
    const query = filters.query?.toLowerCase();
    const byId = new Map<string, ConversationRecord>();

    for (const message of messages) {
      if (filters.platform && message.platform !== filters.platform) {
        continue;
      }
      if (filters.tenant_id && message.tenant_id !== filters.tenant_id) {
        continue;
      }

      const key = `${message.platform}:${message.conversation_id}`;
      const current = byId.get(key) ?? {
        platform: message.platform,
        tenant_id: message.tenant_id,
        conversation_id: message.conversation_id,
        conversation_name: message.conversation_name,
        message_count: 0
      };

      current.message_count += 1;
      if (!current.latest_timestamp || Date.parse(message.timestamp) > Date.parse(current.latest_timestamp)) {
        current.latest_timestamp = message.timestamp;
      }
      byId.set(key, current);
    }

    return [...byId.values()]
      .filter((conversation) => {
        if (!query) {
          return true;
        }
        return (
          conversation.conversation_id.toLowerCase().includes(query) ||
          conversation.conversation_name?.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => Date.parse(b.latest_timestamp ?? "0") - Date.parse(a.latest_timestamp ?? "0"))
      .slice(0, filters.limit ?? 50);
  }

  async appendAudit(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent> {
    await this.ensure();
    const record: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event
    };
    await this.appendJsonl(this.auditPath, record);
    return record;
  }

  async appendScheduledAction(record: Omit<ScheduledActionRecord, "id" | "created_at" | "status">): Promise<ScheduledActionRecord> {
    await this.ensure();
    const scheduled: ScheduledActionRecord = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: "pending",
      ...record
    };
    await this.appendJsonl(this.scheduledPath, scheduled);
    return scheduled;
  }

  async upsertIdentityMapping(record: Omit<IdentityMappingRecord, "id" | "created_at" | "updated_at">): Promise<IdentityMappingRecord> {
    await this.ensure();
    const records = await this.readJsonl<IdentityMappingRecord>(this.identityPath);
    const now = new Date().toISOString();
    const tenantId = record.tenant_id ?? "default";
    const aliases = uniqueStrings([
      ...record.aliases,
      record.display_name,
      record.platform_user_name,
      record.platform_user_id,
      record.canonical_user
    ]);
    const index = records.findIndex((item) =>
      (item.tenant_id ?? "default") === tenantId &&
      item.platform === record.platform &&
      ((record.platform_user_id && item.platform_user_id === record.platform_user_id) ||
        (record.platform_user_name && item.platform_user_name === record.platform_user_name) ||
        item.canonical_user === record.canonical_user)
    );
    const mapping: IdentityMappingRecord = index >= 0
      ? {
          ...records[index],
          ...record,
          tenant_id: tenantId,
          aliases: uniqueStrings([...(records[index].aliases ?? []), ...aliases]),
          updated_at: now
        }
      : {
          id: crypto.randomUUID(),
          created_at: now,
          updated_at: now,
          ...record,
          tenant_id: tenantId,
          aliases
        };
    if (index >= 0) {
      records[index] = mapping;
    } else {
      records.push(mapping);
    }
    await writeFile(this.identityPath, records.map((item) => JSON.stringify(item)).join("\n") + "\n");
    return mapping;
  }

  async listIdentityMappings(filters: { tenant_id?: string; platform?: Platform; canonical_user?: string; query?: string; limit?: number }): Promise<IdentityMappingRecord[]> {
    await this.ensure();
    const query = filters.query?.toLowerCase();
    return (await this.readJsonl<IdentityMappingRecord>(this.identityPath))
      .filter((record) => !filters.tenant_id || (record.tenant_id ?? "default") === filters.tenant_id)
      .filter((record) => !filters.platform || record.platform === filters.platform)
      .filter((record) => !filters.canonical_user || record.canonical_user === filters.canonical_user)
      .filter((record) => !query || identityHaystack(record).includes(query))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, filters.limit ?? 50);
  }

  async resolveIdentity(filters: { tenant_id?: string; platform?: Platform; value: string }): Promise<IdentityMappingRecord[]> {
    const value = filters.value.toLowerCase();
    return this.listIdentityMappings({
      tenant_id: filters.tenant_id,
      platform: filters.platform,
      query: value,
      limit: 20
    });
  }

  async listScheduledActions(filters: { tenant_id?: string; status?: ScheduledActionRecord["status"]; limit?: number }): Promise<ScheduledActionRecord[]> {
    await this.ensure();
    return (await this.readJsonl<ScheduledActionRecord>(this.scheduledPath))
      .filter((record) => !filters.tenant_id || record.tenant_id === filters.tenant_id)
      .filter((record) => !filters.status || record.status === filters.status)
      .sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for))
      .slice(0, filters.limit ?? 50);
  }

  async cancelScheduledAction(filters: { tenant_id?: string; id: string }): Promise<ScheduledActionRecord | undefined> {
    await this.ensure();
    const records = await this.readJsonl<ScheduledActionRecord>(this.scheduledPath);
    const index = records.findIndex((record) => record.id === filters.id && (!filters.tenant_id || record.tenant_id === filters.tenant_id));
    if (index < 0) {
      return undefined;
    }
    records[index] = { ...records[index], status: "cancelled" };
    await writeFile(this.scheduledPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return records[index];
  }

  async updateScheduledActionStatus(filters: {
    tenant_id?: string;
    id: string;
    status: ScheduledActionRecord["status"];
    result_summary?: string;
  }): Promise<ScheduledActionRecord | undefined> {
    await this.ensure();
    const records = await this.readJsonl<ScheduledActionRecord>(this.scheduledPath);
    const index = records.findIndex((record) => record.id === filters.id && (!filters.tenant_id || record.tenant_id === filters.tenant_id));
    if (index < 0) {
      return undefined;
    }
    records[index] = {
      ...records[index],
      status: filters.status,
      last_run_at: new Date().toISOString(),
      result_summary: filters.result_summary
    };
    await writeFile(this.scheduledPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return records[index];
  }

  async auditCount(): Promise<number> {
    await this.ensure();
    return (await this.readJsonl<AuditEvent>(this.auditPath)).length;
  }

  private async readMessages(): Promise<MessageRecord[]> {
    await this.ensure();
    return this.readJsonl<MessageRecord>(this.messagePath);
  }

  private async readJsonl<T>(filePath: string): Promise<T[]> {
    const content = await readFile(filePath, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  }

  private async appendJsonl(filePath: string, value: unknown): Promise<void> {
    const content = `${JSON.stringify(value)}\n`;
    await writeFile(filePath, content, { flag: "a" });
  }

  private async ensureFile(filePath: string): Promise<void> {
    try {
      await readFile(filePath, "utf8");
    } catch {
      await writeFile(filePath, "");
    }
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function identityHaystack(record: IdentityMappingRecord): string {
  return [
    record.canonical_user,
    record.display_name,
    record.platform_user_id,
    record.platform_user_name,
    ...record.aliases
  ].filter(Boolean).join(" ").toLowerCase();
}
