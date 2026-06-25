import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
export class JsonlStore {
    dataDir;
    mode = "jsonl";
    messagePath;
    auditPath;
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.messagePath = path.join(dataDir, "messages.jsonl");
        this.auditPath = path.join(dataDir, "audit.jsonl");
    }
    async ensure() {
        await mkdir(this.dataDir, { recursive: true });
        await this.ensureFile(this.messagePath);
        await this.ensureFile(this.auditPath);
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
//# sourceMappingURL=store.js.map