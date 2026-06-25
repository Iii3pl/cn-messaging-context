import { mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
export class SqliteStore {
    dataDir;
    mode = "sqlite";
    db;
    constructor(dataDir) {
        this.dataDir = dataDir;
    }
    async ensure() {
        if (this.db) {
            return;
        }
        await mkdir(this.dataDir, { recursive: true });
        const moduleName = "node:sqlite";
        const sqlite = (await import(moduleName));
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
        }
        catch {
            // Some SQLite builds omit FTS5. Search falls back to LIKE below.
        }
    }
    async appendMessage(record) {
        const db = await this.database();
        const tenantId = tenantIdOf(record.tenant_id);
        const normalized = { ...record, tenant_id: tenantId };
        const result = db.prepare(`
      INSERT OR IGNORE INTO messages (
        tenant_id, platform, conversation_id, conversation_name, message_id, sender,
        sender_id, text, timestamp, raw_payload, context_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, normalized.platform, normalized.conversation_id, normalized.conversation_name ?? null, normalized.message_id, normalized.sender, normalized.sender_id ?? null, normalized.text, normalized.timestamp, normalized.raw_payload === undefined ? null : JSON.stringify(normalized.raw_payload), normalized.context_summary ?? null);
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
            }
            catch {
                // FTS is optional.
            }
        }
        return { inserted: (result.changes ?? 0) > 0, record: normalized };
    }
    async searchMessages(filters) {
        const db = await this.database();
        const clauses = ["m.tenant_id = ?"];
        const params = [tenantIdOf(filters.tenant_id)];
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
    `).all(...params, filters.limit ?? 50);
        return rows.map(rowToMessage);
    }
    async listConversations(filters) {
        const db = await this.database();
        const clauses = ["m.tenant_id = ?"];
        const params = [tenantIdOf(filters.tenant_id)];
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
    `).all(...params, filters.limit ?? 50);
        return rows;
    }
    async authorizeConversation(record) {
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
    async isConversationAuthorized(filters) {
        const db = await this.database();
        const row = db.prepare(`
      SELECT authorized FROM conversations
      WHERE tenant_id = ? AND platform = ? AND conversation_id = ?
    `).get(filters.tenant_id, filters.platform, filters.conversation_id);
        return row?.authorized === 1;
    }
    async appendAudit(event) {
        const db = await this.database();
        const record = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            ...event
        };
        db.prepare(`
      INSERT INTO audit_events (id, action, tenant_id, platform, conversation_id, timestamp, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.action, record.tenant_id ?? null, record.platform ?? null, record.conversation_id ?? null, record.timestamp, record.status, record.metadata === undefined ? null : JSON.stringify(record.metadata));
        return record;
    }
    async auditCount() {
        const db = await this.database();
        const row = db.prepare("SELECT COUNT(*) AS count FROM audit_events").get();
        return row.count;
    }
    async database() {
        await this.ensure();
        if (!this.db) {
            throw new Error("sqlite_store_not_initialized");
        }
        return this.db;
    }
}
function rowToMessage(row) {
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
function tenantIdOf(value) {
    return value && value.length > 0 ? value : "default";
}
//# sourceMappingURL=sqlite-store.js.map