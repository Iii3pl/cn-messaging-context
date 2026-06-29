# 评论/回复/意见提取 — 薪福通详情页 (2026-06-29 实战)

## 场景

用户问"看下是否回复了我的评论" / "展开评论" / "拉下评论记录"，需要从详情页提取完整的评论区内容（含用户、时间戳、@对象、正文）。

## 难点

1. **评论区位置不固定**：可能是 `.comment-list-item` / `.comment-item` / `[class*=comment]` / 也可能在 `.ant-modal` 弹窗中
2. **评论触发按钮易误点**：详情页上的"评论"标签可能是 `<div>` 而非 `<button>`，点击可能触发侧栏菜单（如"去预定"）而非评论弹窗
3. **`@用户名` 格式**：回复里用 `@陈小香` 形式，正则要捕获汉字 + 字母数字组合
4. **审批链和评论混合**：审批节点 + 评论时间戳格式相近，容易混淆

## 实战可用提取流程

### Step 1: 打开详情页

```bash
opencli browser <sess> open "https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=<bid>&viewType=APPROVE_PEND"
sleep 8
```

### Step 2: 抓全文搜索 @ 提及 + 评论文本

```bash
opencli browser <sess> eval "
(function(){
  const t = document.body.innerText || '';
  const atMatches = [...new Set([...t.matchAll(/@[\\u4e00-\\u9fa5\\w]{2,15}/g)].map(m=>m[0]))];
  const replyMatches = [...t.matchAll(/@[\\u4e00-\\u9fa5\\w]+[\\s\\S]{0,300}/g)].map(m=>m[0]);
  const cmtContainers = Array.from(document.querySelectorAll('div')).filter(d => /comment/i.test(d.className||'') && d.innerText.length > 20);
  const cmtTexts = cmtContainers.map(d => d.innerText.replace(/\\s+/g,' ').trim());
  return JSON.stringify({atMatches, replyMatches, cmtTexts}, null, 2);
})()
"
```

### Step 3: 抓人名+时间戳的对话节点

```bash
opencli browser <sess> eval "
(function(){
  const allText = document.body.innerText || '';
  const personTimeMatches = [...allText.matchAll(/[\\u4e00-\\u9fa5]{2,4}\\s+\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}[\\s\\S]{0,200}/g)].map(m=>m[0]);
  return JSON.stringify(personTimeMatches, null, 2);
})()
"
```

## 已验证样本 (2026-06-29)

### X2 陈小香 ¥10,547.32 云账户支付

```
{
  "atMatches": ["@陈小香"],
  "cmtTexts": [
    "吴亮 2026-06-26 21:59 @陈小香 这个是新的供应商吗？"
  ],
  "replyMatches": [
    "@陈小香 这个是新的供应商吗？\\n五级部门审批节点\\n审批人已自动转交\\n会签\\n..."
  ]
}
```

**结论**：只有吴亮一条评论，无任何回复。

### X1 汪培云 ¥1,678

```
{
  "atMatches": [],
  "cmtTexts": [],
  "replyMatches": []
}
```

**结论**：零评论。

### X3 陈小香 ¥20,042.76

```
{
  "atMatches": [],
  "cmtTexts": [],
  "replyMatches": []
}
```

**结论**：零评论。

## 注意事项

1. **不要点"评论"按钮触发弹窗**：详情页上的 `<div>评论</div>` 标签点击可能触发侧栏菜单（实测触发了"去预定"弹窗），污染提取结果。直接从 body.innerText 提取即可。
2. **审批链节点含"已通过/审批中"**：用 `([\\u4e00-\\u9fa5]{2,4})\\s+(已通过|审批中|已驳回|未开始|已完成)` 区分审批节点 vs 评论节点（评论节点是"用户 + 时间 + @内容"格式）
3. **"财智能体/用金核销"等非人类节点**：2026-06-29 X1 审批链出现"用金核销:审批中"、"财智能体:已通过"两个非人类节点，说明审批链解析要兼容 AI Agent 节点。详见 [审批链解析新节点.md](approval-chain-ai-nodes.md)

## 失败诊断

| 现象 | 原因 | 解决 |
|------|------|------|
| `atMatches: []` + `cmtTexts: []` | 真无评论 | 直接汇报"零评论" |
| 点击"评论"标签触发弹窗含"去预定" | 侧栏菜单干扰，不是真正的评论弹窗 | 关掉弹窗，直接读 body.innerText |
| `replyMatches` 含审批节点（如"@陈小香"后跟"五级部门审批节点"） | 评论和审批节点混合在同一文本中 | 截取到第一个 `@` 提及后的 50 字符作为评论内容 |
| `personTimeMatches` 空 | 评论用相对时间（如"3天前"）而非绝对时间戳 | 用 `@` 提及作为评论存在的标志 |