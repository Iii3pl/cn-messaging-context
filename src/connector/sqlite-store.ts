import { mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AuditEvent, ConversationRecord, MessageRecord, Platform, ScheduledActionRecord } from "../shared/types.js";
import type { MessageStore } from "./store.js";

type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes?: number };
  };
};

export class SqliteStore implements MessageStore {
  readonly mode = "sqlite";
  private db?: DatabaseSync;

  constructor(private readonly dataDir: string) {}

  async ensure(): Promise<void> {
    if (this.db) {
      return;
    }

    await mkdir(this.dataDir, { recursive: true });
    const moduleName = "node:sqlite";
    const sqlite = (await import(moduleName)) as { DatabaseSync: new (filename: string) => DatabaseSync };
    this.db = new sqlite.DatabaseSync(path.join(this.dataDir, "messages.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        tenant_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        conversation_name TEXT,
        message_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        sender_id TEXT,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        raw_payload TEXT,
        context_summary TEXT,
        PRIMARY KEY (tenant_id, platform, message_id)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        tenant_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        conversation_name TEXT,
        authorized INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, platform, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        tenant_id TEXT,
        platform TEXT,
        conversation_id TEXT,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS scheduled_actions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        action TEXT NOT NULL,
        platform TEXT,
        conversation_id TEXT,
        conversation_name TEXT,
        scheduled_for TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
          tenant_id UNINDEXED,
          platform UNINDEXED,
          conversation_id UNINDEXED,
          message_id UNINDEXED,
          text,
          sender
        );
      `);
    } catch {
      // Some SQLite builds omit FTS5. Search falls back to LIKE below.
    }
  }

  async appendMessage(record: MessageRecord): Promise<{ inserted: boolean; record: MessageRecord }> {
    const db = await this.database();
    const tenantId = tenantIdOf(record.tenant_id);
    const normalized = { ...record, tenant_id: tenantId };
    const result = db.prepare(`
      INSERT OR IGNORE INTO messages (
        tenant_id, platform, conversation_id, conversation_name, message_id, sender,
        sender_id, text, timestamp, raw_payload, context_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId,
      normalized.platform,
      normalized.conversation_id,
      normalized.conversation_name ?? null,
      normalized.message_id,
      normalized.sender,
      normalized.sender_id ?? null,
      normalized.text,
      normalized.timestamp,
      normalized.raw_payload === undefined ? null : JSON.stringify(normalized.raw_payload),
      normalized.context_summary ?? null
    );

    db.prepare(`
      INSERT INTO conversations (tenant_id, platform, conversation_id, conversation_name, authorized, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(tenant_id, platform, conversation_id) DO UPDATE SET
        conversation_name = COALESCE(excluded.conversation_name, conversations.conversation_name),
        updated_at = excluded.updated_at
    `).run(tenantId, normalized.platform, normalized.conversation_id, normalized.conversation_name ?? null, new Date().toISOString());

    if ((result.changes ?? 0) > 0) {
      try {
        db.prepare(`
          INSERT INTO message_fts (tenant_id, platform, conversation_id, message_id, text, sender)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(tenantId, normalized.platform, normalized.conversation_id, normalized.message_id, normalized.text, normalized.sender);
      } catch {
        // FTS is optional.
      }
    }

    return { inserted: (result.changes ?? 0) > 0, record: normalized };
  }

  async searchMessages(filters: {
    tenant_id?: string;
    platform?: Platform;
    conversation_id?: string;
    query?: string;
    sender?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<MessageRecord[]> {
    const db = await this.database();
    const clauses = ["m.tenant_id = ?"];
    const params: unknown[] = [tenantIdOf(filters.tenant_id)];

    if (filters.platform) {
      clauses.push("m.platform = ?");
      params.push(filters.platform);
    }
    if (filters.conversation_id) {
      clauses.push("m.conversation_id = ?");
      params.push(filters.conversation_id);
    }
    if (filters.sender) {
      clauses.push("(lower(m.sender) LIKE ? OR lower(COALESCE(m.sender_id, '')) LIKE ?)");
      params.push(`%${filters.sender.toLowerCase()}%`, `%${filters.sender.toLowerCase()}%`);
    }
    if (filters.since) {
      clauses.push("m.timestamp >= ?");
      params.push(filters.since);
    }
    if (filters.until) {
      clauses.push("m.timestamp <= ?");
      params.push(filters.until);
    }
    if (filters.query) {
      clauses.push("lower(m.text) LIKE ?");
      params.push(`%${filters.query.toLowerCase()}%`);
    }

    const rows = db.prepare(`
      SELECT m.* FROM messages m
      WHERE ${clauses.join(" AND ")}
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(...params, filters.limit ?? 50) as SqlMessageRow[];

    return rows.map(rowToMessage);
  }

  async listConversations(filters: { tenant_id?: string; platform?: Platform; query?: string; limit?: number }): Promise<ConversationRecord[]> {
    const db = await this.database();
    const clauses = ["m.tenant_id = ?"];
    const params: unknown[] = [tenantIdOf(filters.tenant_id)];
    if (filters.platform) {
      clauses.push("m.platform = ?");
      params.push(filters.platform);
    }
    if (filters.query) {
      clauses.push("(lower(m.conversation_id) LIKE ? OR lower(COALESCE(m.conversation_name, '')) LIKE ?)");
      params.push(`%${filters.query.toLowerCase()}%`, `%${filters.query.toLowerCase()}%`);
    }

    const rows = db.prepare(`
      SELECT
        m.tenant_id,
        m.platform,
        m.conversation_id,
        MAX(m.conversation_name) AS conversation_name,
        MAX(m.timestamp) AS latest_timestamp,
        COUNT(*) AS message_count
      FROM messages m
      WHERE ${clauses.join(" AND ")}
      GROUP BY m.tenant_id, m.platform, m.conversation_id
      ORDER BY latest_timestamp DESC
      LIMIT ?
    `).all(...params, filters.limit ?? 50) as Array<ConversationRecord & { message_count: number }>;

    return rows;
  }

  async authorizeConversation(record: { tenant_id: string; platform: Platform; conversation_id: string; conversation_name?: string }): Promise<void> {
    const db = await this.database();
    db.prepare(`
      INSERT INTO conversations (tenant_id, platform, conversation_id, conversation_name, authorized, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(tenant_id, platform, conversation_id) DO UPDATE SET
        authorized = 1,
        conversation_name = COALESCE(excluded.conversation_name, conversations.conversation_name),
        updated_at = excluded.updated_at
    `).run(record.tenant_id, record.platform, record.conversation_id, record.conversation_name ?? null, new Date().toISOString());
  }

  async isConversationAuthorized(filters: { tenant_id: string; platform: Platform; conversation_id: string }): Promise<boolean> {
    const db = await this.database();
    const row = db.prepare(`
      SELECT authorized FROM conversations
      WHERE tenant_id = ? AND platform = ? AND conversation_id = ?
    `).get(filters.tenant_id, filters.platform, filters.conversation_id) as { authorized?: number } | undefined;
    return row?.authorized === 1;
  }

  async appendAudit(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent> {
    const db = await this.database();
    const record: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event
    };
    db.prepare(`
      INSERT INTO audit_events (id, action, tenant_id, platform, conversation_id, timestamp, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.action,
      record.tenant_id ?? null,
      record.platform ?? null,
      record.conversation_id ?? null,
      record.timestamp,
      record.status,
      record.metadata === undefined ? null : JSON.stringify(record.metadata)
    );
    return record;
  }

  async auditCount(): Promise<number> {
    const db = await this.database();
    const row = db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number };
    return row.count;
  }

  async appendScheduledAction(record: Omit<ScheduledActionRecord, "id" | "created_at" | "status">): Promise<ScheduledActionRecord> {
    const db = await this.database();
    const scheduled: ScheduledActionRecord = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: "pending",
      ...record
    };
    db.prepare(`
      INSERT INTO scheduled_actions (
        id, tenant_id, action, platform, conversation_id, conversation_name,
        scheduled_for, status, created_at, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scheduled.id,
      scheduled.tenant_id ?? null,
      scheduled.action,
      scheduled.platform ?? null,
      scheduled.conversation_id ?? null,
      scheduled.conversation_name ?? null,
      scheduled.scheduled_for,
      scheduled.status,
      scheduled.created_at,
      JSON.stringify(scheduled.payload)
    );
    return scheduled;
  }

  async listScheduledActions(filters: { tenant_id?: string; status?: ScheduledActionRecord["status"]; limit?: number }): Promise<ScheduledActionRecord[]> {
    const db = await this.database();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.tenant_id) {
      clauses.push("tenant_id = ?");
      params.push(filters.tenant_id);
    }
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT * FROM scheduled_actions
      ${where}
      ORDER BY scheduled_for ASC
      LIMIT ?
    `).all(...params, filters.limit ?? 50) as SqlScheduledRow[];
    return rows.map(rowToScheduledAction);
  }

  async cancelScheduledAction(filters: { tenant_id?: string; id: string }): Promise<ScheduledActionRecord | undefined> {
    const db = await this.database();
    const clauses = ["id = ?"];
    const params: unknown[] = [filters.id];
    if (filters.tenant_id) {
      clauses.push("tenant_id = ?");
      params.push(filters.tenant_id);
    }
    db.prepare(`UPDATE scheduled_actions SET status = 'cancelled' WHERE ${clauses.join(" AND ")}`).run(...params);
    const row = db.prepare(`SELECT * FROM scheduled_actions WHERE ${clauses.join(" AND ")}`).get(...params) as SqlScheduledRow | undefined;
    return row ? rowToScheduledAction(row) : undefined;
  }

  private async database(): Promise<DatabaseSync> {
    await this.ensure();
    if (!this.db) {
      throw new Error("sqlite_store_not_initialized");
    }
    return this.db;
  }
}

interface SqlMessageRow {
  tenant_id: string;
  platform: Platform;
  conversation_id: string;
  conversation_name?: string | null;
  message_id: string;
  sender: string;
  sender_id?: string | null;
  text: string;
  timestamp: string;
  raw_payload?: string | null;
  context_summary?: string | null;
}

interface SqlScheduledRow {
  id: string;
  tenant_id?: string | null;
  action: ScheduledActionRecord["action"];
  platform?: Platform | null;
  conversation_id?: string | null;
  conversation_name?: string | null;
  scheduled_for: string;
  status: ScheduledActionRecord["status"];
  created_at: string;
  payload: string;
}

function rowToMessage(row: SqlMessageRow): MessageRecord {
  return {
    tenant_id: row.tenant_id,
    platform: row.platform,
    conversation_id: row.conversation_id,
    conversation_name: row.conversation_name ?? undefined,
    message_id: row.message_id,
    sender: row.sender,
    sender_id: row.sender_id ?? undefined,
    text: row.text,
    timestamp: row.timestamp,
    raw_payload: row.raw_payload ? JSON.parse(row.raw_payload) : undefined,
    context_summary: row.context_summary ?? undefined
  };
}

function rowToScheduledAction(row: SqlScheduledRow): ScheduledActionRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id ?? undefined,
    action: row.action,
    platform: row.platform ?? undefined,
    conversation_id: row.conversation_id ?? undefined,
    conversation_name: row.conversation_name ?? undefined,
    scheduled_for: row.scheduled_for,
    status: row.status,
    created_at: row.created_at,
    payload: JSON.parse(row.payload) as Record<string, unknown>
  };
}

function tenantIdOf(value: string | undefined): string {
  return value && value.length > 0 ? value : "default";
}
