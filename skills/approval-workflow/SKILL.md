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
