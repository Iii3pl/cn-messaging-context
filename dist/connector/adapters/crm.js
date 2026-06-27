import { spawn } from "node:child_process";
const DEFAULT_TIMEOUT_MS = 20000;
const HIGH_AMOUNT = 50000;
const LARGE_AMOUNT = 10000;
export function createCrmAdapter(options = {}) {
    const enabled = options.enabled ?? process.env.CN_MESSAGING_CRM_ENABLED === "true";
    const command = options.command ?? process.env.CN_MESSAGING_CRM_CLI ?? "crm";
    const timeoutMs = options.timeoutMs ?? Number(process.env.CN_MESSAGING_CRM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const runner = options.runner ?? runCommand;
    async function status() {
        if (!enabled) {
            return { enabled, cli: "disabled", command, timeout_ms: timeoutMs };
        }
        const available = await commandExists(command, runner, timeoutMs);
        return { enabled, cli: available ? "available" : "missing", command, timeout_ms: timeoutMs };
    }
    async function searchProjects(input) {
        ensureEnabled(enabled);
        const query = requireNonEmpty(input.query, "query");
        const limit = clampLimit(input.limit, 10);
        const raw = await runJson(command, ["project", "list", "--keyword", query, "--rows", String(limit), "--json"], runner, timeoutMs);
        return {
            projects: extractArray(raw).map((item) => normalizeProject(item, "crm.project.list")).slice(0, limit),
            raw_result: raw
        };
    }
    async function getProjectDetail(projectId) {
        ensureEnabled(enabled);
        const id = requireNonEmpty(projectId, "project_id");
        const raw = await runJson(command, ["project", "detail", String(id), "--json"], runner, timeoutMs);
        return {
            project: normalizeProject(raw, "crm.project.detail"),
            raw_result: raw
        };
    }
    async function lookupUsers(input) {
        ensureEnabled(enabled);
        const name = requireNonEmpty(input.name, "name");
        const limit = clampLimit(input.limit, 5);
        const raw = await runJson(command, ["org", "users", "--name", name, "--rows", String(limit), "--json"], runner, timeoutMs);
        return {
            users: extractArray(raw).map(normalizeUser).slice(0, limit),
            raw_result: raw
        };
    }
    async function preauditApproval(input) {
        const checks = [];
        const evidence = [];
        const missingContext = [];
        if (!enabled) {
            addCheck(checks, "crm_cli", "unknown", "yellow", "CRM CLI access is disabled", {
                enable_with: "CN_MESSAGING_CRM_ENABLED=true"
            });
            return finalizePreaudit({ checks, evidence, missingContext: ["crm_cli_disabled"], input });
        }
        const statusResult = await status();
        if (statusResult.cli !== "available") {
            addCheck(checks, "crm_cli", "unknown", "yellow", "CRM CLI is not available", { ...statusResult });
            return finalizePreaudit({ checks, evidence, missingContext: ["crm_cli_missing"], input });
        }
        addAmountCheck(checks, input.amount);
        const projectRefs = extractProjectRefs(input);
        let best;
        const projectErrors = [];
        if (projectRefs.length === 0) {
            addCheck(checks, "crm_project_ref", "unknown", "yellow", "No project reference was provided for CRM matching");
            missingContext.push("project_ref");
        }
        else {
            const candidates = [];
            for (const ref of projectRefs.slice(0, 6)) {
                try {
                    const result = await searchProjects({ query: ref, limit: 10 });
                    candidates.push(...result.projects);
                }
                catch (error) {
                    projectErrors.push({ ref, error: errorMessage(error) });
                }
            }
            best = pickBestProject(candidates, projectRefs, input.department);
            if (best?.matched && best.candidate) {
                addCheck(checks, "crm_project_match", "pass", "info", "Matched a CRM project", {
                    crm_project_id: best.candidate.crm_project_id,
                    project_full_name: best.candidate.project_full_name,
                    confidence: best.confidence,
                    match_method: best.reasons.join("; ")
                });
                evidence.push({
                    source: best.candidate.source,
                    kind: "crm_project_match",
                    data: projectEvidence(best.candidate)
                });
                const projectForChecks = best.candidate.crm_project_id
                    ? await detailOrCandidate(best.candidate, getProjectDetail)
                    : best.candidate;
                addProjectChecks(checks, projectForChecks, input);
            }
            else {
                addCheck(checks, "crm_project_match", "warn", "yellow", "No confident CRM project match was found", {
                    tried: projectRefs,
                    errors: projectErrors
                });
                missingContext.push("crm_project");
            }
        }
        let applicant;
        if (input.applicant) {
            try {
                const users = await lookupUsers({ name: input.applicant, limit: 5 });
                applicant = users.users[0];
                if (applicant) {
                    addCheck(checks, "crm_applicant", "pass", "info", "Applicant was found in CRM organization", {
                        name: applicant.name,
                        job_number: applicant.job_number,
                        title: applicant.title
                    });
                    evidence.push({
                        source: "crm.org.users",
                        kind: "crm_applicant",
                        data: compactObject({
                            name: applicant.name,
                            job_number: applicant.job_number,
                            title: applicant.title,
                            department_path: applicant.department_path
                        })
                    });
                }
                else {
                    addCheck(checks, "crm_applicant", "warn", "yellow", "Applicant was not found in CRM organization", {
                        applicant: input.applicant
                    });
                    missingContext.push("crm_applicant");
                }
            }
            catch (error) {
                addCheck(checks, "crm_applicant", "unknown", "yellow", "CRM applicant lookup failed", {
                    error: errorMessage(error)
                });
                missingContext.push("crm_applicant");
            }
        }
        return finalizePreaudit({
            checks,
            evidence,
            missingContext,
            input,
            projectMatch: best,
            applicant
        });
    }
    return { status, searchProjects, getProjectDetail, lookupUsers, preauditApproval };
}
const defaultAdapter = createCrmAdapter();
export async function checkCrmStatus() {
    return defaultAdapter.status();
}
export async function searchCrmProjects(input) {
    return defaultAdapter.searchProjects(input);
}
export async function getCrmProjectDetail(projectId) {
    return defaultAdapter.getProjectDetail(projectId);
}
export async function lookupCrmUsers(input) {
    return defaultAdapter.lookupUsers(input);
}
export async function preauditApprovalWithCrm(input) {
    return defaultAdapter.preauditApproval(input);
}
export function parseJsonFromText(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        // Continue to embedded JSON extraction below.
    }
    for (let start = 0; start < text.length; start += 1) {
        const char = text[start];
        if (char !== "{" && char !== "[") {
            continue;
        }
        const end = findJsonEnd(text, start);
        if (end < 0) {
            continue;
        }
        try {
            return JSON.parse(text.slice(start, end + 1));
        }
        catch {
            continue;
        }
    }
    throw new Error(`CRM_JSON_PARSE_FAILED: ${text.slice(0, 300)}`);
}
function findJsonEnd(text, start) {
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    const stack = [close];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < text.length; index += 1) {
        const char = text[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = inString;
            continue;
        }
        if (char === "\"") {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (char === "{") {
            stack.push("}");
        }
        else if (char === "[") {
            stack.push("]");
        }
        else if (char === stack[stack.length - 1]) {
            stack.pop();
            if (stack.length === 0) {
                return index;
            }
        }
    }
    return -1;
}
async function detailOrCandidate(candidate, getDetail) {
    if (!candidate.crm_project_id) {
        return candidate;
    }
    try {
        const detail = await getDetail(candidate.crm_project_id);
        return { ...candidate, ...detail.project };
    }
    catch {
        return candidate;
    }
}
function pickBestProject(candidates, refs, department) {
    let best;
    for (const candidate of dedupeProjects(candidates)) {
        for (const ref of refs) {
            const score = scoreProject(candidate, ref, department);
            if (!best || score.score > best.score) {
                best = {
                    matched: score.score >= 78,
                    confidence: score.score >= 95 ? "high" : score.score >= 78 ? "medium" : "low",
                    score: score.score,
                    reasons: score.reasons,
                    candidate,
                    normalizedProject: ref
                };
            }
        }
    }
    return best;
}
function scoreProject(candidate, ref, department) {
    const normalizedRef = normalizeText(ref);
    const fullName = normalizeText(candidate.project_full_name);
    const name = normalizeText(candidate.project_name);
    const dept = normalizeText(candidate.charge_department_path || candidate.charge_department_name);
    const deptTail = normalizeText(lastDeptSegment(department));
    let score = 0;
    const reasons = [];
    if (normalizedRef && fullName === normalizedRef) {
        score += 100;
        reasons.push("project_full_name exact");
    }
    else if (normalizedRef && name === normalizedRef) {
        score += 92;
        reasons.push("project_name exact");
    }
    else if (normalizedRef && fullName.includes(normalizedRef)) {
        score += 88;
        reasons.push("project_full_name contains");
    }
    else if (normalizedRef && name.includes(normalizedRef)) {
        score += 78;
        reasons.push("project_name contains");
    }
    else if (normalizedRef && normalizedRef.includes(name) && name.length >= 4) {
        score += 72;
        reasons.push("input contains project_name");
    }
    if (deptTail && dept.includes(deptTail)) {
        score += 10;
        reasons.push("department matched");
    }
    if (isApproved(candidate)) {
        score += 5;
        reasons.push("CRM project approved");
    }
    return { score, reasons };
}
function addAmountCheck(checks, amount) {
    if (amount === undefined || amount === null || Number.isNaN(amount)) {
        addCheck(checks, "amount", "unknown", "yellow", "Amount is missing; cannot evaluate amount risk");
        return;
    }
    if (amount <= 0) {
        addCheck(checks, "amount", "warn", "yellow", "Amount is zero or negative", { amount });
    }
    else if (amount > HIGH_AMOUNT) {
        addCheck(checks, "amount", "warn", "yellow", "Amount is above the critical review threshold", { amount, threshold: HIGH_AMOUNT });
    }
    else if (amount > LARGE_AMOUNT) {
        addCheck(checks, "amount", "warn", "yellow", "Amount is above the large review threshold", { amount, threshold: LARGE_AMOUNT });
    }
    else {
        addCheck(checks, "amount", "pass", "info", "Amount is within the standard review threshold", { amount });
    }
}
function addProjectChecks(checks, project, input) {
    if (isApproved(project)) {
        addCheck(checks, "crm_project_approved", "pass", "info", "CRM project approval status is approved", {
            approval_status: project.approval_status,
            approval_status_str: project.approval_status_str
        });
    }
    else {
        addCheck(checks, "crm_project_approved", "warn", "yellow", "CRM project approval status is not clearly approved", {
            approval_status: project.approval_status,
            approval_status_str: project.approval_status_str
        });
    }
    const inputDept = normalizeText(lastDeptSegment(input.department));
    const crmDept = project.charge_department_path || project.charge_department_name;
    if (inputDept && crmDept && normalizeText(crmDept).includes(inputDept)) {
        addCheck(checks, "department_match", "pass", "info", "Approval department matches CRM project department", {
            approval_department: input.department,
            crm_department: crmDept
        });
    }
    else if (inputDept && crmDept) {
        addCheck(checks, "department_match", "warn", "yellow", "Approval department does not clearly match CRM project department", {
            approval_department: input.department,
            crm_department: crmDept
        });
    }
    else {
        addCheck(checks, "department_match", "unknown", "yellow", "Department context is incomplete", {
            approval_department: input.department,
            crm_department: crmDept
        });
    }
    const periodState = projectPeriodState(project);
    if (periodState === "active") {
        addCheck(checks, "project_period", "pass", "info", "CRM project is currently active", {
            begin: project.project_begin_at,
            end: project.project_end_at
        });
    }
    else if (periodState === "ended") {
        addCheck(checks, "project_period", "warn", "yellow", "CRM project period has ended; confirm whether this is a late settlement", {
            begin: project.project_begin_at,
            end: project.project_end_at
        });
    }
    else if (periodState === "future") {
        addCheck(checks, "project_period", "warn", "yellow", "CRM project period has not started; confirm prepayment or early procurement rationale", {
            begin: project.project_begin_at,
            end: project.project_end_at
        });
    }
    else {
        addCheck(checks, "project_period", "unknown", "yellow", "CRM project period is missing or invalid");
    }
}
function finalizePreaudit(input) {
    const riskLevel = deriveRiskLevel(input.checks);
    const recommendation = riskLevel === "red" ? "reject_or_return" : riskLevel === "yellow" || riskLevel === "unknown" ? "manual_review" : "pass";
    const confidence = deriveConfidence(input.checks);
    const summary = buildSummary(input.checks, input.input);
    return {
        ok: riskLevel !== "red",
        risk_level: riskLevel,
        recommendation,
        confidence,
        checks: input.checks,
        evidence: input.evidence,
        missing_context: uniqueStrings(input.missingContext),
        crm_project_match: input.projectMatch ? {
            matched: input.projectMatch.matched,
            confidence: input.projectMatch.confidence,
            score: input.projectMatch.score,
            reasons: input.projectMatch.reasons,
            candidate: input.projectMatch.candidate,
            normalized_project: input.projectMatch.normalizedProject
        } : undefined,
        applicant: input.applicant,
        summary
    };
}
function deriveRiskLevel(checks) {
    if (checks.some((check) => check.status === "fail" || check.severity === "red")) {
        return "red";
    }
    if (checks.some((check) => check.status === "warn" || check.severity === "yellow")) {
        return "yellow";
    }
    if (checks.some((check) => check.status === "unknown")) {
        return "unknown";
    }
    return "green";
}
function deriveConfidence(checks) {
    const unknown = checks.filter((check) => check.status === "unknown").length;
    const pass = checks.filter((check) => check.status === "pass").length;
    if (pass >= 3 && unknown === 0) {
        return "high";
    }
    if (pass >= 1 && unknown <= 2) {
        return "medium";
    }
    if (checks.length > 0) {
        return "low";
    }
    return "unknown";
}
function buildSummary(checks, input) {
    const risky = checks.filter((check) => check.status === "warn" || check.status === "fail" || check.status === "unknown");
    const subject = input.title || input.approval_id || "approval";
    if (risky.length === 0) {
        return `${subject}: CRM preaudit found no obvious risk.`;
    }
    return `${subject}: CRM preaudit has ${risky.length} item(s) requiring review: ${risky.map((check) => check.message).join("; ")}`;
}
function extractProjectRefs(input) {
    const refs = [
        ...(input.project_refs ?? []),
        input.project,
        extractBracketText(input.title),
        extractBracketText(input.process_name)
    ];
    return uniqueStrings(refs)
        .flatMap(splitProjectLike)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .slice(0, 12);
}
function splitProjectLike(value) {
    return value
        .split(/[;；,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}
function extractBracketText(value) {
    if (!value) {
        return undefined;
    }
    return value.match(/[（(]([^()（）]+)[)）]/)?.[1];
}
function normalizeProject(item, source) {
    const data = item;
    const id = firstNumber(data.crm_project_id, data.id);
    const chargeDepartment = data.charge_department;
    const contractOrder = data.contract_order;
    return compactObject({
        source,
        crm_project_id: id,
        project_unique_sn: firstString(data.project_unique_sn, data.unique_sn),
        project_name: firstString(data.project_name, data.name),
        project_full_name: firstString(data.project_full_name, data.full_name),
        amount_yuan: firstNumber(data.amount_yuan, data.amount),
        project_begin_at: firstString(data.project_begin_at),
        project_end_at: firstString(data.project_end_at),
        status: firstString(data.status) ?? firstNumber(data.status),
        approval_status: firstString(data.approval_status) ?? firstNumber(data.approval_status),
        approval_status_str: firstString(data.approval_status_str),
        charge_department_name: firstString(data.charge_department_name, chargeDepartment?.name),
        charge_department_path: firstString(data.charge_department_path, chargeDepartment?.full_name),
        project_owner_names: firstString(data.project_owner_names),
        contract_order_id: firstString(data.contract_order_id, contractOrder?.id) ?? firstNumber(data.contract_order_id, contractOrder?.id),
        order_name: firstString(data.order_name, contractOrder?.name),
        order_sn: firstString(data.order_sn, contractOrder?.order_sn),
        sub_order_sn: firstString(data.sub_order_sn, contractOrder?.sub_order_sn),
        order_amount_yuan: firstNumber(data.order_amount_yuan, contractOrder?.amount),
        order_customer_name: firstString(data.order_customer_name, contractOrder?.customer_name),
        raw_payload: item
    });
}
function normalizeUser(item) {
    const data = item;
    const department = data.department;
    const record = {
        source: "crm.org.users",
        name: firstString(data.name, data.display_name, data.user_name),
        job_number: firstString(data.job_number, data.employee_no, data.work_no),
        title: firstString(data.title, data.position_name, data.job_title),
        department_name: firstString(data.department_name, department?.name),
        department_path: firstString(data.department_path, department?.full_name),
        user_id: firstString(data.user_id, data.id) ?? firstNumber(data.user_id, data.id),
        raw_payload: item
    };
    return compactObject(record);
}
function extractArray(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }
    const data = raw;
    for (const key of ["items", "list", "records", "rows", "data", "result"]) {
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
function isApproved(project) {
    return project.approval_status === 3 ||
        project.approval_status === "3" ||
        /approved|已通过/i.test(String(project.approval_status_str ?? project.status ?? ""));
}
function projectPeriodState(project) {
    const now = new Date();
    const begin = parseMaybeDate(project.project_begin_at);
    const end = parseMaybeDate(project.project_end_at);
    if (!begin || !end) {
        return "unknown";
    }
    if (now < begin) {
        return "future";
    }
    if (now > end) {
        return "ended";
    }
    return "active";
}
function parseMaybeDate(value) {
    if (!value) {
        return undefined;
    }
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
function projectEvidence(project) {
    return compactObject({
        crm_project_id: project.crm_project_id,
        project_full_name: project.project_full_name,
        project_name: project.project_name,
        order_customer_name: project.order_customer_name,
        charge_department_path: project.charge_department_path,
        approval_status: project.approval_status,
        approval_status_str: project.approval_status_str
    });
}
function addCheck(checks, id, status, severity, message, evidence) {
    checks.push({ id, status, severity, message, evidence });
}
function dedupeProjects(projects) {
    const seen = new Set();
    const result = [];
    for (const project of projects) {
        const key = String(project.crm_project_id ?? project.project_full_name ?? JSON.stringify(project.raw_payload));
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(project);
    }
    return result;
}
function lastDeptSegment(value) {
    if (!value) {
        return "";
    }
    const parts = value.includes("→") ? value.split("→") : value.split("|");
    return parts[parts.length - 1]?.trim() ?? value.trim();
}
function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value?.trim()).filter((value) => Boolean(value)))];
}
function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
        if (typeof value === "number") {
            return String(value);
        }
    }
    return undefined;
}
function firstNumber(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === "string" && value.trim().length > 0) {
            const parsed = Number(value.replace(/,/g, ""));
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return undefined;
}
function requireNonEmpty(value, name) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
        throw new Error(`${name} is required`);
    }
    return normalized;
}
function clampLimit(value, defaultValue) {
    const limit = Number(value ?? defaultValue);
    if (!Number.isFinite(limit)) {
        return defaultValue;
    }
    return Math.max(1, Math.min(50, Math.floor(limit)));
}
function ensureEnabled(enabled) {
    if (!enabled) {
        throw new Error("CRM CLI access is disabled. Set CN_MESSAGING_CRM_ENABLED=true to enable read-only CRM tools.");
    }
}
async function runJson(command, args, runner, timeoutMs) {
    const result = await runner(command, args, { timeoutMs });
    const raw = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code !== 0) {
        throw new Error(`CRM CLI failed (${result.code}): ${raw.slice(0, 500)}`);
    }
    return parseJsonFromText(raw);
}
async function commandExists(command, runner, timeoutMs) {
    try {
        await runner(command, ["--help"], { timeoutMs: Math.min(timeoutMs, 5000) });
        return true;
    }
    catch {
        return false;
    }
}
function runCommand(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, NO_COLOR: "1" }
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error(`CRM CLI timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code });
        });
        if (options.input) {
            child.stdin.write(options.input);
        }
        child.stdin.end();
    });
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=crm.js.map