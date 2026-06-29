# cmb-xft-approval v4 规格书：完整字段提取

> 日期 2026-05-02
> 基于 #1 李思佳 ¥324.50 详情页实测数据

---

## 一、问题诊断

v3 的 `parseBillDetail` 直接从 `document.body.innerText` 用简单正则抓字段，缺陷：

| 缺陷 | 后果 |
|------|------|
| 只取第一个部门 | 丢掉了分摊1「改名了吗四组」 |
| 只取第一个项目 | 丢掉了备注里引用的 6 个项目 |
| 没有费用类别 | 「市内交通费(项目)」未收录 |
| 没有费用分摊结构 | 分摊金额、比例、承担部门/项目 全部丢失 |
| 申请人正则不通用 | 陈洁、何品郦的名字提取失败 |

### 李思佳单据的实际结构

```
费用类别：市内交通费(项目)
金额合计：CNY 324.50（税额 9.45，不含税 315.05，2 张发票）

分摊 1（28.54%）
  承担金额 CNY 92.60
  承担部门 919872092-改名了吗四组（运营中心 > 运营六部）
  承担项目 淘宝秒杀 b站4月代运营

分摊 2（71.46%）
  承担金额 CNY 231.90
  承担部门 911533138-规模2组
  承担项目 淘宝秒杀 b站4月代运营

事由备注引用项目：
  - 淘宝秒杀项目剪辑
  - 小度项目剪辑
  - 民生信用卡项目剪辑
  - 猫天天项目剪辑
  - ima项目剪辑
  → 另关联 ima官号代运营Q2 项目
```

---

## 二、v4 目标字段

### 2.1 逐 td 结构化提取（新方案）

不再全文正则，改为 DOM 查询 + 结构化解析：

```
费用信息区域（table 结构）：
  ├── 费用类别           → expense_category
  ├── 金额合计(CNY)      → amount_total
  ├── 税额(CNY)          → tax
  ├── 不含税金额(CNY)    → amount_pretax
  ├── 发票张数           → invoice_count
  ├── 发票金额(CNY)      → invoice_amount

分摊明细（每个分摊一行）：
  ├── 分摊 N
  │   ├── 承担金额(CNY)        → allocation.amount
  │   ├── 承担金额(不含税)      → allocation.amount_pretax
  │   ├── 承担税额              → allocation.tax
  │   ├── 承担比例              → allocation.ratio
  │   ├── 承担部门编号+路径     → allocation.dept_id, allocation.dept_path
  │   ├── 承担项目编号+路径     → allocation.project_id, allocation.project_path
  │   └── 备注                 → allocation.remark

单据信息：
  ├── 公司名称           → company
  ├── 承担部门（主）      → department (取第一个分摊的部门)
  ├── 事项标题           → subject
  ├── 事由备注           → remark_body (完整多行)
  └── 关联单据           → related_bills
```

### 2.2 审批链

```
审批信息区域：
  ├── 发起申请  [人]  已申请  [时间]
  ├── 一级部门审批  [审批方式]  [人]  [状态]  [时间]
  ├── ...
  └── 四级部门审批节点  吴亮  审批中
```

### 2.3 项目引用提取

从事由备注 + 分摊明细中提取所有项目引用：
- `project_refs` → 数组，去重

---

## 三、数据库变更

### 3.1 approvals 表新增字段

```sql
ALTER TABLE approvals ADD COLUMN expense_category TEXT;       -- 费用类别
ALTER TABLE approvals ADD COLUMN invoice_amount REAL;          -- 发票金额
ALTER TABLE approvals ADD COLUMN amount_pretax REAL;           -- 不含税金额
ALTER TABLE approvals ADD COLUMN tax REAL;                     -- 税额
ALTER TABLE approvals ADD COLUMN remark_body TEXT;             -- 事由备注全文
ALTER TABLE approvals ADD COLUMN allocations TEXT;             -- JSON: 分摊明细数组
ALTER TABLE approvals ADD COLUMN project_refs TEXT;            -- JSON: 所有引用项目
```

### 3.2 新增 allocations 表（可选，规范化）

```sql
CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id TEXT NOT NULL,
  seq INTEGER NOT NULL,               -- 分摊序号 1/2/...
  amount REAL,
  amount_pretax REAL,
  tax REAL,
  ratio REAL,                         -- 比例 e.g. 0.285362
  dept_id TEXT,
  dept_path TEXT,
  project_id TEXT,
  project_path TEXT,
  remark TEXT,
  FOREIGN KEY (bill_id) REFERENCES approvals(bill_id)
);
```

> 建议先用 JSON 列（`allocations TEXT`），避免多表 JOIN 复杂度。后续按需迁移。

---

## 四、解析策略

### 4.1 DOM 分区解析

薪福通详情页文本天然分区：

```
[单据详情]           ← 标题区
单据信息             ← 基本信息区
费用信息             ← 费用区（table）
审批信息             ← 审批链区
```

策略：按「费用信息」「审批信息」「分摊」等关键词切分 text，每区独立解析。

### 4.2 分摊明细解析

```
text.split(/分摊\d+/)
  → 每个片段包含：承担金额、承担部门、承担项目、备注
  → 解析为结构化 JSON
```

### 4.3 申请人提取增强

当前正则 `(\S+)\s*[-–]\s*(\d{6})\s*[-–]\s*\S+` 要求 6 位工号，但：
- 有的单据申请人格式不同（如直接在 label 行）
- 降级方案：从「单据信息」区找 `提单时间` 附近的姓名行

新增候选正则：
```
/(\S{2,4})\s*-\s*(\d{4,6})\s*-\s*厦门小题/
/申请人[：:]\s*(\S{2,4})/
```

### 4.4 项目引用去重

```
1. 分摊明细中的 project_path
2. 事由备注中匹配 /[A-Za-z]+平台?代运营[^\n]{5,80}/g
3. 合并去重 → project_refs[]
```

---

## 五、实施计划

### Phase 1：增强 extract.mjs（不改 DB schema）

- [ ] 优化申请人正则（修复陈洁/何品郦提取失败）
- [ ] 提取费用类别（expense_category）
- [ ] 提取分摊明细（allocations JSON）
- [ ] 提取事由备注全文（remark_body）
- [ ] 提取项目引用列表（project_refs）

### Phase 2：扩展 DB schema + db.mjs

- [ ] openDb() 自动迁移新增列
- [ ] recordApproval() 写入新字段

### Phase 3：更新输出格式

- [ ] review.mjs 单笔/批量展示分摊明细
- [ ] approve.mjs 摘要含完整字段

### Phase 4：文档更新

- [ ] SKILL.md 字段表
- [ ] GUIDE.md 解析说明
- [ ] SPEC.md 同步 v4

---

## 六、验收标准

| # | 检查项 | 通过条件 |
|---|--------|---------|
| 1 | 申请人 | 李思佳、陈洁、何品郦 均正确提取 |
| 2 | 费用类别 | 「市内交通费(项目)」正确 |
| 3 | 分摊明细 | 至少解析出 2 个分摊，字段完整 |
| 4 | 项目引用 | 包含淘宝秒杀、小度、民生、猫天天、ima |
| 5 | 事由备注 | 完整保留多行原文 |
| 6 | DB 写入 | 新字段无报错 |
| 7 | 向后兼容 | 旧审批记录不受影响 |
