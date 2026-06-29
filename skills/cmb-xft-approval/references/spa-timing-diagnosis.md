# SPA 时序诊断：pending>0 但 bills=[]

## 症状

```json
{"ok":true,"pending":5,"bills":[],"page":1}
```

`navigate.mjs homepage` 返回 pending > 0 但 bills 为空。

## 快速判定：跑 `_debug_parse.mjs`

```bash
node _debug_parse.mjs
```

### 情况 A：matched == total（如 matched=5, mismatched=0）

→ **SPA 异步渲染时序问题**。列表页 SPA 先渲染空 DOM 骨架，`parseHomepageBills` 的 `page.evaluate` 执行时 `tr.ant-table-row` 还未完成渲染。

**修复：重试一次即可。**
```bash
node navigate.mjs homepage
# 通常第二次就正常了
```

不需要改代码、不需要加白名单、不需要重新登录。

### 情况 B：mismatched > 0

→ **类型白名单遗漏**。见 [type-whitelist.md](type-whitelist.md)。

## 根因

薪福通审批列表页（`/#/form-app/approval`）是 Ant Design SPA，渲染流程：

1. 页面加载 → 显示空表格骨架
2. API 异步请求审批数据
3. 数据返回 → 渲染 `tr.ant-table-row`

`navigate.mjs homepage` 中 `ensureLoggedIn` 先导航到 `HOMEPAGE`（`/#/trip-app/homepage`），再 `page.goto(APPROVAL_LIST, { settleMs: 3000 })`。3000ms 通常足够，但 SPA 异步请求在偶发延迟场景下可能超过 settleMs，导致 `parseHomepageBills` 抓到空的 `tr.ant-table-row`。

## 同类问题

同一个 SPA 时序问题还影响：

| 场景 | 表现 | 修复 |
|------|------|------|
| 列表页 (`navigate.mjs homepage`) | `bills:[]` | 重试一次 |
| 详情页 (`parseBillDetail`) | 金额=0.00（骨架） | 内置 20×500ms 重试循环 |
| 批量审核 (`review.mjs --batch`) | `total:0` | 重试一次 |

## 不应做的

- ❌ 不要因为一次 `bills:[]` 就去改 `extract.mjs` 的 `VALID_BILL_TYPES`
- ❌ 不要因为一次空返回就判定 session 过期去重新登录
- ✅ 先跑 `_debug_parse.mjs` 判定类型是否匹配 → 匹配就重试
