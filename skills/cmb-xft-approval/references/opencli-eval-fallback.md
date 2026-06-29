# opencli browser eval 兜底审批

当 `approve.mjs` 返回 `BILL_NOT_FOUND` 或 `BUTTON_NOT_FOUND`，但 `navigate.mjs homepage` 列表中仍可见该单据时，可用 `opencli browser eval` 直接在页面上点击按钮完成审批。

## 适用场景

1. **预算审批** — 页面在 `/budget-app/budgetapprovaldetail`，按钮文字是 "通 过"（带空格），与 approve.mjs 预期不匹配。**完整兜底流程见 `references/budget-approval.md` 末尾「¥0 预算 + approve.mjs BUTTON_NOT_FOUND 兜底」章节**
2. **幽灵救活** — `navigate.mjs bill` 返回 BILL_NOT_FOUND，但直接 URL 导航到详情页可打开且有按钮
3. **新单据类型** — 页面结构与 approve.mjs 预期不同

## 前置条件

- opencli daemon 运行中，extension 已连接
- **优先用用户提供的已连接 session 名**（如 `gxs46xbg`），见 SKILL.md「🔴 共享已有 opencli session 名」章节
- XFT 页面已登录（`self-heal.mjs` 报告 SESSION_VALID 或 SESSION_VALID reason 含 "title:智能费控·薪福通"）

## 通用两步审批流程

```bash
SESS=$(opencli profile list 2>&1 | grep "connected" | head -1 | awk '{print $1}')

# Step 1: 导航到详情页
opencli browser $SESS open "https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=<ID>&viewType=APPROVE_PEND"

# Step 2: 等页面加载后，找底部"通过"按钮（倒数第二个 ant-btn-primary）
opencli browser $SESS eval '(function(){
  const all=document.querySelectorAll("button.ant-btn-primary");
  let idx=-1;
  all.forEach((b,i)=>{if(b.innerText.trim()==="通过")idx=i});
  if(idx>=0){all[idx].scrollIntoView();all[idx].click();return "CLICKED pass #"+idx}
  return "NOT_FOUND";
})()'

# Step 3: 等确认对话框出现，点"确认"
sleep 2
opencli browser $SESS eval '(function(){
  const ok=document.querySelector("button.guideStepOperateOkButton");
  if(ok){ok.click();return "CONFIRMED"}
  return "NO_CONFIRM";
})()'
```

## 预算审批特殊流程

预算页面 URL 不同，按钮文字带空格，**完整流程见 `references/budget-approval.md` 末尾章节**。关键差异：

```bash
# 导航到预算审批详情页（这次 opencli open 能成功，因为 URL 直接渲染预算子组件，不需要 Vue 根组件挂载）
opencli browser $SESS open "https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId=<ID>&viewType=APPROVE_PEND"

# 点击"通 过"（注意 includes('通') && includes('过')，不用 === '通过'）
sleep 5  # 必须等 SPA 渲染
opencli browser $SESS eval "Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('通') && b.innerText.includes('过'))?.click()"

# 点击"确认"
sleep 3
opencli browser $SESS eval "Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '确认')?.click()"
```

**`approve.mjs` 返 `BUTTON_NOT_FOUND` 时不要加 `--force` 重试**——加 `--force` 仍然找不到按钮（不是 DB 重复问题），浪费 token。

## 批量预算 Python 脚本模式

```python
import subprocess, time

SESS = "uz3357c8"  # opencli profile list 获取
BASE = "https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId={}&viewType=APPROVE_PEND"

for bid, name in bills:
    subprocess.run(["opencli", "browser", SESS, "open", BASE.format(bid)], capture_output=True)
    time.sleep(5)  # 必须 sleep 5+ 等 SPA 渲染
    subprocess.run(["opencli", "browser", SESS, "eval", 
        "Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('通') && b.innerText.includes('过'))?.click()"], capture_output=True)
    time.sleep(3)
    subprocess.run(["opencli", "browser", SESS, "eval",
        "Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '确认')?.click()"], capture_output=True)
    time.sleep(4)
```

## 供应商结算单等普通页面流程

普通审批页面（`/trip-app/billDetail`）可能有多个"通过"按钮（每个审批节点一个）。需点底部的 `ant-btn-primary` "通过"：

```bash
# 找倒数第二个 ant-btn-primary（最后一个通常是"取消"）
opencli browser $SESS eval '(function(){
  window.scrollTo(0, document.body.scrollHeight);
  const all=document.querySelectorAll("button.ant-btn-primary");
  let info=[]; all.forEach((b,i)=>{info.push(i+":"+b.innerText.trim())});
  return JSON.stringify(info);
})()'
```

找到"通过"按钮的索引后点击。

## 验证审批结果

```bash
node scripts/navigate.mjs homepage | python3 -c "import sys,json; d=json.load(sys.stdin); print('pending:', d['pending'])"
```

## 行级按钮方案（2026-06-16 验证）

适合 **多单据批量处理**：不打开详情页，直接在审批列表页按 billId 定位行，点行内的「通过」按钮。

```python
import subprocess, time, json

SESSION = 'tvrvbmjk'
URL = 'https://xft.cmbchina.com/TripMainWeb/#/form-app/approval'
BIDS = ['2026061662687728', '2026061662712843']

def ev(code, timeout=25):
    p = subprocess.run(['opencli', 'browser', SESSION, 'eval', code],
                       capture_output=True, text=True, timeout=timeout)
    return (p.stdout or '').strip()

ev(f'(function(){{location.href={json.dumps(URL)}; return location.href;}})()')
time.sleep(4)

for bid in BIDS:
    # Step 1: 行内找「通过」按钮并按 billId 精确定位
    code = f"""
(function(){{
  const bid={json.dumps(bid)};
  const norm = s => (s||'').replace(/\\s/g,'');
  const rows = Array.from(document.querySelectorAll('tr.ant-table-row'));
  const row = rows.find(r => (r.innerText||'').includes(bid));
  if(!row) return 'row-miss';
  row.scrollIntoView({{block:'center'}});
  const btns = Array.from(row.querySelectorAll('button'));
  const btn = btns.find(b => {{
    const t = norm(b.innerText);
    return t.includes('通过') || (t.includes('通')&&t.includes('过'));
  }});
  if(!btn) return 'button-miss';
  btn.click(); return 'clicked';
}})()
"""
    ev(code)
    time.sleep(1.5)
    
    # Step 2: 点弹窗确认按钮（文本可能是「同意」或「确认」）
    ev("""
(function(){
  const norm = s => (s||'').replace(/\\s/g,'');
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const btns = Array.from(document.querySelectorAll('.ant-modal button,.ant-popover button'))
    .filter(visible)
    .filter(b => {const t = norm(b.innerText); return t === '同意' || t === '确认' || t === '确定';});
  if(!btns.length) return 'none';
  btns[btns.length-1].click(); return 'ok';
})()
""")
    time.sleep(4)
    
    # Step 3: 验证行已消失（注意：4s 假阳性窗口，详见 SKILL.md「行级回查的 4s 假阳性」章节）
    check = ev(f"(function(){{const bid={json.dumps(bid)}; return Array.from(document.querySelectorAll('tr.ant-table-row')).some(r=>(r.innerText||'').includes(bid))?'still':'gone';}})()")
    if check == 'still':
        time.sleep(2)  # 总 6s,SPA 重排窗口
        check = ev(f"(function(){{const bid={json.dumps(bid)}; return Array.from(document.querySelectorAll('tr.ant-table-row')).some(r=>(r.innerText||'').includes(bid))?'still':'gone';}})()")
```

### 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 确认按钮搜索 | `'同意'` / `'确认'` / `'确定'` | 2026-06-16 实测弹窗按钮是**「同意」**而非「确认」；**优先搜「同意」** |
| 按钮文本匹配 | `<bare>includes('通过') || (includes('通')&&includes('过'))` | 兼容预算按钮 `通 过`（带空格） |
| 按钮定位 | `tr.ant-table-row` 行内 `button` | 只在目标行内搜，不受其他行按钮干扰 |
| 弹窗可见性过滤 | `offsetWidth \|\| offsetHeight \|\| getClientRects().length` | 过滤掉不可见的 modal 元素 |

### 堆叠弹窗处理

当多条审批的「通过」已点击但「确认」没跟上时，弹窗会堆叠（每个都有「同意|取消」按钮）。处理方式：
1. 先 N 次循环点「同意」清空堆叠弹窗
2. 回到列表页重新检查
3. 对仍存在的行逐条重试（确保每步单独确认）

```python
for i in range(12):
    r = ev(...search visible ant-modal buttons with text '同意'...)
    if r == 'none': break
    time.sleep(2.5)
```

## 注意事项

- **确认按钮不总是「确认」**：2026-06-16 实测堆叠弹窗和部分 UI 状态下的确认按钮是「同意」。永远把「同意」「确认」「确定」都放进搜索列表，优先匹配「同意」。
- opencli eval 中变量会跨调用持久化，用 IIFE `(function(){...})()` 避免变量冲突
- 按钮索引在页面不同状态下可能变化
- 点击后需 sleep 等 SPA 渲染
- opencli 1.8.3 起 `--session` 已弃用，改为位置参数：`opencli browser <session> <command>`

## 🆕 投流费用申请单 — opencli eval 行级 可行（2026-06-26 实战修正）

**反 SKILL 旧假设**：SKILL.md 「🔴 投流费用申请单：跳过 approve.mjs」 章节说 `approve.mjs` 对投流 100% 返 `BUTTON_NOT_FOUND`，但**本会话 X11(陈祎楠 ¥7,476.64) + X2(沈煜 ¥1,980.20) 投流单 都通过 opencli eval 行级 + 弹窗「确认」双步成功通过**。

**新模式**（投流 主页行级 走与普通报销相同的双步）：

```bash
SESS=gxs46xbg
# Step 1: 主页行内 click「通过」
opencli browser $SESS eval "
(function(){
  const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('BILLID'));
  if(!tr) return 'NO_ROW';
  const btn = Array.from(tr.querySelectorAll('button')).find(b => {const t=b.innerText.replace(/\s+/g,''); return t==='通过' || (t.includes('通')&&t.includes('过'));});
  if(!btn) return 'BTN_NOT_FOUND';
  btn.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true}));
  return 'DISPATCHED';
})()
"
sleep 5

# Step 2: 点弹窗「确认」(.ant-modal 内 .ant-btn-primary)
opencli browser $SESS eval "
(function(){
  const btns = document.querySelectorAll('.ant-modal button');
  for(const b of btns){
    if(b.innerText.trim()==='确认'||b.innerText.trim()==='知道了') { b.click(); return 'CLICKED'; }
  }
  return 'NO_CONFIRM';
})()
"
sleep 6
# 验证 GONE
opencli browser $SESS eval "Array.from(document.querySelectorAll('tr.ant-table-row')).find(r=>r.innerText.includes('BILLID'))?'STILL':'GONE'"
```

**为什么与之前投流走 approve.mjs 失败的结论矛盾**：
- 旧失败样本是 `navigate.mjs bill` 拿不到详情页按钮（结构差异）
- 本次**直接在主页行内** click → 走的是统一行级路径，**与投流/报销/预算同一路径**，不依赖详情页结构
- 结论：**投流 主页行级 双步 与 普通报销相同**——只避 navigate.mjs/approve.mjs 的详情页路径

**操作路由**（2026-06-26 修正）：
- ✅ **走 opencli eval 主页行级 + 弹窗确认**（最快）
- ❌ 不要走 `approve.mjs`（100% BUTTON_NOT_FOUND）
- ❌ 不要走 `navigate.mjs bill <投流billId>`（结构差异也常 timeout）

## 🆕 Daemon 抖动时 navigate.mjs / review.mjs / approve.mjs 全部 timeout — 跳到 opencli eval（2026-06-26 实战）

**症状**：opencli bridge 反复 `connectivity test failed` / `extension not connected` 期间，**所有走 Playwright Page 的脚本**（navigate.mjs / review.mjs / approve.mjs）**全部 timeout 60-120s 无任何输出**。

**判定流程**：
1. `navigate.mjs` 超时 → 跑 `opencli doctor` 看 bridge 状态
2. `opencli daemon restart` 强制重连
3. 等 `connectivity: connected in 0.2s` 再继续
4. **如果 navigate.mjs / review.mjs 再次 timeout（>30s 无输出），立即停止 Playwright 路径**：
   - 改用 `opencli browser <s> eval` 直接在 tab 上拿数据
   - 详情展开：`opencli browser <s> open <detail_url> + sleep 7 + eval 提取 innerText`
   - 审批操作：行级 `eval` 点通过 + 弹窗确认（详见上方投流行级模式）

**禁止**：
- 不要对 navigate.mjs / approve.mjs 反复重试 timeout（已知根因=Playwright 桥接未稳）
- 不要在 Playwright 超时 + opencli 路径可用时，浪费 token 等 Playwright 恢复

## 🆕 预算行级 单步无弹窗（2026-06-26 实战）

**新观察**：李锦晶 ¥0 预算单 (billId 2026062665983384) 主页行级 click「通过」后**没有弹窗**，但 sleep 5 后 row 已 GONE。

**判定**：
- 预算单行级点击有时**直接生效**（与旧假设「双步需确认」不同）
- 流程：click → sleep 5 → 验证 GONE，无需确认
- 如果仍 STILL → 走「确认」弹窗兜底（兼容两种 UI 状态）

**反之**（2026-06-22 实战预算双步）：同一类预算单在某些状态下走「通过 → 确认」双步。本质上**主页行级 click 后看是否出现 `.ant-modal` 决定后续动作**：
- 有 modal → 点「确认」/「知道了」
- 无 modal → 验证 row 消失即可

## 🆕 主页行级审批的「权限」陷阱（2026-06-26 实测）

**症状**：opencli eval 主页行级 click「通过」→ 弹窗正常出现 → 点击「确认」/「知道了」后**审批未真生效**，反而出现「**操作异常-没有权限进行当前操作，请刷新后重试！**」错误弹窗。

**根因**：opencli tab 的 cookie/session 状态异常（虽然 `opencli doctor` 全绿），但缺少部分权限字段，**Playwright Page 路径走的是另一个 context，有完整权限**。

**判定**：
- 错误弹窗 `.ant-modal-confirm-btns button` 文本是「关闭」（不是「确认」/「知道了」）
- 内容含「操作异常」+「没有权限」字样
- 关闭弹窗后行级 row 仍存在（没批过）

**兜底**（已验证可用）：走 `approve.mjs <billId> agree "同意" --force --skip-preaudit` —— Playwright 独立 context + Vue 实例方法点击。

**禁止**：
- 不要重复点行级「通过」+ 弹窗「确认」——会无限循环假阳性
- 不要在错误弹窗后用 `open -a "Google Chrome"` 重新登录（session 仍有效，是 opencli context 权限问题）

## Dialog Confirmation Loop（bash 模式，2026-06-22 验证）

点击行级「通过」按钮后，弹窗可能堆叠。最稳的做法是用 bash 循环逐层点「确认」直到弹窗消失，同时追踪 `tr.ant-table-row` 数量变化：

```bash
for i in $(seq 1 10); do
  state=$(opencli browser SESS eval "
JSON.stringify({
  d: !!document.querySelector('.ant-modal'),
  r: document.querySelectorAll('tr.ant-table-row').length
})
" 2>&1 | grep -o '{.*}')

  echo "Round $i: $state"
  hasD=$(echo "$state" | python3 -c "import sys,json;print(json.load(sys.stdin)['d'])")
  if [ "$hasD" != "True" ]; then echo "DONE"; break; fi

  opencli browser SESS eval "
Array.from(document.querySelectorAll('button')).find(b=>b.innerText.trim()==='确认')?.click();'ok'
" 2>&1 | grep -v "Update"
  sleep 2
done
```

**关键点**：
- 每轮同时检查 `dialog` 和 `rows`，便于追踪审批进度
- `grep -o '{.*}'` 从 opencli 更新提示噪音中提取 JSON
- `eval` 用 IIFE 避免变量污染
- 预算单按钮含空格（`通 过`），需要额外的 `replace(/\\s+/g,'')` 匹配

## SPA Blank Recovery（2026-06-22 修正）

当 `opencli browser eval` 返回 `title:"智能费控·薪福通"` 但 `bodyLen:0` / `rows:0` 时，说明 SPA 框架未挂载（页面 frame 加载了但 Vue 组件未渲染）。URL 改写和 `location.reload()` 都救不了。

**恢复原则**：
- **普通审批主页** (`/#/form-app/approval`) → 用 `navigate.mjs homepage`（走 Playwright Page `page.goto()`）真渲染 SPA
- **预算单详情** (`/#/budget-app/budgetapprovaldetail?billId=...&viewType=APPROVE_PEND`) → 用 `opencli browser $SESS open <budget_url>` 直接打开，**不需要 `navigate.mjs`**，因为预算 URL 走的是 SPA 子路由（不依赖根组件完整挂载）

```bash
# 普通审批主页卡空白时
cd /path/to/cmb-xft-approval
node scripts/navigate.mjs homepage
# 之后 opencli browser SESS eval 即可读到 rows > 0

# 预算单卡空白时（注意：不要走 navigate.mjs bill，它不支持预算单）
SESS=gxs46xbg
opencli browser $SESS open "https://xft.cmbchina.com/TripMainWeb/#/budget-app/budgetapprovaldetail?billId=<ID>&viewType=APPROVE_PEND"
sleep 5
opencli browser $SESS eval "Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('通') && b.innerText.includes('过'))?.click()"
# 后续点确认
```

**为什么预算单能直接 opencli open**（与主页相反）：2026-06-22 实测，吴秋霞 ¥0 预算场景下：
- `navigate.mjs homepage` 不渲染预算详情（navigate.mjs bill 显式不支持预算单）
- `opencli open <budget_url>` 成功（location.href 含 budgetapprovaldetail，按钮列表能 eval 到「通 过」+「否 决」）
- 根因：预算 URL 走的是 SPA 子路由（`/#/budget-app/...`），不依赖根 Vue 组件完整挂载；list 主页 URL（`/#/form-app/approval`）需要完整 nav history + 鉴权态才挂载
