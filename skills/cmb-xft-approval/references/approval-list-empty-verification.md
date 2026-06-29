# 审批列表空结果验真（钉钉 + 薪福通）

适用场景：用户说「审批列表」「待审批」时，需要同时覆盖钉钉 OA 与薪福通。

## 钉钉 OA 不能只信旧 curl 空结果

旧版 curl 接口 `topapi/process/workrecord/task/query` 可能返回：

```json
{"errcode":0,"errmsg":"ok","result":{"has_more":false}}
```

这只说明该旧工作记录接口没有返回 `list`，不能单独作为「钉钉审批为空」的充分证据。

## 空列表确认标准

汇报「钉钉 OA 待审批 0 条」前，至少走当前权威 MCP 路径交叉验证：

1. `dingtalk-oa-approval.list_pending_approvals`
2. `dingtalk-oa-approval.list_pending_approvals_for_me`
3. `dingtalk-oa-approval.get_todo_tasks`（按吴亮 userId）

三者均为空，且没有用户提供页面截图/事实反证时，才可汇报为空。

## 技能名歧义处理

若 `skill_view(name="dingtalk-approval")` 报 Ambiguous skill name，不要循环重试同名；直接读取/使用权威路径：

- `/Users/wuliang/.openclaw/workspace/skills/dingtalk-approval-exec/SKILL.md`
- 或当前 Hermes 技能中的 `openclaw-imports/cmb-xft-approval` 审批工作流章节。

## 输出口径

- 钉钉 OA：说明跑过哪些通路，如「OA MCP 主通路 + for_me + todo_tasks 均为空」。
- 薪福通：继续 `health.mjs` → `navigate.mjs homepage` → 必要时 `review.mjs --batch`。
- 不要因为钉钉 OA 为空就停止；用户说「审批列表」默认还要查薪福通。
