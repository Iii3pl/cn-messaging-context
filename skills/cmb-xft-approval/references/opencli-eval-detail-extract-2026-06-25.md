# opencli eval 详情提取（2026-06-25 实战沉淀）

当 `navigate.mjs bill <billId>` 超时（>45s）或返回不完整时，可用 opencli eval 直接在详情页提取关键字段。

## 触发场景

- 供应商结算单（含较多附件/PDF 拖慢 navigate.mjs）
- 合同用印（含合同附件大文件）
- navigate.mjs bill 执行时间 > 45s 后需降级

## 实战样本

X6 方彦博 ¥3,748.75 供应商结算单（billId=2026062364806877）：
- `navigate.mjs bill` 45s timeout ×2
- opencli eval 详情页成功提取：金额合计 ¥3,748.75、审批链（审批中无需支付）、承担部门（中台组）

## 操作流程

```bash
# Step 1: 导航到 bill detail 页
opencli browser cmb-nav open "https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=<billId>&viewType=APPROVE_PEND"
sleep 8

# Step 2: 提取关键字段（合同/供应商/金额）
opencli browser cmb-nav eval "
(function(){
const t = document.body.innerText;
const lines = t.split('\n').filter(l => l.trim());
const idx = lines.findIndex(l => l.includes('合同名称') || l.includes('供应商'));
if(idx < 0) return 'NOT_FOUND';
return lines.slice(Math.max(0,idx-2), Math.min(lines.length, idx+25)).join(' | ');
})()
"

# Step 3: 提取金额
opencli browser cmb-nav eval "
(function(){
const t = document.body.innerText;
const lines = t.split('\n').filter(l => l.trim());
return lines.filter(l => l.includes('合计') || l.includes('金额(CNY)') || l.match(/^[\d,]+\.\d{2}$/)).slice(0,10).join(' || ');
})()
"

# Step 4: 提取审批链
opencli browser cmb-nav eval "
(function(){
const t = document.body.innerText;
const lines = t.split('\n').filter(l => l.trim());
const idx = lines.findIndex(l => l.includes('审批信息'));
if(idx < 0) return 'NOT_FOUND';
return lines.slice(idx, Math.min(lines.length, idx+15)).join(' | ');
})()
"

# Step 5: 提取分摊/承担部门
opencli browser cmb-nav eval "
(function(){
const t = document.body.innerText;
const lines = t.split('\n').filter(l => l.trim());
const idx = lines.findIndex(l => l.includes('承担部门') || l.includes('费用信息'));
if(idx < 0) return 'NOT_FOUND';
return lines.slice(idx, Math.min(lines.length, idx+10)).join(' | ');
})()
"
```

## ⚠️ navigate.mjs bill ok=true ≠ 字段完整（2026-06-26 X3 实战）

X3 陈小香 ¥10,547.32 云账户支付（billId=2026061863520959）：
- `navigate.mjs bill` 返 `ok:true`，但 `project/contractName/bankAccount` 全部空字符串
- `systemRemark/approvalChain` 也空
- **判定**：navigate.mjs 内部 SPA 解析抓到主字段（type/amount/subject/dept/allocations）就提前返 ok，但合同/收方等次要字段如果页面异步加载或正则未命中，不会重试
- **应对**：大额/复杂单（云账户 ¥1万+/跨部门分摊/无项目）走完下方"全量提取"流程，不要只信 `navigate.mjs bill` 的 ok

## ⚠️ opencli eval 单次大 JSON 容易 timeout（2026-06-26 X3 实战）

```js
// ❌ 一次抓所有字段（5+ key 拼接）→ 连续 30s timeout
eval "JSON.stringify({...all fields...})"
```

**拆成 3-4 次小 eval** 每次只抓一类字段：

```bash
# 1) 主字段（type/amount/subject/dept/project）
opencli browser <s> eval "
(function(){
  const t = document.body.innerText;
  return JSON.stringify({
    type: (t.match(/(云账户支付|员工日常报销单|差旅报销单|供应商结算单|合同用印|投流费用申请单|供应商预付款|预算)/)||[])[0],
    amount: (t.match(/金额合计[^0-9]*([\d,]+\.?\d*)/)||[])[1],
    subject: (t.match(/事项标题[：:]?\s*([^\n]+)/)||[])[1],
    dept: (t.match(/承担部门[：:]?\s*([^\n]+)/)||[])[1],
    project: (t.match(/单据项目[：:]?\s*([^\n]+)/)||[])[1]
  });
})()
"

# 2) 审批链（独立 eval，因为通常最长）
opencli browser <s> eval "
(function(){
  const t = document.body.innerText;
  const m = t.match(/审批信息[\s\S]+?(?=附件|相关单据|$)/);
  return m ? m[0].slice(0, 500) : 'NOT_FOUND';
})()
"

# 3) 合同/收方/预算
opencli browser <s> eval "
(function(){
  const t = document.body.innerText;
  return JSON.stringify({
    contract: (t.match(/(合同名称|合同编号|合同期限)[\s\S]{0,150}/)||[])[0],
    supplier: (t.match(/(收方|供应商|相对方)[\s\S]{0,150}/)||[])[0],
    budget: (t.match(/预算占用[\s\S]{0,300}/)||[])[0]
  });
})()
"
```

每次 eval < 8s 完成；如果某次 timeout 单独重试 1 次，不要合并重试。

## ⚠️ 连续 5+ 次 eval 后 bridge 可能卡死（2026-06-26 X3 实战）

X3 详情页连续 eval 5 次后，第 6 次起 `opencli browser <s> eval` 全部 timeout。`opencli doctor` 也 timeout。

**恢复**：
```bash
opencli daemon restart
sleep 8
opencli doctor  # 确认 extension connected
# eval 恢复
```

**预防**：
- 单个详情页 eval 不超过 4 次，5+ 必须停下导航回主页
- 不要在 about:blank 状态连续 eval → 必卡死
- 详见 SKILL.md「OpenCLI Bridge 断连恢复流程」

## 重要：完成后必须导航回审批列表

```bash
opencli browser cmb-nav open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
sleep 6
# 验证：
opencli browser cmb-nav eval "document.title + ' | rows=' + document.querySelectorAll('tr.ant-table-row').length + ' | hash=' + location.hash"
```
