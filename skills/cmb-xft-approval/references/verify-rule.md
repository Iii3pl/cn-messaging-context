# 三重验证硬规则（DB + list + taskStatus）

> 来源：2026-06-22 实战总结（武欣荣 dou+ 充值 ¥20,000 / 陈小香 供应商结算单 / 王子昕 员工备用金 ¥3,500 等多单误判案例）

## 为什么需要三重验证

`approve.mjs` 返 `success:true` **不等于审批已生效**。`dbSaved:true` **不等于列表已消除**。`navigate.mjs homepage` 返 pending 减 1 **不等于吴亮节点已完成**。任何单一信号都可能被三种独立失败模式之一污染。

| 单一信号 | 可能的污染（实际发生过的反例） |
|----------|-----------|
| `approve.mjs` ok=true + dbSaved=true | SPA 点击未真提交（页面 DOM 短暂重排误判）；或后续节点 RUNNING 导致实例整体仍 RUNNING |
| `navigate.mjs homepage` 不含 billId | 列表缓存未及时刷新；吴亮节点已通过但后续节点仍未结束；或 SPA 短暂卸载后重渲染 |
| `navigate.mjs homepage` 含 billId | 列表缓存保留幽灵单（吴亮节点已批但 SPA 没刷新）；后端实际已审批但前端没拉到新数据 |
| `dws detail` task status=COMPLETED | 吴亮节点已完成；后续节点可能仍 RUNNING，实例 overall 仍 RUNNING（属正常）|

## 判定真批成功的硬规则

**三个信号必须同时满足**：

### 1. DB 落地（最基础必要条件）

```bash
sqlite3 /Users/wuliang/.hermes/data/cmb_approvals.db \
  "SELECT approved_at, action FROM approvals WHERE bill_id='<bid>';"
```

返回 1 行 `action='agree'` 才算 DB 已写。注意：
- 部分类型（供应商预付款/预算/员工备用金/云账户/部分供应商结算单）`dbSaved:false` 是已知 bug，但 DB 可能已写（`recordApproval` 异步）；以 sqlite 查询为准
- 同一 billId 多次 approve 后 DB 会有多条记录（`INSERT OR IGNORE` 不去重同 billId 多次插入）；按 `MAX(approved_at)` 取最新

### 2. list 状态（最直观强信号）

```bash
node /Users/wuliang/.hermes/skills/openclaw-imports/cmb-xft-approval/scripts/navigate.mjs homepage | python3 -c "
import json, sys
d = json.load(sys.stdin)
bids = [b['billId'] for b in d.get('bills', [])]
print('IN_LIST' if '<bid>' in bids else 'GONE')
print('pending:', d.get('pending'))
"
```

- 普通审批（报销/结算/备用金/投流/合同用印）吴亮是最后节点 → 列表必须不含
- **预算单**（吴亮是中间节点，subType=业务部门负责人）吴亮节点后还有 财务/CFO/CEO 节点 → 列表保留属预期，**不要误判为失败**
- **合同用印** 类似，吴亮后还有法务/财务/CEO 节点 → 列表保留属预期

### 3. 吴亮 task 状态（最权威）

```bash
# dws detail 路径（仅当 dws detail 不报 PARAM_ERROR 时）
dws oa approval detail --instance-id <iid> --format raw
# 解析 tasks[] 找 userId=吴亮 且 taskStatus=COMPLETED
```

- 找不到 dws detail 时用 ts-node（已知 dws 走不通的类型：采购/offer/招聘/2026年度绩效考核方案确认/出差等）
- ts-node 返回的 task status/result 是 None 时（已知现象）以 `taskId` 已用 + DB agree + list 消除为联合判定

## 判定矩阵

| DB | list | taskStatus | 结论 |
|----|------|------------|------|
| ✅ | ✅ | ✅ | **真批成功** |
| ✅ | ❌ | ✅ | 列表缓存未消（吴亮是中间节点型，预期）→ **真批成功** |
| ❌ | ❌ | ✅ | dbSaved:false 是已知 bug + list 消除 + task 完成 → **真批成功**（看具体情况，多数可接受）|
| ❌ | ❌ | ❌ | **真失败**，重试或上报 |
| 任意 | 任意 | RUNNING/NONE | **未生效**，重试或上报 |

## 实战反例（2026-06-22 同日三起）

### 反例 1：X1 武欣荣 dou+ 充值 ¥20,000（单看 dbSaved 误判）
- `approve.mjs` 报黄灯（金额>1万 + 部门不完全一致 + 无 CRM 验收记录）
- `dbSaved:true`，汇报"已通过"
- **实际问题**：弹窗点击时序问题，SPA 未真提交
- **正确做法**：批完后必须立即查 DB + list 回查。list 仍含该 billId → 重试

### 反例 2：X4/X5 重复出现（单看 list 误判）
- 上一轮 X5 王子昕 ¥5,000 已批（DB agree at 2026-06-22T06:30:02）
- 下一轮 `navigate.mjs homepage` 仍显示该 billId
- **实际问题**：薪福通 SPA 列表缓存未及时消除（已知现象，不影响实际审批）
- **正确做法**：查 DB 已有 agree 记录 + 任务 taskId 已使用 → **不重批**，告诉用户"已生效，列表缓存未消"

### 反例 3：X4 吴秋霞 ¥0 预算（opencli eval 兜底，DB 缺失）
- approve.mjs 报 BUTTON_NOT_FOUND（按钮是"通 过"带空格）
- 降级 opencli eval 点"通 过"+"确认"，页面跳 about:blank，弹窗消失
- list 显示该 billId 已消除
- **但 DB 无记录**（opencli eval 走的是原生 OAPI 流程，不写本地 SQLite）
- **正确判定**：list 消除 + 弹窗消失 + 后续 navigate.mjs 不再返回 → **真批成功**，DB 缺失属预期（opencli eval 路径不写 DB）

## 汇报模板

每批完一条审批，汇报时**必须包含三项信号的具体值**：

```
✅ D3 陈小香 供应商结算单 ¥15,666.00
   - DB: agree at 2026-06-22T07:23:46
   - list: GONE (pending 5→4)
   - taskStatus: COMPLETED/AGREE
```

**禁止**只说"已通过"——必须给出三项验证结果。预算单等吴亮是中间节点的情况：

```
✅ X3 李碧 ¥0 预算 (subType=业务部门负责人)
   - DB: agree at 2026-06-22T07:24:01
   - list: GONE (pending 7→5, 预算单预期行为)
   - taskStatus: COMPLETED/AGREE (opencli eval 兜底路径，弹窗消失确认)
```

## 不要做的事

- **不要**只信 `approve.mjs` 输出的 `ok:true` / `clickVerified:true` / `dbSaved:true` 任何一个就汇报"已通过"
- **不要**因为 list 仍含 billId 就重试——可能是缓存；先查 DB 决定
- **不要**因为 DB 已有记录就停止验证——可能是上一次的真批；这次可能未生效
- **不要**对同一 billId 在 1 轮 approve 失败后立即重试超过 1 次——可能是路径选择错误（approve.mjs vs opencli eval），先诊断再换路径

## 与其他 reference 的关系

- 预算单 opencli eval 兜底流程：`references/budget-approval.md` 末尾章节
- 供应商结算单等普通审批的 opencli eval 兜底：`references/opencli-eval-fallback.md`「供应商结算单等普通页面流程」
- BUTTON_NOT_FOUND / 按钮文本带空格等 SPA 解析坑：`references/opencli-eval-fallback.md` 主体
- 重复 0 条 / 接口盲区：见 SKILL.md「SPA 空结果必须重试」+「接口盲区审批」章节
