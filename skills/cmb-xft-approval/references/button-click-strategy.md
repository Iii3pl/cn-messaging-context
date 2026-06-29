# 按钮点击策略（2026-06-05 重写）

## 旧版问题

只搜 `button.ant-btn` + 精确文本 `"通过"`：
- 不同单据类型的审批按钮 class 不同（`ant-btn` vs `ant-btn-primary`）
- 按钮文本不一致（"通过" / "同意" / "提交"）
- 确认按钮文本也不一致（"确认" / "同意" / "确定"）
- 按钮未找到时静默继续 → `verifyClick` 误判通过

## 新版 3 层策略

### Step 1：审批按钮

```
策略1: button.ant-btn 精确匹配 → 文本: ['通过','同意','提交']
策略2: button.ant-btn-primary 精确匹配 → 同上
策略3: 所有 button 模糊匹配（含 class 过滤）→ 同上
```

任一命中即 `return`，全部未命中 → `BUTTON_NOT_FOUND` 硬退出（不再继续 verifyClick）。

### Step 2：确认按钮

```
策略1: button.ant-btn-primary 精确匹配 → 文本: ['确认','同意','确定','提交']
策略2: 所有 button 降级匹配 → 文本: ['确认','同意','确定']
```

### 入口参数

```js
clickApproveAndConfirm(page, action)
// action = 'agree' → labels = ['通过','同意','提交']
// action = 'reject' → labels = ['退回','拒绝']
```

## 验证

- 罗凯备用金 `--force` → `clicked ant-btn: 通过 → clicked confirm: 确认` ✅
- 吴佳榕投流 `--force` → `clicked ant-btn: 通过 → clicked confirm: 确认` ✅
- 郑秀雯投流 `--force` → `clicked ant-btn: 通过 → clicked confirm: 确认` ✅
- 夏旭预付款 → `clicked ant-btn: 通过 → clicked confirm: 确认` ✅
- 已通过单据 → `BUTTON_NOT_FOUND`（正确，无按钮可点）✅
