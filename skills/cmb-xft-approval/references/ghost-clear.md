# ghost-clear.mjs — 幽灵单据 SPA 缓存清理

## 背景

薪福通审批后，已批单据有时仍显示在待审批列表（幽灵单据）。普通 `location.reload()` 不能清除 SPA 状态，因为这些数据来自服务端 API 响应缓存而非浏览器缓存。

## 结论（2026-06-06 验证）

**硬刷新 + 清 storage + 导航回到审批页 = 无效。** 幽灵是 XFT 服务端数据一致性问题，客户端无解。只能等系统同步或手动页面操作。

## 脚本

`ghost-clear.mjs` 通过 opencli CDP 尝试硬刷新 + 清 storage + 重新导航。已验证 `pendingBefore=13 → pendingAfter=13`（无变化），确认客户端手段无效。

```bash
node scripts/ghost-clear.mjs
# → {success, pendingBefore, pendingAfter, method}
```

## 判定流程

| 症状 | 判定 | 动作 |
|------|------|------|
| `navigate.mjs homepage` 可见 | 列表中有该 billId | 继续 |
| `approve.mjs <billId>` → BILL_NOT_FOUND | 详情页不可达 | 疑似幽灵 |
| `navigate.mjs bill <billId>` → BILL_NOT_FOUND | 确认幽灵 | 跳过 |
| `health.mjs` → ok + session valid | 非 session 问题 | 确认幽灵 |
| `--filter-ghosts` → realPending=0 | 全部幽灵 | 等待系统同步 |

## 与 navigate.mjs --filter-ghosts 的关系

`--filter-ghosts` 做的是「待审批 vs 已审批」两 tab 交叉比对，能标出同时在两个 tab 的单据。但它不能清除它们——只是诊断工具。真正清除需 XFT 服务端数据同步。
