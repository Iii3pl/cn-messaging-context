# BILL_NOT_FOUND 直接 URL 诊断（2026-06-05）

## 何时使用

当 `navigate.mjs homepage` 正常返回 bills，但某条 `approve.mjs <billId>` 返回 `BILL_NOT_FOUND`，
且 `open -a "Google Chrome"` 手动登录后仍失败时，用此脚本区分根因。

## 诊断脚本

```js
// diag_bill_not_found.mjs — 放到 scripts/ 目录下
import { Page } from '/opt/homebrew/lib/node_modules/@jackwener/opencli/dist/src/browser/page.js';
import { ensureLoggedIn } from './shared/session.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const billId = process.argv[2];
if (!billId) { console.log('Usage: node diag_bill_not_found.mjs <billId>'); process.exit(1); }

const page = new Page('cmb-diag');
await ensureLoggedIn(page);

// 直接 URL 导航到详情页（不依赖列表页 row-click）
await page.evaluate(`window.location.hash = '#/trip-app/billDetail?billId=${billId}&viewType=APPROVED&reserveTab=true'`);
await sleep(5000);

const text = await page.evaluate('document.body.innerText');
const url = await page.evaluate('window.location.href');

// 判定
const hasApproved = text.includes('已通过');
const hasRejectBtn = text.includes('通过') && text.includes('退回');
const hasError = text.includes('系统异常') || text.includes('重新登录');

console.log(JSON.stringify({
  billId, url,
  diagnosis: hasError ? 'SESSION_EXPIRED' :
              hasApproved && !hasRejectBtn ? 'ALREADY_APPROVED' :
              hasRejectBtn ? 'PENDING_OK' : 'UNKNOWN',
  hasApproved, hasRejectBtn, hasError,
  snippet: text.substring(0, 300)
}));
```

## 判定逻辑

| 条件 | 诊断 | 处理 |
|------|------|------|
| 页面含「系统异常」| `SESSION_EXPIRED` | 重新登录 |
| 含「已通过」且无「通过」按钮 | `ALREADY_APPROVED` | 无需操作，列表缓存延迟 |
| 含「通过」+「退回」按钮 | `PENDING_OK` | 正常待审批，原 `approve.mjs` 的 row-click 路径有 bug |

## 已验证样本（2026-06-05）

三条均诊断为 `ALREADY_APPROVED`：

| billId | 申请人 | 金额 | 审批链状态 |
|--------|--------|------|-----------|
| 2026060257501211 | 张志娟 | ¥8,858 | OM运营一部审批节点 已通过，一级审批节点 已通过 |
| 2026051952883569 | 付蓉 | ¥22,500 | 推断同上 |
| 2026052053248008 | 张志娟 | ¥29,187 | 推断同上 |
