# XFT 批量行级审批实战：4 单连续 click + 弹窗堆叠（2026-06-22）

## 触发场景

用户说"绿色的都通过"——批量处理 4-8 条小额报销（<¥500），每条都是普通报销类型。XFT 主页行级「通过」按钮**单步直接生效**（无弹窗），但批量点完后经常出现：
- 弹窗**堆叠**（4 条 click 后可能有 2-3 个 ant-modal 同时存在）
- 第二个 click 触发的弹窗「确认」按钮位置和第一个不同
- DOM 短暂重排导致行级"消失"误判

## 完整 batch 序列

```bash
SESSION=gxs46xbg  # 用户提供的已连接 session

# === Step 0: 验证 session 有效 ===
opencli browser $SESSION eval "document.title"
# → "智能费控·薪福通" 表示 session OK
# → "" 表示 session 死了，找用户要新 session

# === Step 1: 打开审批列表 ===
opencli browser $SESSION open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 3

# === Step 2: 提取所有 billId + 申请人 + 金额 + 类型 ===
opencli browser $SESSION eval "
Array.from(document.querySelectorAll('tr.ant-table-row')).map((tr, i) => {
  const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\\s+/g, ' ').trim());
  return (i+1) + '|' + (tds[1]||'') + '|' + (tds[3]||'') + '|' + (tds[4]||'') + '|' + (tds[5]||'');
}).join('\\n')
"
# 输出示例:
# 1|2026062163902166|CNY 39.00|员工日常报销单|林子彧
# 2|2026062163903004|CNY 300.00|员工日常报销单|林子彧
# 3|2026062163901450|CNY 200.00|员工日常报销单|林子彧
# 4|2026061963665552|CNY 3,500.00|员工备用金|王子昕
# ...

# === Step 3: 逐条点行级「通过」(IIFE 避免变量冲突) ===
for bid in 2026062163902166 2026062163903004 2026062163901450 2026062264053029; do
  opencli browser $SESSION eval "
(function(){
const tr=Array.from(document.querySelectorAll('tr.ant-table-row')).find(r=>r.innerText.includes('$bid'));
if(!tr)return 'ROW_NOT_FOUND';
const btn=Array.from(tr.querySelectorAll('button')).find(b=>b.innerText.trim()==='通过');
if(!btn)return 'BUTTON_NOT_FOUND';
btn.click();return 'CLICKED';
})()
"
  sleep 1.5  # 让 SPA 注册 click 事件
done

# === Step 4: 第一次确认（弹窗可能堆叠） ===
opencli browser $SESSION eval "
Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '确认')?.click();
'CONFIRMED'
"
sleep 4

# === Step 5: 循环确认直到无弹窗（关键！） ===
for i in 1 2 3 4 5; do
  state=$(opencli browser $SESSION eval "
JSON.stringify({
  dialog: !!document.querySelector('.ant-modal'),
  rows: document.querySelectorAll('tr.ant-table-row').length
})
" 2>/dev/null | grep -o '{.*}')
  echo "Round $i: $state"
  
  hasDialog=$(echo "$state" | python3 -c "import sys,json; print(json.load(sys.stdin)['dialog'])" 2>/dev/null)
  [ "$hasDialog" != "True" ] && { echo "No more dialogs!"; break; }
  
  opencli browser $SESSION eval "
Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '确认')?.click();
'ok'
"
  sleep 3
done
```

## 关键坑

1. **不能用同一个 `const bid = '...'` 串行 4 次 eval**——`bid` 变量会跨调用冲突，第二条起返 `SyntaxError: Identifier 'bid' has already been declared`。**必须 IIFE** `(function(){...})()` 包起来。

2. **第一次"确认"后弹窗还可能再出现 1-2 次**——SFA 渲染时序问题。**必须循环 check + 循环 click**。

3. **不要直接判定 `rows` 减少就报成功**——SPA 短暂重排会让 `tr.ant-table-row` 数量减少 1 但实际未批。**sleep 5s 后重新 navigate.mjs homepage** 才是权威。

4. **`opencli browser <s> open <url>` 不会真启动 SPA**——必须 sleep 3-5s 等 Vue 挂载。

5. **绿色 4 单 = ¥677.87 总金额 = 不大**——按用户偏好"绿灯通过"直接批。**但** ¥3,500 备用金（X4 王子昕）其实是黄色范围（¥500-5,000），**不要混进绿色全过**。

## 后续验证

```bash
# 1. 主页 rows 数
opencli browser $SESSION eval "document.querySelectorAll('tr.ant-table-row').length"
# → 12 (从 16 减 4)

# 2. SQLite 落地
sqlite3 /Users/wuliang/.hermes/data/cmb_approvals.db \
  "SELECT bill_id, applicant_name, amount, approved_at FROM approvals 
   WHERE approved_at > datetime('now','-1 hour') ORDER BY approved_at DESC;"
# → 应有 4 条新记录

# 3. navigate.mjs 回查 (权威)
node /Users/wuliang/.hermes/skills/openclaw-imports/cmb-xft-approval/scripts/navigate.mjs homepage
# → billId 列表不应再含 2026062163902166 / 2026062163903004 / 2026062163901450 / 2026062264053029
```

## 已知样本（2026-06-22）

| 申请人 | billId | 金额 | 命中位置 | 备注 |
|---|---|---:|---|---|
| 林子彧 | 2026062163902166 | ¥39 | X1 | 绿色 |
| 林子彧 | 2026062163903004 | ¥300 | X2 | 绿色 |
| 林子彧 | 2026062163901450 | ¥200 | X3 | 绿色 |
| 赵苏雯 | 2026062264053029 | ¥138.87 | X7 | 绿色 |

rows: 16 → 15 → 14 → 13 → 12 (4 步减少)
