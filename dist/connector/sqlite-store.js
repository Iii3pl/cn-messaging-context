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
        thread_id TEXT,
        parent_message_id TEXT,
        reply_count INTEGER,
        is_thread_parent INTEGER,
        sender TEXT NOT NULL,
        sender_id TEXT,
        mentions TEXT,
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
        last_run_at TEXT,
        result_summary TEXT,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS identity_mappings (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        canonical_user TEXT NOT NULL,
        display_name TEXT,
        platform TEXT NOT NULL,
        platform_user_id TEXT,
        platform_user_name TEXT,
        aliases TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
        for (const statement of [
            "ALTER TABLE messages ADD COLUMN thread_id TEXT",
            "ALTER TABLE messages ADD COLUMN parent_message_id TEXT",
            "ALTER TABLE messages ADD COLUMN reply_count INTEGER",
            "ALTER TABLE messages ADD COLUMN is_thread_parent INTEGER",
            "ALTER TABLE messages ADD COLUMN mentions TEXT",
            "ALTER TABLE scheduled_actions ADD COLUMN last_run_at TEXT",
            "ALTER TABLE scheduled_actions ADD COLUMN result_summary TEXT"
        ]) {
            try {
                this.db.exec(statement);
            }
            catch {
                // Existing databases may already have the column.
            }
        }
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
        tenant_id, platform, conversation_id, conversation_name, message_id, thread_id,
        parent_message_id, reply_count, is_thread_parent, sender, sender_id, mentions,
        text, timestamp, raw_payload, context_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, normalized.platform, normalized.conversation_id, normalized.conversation_name ?? null, normalized.message_id, normalized.thread_id ?? null, normalized.parent_message_id ?? null, normalized.reply_count ?? null, normalized.is_thread_parent === undefined ? null : Number(normalized.is_thread_parent), normalized.sender, normalized.sender_id ?? null, normalized.mentions ? JSON.stringify(normalized.mentions) : null, normalized.text, normalized.timestamp, normalized.raw_payload === undefined ? null : JSON.stringify(normalized.raw_payload), normalized.context_summary ?? null);
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
        if (filters.thread_id) {
            clauses.push("(m.thread_id = ? OR m.parent_message_id = ?)");
            params.push(filters.thread_id, filters.thread_id);
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
    async appendScheduledAction(record) {
        const db = await this.database();
        const scheduled = {
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
    `).run(scheduled.id, scheduled.tenant_id ?? null, scheduled.action, scheduled.platform ?? null, scheduled.conversation_id ?? null, scheduled.conversation_name ?? null, scheduled.scheduled_for, scheduled.status, scheduled.created_at, JSON.stringify(scheduled.payload));
        return scheduled;
    }
    async upsertIdentityMapping(record) {
        const db = await this.database();
        const tenantId = tenantIdOf(record.tenant_id);
        const now = new Date().toISOString();
        const aliases = uniqueStrings([
            ...record.aliases,
            record.display_name,
            record.platform_user_name,
            record.platform_user_id,
            record.canonical_user
        ]);
        const existing = db.prepare(`
      SELECT * FROM identity_mappings
      WHERE tenant_id = ? AND platform = ? AND (
        (? IS NOT NULL AND platform_user_id = ?) OR
        (? IS NOT NULL AND platform_user_name = ?) OR
        canonical_user = ?
      )
      LIMIT 1
    `).get(tenantId, record.platform, record.platform_user_id ?? null, record.platform_user_id ?? null, record.platform_user_name ?? null, record.platform_user_name ?? null, record.canonical_user);
        const mapping = existing
            ? {
                ...rowToIdentityMapping(existing),
                ...record,
                tenant_id: tenantId,
                aliases: uniqueStrings([...JSON.parse(existing.aliases), ...aliases]),
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
        db.prepare(`
      INSERT INTO identity_mappings (
        id, tenant_id, canonical_user, display_name, platform, platform_user_id,
        platform_user_name, aliases, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_user = excluded.canonical_user,
        display_name = excluded.display_name,
        platform_user_id = excluded.platform_user_id,
        platform_user_name = excluded.platform_user_name,
        aliases = excluded.aliases,
        updated_at = excluded.updated_at
    `).run(mapping.id, tenantId, mapping.canonical_user, mapping.display_name ?? null, mapping.platform, mapping.platform_user_id ?? null, mapping.platform_user_name ?? null, JSON.stringify(mapping.aliases), mapping.created_at, mapping.updated_at);
        return mapping;
    }
    async listIdentityMappings(filters) {
        const db = await this.database();
        const clauses = ["tenant_id = ?"];
        const params = [tenantIdOf(filters.tenant_id)];
        if (filters.platform) {
            clauses.push("platform = ?");
            params.push(filters.platform);
        }
        if (filters.canonical_user) {
            clauses.push("canonical_user = ?");
            params.push(filters.canonical_user);
        }
        if (filters.query) {
            const query = `%${filters.query.toLowerCase()}%`;
            clauses.push("(lower(canonical_user) LIKE ? OR lower(COALESCE(display_name, '')) LIKE ? OR lower(COALESCE(platform_user_id, '')) LIKE ? OR lower(COALESCE(platform_user_name, '')) LIKE ? OR lower(aliases) LIKE ?)");
            params.push(query, query, query, query, query);
        }
        const rows = db.prepare(`
      SELECT * FROM identity_mappings
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, filters.limit ?? 50);
        return rows.map(rowToIdentityMapping);
    }
    async resolveIdentity(filters) {
        return this.listIdentityMappings({
            tenant_id: filters.tenant_id,
            platform: filters.platform,
            query: filters.value,
            limit: 20
        });
    }
    async listScheduledActions(filters) {
        const db = await this.database();
        const clauses = [];
        const params = [];
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
    `).all(...params, filters.limit ?? 50);
        return rows.map(rowToScheduledAction);
    }
    async cancelScheduledAction(filters) {
        const db = await this.database();
        const clauses = ["id = ?"];
        const params = [filters.id];
        if (filters.tenant_id) {
            clauses.push("tenant_id = ?");
            params.push(filters.tenant_id);
        }
        db.prepare(`UPDATE scheduled_actions SET status = 'cancelled' WHERE ${clauses.join(" AND ")}`).run(...params);
        const row = db.prepare(`SELECT * FROM scheduled_actions WHERE ${clauses.join(" AND ")}`).get(...params);
        return row ? rowToScheduledAction(row) : undefined;
    }
    async updateScheduledActionStatus(filters) {
        const db = await this.database();
        const clauses = ["id = ?"];
        const params = [filters.id];
        if (filters.tenant_id) {
            clauses.push("tenant_id = ?");
            params.push(filters.tenant_id);
        }
        db.prepare(`
      UPDATE scheduled_actions
      SET status = ?, last_run_at = ?, result_summary = ?
      WHERE ${clauses.join(" AND ")}
    `).run(filters.status, new Date().toISOString(), filters.result_summary ?? null, ...params);
        const row = db.prepare(`SELECT * FROM scheduled_actions WHERE ${clauses.join(" AND ")}`).get(...params);
        return row ? rowToScheduledAction(row) : undefined;
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
        thread_id: row.thread_id ?? undefined,
        parent_message_id: row.parent_message_id ?? undefined,
        reply_count: row.reply_count ?? undefined,
        is_thread_parent: row.is_thread_parent === null || row.is_thread_parent === undefined ? undefined : Boolean(row.is_thread_parent),
        sender: row.sender,
        sender_id: row.sender_id ?? undefined,
        mentions: row.mentions ? JSON.parse(row.mentions) : undefined,
        text: row.text,
        timestamp: row.timestamp,
        raw_payload: row.raw_payload ? JSON.parse(row.raw_payload) : undefined,
        context_summary: row.context_summary ?? undefined
    };
}
function rowToScheduledAction(row) {
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
        last_run_at: row.last_run_at ?? undefined,
        result_summary: row.result_summary ?? undefined,
        payload: JSON.parse(row.payload)
    };
}
function rowToIdentityMapping(row) {
    return {
        id: row.id,
        tenant_id: row.tenant_id,
        canonical_user: row.canonical_user,
        display_name: row.display_name ?? undefined,
        platform: row.platform,
        platform_user_id: row.platform_user_id ?? undefined,
        platform_user_name: row.platform_user_name ?? undefined,
        aliases: JSON.parse(row.aliases),
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}
function tenantIdOf(value) {
    return value && value.length > 0 ? value : "default";
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value?.trim()).filter((value) => Boolean(value)))];
}
//# sourceMappingURL=sqlite-store.js.map