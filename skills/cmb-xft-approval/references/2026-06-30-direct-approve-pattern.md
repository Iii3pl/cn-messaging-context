# 2026-06-30 直达审批模式实战

## 背景

2026-06-30 会话，吴亮一次性审批 18 笔薪福通待办。过程中发现了比现有 `fast-approve.mjs`（行级按钮）更高效的审批模式：**直接构造详情页 URL + APPROVE_PEND 视口**。

## 发现

### 1. 直达 URL 优于列表页导航

现有 `approve.mjs` 的流程：列表页 → `parseHomepageBills` → 逐行定位 → `parseBillDetail(page, billId)` → 点击

实测中发现：
- 列表页 SPA 渲染有时序问题（刚批完一批后 rows 可能为 0）
- 幽灵单据（同时出现在待审批+已审批两个 tab）会导致 `BILL_NOT_FOUND`
- Row click 受 Vue 组件展开/折叠状态影响

**直达 URL 完全绕过这些问题**：

```
https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId={billId}&viewType=APPROVE_PEND&reserveTab=true
```

- `viewType=APPROVE_PEND`：强制进入审批视口，不受列表 tab 状态影响
- `reserveTab=true`：保留审批 tab 上下文

### 2. 简化按钮定位

现有 `approve.mjs` 的 `clickApproveAndConfirm` 使用 3 层策略（ant-btn → ant-btn-primary → fuzzy），先滚屏再点击，代码 70+ 行。

实测中以下一行 eval 足以覆盖所有 18 笔：

```javascript
// Step 1: 点击「通过」
document.querySelectorAll('button')
  .filter(b => b.offsetParent && b.className.includes('ant-btn-primary'))
  .find(b => b.innerText.trim() === '通过')?.click();

// Step 2: 点击「确认」
document.querySelector('.ant-modal')
  .querySelectorAll('button')
  .filter(b => b.offsetParent)
  .find(b => ['确认','确定','同意'].includes(b.innerText.trim()))?.click();
```

### 3. 幽灵单据无需 ghost-clear

2026-06-26 发现某些单据同时出现在「待审批」和「已审批」两个 tab（幽灵），需要通过 `ghost-clear.mjs` 清理。

本次发现：直接用 `viewType=APPROVE_PEND` 打开详情即可正常审批，无需 ghost-clear 预处理。因为 APPROVE_PEND 视口直接命中审批路由，不受列表 tab 数据不一致影响。

## 性能对比

| 指标 | fast-approve.mjs (行级) | direct-approve.mjs (直达) |
|------|------------------------|--------------------------|
| 每笔耗时 | ~8-10s（列表加载 + 行定位 + 弹窗循环） | ~6-7s（页面加载 + 点通过 + 点确认） |
| 18 笔总耗时 | ~2.5min | ~2min |
| 失败率 | 偶发 ROW_NOT_FOUND / 弹窗堆叠 | 偶发 PAGE_NOT_LOADED（重试即可） |
| 幽灵单据 | 需要预处理 | 不需要 |

## 适用建议

- **少量（1-5 笔）**：`approve.mjs` 即可，有完整审核+DB 记录
- **批量（6-30 笔）+ 用户已明确**：优先 `direct-approve.mjs --ids --yes`
- **需要审核摘要**：先 `review.mjs --batch` 展示，再 `direct-approve.mjs` 执行
- **行级按钮可用时**：`fast-approve.mjs` 仍有效，适合不想离开列表页的场景
