import { spawn } from "node:child_process";
export async function checkWorkspaceStatus() {
    const [lark, dws] = await Promise.all([commandExists("lark-cli"), commandExists("dws")]);
    return {
        feishu: {
            cli: lark ? "available" : "missing",
            command: "lark-cli",
            docs: lark,
            sheets: lark,
            base: lark,
            whiteboard: lark
        },
        dingtalk: {
            cli: dws ? "available" : "missing",
            command: "dws",
            doc: dws,
            sheet: dws,
            aitable: dws
        },
        tencent: {
            openapi_configured: Boolean(process.env.TENCENT_DOCS_ACCESS_TOKEN && process.env.TENCENT_DOCS_OPEN_ID),
            mcp_token_configured: Boolean(process.env.TENCENT_DOCS_MCP_TOKEN),
            api_base: tencentApiBase(),
            note: "Tencent Docs adapter uses OpenAPI/OAuth credentials or a future Tencent Docs MCP bridge; secrets stay in connector env, never plugin files."
        }
    };
}
export async function readWorkspaceResource(input) {
    if (input.provider === "feishu") {
        return readFeishuWorkspace(input);
    }
    if (input.provider === "dingtalk") {
        return readDingTalkWorkspace(input);
    }
    return readTencentWorkspace(input);
}
export async function writeWorkspaceResource(input) {
    if (input.dry_run) {
        return {
            provider: input.provider,
            kind: input.kind,
            action: input.mode === "create" ? "publish" : "write",
            dry_run: true,
            adapter: adapterName(input.provider),
            target: input.target,
            raw_result: {
                title: input.title,
                mode: input.mode,
                target: input.target,
                content_length: input.content?.length ?? 0,
                values_rows: input.values?.length ?? input.rows?.length ?? 0,
                records: input.records?.length ?? 0
            }
        };
    }
    if (input.provider === "feishu") {
        return writeFeishuWorkspace(input);
    }
    if (input.provider === "dingtalk") {
        return writeDingTalkWorkspace(input);
    }
    return writeTencentWorkspace(input);
}
export async function listMentionMessages(input) {
    if (input.platform === "feishu") {
        const args = ["im", "+messages-search", "--is-at-me", "--format", "json", "--page-size", String(input.limit ?? 50)];
        if (input.conversation_id) {
            args.push("--chat-id", input.conversation_id);
        }
        if (input.since) {
            args.push("--start", input.since);
        }
        if (input.until) {
            args.push("--end", input.until);
        }
        const raw = await runJson("lark-cli", args);
        return { platform: "feishu", source: "mentions", adapter: "lark-cli im +messages-search --is-at-me", raw_result: raw, normalized: extractArray(raw) };
    }
    const args = ["chat", "message", "list-mentions", "--format", "json", "--limit", String(input.limit ?? 50)];
    if (input.conversation_id) {
        args.push("--group", input.conversation_id);
    }
    args.push("--start", input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), "--end", input.until ?? new Date().toISOString());
    const raw = await runJson("dws", args);
    return { platform: "dingtalk", source: "mentions", adapter: "dws chat message list-mentions", raw_result: raw, normalized: extractArray(raw) };
}
export async function listUnreadConversations(input) {
    if (input.platform === "dingtalk") {
        const args = ["chat", "message", "list-unread-conversations", "--format", "json"];
        if (input.limit) {
            args.push("--count", String(input.limit));
        }
        const raw = await runJson("dws", args);
        return { platform: "dingtalk", source: "unread_conversations", adapter: "dws chat message list-unread-conversations", raw_result: raw, normalized: extractArray(raw) };
    }
    const raw = await runJson("lark-cli", ["im", "+feed-shortcut-list", "--format", "json"]);
    const cards = extractArray(raw).filter((item) => JSON.stringify(item).toLowerCase().includes("unread"));
    return {
        platform: "feishu",
        source: "unread_conversations",
        adapter: "lark-cli im +feed-shortcut-list",
        raw_result: raw,
        normalized: cards.slice(0, input.limit ?? 50)
    };
}
export async function queryMessageReadStatus(input) {
    if (input.platform === "dingtalk") {
        const raw = await runJson("dws", [
            "chat",
            "message",
            "query-read-status",
            "--format",
            "json",
            "--group",
            input.conversation_id,
            "--msg-id",
            input.message_id
        ]);
        return { platform: "dingtalk", source: "read_status", adapter: "dws chat message query-read-status", raw_result: raw };
    }
    const raw = await runJson("lark-cli", ["im", "+messages-mget", "--format", "json", "--message-ids", input.message_id]);
    return {
        platform: "feishu",
        source: "read_status",
        adapter: "lark-cli im +messages-mget",
        raw_result: raw,
        normalized: extractArray(raw)
    };
}
async function readFeishuWorkspace(input) {
    assertUserAccessConsent(input);
    if (input.kind === "doc" || input.kind === "smartcanvas") {
        const { raw, accessIdentity, userPermissionUsed } = await runWithFeishuAccessFallback([
            "docs",
            "+fetch",
            "--api-version",
            "v2",
            "--doc",
            required(input.target, "target"),
            "--doc-format",
            input.output_as === "xml" ? "xml" : "markdown",
            "--format",
            "json"
        ], input);
        return result(input, "read", false, "lark-cli docs +fetch", raw, accessIdentity, userPermissionUsed);
    }
    if (input.kind === "sheet") {
        const args = ["sheets", "+csv-get", "--format", "json", "--range", input.range ?? "A1:Z100"];
        pushTargetArg(args, input.target);
        pushOptional(args, "--sheet-id", input.sheet_id);
        const { raw, accessIdentity, userPermissionUsed } = await runWithFeishuAccessFallback(args, input);
        return result(input, "read", false, "lark-cli sheets +csv-get", raw, accessIdentity, userPermissionUsed);
    }
    if (input.kind === "base" || input.kind === "smartsheet") {
        const { raw, accessIdentity, userPermissionUsed } = await runWithFeishuAccessFallback([
            "base",
            "+record-list",
            "--base-token",
            required(input.target, "target"),
            "--table-id",
            required(input.table_id, "table_id"),
            "--limit",
            String(input.limit ?? 100),
            "--format",
            "json"
        ], input);
        return result(input, "read", false, "lark-cli base +record-list", raw, accessIdentity, userPermissionUsed);
    }
    if (input.kind === "whiteboard" || input.kind === "board") {
        const { raw, accessIdentity, userPermissionUsed } = await runWithFeishuAccessFallback([
            "whiteboard",
            "+query",
            "--whiteboard-token",
            required(input.target, "target"),
            "--output_as",
            input.output_as === "raw" ? "raw" : "code",
            "--format",
            "json"
        ], input);
        return result(input, "read", false, "lark-cli whiteboard +query", raw, accessIdentity, userPermissionUsed);
    }
    return unsupported(input, "read", "feishu_workspace_kind_not_supported");
}
async function writeFeishuWorkspace(input) {
    if (input.kind === "doc" || input.kind === "smartcanvas") {
        const content = required(input.content, "content");
        const raw = input.mode === "create" || !input.target
            ? await runJson("lark-cli", [
                "docs",
                "+create",
                "--api-version",
                "v2",
                "--doc-format",
                input.input_format === "xml" ? "xml" : "markdown",
                "--content",
                content,
                "--format",
                "json",
                ...optionalParentArgs(input)
            ])
            : await runJson("lark-cli", [
                "docs",
                "+update",
                "--api-version",
                "v2",
                "--doc",
                input.target,
                "--command",
                input.mode === "overwrite" ? "overwrite" : "append",
                "--doc-format",
                input.input_format === "xml" ? "xml" : "markdown",
                "--content",
                content,
                "--format",
                "json"
            ]);
        return result(input, input.mode === "create" ? "publish" : "write", false, "lark-cli docs", raw);
    }
    if (input.kind === "sheet") {
        const args = ["sheets", "+csv-put", "--format", "json", "--start-cell", input.range ?? "A1", "--csv", input.content ?? matrixToCsv(requiredMatrix(input.values, "values"))];
        pushTargetArg(args, input.target);
        pushOptional(args, "--sheet-id", input.sheet_id);
        const raw = await runJson("lark-cli", args);
        return result(input, "write", false, "lark-cli sheets +csv-put", raw);
    }
    if (input.kind === "base" || input.kind === "smartsheet") {
        const payload = input.records ? { records: input.records } : { fields: requiredArray(input.fields, "fields"), rows: requiredMatrix(input.rows, "rows") };
        const raw = await runJson("lark-cli", [
            "base",
            "+record-batch-create",
            "--base-token",
            required(input.target, "target"),
            "--table-id",
            required(input.table_id, "table_id"),
            "--json",
            JSON.stringify(payload),
            "--format",
            "json"
        ]);
        return result(input, "write", false, "lark-cli base +record-batch-create", raw);
    }
    if (input.kind === "whiteboard" || input.kind === "board") {
        const raw = await runJson("lark-cli", [
            "whiteboard",
            "+update",
            "--whiteboard-token",
            required(input.target, "target"),
            "--input_format",
            input.input_format === "plantuml" ? "plantuml" : input.input_format === "raw" ? "raw" : "mermaid",
            "--source",
            required(input.content, "content"),
            "--overwrite",
            "--format",
            "json"
        ]);
        return result(input, "write", false, "lark-cli whiteboard +update", raw);
    }
    return unsupported(input, "write", "feishu_workspace_kind_not_supported");
}
async function readDingTalkWorkspace(input) {
    if (input.kind === "doc" || input.kind === "smartcanvas") {
        const raw = await runJson("dws", ["doc", "read", "--node", required(input.target, "target"), "--format", "json"]);
        return result(input, "read", false, "dws doc read", raw);
    }
    if (input.kind === "sheet") {
        const args = ["sheet", "range", "read", "--node", required(input.target, "target"), "--format", "json"];
        pushOptional(args, "--sheet-id", input.sheet_id);
        pushOptional(args, "--range", input.range);
        const raw = await runJson("dws", args);
        return result(input, "read", false, "dws sheet range read", raw);
    }
    if (input.kind === "base" || input.kind === "smartsheet") {
        const raw = await runJson("dws", [
            "aitable",
            "record",
            "query",
            "--base-id",
            required(input.target, "target"),
            "--table-id",
            required(input.table_id, "table_id"),
            "--limit",
            String(input.limit ?? 100),
            "--format",
            "json"
        ]);
        return result(input, "read", false, "dws aitable record query", raw);
    }
    return unsupported(input, "read", "dingtalk_workspace_kind_not_supported_by_current_dws");
}
async function writeDingTalkWorkspace(input) {
    if (input.kind === "doc" || input.kind === "smartcanvas") {
        const raw = input.mode === "create" || !input.target
            ? await runJson("dws", [
                "doc",
                "create",
                "--name",
                required(input.title, "title"),
                "--markdown",
                required(input.content, "content"),
                "--format",
                "json",
                ...optionalDingTalkParentArgs(input)
            ])
            : await runJson("dws", [
                "doc",
                "update",
                "--node",
                input.target,
                "--mode",
                input.mode === "overwrite" ? "overwrite" : "append",
                "--content",
                required(input.content, "content"),
                "--format",
                "json"
            ]);
        return result(input, input.mode === "create" ? "publish" : "write", false, "dws doc", raw);
    }
    if (input.kind === "sheet") {
        const raw = input.mode === "create" || !input.target
            ? await runJson("dws", ["sheet", "create", "--name", required(input.title, "title"), "--format", "json", ...optionalDingTalkParentArgs(input)])
            : await runJson("dws", [
                "sheet",
                input.mode === "append" ? "append" : "range",
                ...(input.mode === "append" ? [] : ["update"]),
                "--node",
                input.target,
                "--sheet-id",
                required(input.sheet_id, "sheet_id"),
                ...(input.mode === "append" ? [] : ["--range", input.range ?? "A1"]),
                "--values",
                JSON.stringify(requiredMatrix(input.values, "values")),
                "--format",
                "json"
            ]);
        return result(input, input.mode === "create" ? "publish" : "write", false, "dws sheet", raw);
    }
    if (input.kind === "base" || input.kind === "smartsheet") {
        const raw = await runJson("dws", [
            "aitable",
            "record",
            input.mode === "update" ? "update" : "create",
            "--base-id",
            required(input.target, "target"),
            "--table-id",
            required(input.table_id, "table_id"),
            "--records",
            JSON.stringify(requiredArray(input.records, "records")),
            "--format",
            "json"
        ]);
        return result(input, "write", false, "dws aitable record", raw);
    }
    return unsupported(input, "write", "dingtalk_workspace_kind_not_supported_by_current_dws");
}
async function readTencentWorkspace(input) {
    const raw = await callTencentDocsApi("POST", input.tencent_api_path ?? `/openapi/${input.kind}/read`, input);
    return result(input, "read", false, "tencent-docs-openapi", raw);
}
async function writeTencentWorkspace(input) {
    const raw = await callTencentDocsApi("POST", input.tencent_api_path ?? `/openapi/${input.kind}/${input.mode ?? "update"}`, input);
    return result(input, input.mode === "create" ? "publish" : "write", false, "tencent-docs-openapi", raw);
}
async function callTencentDocsApi(method, path, body) {
    const accessToken = process.env.TENCENT_DOCS_ACCESS_TOKEN;
    const openId = process.env.TENCENT_DOCS_OPEN_ID;
    if (!accessToken || !openId) {
        return {
            configured: false,
            error: "tencent_docs_credentials_missing",
            required_env: ["TENCENT_DOCS_ACCESS_TOKEN", "TENCENT_DOCS_OPEN_ID"],
            optional_env: ["TENCENT_DOCS_CLIENT_ID", "TENCENT_DOCS_API_BASE", "TENCENT_DOCS_MCP_TOKEN"],
            note: "Tencent Docs official OpenAPI/OAuth credentials must be configured in the connector service environment before real read/write calls."
        };
    }
    const response = await fetch(new URL(path, tencentApiBase()), {
        method,
        headers: {
            "content-type": "application/json",
            "access-token": accessToken,
            "open-id": openId,
            ...(process.env.TENCENT_DOCS_CLIENT_ID ? { "client-id": process.env.TENCENT_DOCS_CLIENT_ID } : {})
        },
        body: JSON.stringify(body)
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(`Tencent Docs request failed: ${response.status} ${JSON.stringify(payload)}`);
    }
    return payload;
}
function result(input, action, dryRun, adapter, raw, accessIdentity = input.access_identity, userPermissionUsed = accessIdentity === "user") {
    return {
        provider: input.provider,
        kind: input.kind,
        action,
        dry_run: dryRun,
        adapter,
        access_identity: accessIdentity,
        user_permission_used: userPermissionUsed,
        target: input.target,
        raw_result: raw
    };
}
function unsupported(input, action, diagnostic) {
    return {
        provider: input.provider,
        kind: input.kind,
        action,
        dry_run: false,
        adapter: adapterName(input.provider),
        target: input.target,
        diagnostic
    };
}
function adapterName(provider) {
    return provider === "feishu" ? "lark-cli" : provider === "dingtalk" ? "dws" : "tencent-docs-openapi";
}
function tencentApiBase() {
    return process.env.TENCENT_DOCS_API_BASE ?? "https://docs.qq.com";
}
function required(value, name) {
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
}
function requiredArray(value, name) {
    if (!value || value.length === 0) {
        throw new Error(`${name} is required`);
    }
    return value;
}
function requiredMatrix(value, name) {
    if (!value || value.length === 0) {
        throw new Error(`${name} is required`);
    }
    return value;
}
function pushOptional(args, flag, value) {
    if (value) {
        args.push(flag, value);
    }
}
function pushTargetArg(args, target) {
    const value = required(target, "target");
    if (/^https?:\/\//.test(value)) {
        args.push("--url", value);
    }
    else {
        args.push("--spreadsheet-token", value);
    }
}
function optionalParentArgs(input) {
    if (input.parent_id) {
        return ["--parent-token", input.parent_id];
    }
    return [];
}
function optionalDingTalkParentArgs(input) {
    if (input.parent_id) {
        return ["--folder", input.parent_id];
    }
    if (input.workspace_id) {
        return ["--workspace", input.workspace_id];
    }
    return [];
}
function matrixToCsv(rows) {
    return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}
function assertUserAccessConsent(input) {
    if ((input.access_identity === "user" || input.allow_user_fallback) && !input.user_consent_confirmed) {
        throw new Error("需要先得到你的同意，才能用你的飞书账号权限读取群聊或文档。");
    }
}
async function runWithFeishuAccessFallback(args, input) {
    const primaryIdentity = input.access_identity ?? "auto";
    try {
        return {
            raw: await runJson("lark-cli", [...args, ...accessArgs(primaryIdentity)]),
            accessIdentity: primaryIdentity,
            userPermissionUsed: primaryIdentity === "user"
        };
    }
    catch (error) {
        if (primaryIdentity === "user" || !input.allow_user_fallback || !isPermissionLikeError(error)) {
            throw error;
        }
        assertUserAccessConsent(input);
        return {
            raw: await runJson("lark-cli", [...args, ...accessArgs("user")]),
            accessIdentity: "user",
            userPermissionUsed: true
        };
    }
}
function accessArgs(identity) {
    if (identity === "auto") {
        return [];
    }
    return ["--as", identity];
}
function isPermissionLikeError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /permission|forbidden|unauthori[sz]ed|scope|access denied|no access|无权限|权限不足|没有权限|未授权|91403|99991663/i.test(message);
}
function extractArray(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }
    const data = raw;
    for (const key of ["items", "list", "records", "messages", "conversations", "data", "result"]) {
        const value = data?.[key];
        if (Array.isArray(value)) {
            return value;
        }
        if (value && typeof value === "object") {
            const nested = extractArray(value);
            if (nested.length > 0) {
                return nested;
            }
        }
    }
    return [];
}
async function commandExists(command) {
    try {
        await run(command, ["--help"], { timeoutMs: 5000 });
        return true;
    }
    catch {
        return false;
    }
}
async function runJson(command, args) {
    const output = await run(command, args, { timeoutMs: 60000 });
    return JSON.parse(output);
}
function run(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error(`${command} timed out`));
        }, options.timeoutMs);
        const stdout = [];
        const stderr = [];
        child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            const out = Buffer.concat(stdout).toString("utf8").trim();
            const err = Buffer.concat(stderr).toString("utf8").trim();
            if (code !== 0) {
                reject(new Error(`${command} exited ${code}: ${err || out}`));
                return;
            }
            resolve(out);
        });
    });
}
//# sourceMappingURL=workspace.js.map