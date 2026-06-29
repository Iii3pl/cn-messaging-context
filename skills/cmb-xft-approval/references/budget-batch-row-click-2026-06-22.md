# XFT 预算页批量行级审批实战（2026-06-22）

## 触发场景

薪福通待审批里有 2-5 条 ¥0 预算单（业务部门负责人节点 = 吴亮），用户说"预算都过"或"绿灯通过 + 预算调整都通过"。

**关键差异 vs 普通报销**：
- 预算详情页 URL = `/#/budget-app/budgetapprovaldetail`，不是 `/#/trip-app/billDetail`
- **行级按钮文字是 `通 过`（中间有空格），不是 `通过`**
- 单步点行级「通 过」→ 弹窗 → 弹窗内「确认」→ toast「同意成功」+ 列表消除
- `approve.mjs` 对预算页**直接报 `BUTTON_NOT_FOUND`**（它默认匹配 `通过` 不带空格）
- 预算审批后列表**有时不消除**（后续还有财务/CFO/CEO 节点），**不要判定为失败**

## approve.mjs 失败原因（2026-06-22 实测）

```
{
  "ok": false,
  "error": "BUTTON_NOT_FOUND",
  "billId": "2026061863587003",
  "method": "button-not-found"
}
```

即使加 `--force` 也走不通——按钮搜索策略没覆盖带空格文本。**预算页必须走 opencli eval 兜底**。

## 完整 batch 序列

```bash
SESSION=gxs46xbg

# === Step 1: 打开主页 + 等 SPA 挂载 ===
opencli browser $SESSION open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 6
opencli browser $SESSION eval "document.querySelectorAll('tr.ant-table-row').length"
# → 9（确认主页已加载）

# === Step 2: 确认预算行确实有"通 过"按钮 ===
opencli browser $SESSION eval "
Array.from(document.querySelectorAll('tr.ant-table-row')).filter(r => r.innerText.includes('2026061863587003'))
  .map(r => Array.from(r.querySelectorAll('button')).map(b => b.innerText.replace(/\s+/g,' ').trim()))
"
# → [["通 过", "否 决"]]  （注意中间有空格）

# === Step 3: 逐条点"通 过"（IIFE + 每条 sleep 3s 避免弹窗堆叠） ===
for bid in 2026061863587003 2026062264285916 2026062264336246 2026062264306759; do
  opencli browser $SESSION eval "
(function(){
const tr=Array.from(document.querySelectorAll('tr.ant-table-row')).find(r=>r.innerText.includes('$bid'));
const btn=tr?Array.from(tr.querySelectorAll('button')).find(b=>b.innerText.includes('通')&&b.innerText.includes('过')):null;
btn?.click();
return btn?'clicked $bid':'btn not found $bid';
})()
"
  sleep 3  # 让弹窗渲染

  # === Step 4: 立即点"确认"（预算页弹窗堆叠风险小，但要快） ===
  opencli browser $SESSION eval "
(function(){
const btn=Array.from(document.querySelectorAll('.ant-modal button')).find(b=>b.innerText.trim()==='确认');
btn?.click();
return 'clicked 确认';
})()
"
  sleep 4  # 等 toast + 列表更新
done
```

## 关键坑

1. **`b.innerText.trim() === '通过'` 会失败**——预算页按钮是 `通 过` 带空格。**必须用 `b.innerText.includes('通') && b.innerText.includes('过')` 或 `b.innerText.replace(/\s+/g,'') === '通过'`**。

2. **不能走 `approve.mjs <bid> agree`** ——直接 BUTTON_NOT_FOUND，连 `--force` 都没用。

3. **approve.mjs 的 `navigate.mjs bill <bid>` 对预算页** 也能返回 OK（`url: "https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?..."`），但 `type: "预算" subType: "业务部门负责人" amount: null subject: null department: null`，**正文/部门/金额都拿不到**，只拿到 project（如 "代运营-淘小宝-26.05-26.07"）。要看正文需用 `budget-detail-extract.mjs`。

4. **预算审批后列表可能不消除**（吴亮是 2+级，前面还有 4-5 级节点）——以吴亮 task 状态为准，不是列表消除为准。skill 主文档「批处理后回查」章节已有提及。

5. **预算 ¥0 单本身无资金风险**（走流程锁定编号），即使错批也只是流程编号，不涉及付款——但仍应按"绿灯通过"原则批。

## 验证（2026-06-22 实战 4 单全成功）

```bash
# 主页 rows 数（应减少 4）
opencli browser $SESSION eval "document.querySelectorAll('tr.ant-table-row').length"
# → 5（从 9 减 4，剩余是供应商结算 + 备用金 + 郑颖/王子昕残留）

# 预算行数（应全 0）
opencli browser $SESSION eval "
Array.from(document.querySelectorAll('tr.ant-table-row'))
  .filter(r => r.innerText.includes('2026061863587003') 
            || r.innerText.includes('2026062264285916')
            || r.innerText.includes('2026062264336246')
            || r.innerText.includes('2026062264306759')).length
"
# → 0

# DB 落地（预算走 opencli eval 不写 DB，DB 记录是 approve.mjs 才会写）
# → 预算单无 DB 记录属正常
```

## 已知样本（2026-06-22 4 单全过）

| 申请人 | billId | 项目 | 备注 |
|---|---|---|---|
| 王馨平 | 2026061863587003 | 代运营项目-26.05-26.05 | 业务部门负责人 |
| 林子彧 | 2026062264285916 | 代运营-淘小宝-26.05-26.07 | 业务部门负责人 |
| 邱靖雯 | 2026062264336246 | 代运营-你组不组组-绝味鸭脖-26.05-26.05 | 业务部门负责人 |
| 陈诗云 | 2026062264306759 | 代运营-呜哩AI小红书-26.05-26.05 | 业务部门负责人 |

rows: 9 → 5（4 单全消除）

## 与 batch-row-click-2026-06-22.md 的差异

| 维度 | 普通报销 | 预算 |
|---|---|---|
| 按钮文字 | `通过`（无空格）| `通 过`（带空格）|
| 单步 vs 双步 | 双步（弹窗 + 确认）| 双步（弹窗 + 确认）|
| 弹窗堆叠 | 多次 click 会堆叠 | 每条单独 click + confirm 不堆叠 |
| approve.mjs | 偶发 ok=true（--force 后）| **永远 BUTTON_NOT_FOUND** |
| DB 落地 | clickVerified=true + dbSaved=true | **opencli eval 路径不写 DB**（属正常） |
| 列表消除 | rows 减少 1 | 预算 rows 减少 1（吴亮是当前节点） |
| 后续节点 | 通常无 | 可能有财务/CFO 节点（列表可能不消） |
