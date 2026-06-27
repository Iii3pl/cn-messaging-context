---
name: approval-workflow
description: Read DingTalk OA approvals and approve only after explicit user confirmation.
---

# DingTalk OA Approval Workflow

Use this skill when the user asks about DingTalk OA approvals, pending approvals, approval details, approval records, task ids, or approving an item.

## Read Workflow

1. Call `list_pending_dingtalk_approvals` for pending items.
2. For any item the user might act on, call `get_dingtalk_approval_detail`, `get_dingtalk_approval_tasks`, and `get_dingtalk_approval_records`.
3. Keep these facts separate:
   - pending-list membership
   - workflow status
   - task id
   - approval records
   - whether the current account can act
4. If the records or workflow state disagree with the pending list, report the disagreement and do not approve.

## Optional CRM Preaudit

When an approval has project, customer, applicant, amount, department, reimbursement, supplier settlement, purchase, or contract context, and CRM access is enabled, call `preaudit_approval_with_crm` before recommending action. Use the CRM result only as read-only evidence:

- Treat `risk_level=green` as "no obvious CRM issue found", not as permission to approve.
- Treat `unknown` or `warn` checks as items for the user to review.
- Never fabricate missing CRM project or applicant data.
- Do not approve based only on CRM preaudit; the regular task/record confirmation and explicit user confirmation are still required.

## How To Explain It To People

Use plain workplace language in the final answer. Avoid exposing internal words such as `RUNNING`, `taskId`, `instance_id`, `PARAM_ERROR`, `saNode`, `127.0.0.1`, or `dry-run` unless the user explicitly asks for debugging detail.

Prefer this shape:

```md
今天还有 <N> 个钉钉审批需要你看。

1. <审批标题>
   - 谁提交的：<人名，如果能看出>
   - 现在到哪一步：<还在审批中 / 已有几个人同意 / 等你处理>
   - 我能确认的证据：<待审批列表里还在；审批流水显示...>

说明：插件的小服务刚才没开，所以我直接查了钉钉。结果是实时查到的；只是钉钉详情接口有一部分字段返回不规整，不影响这条是否在待审批列表里的判断。
```

When connector service status matters, say "插件的小服务没开" instead of "127.0.0.1:8787 failed". When a detail endpoint fails but list/tasks/records work, say "详情页有一部分字段读不出来，但待审批名单和审批流水能确认" instead of showing raw error strings.

## Approval Safety

Before approving, Codex must show:

```md
Approval: <title or instance id>
Instance ID: <instance_id>
Task ID: <task_id>
Remark:
<exact remark>
```

Then wait for direct confirmation such as "确认通过这个审批".

Call `approve_dingtalk_approval` only when:

- The user explicitly confirmed the exact approval.
- `task_id` is present from `get_dingtalk_approval_tasks`.
- The remark is exact and visible to the user.
- `confirmed_by_user` is true.

Never batch-approve multiple items unless the user reviewed and confirmed every item and remark.
