# approve.mjs 超时 → opencli eval 兜底审批

2026-06-08 会话中验证的完整流水线。当 `approve.mjs` 超时（>30s）或 daemon 重启后 page state 丢失时使用。

## 触发条件

- `approve.mjs` 超时无响应
- daemon 重启后 page 在 `about:blank`
- `approve.mjs` 返回 HEAL_FAILED 且重试无效

## 完整流程

### Step 0：恢复 session

```bash
opencli daemon restart && sleep 5
node scripts/self-heal.mjs
```

> ⚠️ 扩展重载后 session name 可能改变（如 uz3357c8 → tvrvbmjk）。从 `opencli doctor` 输出获取当前 session。

### Step 1：导航到单据详情

```bash
opencli browser <SESSION> eval "location.href = 'https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=<ID>&viewType=APPROVE_PEND&reserveTab=true'"
sleep 4
```

### Step 2：找到并点击正确的「通过」按钮

**关键**：页面有**两组**「通过」按钮：
- 审批链表格里的 `button.ant-btn-link` — 不要点这些
- 底部操作区的 `button.ant-btn-primary` — 点这个

```bash
# 先侦查
opencli browser <SESSION> eval "[...document.querySelectorAll('button.ant-btn-primary')].map(b => b.innerText.trim()+':'+b.offsetTop)"

# 点击 offsetTop > 10 的（offsetTop=0 的是审批链混淆）
opencli browser <SESSION> eval "document.querySelectorAll('button.ant-btn-primary').forEach(b=>{if(b.innerText.trim()==='通过'&&b.offsetTop>10)b.click()})"
sleep 2
```

### Step 3：点击确认

```bash
opencli browser <SESSION> eval "document.querySelectorAll('button').forEach(b=>{if(b.innerText.trim()==='确认'&&b.className.includes('guideStepOperate'))b.click()})"
sleep 2
```

### Step 4：验证

```bash
# 成功 → URL 跳转到审批列表
opencli browser <SESSION> eval "location.href"  # 含 /#/form-app/approval 即成功
```

## 已验证样本

- 2026-06-08：李锦晶 ¥4,688 员工日常报销 (#7)，approve.mjs 超时后 eval 兜底成功
- 2026-06-08：陈小香 ¥4,381 云账户支付 (#1)，页面显示「同意成功」

## Pitfalls

| 现象 | 原因 | 修复 |
|------|------|------|
| eval 返回空 | 页面在 `about:blank` | `self-heal.mjs` 恢复 |
| 弹出差旅/预订弹窗 | 点了审批链里的「通过」link | 点「取消」关闭，重试 Step 2 |
| `确认` 找不到 | 弹窗盖住或没出现 | 检查 `.ant-modal`，先关掉再重试 |
| URL 没跳转 | 通过点错了按钮 | 重试 Step 2，确保 offsetTop>10 |
