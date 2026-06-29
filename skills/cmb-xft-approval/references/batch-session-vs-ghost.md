# 批量操作中区分 Session 超时 vs 幽灵单据

## 症状

批量 review/approve 时，前几条成功、后几条连续 BILL_NOT_FOUND。

## 判定流程

```
部分成功 → 全部失败？
  ├─ 是 → 大概率 session 超时
  │       → self-heal.mjs → 重试
  └─ 否（前N条成功，后M条失败，N≥1,M≥1）
        → 跑 health.mjs 确认 session 状态
          ├─ health ok + title 非空 → session 正常
          │   → 失败的 bill 是幽灵单据（已自动消除）
          │   → 重新拉列表确认 pending 减少量
          │   → 无需重试，直接标记为「已消除」
          └─ health ok 但 title="" → 灰色地带
              → 跑 self-heal.mjs
              → heal 后仍失败 → 幽灵单据
```

## 数字验证

重新拉列表后的 pending 减少量 = 成功批完的条数（不含幽灵）。

例：pending 35→29，成功批 6 条，则 35-6=29 ✓。失败的那几条在 pending 减少量之外，即原本就是幽灵。

## 已验证样本

2026-06-06：
- 🟢 批量 9条：6条成功 + 3条 BILL_NOT_FOUND（郭郡/方彦博/王峥又）
- 🟡 批量 review 8条：前4条成功 + 后4条 BILL_NOT_FOUND（林子涵/林子彧/方彦博/黄靖玮）
- health.mjs 返回 ok + "智能费控·薪福通" → session 正常
- approve.mjs 对失败单也返回 BILL_NOT_FOUND
- 重拉列表 pending=29，成功批6条，35-6=29 ✓ → 失败单全是幽灵

## 注意

- BILL_NOT_FOUND 不是 approve.mjs 或 review.mjs 的 bug——是这些单据确实不在待审批数据面了
- 不要在 session 正常时反复重试 BILL_NOT_FOUND 单
- 不要在 shell 管道中解析 approve.mjs JSON（SQLite ExperimentalWarning 混入 stderr 会污染 stdout）
