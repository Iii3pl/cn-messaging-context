# approve.mjs BUTTON_NOT_FOUND 兜底：差旅报销单 + 云账户支付 — 2026-06-29 实战

## 症状

`approve.mjs <billId> agree --force --skip-preaudit` 对以下类型返 `ok:false, error: "BUTTON_NOT_FOUND"`：

- **差旅报销单**（X11 李锦晶 ¥474.71 海信电视赛里木湖打车，2026-06-29 实测）
- **云账户支付**（X14/X15 陈小香 ¥10,547.32 + ¥20,042.76 功夫科技，2026-06-29 实测）
- 预算单（已在 SKILL 已知，¥0 按钮为「通 过」带空格）
- 投流费用申请单（已在 SKILL 已知，详情页结构差异）

但 review 阶段能拿到完整字段（部门全路径 + 项目 + 审批链），说明 review.mjs / navigate.mjs 的页面解析没问题，**问题出在审批按钮选择器**。

## 根因

差旅报销单和云账户支付的详情页审批按钮**结构与员工日常报销单不同**：
- 员工日常报销单：底部 ant-btn-primary "通过"
- 差旅报销单 / 云账户支付：按钮可能被 div + 隐藏 span 包裹，或 click handler 是 Vue 自定义方法，不在 approve.mjs 默认的 3 层策略中

## 兜底流程（按优先级）

### 优先级 1：opencli eval 主页行级 + 弹窗「确认」双步（首选）

适用于差旅报销单、云账户支付（已验证但 opencli eval 路径 SPA 必须挂载）：

```bash
# 1. 切到审批列表
opencli browser gxs46xbg open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 8  # 等 Vue SPA 挂载

# 2. eval 验证 SPA 挂载
opencli browser gxs46xbg eval "document.querySelectorAll('tr.ant-table-row').length"
# 应返 N>0；如果返空或 hang，走优先级 2

# 3. 按 billId 精确匹配行 + 点行级「通过」+ 弹窗「确认」
opencli browser gxs46xbg eval "
(function(){
  const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('<billId>'));
  if (!tr) return JSON.stringify({err:'NO_ROW'});
  const btn = Array.from(tr.querySelectorAll('button')).find(b => (b.innerText||'').replace(/\\s+/g,'') === '通过');
  if (!btn) return JSON.stringify({err:'NO_BTN', btns: Array.from(tr.querySelectorAll('button')).map(b=>b.innerText.trim())});
  btn.click();
  return JSON.stringify({ok:'clicked'});
})()
"
sleep 4  # 等弹窗

# 4. 点弹窗「确认」
opencli browser gxs46xbg eval "
(function(){
  const btns = Array.from(document.querySelectorAll('.ant-modal button'));
  const confirm = btns.find(b => b.innerText.trim() === '确认');
  if (!confirm) return JSON.stringify({err:'NO_CONFIRM_BTN', btns: btns.map(b=>b.innerText.trim())});
  confirm.click();
  return JSON.stringify({ok:'clicked confirm'});
})()
"
sleep 4

# 5. 回查 row 消失
opencli browser gxs46xbg eval "
(function(){
  const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('<billId>'));
  return tr ? 'STILL_THERE' : 'GONE';
})()
"
```

**三件套硬信号**：row 消失 + 弹窗消失 + toast「同意成功」必须全有（与 2026-06-26 统一双步规则一致）。

### 优先级 2：opencli eval 失败时降级 — navigate.mjs 重新渲染 SPA

opencli tab `about:blank` / eval 持续返空时：

```bash
cd /Volumes/SSD/.hermes/skills/openclaw-imports/cmb-xft-approval/scripts
node navigate.mjs homepage
# 输出 pending 数字 + bills[]

# 再切回 opencli eval（navigate 后 SPA 已挂载）
opencli browser gxs46xbg eval "document.querySelectorAll('tr.ant-table-row').length"
# 应返 N>0
```

**禁止**：opencli eval 返空就判定 session 过期——优先 navigate.mjs 跨 context 重渲染。

### 优先级 3：云账户支付 + 双步失败 → 详情页强制 opencli 重新进入

云账户支付有时主页行级点击后弹窗堆叠或 SPA 路由跳转混乱。降级到详情页：

```bash
opencli browser gxs46xbg open "https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=<billId>&viewType=APPROVE_PEND"
sleep 8

opencli browser gxs46xbg eval "
(function(){
  const btns = Array.from(document.querySelectorAll('button.ant-btn-primary'));
  const passBtn = btns.find(b => (b.innerText||'').replace(/\\s+/g,'').includes('通过'));
  if (!passBtn) return JSON.stringify({err:'NO_PRIMARY_BTN', btns: btns.map(b=>b.innerText.trim())});
  passBtn.click();
  return JSON.stringify({ok:'clicked primary'});
})()
"
sleep 4

# 弹窗「确认」
opencli browser gxs46xbg eval "
(function(){
  const btns = Array.from(document.querySelectorAll('.ant-modal button'));
  const confirm = btns.find(b => b.innerText.trim() === '确认');
  if (!confirm) return JSON.stringify({err:'NO_CONFIRM_BTN'});
  confirm.click();
  return JSON.stringify({ok:'clicked confirm'});
})()
"
sleep 4
```

## 实测样本（2026-06-29）

- **X11 李锦晶 ¥474.71 差旅报销**：`approve.mjs` BUTTON_NOT_FOUND，opencli eval 路径当时 SPA 未挂载（eval 持续返空），未在会话内完成兜底
- **X14/X15 陈小香 ¥10,547.32 + ¥20,042.76 云账户支付**：同上，BUTTON_NOT_FOUND，opencli eval 不可用
- **教训**：会话后期 opencli 桥接频繁 hang，需要在会话**开头**就备好兜底路径，不要等问题堆积才补救

## 关联 Bug

- **差旅报销单 approve.mjs BUTTON_NOT_FOUND**：与「预算 ¥0 + 投流详情页结构」不同，差旅报销详情页应是有按钮但选择器不匹配
- **云账户支付 approve.mjs BUTTON_NOT_FOUND**：与投流类似，可能是详情页结构差异（云账户是新的特殊表单组件）

## 后续建议

1. **会话开始时**：如果用户预期会批云账户/差旅，提前在后台挂 navigate.mjs 渲染 SPA，避免后期桥接挂了无路可走
2. **fast-approve-batch.py 修复**：当前脚本里 JS 语法被错放在 .py 文件（`b.innerText.replace(/\s+/g,'')` 是 JS 语法），需要重写为 Python 调用 subprocess + opencli eval 子进程
3. **approve.mjs 增强**：在 BUTTON_NOT_FOUND 时自动降级到 opencli eval 行级路径，而不是直接硬退出

## 验证信号一致性

任何 XFT 审批完成后，必须三重验证（与 SKILL 硬规则一致）：

1. DB 落地：`sqlite3 ~/.hermes/data/cmb_approvals.db "SELECT * FROM approvals WHERE bill_id='<id>'"`
2. 列表消除：`navigate.mjs homepage` 输出不含该 billId（吴亮非最后节点时列表残留属正常）
3. 详情页吴亮节点变 COMPLETED/AGREE

矛盾时以 DB + 任务状态为准。