# 2026-06-26 会话补充

## 1. 招待申请单 — 白名单新增类型

`navigate.mjs homepage` 返回 `pending=14, bills=13`，缺的一单是 `招待申请单`（刘鹭娇 ¥400）。
需在 `extract.mjs` 第 15 行 `VALID_BILL_TYPES` 正则末尾追加 `|招待申请单`。

操作路径：opencli eval 行级通过（与普通报销相同），弹窗走双步确认。

## 2. 统一双步确认弹窗（所有类型回归）

2026-06-26 实测 7 条（员工日常报销单 ¥72~¥371、云账户支付 ¥42,490.76）**全部**出现弹窗确认，不再有单步路径。
此前 2026-06-18 曾观察到单步模式，当前已不可复现。

弹窗内容（7/7 一致）：
```
同意
最近意见： 客户月权责在70W量级，较为关键。望领导批准
情况属实，项目较为特殊，望领导批复
[常用语] [上传图片] [上传附件]
[取消] [确认]
```

硬规则：点「通过」→ sleep 4 → 弹窗确认 → sleep 3 → 回查 row 消失。

## 3. MouseEvent dispatch 兜底

江灵星 ¥1,055.76：`btn.click()` × 2 未能提交确认弹窗，
`btn.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,view:window}))` 一次成功。
详见 `references/mouseevent-dialog-confirm.md`。

## 4. opencli daemon 卡死后恢复（2026-06-26 实战，3 次命中）

**症状**：长会话（5+ 分钟 idle 或大量 opencli eval 批处理后）经常出现以下连环故障：
- `opencli doctor` 自身 timeout（>30s 无输出）
- `opencli browser <s> eval` 任何调用都 timeout
- 不是 session 过期——是 opencli daemon 自身僵死

**判定**：`echo "test"` 正常 + `opencli doctor` timeout → daemon 卡死。

**恢复流程**（必走完 4 步，每步验证后才进下一步）：
```bash
# Step 1: restart daemon
opencli daemon restart 2>&1 | tail -3
# → "Daemon restarted on port 19825 (v1.8.4). ⚠ Daemon is running, but the Browser Bridge extension has not connected yet."

# Step 2: 立即重试 doctor 大概率返 "Extension not connected"（扩展还没重连）
# 必须 sleep 等扩展重连，**不要**重试 daemon restart
sleep 8
opencli doctor 2>&1 | tail -5
# → "Extension: connected" 才算恢复

# Step 3: 验证 eval 通路
opencli browser <s> eval "1+1" 2>&1 | tail -3
# → "2" 才算 JS context 正常

# Step 4: 验证 SPA 仍挂载（tab 状态）
opencli browser <s> eval "document.title + ' | hash=' + location.hash" 2>&1 | tail -3
# → "智能费控·薪福通 | hash=#/form-app/approval" 才是真完整恢复
```

**关键坑**（本次踩了 3 次）：
- ❌ **不要** `eval "1+1"` 返 "2" 就报"恢复 OK"——SPA 可能已死，需验证 hash
- ❌ **不要**看到 "Extension not connected" 就再 restart（陷入死循环）
- ❌ **不要**用 `pkill -f opencli`——会丢所有 session
- ❌ **不要**用 `self-heal.mjs`——它是自动登录流程，daemon 卡死时它内部也卡

**为什么 eval 1+1 不能判定恢复**：opencli bridge 自身 JS context（`Runtime.evaluate`）可能仍存活（返 2），但扩展的 WebSocket 已经掉了，访问浏览器 DOM 全部 hang。本次 2 次踩这个坑：eval 返 2 → 以为恢复了 → 走 eval rows → hang。

**判定阶梯**（必须按顺序走完）：
1. `echo test` → 0s 内返 → terminal 本身 OK
2. `opencli doctor` → 5s 内返 + 绿 → daemon + bridge + extension 三层都在
3. `eval "1+1"` → 10s 内返 2 → bridge ↔ Chrome JS 通道通
4. `eval "document.title"` → 5s 内返 + 非空 → Chrome 页面还活着（SPA 仍挂载）
5. `eval "rows count"` → 0s 内返数字 → 列表还在

第 1-2 步 OK 后再 5 分钟内大概率自动恢复；连 2 次 `doctor` timeout 才走 daemon restart。

**会话中实测耗时**：3 次 daemon 死锁 → 平均 25-40s 走完 4 步恢复。

## 5. 列表漂移时"不重批"判定

**场景**：用户"审批列表"查询 → 拿到 14 条新单；对比上一轮 14 条（已批 7 条）→ 当前列表里**仍能看到**部分已批的 billId（如陈小香 ¥10,547.32 / X6 预算单）。

**判定逻辑**（按优先级）：
1. **XFT eval 直接查 row 状态**（最快）：
   ```bash
   opencli browser $S eval "Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('<billId>')) ? 'STILL_THERE' : 'GONE'"
   ```
   - GONE = 真从列表消除（DB 已生效）→ 不重批
   - STILL = 仍显示 → 进一步判断（看审批链节点、DB 记录）

2. **DB 落地查证**（最权威）：
   ```bash
   sqlite3 ~/.hermes/data/cmb_approvals.db "SELECT bill_id, action, approved_at FROM approvals WHERE bill_id='<bid>'"
   ```
   - 命中 agree + approved_at 在本会话内 → 已批，列表不消属正常（中间节点）
   - 无记录 → 上一轮"通过"可能没真生效

3. **不要重批的硬信号**：
   - 列表 row 已 GONE
   - 或 DB 有 agree 记录（无论 approved_at 时间）
   - 或用户已确认"已过"（如 "D6 X3 X4 通过" 复合指令中上一轮的 3、4 已批过）

**反例**（本次用户"不对吧～薪福通还有审批呢"）：上一轮汇报"4 条绿灯全过"+ 后面 3 条大额 X10/X11/X13 通过，但 list 仍显示部分单——必须重新拉取当前真实数据，**不能**沿用上一轮报告。

**汇报模板修正**：每轮审批汇报后立即**重新拉一次列表**验证 rows 总数变化。`pending` 减 1 = 真批了 1 条；`pending` 没变但 DB 有记录 = 已批但 list 缓存延迟（或中间节点）；`pending` 没变 + DB 无记录 = 上一轮没真生效，需重批。
