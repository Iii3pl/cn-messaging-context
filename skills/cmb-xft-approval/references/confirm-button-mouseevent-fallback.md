# 确认按钮 MouseEvent 降级方案

## 问题

opencli eval 路径下，`btn.click()` 调用 Vue 确认弹窗的「确认」按钮时，部分情况下不会实际提交：

- `btn.click()` 返回成功（不抛异常）
- 弹窗 `.ant-modal` 仍存在（未关闭）
- row 仍在审批列表（审批未生效）
- 同一页面重复点击，dialog 持久存在

**根因**：Vue 或 React 的事件代理机制在某些弹窗层级中不响应原生 `.click()`，只响应 `dispatchEvent(new MouseEvent('click', ...))`。

## 解决方案

```js
const btn = Array.from(document.querySelectorAll('button'))
  .find(b => b.innerText.trim() === '确认');

// ❌ btn.click() — 有时不生效
// ✅ dispatchEvent + MouseEvent
btn.dispatchEvent(new MouseEvent('click', {
  bubbles: true,
  cancelable: true,
  view: window
}));
```

## 判定流程

```
行级点击「通过」→ sleep 4
  ├─ dialog 出现 → 找「确认」按钮
  │    ├─ btn.click() → sleep 3 → dialog 消失 → row 消失 ✅ 正常流程
  │    ├─ btn.click() → sleep 3 → dialog 仍在 → row 仍在
  │    │    └─ dispatchEvent(MouseEvent) → sleep 3
  │    │         ├─ dialog 消失 + row 消失 → ✅ MouseEvent 降级生效
  │    │         └─ dialog 仍在 + row 仍在 → ❌ 其他问题
  │    └─ 找不到「确认」→ 降级搜「知道了」
  └─ 无 dialog → 检查 row 是否消失（单步生效）
```

## 样例会话

**江灵星 ¥1,055.76 员工日常报销单**（2026-06-26）：
1. 第1次行级点击 → CLICKED，无 dialog，row 仍在（SPA 重排假阳性）
2. 第2次行级点击 → CLICKED，dialog 出现，btn.confirm.click() → row 仍在
3. dispatchEvent(MouseEvent) on confirm → row 消失 ✅

## 适用场景

| 场景 | 优先级 |
|------|:----:|
| 行级点击 dialog 出现，`btn.click()` 不提交 | 1st fallback |
| dialog 持久不消失，但审批实际上可能已生效 | 先查 row 是否消失，再决定 |
| 连续两次 `btn.click()` 都失败 | 必试 MouseEvent |
| 预算单/合同用印弹窗 | 先试 btn.click()，不行再降级 |

## 不适用场景

- `btn` 为 `null`（根本找不到按钮）→ 先搜对齐文本
- dialog 文本为「知道了」→ 参考 dialog-variant-zhi-dao-le.md
- approve.mjs 路径（走 Playwright Page，MouseEvent 处理方式不同）
