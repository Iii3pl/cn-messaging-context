import test from "node:test";
import assert from "node:assert/strict";
import { createCrmAdapter, parseJsonFromText } from "../src/connector/adapters/crm.ts";

test("parseJsonFromText recovers JSON surrounded by CLI log lines", () => {
  assert.deepEqual(parseJsonFromText("loading crm...\n{\"ok\":true,\"count\":1}\n"), {
    ok: true,
    count: 1
  });
});

test("CRM adapter normalizes project search results", async () => {
  const adapter = createCrmAdapter({
    enabled: true,
    runner: async (_command, args) => {
      if (args[0] === "--help") {
        return { stdout: "crm help", stderr: "", code: 0 };
      }
      assert.deepEqual(args.slice(0, 3), ["project", "list", "--keyword"]);
      return {
        stdout: JSON.stringify([
          {
            id: 123,
            project_name: "淘宝秒杀",
            project_full_name: "淘宝秒杀 b站4月代运营",
            approval_status: 3,
            charge_department_path: "运营中心|运营六部|规模2组"
          }
        ]),
        stderr: "",
        code: 0
      };
    }
  });

  const result = await adapter.searchProjects({ query: "淘宝秒杀", limit: 10 });
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0]?.crm_project_id, 123);
  assert.equal(result.projects[0]?.project_full_name, "淘宝秒杀 b站4月代运营");
});

test("CRM preaudit degrades safely when disabled", async () => {
  const adapter = createCrmAdapter({ enabled: false });
  const result = await adapter.preauditApproval({ title: "供应商结算单", amount: 1000 });

  assert.equal(result.risk_level, "yellow");
  assert.equal(result.recommendation, "manual_review");
  assert.ok(result.missing_context.includes("crm_cli_disabled"));
  assert.match(result.summary, /CRM CLI access is disabled/);
});

test("CRM preaudit returns project and applicant evidence for a confident match", async () => {
  const calls: string[][] = [];
  const adapter = createCrmAdapter({
    enabled: true,
    runner: async (_command, args) => {
      calls.push(args);
      if (args[0] === "--help") {
        return { stdout: "crm help", stderr: "", code: 0 };
      }
      if (args[0] === "project" && args[1] === "list") {
        return {
          stdout: JSON.stringify([
            {
              id: 123,
              project_name: "淘宝秒杀 b站4月代运营",
              project_full_name: "淘宝秒杀 b站4月代运营",
              approval_status: 3,
              approval_status_str: "已通过",
              charge_department_path: "运营中心|运营六部|规模2组",
              project_begin_at: "2026-01-01",
              project_end_at: "2099-12-31"
            }
          ]),
          stderr: "",
          code: 0
        };
      }
      if (args[0] === "project" && args[1] === "detail") {
        return {
          stdout: JSON.stringify({
            id: 123,
            project_name: "淘宝秒杀 b站4月代运营",
            project_full_name: "淘宝秒杀 b站4月代运营",
            approval_status: 3,
            approval_status_str: "已通过",
            charge_department: { full_name: "运营中心|运营六部|规模2组" },
            project_begin_at: "2026-01-01",
            project_end_at: "2099-12-31"
          }),
          stderr: "",
          code: 0
        };
      }
      if (args[0] === "org" && args[1] === "users") {
        return {
          stdout: JSON.stringify([
            {
              name: "李四",
              job_number: "000001",
              title: "项目经理",
              department: { full_name: "运营中心|运营六部|规模2组" }
            }
          ]),
          stderr: "",
          code: 0
        };
      }
      throw new Error(`unexpected args: ${args.join(" ")}`);
    }
  });

  const result = await adapter.preauditApproval({
    source: "dingtalk",
    approval_id: "iid-1",
    title: "淘宝秒杀 b站4月代运营 供应商结算",
    amount: 5000,
    applicant: "李四",
    department: "运营中心 → 运营六部 → 规模2组",
    project: "淘宝秒杀 b站4月代运营"
  });

  assert.equal(result.risk_level, "green");
  assert.equal(result.recommendation, "pass");
  assert.equal(result.crm_project_match?.candidate?.crm_project_id, 123);
  assert.equal(result.applicant?.name, "李四");
  assert.ok(result.checks.some((check) => check.id === "crm_project_approved" && check.status === "pass"));
  assert.ok(calls.some((args) => args[0] === "project" && args[1] === "detail"));
});
