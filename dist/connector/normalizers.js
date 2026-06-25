import crypto from "node:crypto";
function parseJsonText(value) {
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return String(parsed.text ?? parsed.content ?? value);
        }
        catch {
            return value;
        }
    }
    if (value && typeof value === "object" && "text" in value) {
        return String(value.text ?? "");
    }
    return "";
}
function fallbackMessageId(platform, payload) {
    return crypto.createHash("sha256").update(`${platform}:${JSON.stringify(payload)}`).digest("hex");
}
export function normalizeFeishuEvent(payload) {
    const data = payload;
    const message = data.event?.message;
    const senderId = data.event?.sender?.sender_id?.user_id ?? data.event?.sender?.sender_id?.open_id ?? data.event?.sender?.sender_id?.union_id;
    return {
        platform: "feishu",
        conversation_id: message?.chat_id ?? "unknown-feishu-conversation",
        conversation_name: message?.chat_type,
        message_id: message?.message_id ?? data.header?.event_id ?? fallbackMessageId("feishu", payload),
        sender: senderId ?? data.event?.sender?.sender_type ?? "unknown",
        sender_id: senderId,
        text: parseJsonText(message?.content),
        timestamp: new Date(Number(message?.create_time ?? data.header?.create_time ?? Date.now())).toISOString(),
        raw_payload: payload
    };
}
export function normalizeDingTalkEvent(payload) {
    const data = payload;
    return {
        platform: "dingtalk",
        conversation_id: data.conversationId ?? "unknown-dingtalk-conversation",
        conversation_name: data.conversationTitle,
        message_id: data.msgId ?? fallbackMessageId("dingtalk", payload),
        sender: data.senderNick ?? data.senderStaffId ?? "unknown",
        sender_id: data.senderStaffId,
        text: data.text?.content ?? "",
        timestamp: new Date(data.createAt ?? Date.now()).toISOString(),
        raw_payload: payload
    };
}
//# sourceMappingURL=normalizers.js.map