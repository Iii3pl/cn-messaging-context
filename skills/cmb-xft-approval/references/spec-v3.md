# cmb-xft-approval 优化规格书 v3

> 日期 2026-05-02 | 基于 v2 开发日志 + 钉钉生产执行日志

## 生产 bug（从钉钉执行日志确认）

| # | Bug | 根因 |
|---|-----|------|
| 🔴1 | 侧栏菜单 `<tr>` 被当成审批单 | `querySelectorAll('tr.ant-table-row')` 匹配了侧栏里的表格行 |
| 🔴2 | 审批按钮第一次找不到 | 按钮在页面底部，进详情后没自动滚动 |
| 🔴3 | Vue @click 不触发 | `element.click()` + `MouseEvent dispatch` 对 Vue SPA 无效 |
| 🔴4 | 桥接断连 | opencli daemon 与 Chrome 扩展失联 |

## Bug 修复方案

### 侧栏污染 → 缩小选择器
限定在有「待审批」标题的 card 内：`.ant-card-body .ant-table-row`
降级策略：如果选择器找不到，回退到全局但加类型过滤。

### 按钮找不到 → 自动滚动
进详情页后自动 `scroll('down', 3000)` + `sleep(1500)` 等 Vue 渲染。

### Vue @click → 多策略
策略 1：`button.__vue__.$emit('click')` 或 `button._vnode.props.onClick()`
策略 2：原生 MouseEvent dispatch
双重验证：URL 变化 + 页面文本变化

### 桥接断连 → auto-heal
`ensureLoggedIn` 内置 `opencli daemon stop` + 3 次重试。

## 目标架构

```
scripts/
├── shared/
│   ├── session.mjs      # 登录检测 + 首页导航 + 桥接自愈
│   ├── db.mjs           # SQLite 操作
│   └── extract.mjs      # 单据信息提取 + 审核规则
├── navigate.mjs         # 首页列表 + 详情（重构）
├── review.mjs           # 🆕 审核分析
├── approve.mjs          # 审批执行（重构）
└── health.mjs           # 不变
```

## 审核能力（review.mjs）

- `node review.mjs BILL_ID` — 单笔审核
- `node review.mjs --batch` — 批量审核
- 6 条审核规则：大额(>10000)、超大额(>50000)、合同用印、跨部门、无项目、重复

## 验收标准（12 条）

1. 语法检查通过
2. 模块拆分：navigate/approve 不内联 extract
3. 侧栏污染修复
4. 逐 td 提取正确
5. 自动滚动
6. Vue 多策略点击 + 双重验证
7. auto-heal
8. BILL_NOT_FOUND 查 DB
9. INSERT OR IGNORE
10. 分页支持
11. review.mjs 输出正确
12. SKILL.md 更新
