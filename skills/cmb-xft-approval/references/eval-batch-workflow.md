# opencli eval 批量审批工作流（2026-06-09 验证）

## 触发条件

当以下条件同时满足时，**放弃 approve.mjs**，直接用 opencli eval 逐条处理：

1. `self-heal.mjs` 确认 session 正常（`SESSION_VALID`, title="智能费控·薪福通"）
2. `opencli doctor` 显示 daemon + extension + bridge 全正常
3. `navigate.mjs homepage` 正常返回 bills（列表可见）
4. 但 `approve.mjs` 对**任意**单据都返回 `BILL_NOT_FOUND`（不是个例，是所有单）

> 验证样本（2026-06-09）：47 条投流费用申请单全部 BILL_NOT_FOUND，但 opencli eval 直接导航到详情页后可正常看到按钮并点击成功。

## 批量 eval 工作流

### Python 脚本模板

```python
import subprocess, time

def ev(code):
    r = subprocess.run(["opencli", "browser", "tvrvbmjk", "eval", code],
                       capture_output=True, text=True, timeout=15)
    return r.stdout.strip()

for bid, name, amt in bills:
    url = f"https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId={bid}&viewType=APPROVE_PEND"
    
    # 1. 导航到详情页
    ev(f'(function(){{location.href="{url}";return""}})()')
    time.sleep(5)  # ⚠️ 至少 5s，3.5s 不足
    
    # 2. 重试循环点击「通过」
    found = False
    for attempt in range(3):
        r = ev('(function(){const bs=document.querySelectorAll("button");for(const b of bs){if((b.innerText||"").trim()==="通过"){b.click();return"ok"}}return"miss"})()')
        if r == "ok":
            found = True
            break
        time.sleep(1.5)
    
    if not found:
        print(f"❌ {bid} 找不到按钮")
        continue
    
    # 3. 等待弹窗 + 点击「确认」
    time.sleep(2)
    ev('(function(){const bs=document.querySelectorAll("button");for(const b of bs){const t=b.innerText||"";if(t.includes("确")&&t.includes("认")){b.click();return""}})()')
    
    # 4. DB 补录（eval 路径不自动写入 DB）
    subprocess.run(["sqlite3", "/Users/wuliang/.hermes/data/cmb_approvals.db",
        f"INSERT OR IGNORE INTO approvals(bill_id, bill_type, applicant_name, amount, action, approved_at) VALUES('{bid}', '投流费用申请单', '{name}', {amt}, 'agree', datetime('now','localtime'));"],
        capture_output=True)
```

### 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 导航后等待 | **5s** | 3.5s 不足（实测 22/47 成功），5s + retry → 46/47 |
| 按钮搜索 | `b.innerText.trim() === "通过"` | 投流/报销单按钮无空格，直接用 equals |
| 重试次数 | 3 次，间隔 1.5s | SPA 异步渲染补偿 |
| 确认按钮 | `t==="同意"||t==="确认"||t==="确定"` | 兼容空格 `确 认` 和按钮「同意」；2026-06-16 弹窗也可能是「同意」 |
| 预算按钮 | `includes("通")&&includes("过")` | ⚠️ 预算页面按钮有空格，不能用 equals |
| profile | `tvrvbmjk` | opencli doctor 输出中的 profile 名 |

### 耗时估算

- 每条：~8s（导航 5s + 点击 2s + 确认 1s）
- 47 条：约 6-7 分钟
- 建议：每 10 条打印进度，方便中断恢复

## 已知边缘情况

### 预算 ¥0 单
- 预算审批 URL 格式不同：`/#/budget-app/budgetapprovaldetail?billId=...`
- 按钮文字为 `通 过`（中间有空格）
- 搜索必须用 `includes('通')&&includes('过')`
- 详情页无金额字段，project 从 `navigate.mjs bill` 获取

### 页面跳转到列表页而非详情页
- 症状：eval 返回大量「操作」「批量通过」「确认」按钮
- 原因：billId 对应的详情页可能已不存在（已批/幽灵）
- 处理：跳过该条，标记为 `GHOST_CANDIDATE`

### 确认按钮文本可变性（2026-06-16 补充）

弹窗确认按钮文字**不是固定的**「确认」，在一些页面（如多单连续批量处理或过签后）弹窗按钮文字为「同意」。`includes("确")&&includes("认")` 会漏掉「同意」。

**正确做法**：同时匹配「确认」和「同意」：

```js
// 弹窗确认按钮（可同时出现「确认」和「同意」，取最后一个可见）
const buttons = Array.from(document.querySelectorAll('.ant-modal button,.ant-popover button,.ant-modal-root button'))
  .filter(visible)
  .filter(b => { const t = norm(b.innerText); return t === '同意' || t === '确认' || t === '确定'; });
if (buttons.length) buttons[buttons.length - 1].click();
```

避免用 `includes("确")` 等单字匹配——它会误配列表行里的「通过」「否决」等邻近按钮。

### row-check SPA 缓存坑（2026-06-16 实测）

点击「通过→确认」后，DOM 的 `tr.ant-table-row` 可能**仍包含该 billId**（SPA 未即时刷新 DOM），导致 `ev` 返回 `still` 误判为未消除。

**正确验证顺序**：
1. 等待 4-5s 后先 DOM 检查（`row.innerText.includes(bid)`）
2. 如果 `still`，再等 2-3s 重试一次
3. 如果仍 `still`，**立即跑 `navigate.mjs homepage` 做最终判定**——主页 `pending` 和 `bills` 是通过后端接口重新拉取的，不受前端 DOM 缓存影响。只要 navigate 返回该 billId 已消失，即判定为通过，不要被 stale DOM 误导。

### 行级点击（替代详情页导航）

当 approve.mjs 不可用但 navigate.mjs homepage 列表正常时，可以**不跳到详情页，直接在列表行内点按钮**。这种方法更稳定（省去了详情页 SPA 导航的空等和骨架渲染问题）：

```js
// 1. 定位到审批列表页
location.href = 'https://xft.cmbchina.com/TripMainWeb/#/form-app/approval';
// 2. 等待 4s 让列表渲染
// 3. 按 billId 找到行
const rows = Array.from(document.querySelectorAll('tr.ant-table-row'));
const row = rows.find(r => (r.innerText || '').includes(billId));
row.scrollIntoView({ block: 'center' });
// 4. 在行内找「通过」按钮
const btn = Array.from(row.querySelectorAll('button'))
  .find(b => { const t = norm(b.innerText); return t.includes('通过') || (t.includes('通') && t.includes('过')); });
btn.click();                                    // 点「通过」
// 5. 等待弹窗 → 找「同意」或「确认」按钮
const confirmBtn = Array.from(document.querySelectorAll('.ant-modal button'))
  .filter(visible)
  .find(b => { const t = norm(b.innerText); return t === '同意' || t === '确认' || t === '确定'; });
confirmBtn.click();                             // 点「确认/同意」
// 6. 等待 4s → verify row消失
```

行级点击优点：
- 无需切换 URL / 加载详情页（省 ~3-5s/条）
- 不受详情页骨架渲染/SPA 导航干扰
- 不会踩 BILL_NOT_FOUND 的详情页空坑

**2026-06-16 验证**：对全部类型的单据（团建费/日常报销/投流/预算/供应商预付款），行级点击均成功，包括按钮文字为「通 过」（预算页）和确认文字为「同意」的模态弹窗。
- 可能原因：点击「通过」后弹窗未加载
- 处理：等待 3s 后重试 ev，再找不到则跳过（按钮已点击但无法验证）
