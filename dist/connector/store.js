import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
export class JsonlStore {
    dataDir;
    mode = "jsonl";
    messagePath;
    auditPath;
    scheduledPath;
    identityPath;
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.messagePath = path.join(dataDir, "messages.jsonl");
        this.auditPath = path.join(dataDir, "audit.jsonl");
        this.scheduledPath = path.join(dataDir, "scheduled-actions.jsonl");
        this.identityPath = path.join(dataDir, "identity-mappings.jsonl");
    }
    async ensure() {
        await mkdir(this.dataDir, { recursive: true });
        await this.ensureFile(this.messagePath);
        await this.ensureFile(this.auditPath);
        await this.ensureFile(this.scheduledPath);
        await this.ensureFile(this.identityPath);
    }
    async appendMessage(record) {
        await this.ensure();
        const messages = await this.readMessages();
        const exists = messages.some((message) => message.platform === record.platform && message.message_id === record.message_id);
        if (exists) {
            return { inserted: false, record };
        }
        await this.appendJsonl(this.messagePath, record);
        return { inserted: true, record };
    }
    async searchMessages(filters) {
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
    async listConversations(filters) {
        const messages = await this.readMessages();
        const query = filters.query?.toLowerCase();
        const byId = new Map();
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
            return (conversation.conversation_id.toLowerCase().includes(query) ||
                conversation.conversation_name?.toLowerCase().includes(query));
        })
            .sort((a, b) => Date.parse(b.latest_timestamp ?? "0") - Date.parse(a.latest_timestamp ?? "0"))
            .slice(0, filters.limit ?? 50);
    }
    async appendAudit(event) {
        await this.ensure();
        const record = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            ...event
        };
        await this.appendJsonl(this.auditPath, record);
        return record;
    }
    async appendScheduledAction(record) {
        await this.ensure();
        const scheduled = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            status: "pending",
            ...record
        };
        await this.appendJsonl(this.scheduledPath, scheduled);
        return scheduled;
    }
    async upsertIdentityMapping(record) {
        await this.ensure();
        const records = await this.readJsonl(this.identityPath);
        const now = new Date().toISOString();
        const tenantId = record.tenant_id ?? "default";
        const aliases = uniqueStrings([
            ...record.aliases,
            record.display_name,
            record.platform_user_name,
            record.platform_user_id,
            record.canonical_user
        ]);
        const index = records.findIndex((item) => (item.tenant_id ?? "default") === tenantId &&
            item.platform === record.platform &&
            ((record.platform_user_id && item.platform_user_id === record.platform_user_id) ||
                (record.platform_user_name && item.platform_user_name === record.platform_user_name) ||
                item.canonical_user === record.canonical_user));
        const mapping = index >= 0
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
        }
        else {
            records.push(mapping);
        }
        await writeFile(this.identityPath, records.map((item) => JSON.stringify(item)).join("\n") + "\n");
        return mapping;
    }
    async listIdentityMappings(filters) {
        await this.ensure();
        const query = filters.query?.toLowerCase();
        return (await this.readJsonl(this.identityPath))
            .filter((record) => !filters.tenant_id || (record.tenant_id ?? "default") === filters.tenant_id)
            .filter((record) => !filters.platform || record.platform === filters.platform)
            .filter((record) => !filters.canonical_user || record.canonical_user === filters.canonical_user)
            .filter((record) => !query || identityHaystack(record).includes(query))
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
            .slice(0, filters.limit ?? 50);
    }
    async resolveIdentity(filters) {
        const value = filters.value.toLowerCase();
        return this.listIdentityMappings({
            tenant_id: filters.tenant_id,
            platform: filters.platform,
            query: value,
            limit: 20
        });
    }
    async listScheduledActions(filters) {
        await this.ensure();
        return (await this.readJsonl(this.scheduledPath))
            .filter((record) => !filters.tenant_id || record.tenant_id === filters.tenant_id)
            .filter((record) => !filters.status || record.status === filters.status)
            .sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for))
            .slice(0, filters.limit ?? 50);
    }
    async cancelScheduledAction(filters) {
        await this.ensure();
        const records = await this.readJsonl(this.scheduledPath);
        const index = records.findIndex((record) => record.id === filters.id && (!filters.tenant_id || record.tenant_id === filters.tenant_id));
        if (index < 0) {
            return undefined;
        }
        records[index] = { ...records[index], status: "cancelled" };
        await writeFile(this.scheduledPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
        return records[index];
    }
    async updateScheduledActionStatus(filters) {
        await this.ensure();
        const records = await this.readJsonl(this.scheduledPath);
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
    async auditCount() {
        await this.ensure();
        return (await this.readJsonl(this.auditPath)).length;
    }
    async readMessages() {
        await this.ensure();
        return this.readJsonl(this.messagePath);
    }
    async readJsonl(filePath) {
        const content = await readFile(filePath, "utf8");
        return content
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    async appendJsonl(filePath, value) {
        const content = `${JSON.stringify(value)}\n`;
        await writeFile(filePath, content, { flag: "a" });
    }
    async ensureFile(filePath) {
        try {
            await readFile(filePath, "utf8");
        }
        catch {
            await writeFile(filePath, "");
        }
    }
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value?.trim()).filter((value) => Boolean(value)))];
}
function identityHaystack(record) {
    return [
        record.canonical_user,
        record.display_name,
        record.platform_user_id,
        record.platform_user_name,
        ...record.aliases
    ].filter(Boolean).join(" ").toLowerCase();
}
//# sourceMappingURL=store.js.map