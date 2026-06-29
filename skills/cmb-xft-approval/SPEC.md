# cmb-xft-approval 优化规格书

> 版本 v3  
> 日期 2026-05-02  
> 基于 v2 开发日志 + 钉钉生产执行日志

---

## 一、现状诊断

### 1.1 架构问题

```
当前:
  navigate.mjs ── 内联 extractBillInfo ──→ stdout JSON
  approve.mjs  ── 内联 extractBillInfo ──→ stdout JSON + SQLite
                    ↑ 完全重复
```

- 单据信息提取逻辑在 2 个文件里各写了一遍
- 登录态检测重复
- DB 操作只在 approve.mjs 里内联

### 1.2 生产 bug（从钉钉执行日志确认）

| # | Bug | 触发脚本 | 根因 |
|---|-----|---------|------|
| 🔴1 | 侧栏菜单 `<tr>` 被当成审批单 | navigate.mjs | `querySelectorAll('tr.ant-table-row')` 匹配了侧栏里的表格行，如「对公付款」「基础档案」菜单项也用 ant-table-row |
| 🔴2 | 审批按钮第一次找不到 | approve.mjs | 按钮在页面底部，进详情后没自动滚动，`querySelectorAll('button')` 扫描不到 |
| 🔴3 | Vue @click 不触发 | approve.mjs | `element.click()` + `MouseEvent dispatch` 对 Vue SPA 无效 |
| 🔴4 | 桥接断连 | 全部 | opencli daemon 与 Chrome 扩展失联 |

### 1.3 已知隐患（文档/代码注释记录）

| # | 隐患 | 触发场景 |
|---|------|---------|
| 🟡5 | SESSION_EXPIRED | Cookie 独立 + 30min 超时 |
| 🟡6 | textContent.replace(/\s+/g,'') 字段粘连 | 正则拆分失败 |
| 🟡7 | BILL_NOT_FOUND 不查 DB | 已处理的单被误报 |
| 🟡8 | INSERT OR REPLACE 静默覆盖 | 重复审批覆盖历史 |
| 🟢9 | 无分页支持 | 待审批超过一页漏看 |
| 🟢10 | 无审核摘要 | 审批前看不到结构化信息 |

---

## 二、目标架构

```
scripts/
├── shared/
│   ├── session.mjs      # 登录检测 + 首页导航 + 桥接自愈
│   ├── db.mjs           # SQLite 操作（建表/写入/查询）
│   └── extract.mjs      # 单据信息提取 + 审核规则
├── navigate.mjs         # 首页列表 + 详情（重构）
├── review.mjs           # 🆕 审核分析（不执行审批）
├── approve.mjs          # 审批执行（重构，内嵌 review）
└── health.mjs           # 桥接检查（不变）
```

数据流：

```
navigate.mjs homepage  → shared/extract → 待审批列表
navigate.mjs bill ID   → shared/extract → 单据详情
review.mjs ID          → shared/extract + shared/db → 审核摘要 + riskFlags
approve.mjs ID         → review（内置）→ 确认 → 点击按钮 → shared/db
```

---

## 三、模块设计

### 3.1 shared/session.mjs

**职责**：统一登录检测 + 首页导航 + 桥接自愈

**导出**：
```js
export const HOMEPAGE = 'https://xft.cmbchina.com/TripMainWeb/#/trip-app/homepage';
export async function ensureLoggedIn(page, { retries = 3 } = {}) → { title, text }
```

**逻辑**：
1. `page.goto(HOMEPAGE)`，`waitUntil: 'load'`，`settleMs: 3000`
2. 读 `document.title`
3. 如果 title 含「招商银行」且不含「智能费控」→ `SESSION_EXPIRED`
4. ⚠️ **auto-heal**：如果第 1 步抛 `fetch failed` / `DAEMON_UNREACHABLE`：
   - 执行 `opencli daemon stop`
   - `sleep 2000`
   - 重试（最多 retries 次）
   - 仍失败抛 `HEAL_FAILED`
5. 返回 `{ title, text: document.body.innerText }`

**使用方**：navigate.mjs、approve.mjs、review.mjs

---

### 3.2 shared/db.mjs

**职责**：SQLite 数据库操作

**导出**：
```js
export function openDb() → DatabaseSync
export function recordApproval(db, info) → void
export function findByBillId(db, billId) → record | null
```

**表结构**（不变）：
```sql
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id TEXT NOT NULL UNIQUE,
  bill_type TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  applicant_id TEXT,
  amount REAL,
  subject TEXT,
  department TEXT,
  project TEXT,
  company TEXT DEFAULT '厦门小题旅行科技有限公司',
  approved_at TEXT NOT NULL,
  approved_by TEXT DEFAULT '吴亮',
  action TEXT NOT NULL DEFAULT 'agree',
  remark TEXT,
  source TEXT DEFAULT 'cmb-xft',
  sync_dingtalk_todo INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

**recordApproval 改进**：
- 使用 `INSERT OR IGNORE`（非 `INSERT OR REPLACE`）
- 返回 `{ inserted: true/false }`，重复时返回 `{ duplicate: true, existing: ... }`

---

### 3.3 shared/extract.mjs

**职责**：单据信息提取 + 审核规则

**导出**：
```js
export async function parseHomepageBills(page) → { pending: number, bills: Array<Bill> }
export async function parseBillDetail(page, billId) → BillDetail
export function riskCheck(bill, dbRecord) → { risks: string[], suggestion: string }
```

**Bill 类型**：
```ts
interface Bill {
  type: string;        // 合同用印 / 员工日常报销单 / 差旅报销单 / ...
  applicant: string;   // 申请人姓名
  date: string;        // 提交日期 YYYY-MM-DD
  billId: string;      // 单号
  subject: string;     // 事由
  amount: string;      // 金额 CNY xxx
  // 详情扩展：
  department?: string;
  project?: string;
  wuLiangStatus?: string;
  invoiceCount?: number;
  invoiceDetail?: string[];
  otherApprovers?: string[];
}
```

---

## 四、Bug 修复方案

### 🔴1 侧栏污染 — 缩小选择器

**旧**：
```js
document.querySelectorAll('tr.ant-table-row')
```

**新**：只取主内容区
```js
// 方案 A：限定在有「待审批」标题的 card 内
const card = document.querySelector('.ant-card-body:has(h4:contains("待审批"))');
if (!card) return [];  // 降级
const rows = card.querySelectorAll('tr.ant-table-row');
```
> **降级策略**：如果 `.ant-card-body` 选择器找不到（页面结构变了），回退到 `document.querySelectorAll('tr.ant-table-row')` 但加类型过滤——行内容必须匹配 `合同用印|员工日常报销单|差旅报销单|...` 才计入。

**逐 td 提取**（替代 textContent 拼合）：
```js
const tds = row.querySelectorAll('td');
const type     = tds[0]?.textContent.trim() || '';
const appDate  = tds[1]?.textContent.trim();        // "李锦晶/2026-04-30"
const appParts = appDate.split('/');
const applicant = appParts[0]?.trim() || '';
const date     = appParts[1]?.trim() || '';
const billText = tds[2]?.textContent.trim() || '';  // "单号 2026043047396427"
const billId   = (billText.match(/单号\s*(\d+)/)||[])[1] || '';
const subject  = tds[3]?.textContent.trim() || '';
const amount   = tds[4]?.textContent.trim() || '';  // "金额 CNY 880.32"
```

### 🔴2 按钮找不到 — 自动滚动 + 等待渲染

approve.mjs 进详情页后：
```js
await page.scroll('down', 3000);  // 滚到底部按钮区
await sleep(1500);                // 等 Vue 渲染
// 然后再查找按钮
```

### 🔴3 Vue @click 不触发 — 多策略尝试

```js
async function clickApproveButton(page, action) {
  const label = action === 'agree' ? '通过' : '退回';

  // 策略 1：Vue 实例方法
  const vueResult = await page.evaluate(`
    (() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === '${label}' && b.offsetParent !== null) {
          // 尝试 Vue 2/3 实例
          const vm = b.__vue__ || b.__vue_app__;
          if (vm) {
            // Vue 2: vm.$emit('click'); Vue 3: vm.config.globalProperties
            if (vm.$emit) { vm.$emit('click'); return 'vue2-emit'; }
          }
          // 尝试 Vue 3 内部
          const vnode = b._vnode;
          if (vnode && vnode.props && vnode.props.onClick) {
            vnode.props.onClick(new MouseEvent('click'));
            return 'vue3-click';
          }
          return 'no-vue-instance';
        }
      }
      return 'button-not-found';
    })()
  `);

  if (vueResult === 'vue2-emit' || vueResult === 'vue3-click') return true;

  // 策略 2：原生事件组合
  await page.evaluate(`
    (() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === '${label}' && b.offsetParent !== null) {
          b.focus();
          b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true}));
          b.dispatchEvent(new MouseEvent('mouseup', {bubbles:true,cancelable:true}));
          b.click();
          return;
        }
      }
    })()
  `);

  return false;  // 不可靠，需双重验证
}
```

**双重验证**（点击后）：
```js
await sleep(2000);
const url = await page.evaluate('window.location.href');
const text = await page.evaluate('document.body.innerText');

const verified = 
  url.includes('homepage') ||           // 跳回首页 = 提交成功
  text.includes('已通过') ||            // 状态更新
  !text.includes('审批中');             // 节点完成

if (!verified) {
  return { 
    ok: false, 
    reason: 'CLICK_NOT_VERIFIED',
    action: '请手动在 Chrome 中点击「通过」按钮',
    billId,
    url 
  };
}
```

### 🔴4 桥接断连 — auto-heal

在 shared/session.mjs 的 `ensureLoggedIn` 中内置（见 3.1）。

### 🟡5 SESSION_EXPIRED — 统一检测

全部通过 `ensureLoggedIn` 处理，错误消息带操作指引：
```
"请手动在自动化窗口中登录薪福通：open 自动化窗口 → 访问 xft.cmbchina.com → 输入手机号+密码"
```

### 🟡7 BILL_NOT_FOUND — 先查 DB

```
approve.mjs 发现 bill 不在待审批列表时：
  1. 调用 findByBillId(billId)
  2. 在 DB 中 → 返回 { already_processed: true, record: {...} }
  3. 不在 DB → 返回 { error: 'BILL_NOT_FOUND', hint: '可能已从待审批列表移除，或单号错误' }
```

---

## 五、新增 review.mjs

### 5.1 命令行接口

```bash
node review.mjs BILL_ID              # 单笔审核
node review.mjs --batch              # 批量：全部待审批
node review.mjs --batch --type 合同用印  # 按类型筛选
```

### 5.2 单笔审核输出

```json
{
  "billId": "2026043047396427",
  "type": "员工日常报销单",
  "applicant": "李锦晶",
  "amount": 880.32,
  "subject": "Q1差旅报销",
  "department": "运营一部",
  "project": "阿里视频代运营",
  "_review": {
    "wuLiangStatus": "审批中",
    "otherApprovers": ["张三(已通过)", "李四(审批中)"],
    "invoiceCount": 3,
    "invoiceDetail": ["高铁票 CNY 520", "酒店 CNY 360.32"],
    "riskFlags": [],
    "suggestion": "金额小、部门匹配、发票齐全，建议通过"
  }
}
```

### 5.3 批量审核输出

```json
{
  "total": 8,
  "byType": { "合同用印": 3, "员工日常报销单": 5 },
  "totalAmount": 125000,
  "bills": [
    {
      "billId": "...",
      "type": "员工日常报销单",
      "applicant": "李锦晶",
      "amount": 880.32,
      "riskFlags": []
    },
    {
      "billId": "...",
      "type": "合同用印",
      "applicant": "王五",
      "amount": 50000,
      "riskFlags": ["金额>10000", "合同用印需核对条款"]
    }
  ],
  "_summary": "8笔待审批，合计CNY 125,000。其中1笔合同用印金额较大需重点审核。"
}
```

### 5.4 审核规则

| 规则 | 条件 | 风险标记 |
|------|------|---------|
| 大额 | 金额 > 10000 | `金额>10000，建议复核` |
| 超大额 | 金额 > 50000 | `金额>50000，需谨慎审批` |
| 合同用印 | 类型 = 合同用印 | `合同用印，请核对合同条款` |
| 跨部门 | 申请人与承担部门不同 | `跨部门报销` |
| 无项目 | 提取不到项目名 | `无项目归属` |
| 重复 | DB 已有同 billId | `已处理(DB)` |

**suggestion 生成策略**：
- 无 riskFlags → `建议通过`
- 仅「金额<10000 无异常」→ `建议通过`
- 含合同用印 → `建议核对合同后通过`
- 含大额/超大额 → `建议复核金额后通过`
- 含重复 → `已处理，无需重复审批`

---

## 六、重构 navigate.mjs

- 导入 `shared/session.mjs` → 统一 `ensureLoggedIn`
- 导入 `shared/extract.mjs` → `parseHomepageBills` / `parseBillDetail`
- 逐 td 提取 + 侧栏过滤（4.1）
- 新增 `--page N` 参数支持分页

### 分页逻辑
```
检测 .ant-pagination 元素
  存在 → 解析页码按钮，点击目标页
  不存在 / 只有 1 页 → 忽略
```

---

## 七、重构 approve.mjs

- 导入 `shared/session.mjs`、`shared/db.mjs`、`shared/extract.mjs`
- 审批前自动调 review 逻辑，输出摘要确认
- 自动滚动 + Vue 多策略点击（4.3）
- 双重验证点击是否生效（4.3）
- BILL_NOT_FOUND 时先查 DB（4.5）
- `INSERT OR IGNORE` 替代 `INSERT OR REPLACE`

### 输出格式（不变 + 扩展）
```json
{
  "ok": true,
  "action": "agree",
  "billId": "...",
  "type": "员工日常报销单",
  "applicant": "李锦晶",
  "amount": 880.32,
  "clickVerified": true,
  "dbSaved": true,
  "dingtalkSync": false,
  "dingtalkHint": "需手动同步钉钉待办"
}
```

---

## 八、不变项

- `health.mjs` — 不变
- 数据库路径 `/Users/wuliang/.hermes/data/cmb_approvals.db` — 不变
- 表结构 — 不变
- 命令行接口 — `navigate.mjs homepage|bill`、`approve.mjs BILL_ID` 保持兼容
- opencli v1.7.8 Page import 路径 — 不变

---

## 九、验收标准

| # | 检查项 | 通过条件 |
|---|--------|---------|
| 1 | 语法 | `node --check scripts/**/*.mjs` 全部通过 |
| 2 | 模块拆分 | navigate.mjs 和 approve.mjs 不再内联 extract 逻辑，统一从 shared/ 导入 |
| 3 | 侧栏污染 | 测试：包含侧栏菜单的页面，bills 数组不含「对公付款」「基础档案」 |
| 4 | 逐 td 提取 | 测试：至少 3 种单据类型的字段提取正确 |
| 5 | 按钮滚动 | approve.mjs 进详情页自动 scroll + 等待 |
| 6 | Vue 点击 | 多策略尝试 + 双重验证，失败时明确报告 |
| 7 | auto-heal | 桥接断连时自动 daemon stop + 重试 |
| 8 | BILL_NOT_FOUND 查 DB | 已处理单据返回 already_processed |
| 9 | INSERT OR IGNORE | 重复审批不覆盖 |
| 10 | 分页 | navigate.mjs --page 2 翻到第二页 |
| 11 | review.mjs | 单笔 + 批量输出正确 |
| 12 | SKILL.md | 反映新架构和调用方式 |

---

## 十、生产验证发现 (2026-05-02)

端到端实测 3 笔审批时发现以下问题，已全部修复：

### 10.1 详情页文本污染

**现象**：`parseBillDetail` 类型始终匹配「对公付款」，而非实际「员工日常报销单」。

**根因**：`document.body.innerText` 包含侧栏导航菜单项（对公付款、基础档案等），`text.match(/合同用印|...|对公付款/)` 优先命中侧栏的「对公付款」。

**修复**：移除「对公付款」「预算审批流程」从类型匹配正则。

### 10.2 金额匹配失败

**现象**：金额始终为 0。

**根因**：
1. 实际格式 `金额合计(CNY)\n324.50`（换行分隔），旧正则 `\s*` 跨行不匹配
2. **SPA 异步渲染**：点击行进入详情时，先渲染骨架（金额=0.00），500ms 后异步加载真实数据

**修复**：
1. 金额正则改为 `[\s\S]*?` 非贪婪跨行
2. 重试循环（20×500ms），等 `金额合计` 后数字 > 0 才认为页面就绪

### 10.3 DB Schema 迁移

**现象**：`recordApproval` 写入报错 `no column named sub_type`。

**根因**：`openDb()` 使用 `CREATE TABLE IF NOT EXISTS`，旧表不包含 v3 增强字段。

**修复**：`openDb()` 新增 `PRAGMA table_info` 检测 + `ALTER TABLE ADD COLUMN` 自动迁移。

### 10.4 审批提交但 DB 无记录

**现象**：点击审批成功，但 DB 写入失败导致无记录，二次执行 BILL_NOT_FOUND。

**修复**：DB 写入 try-catch → 降级核心字段重试 → 仍失败输出 manualFix SQL。

### 10.5 OpenCLI Bridge 断连

**现象**：`opencli doctor` 显示 `Extension: not connected`，daemon 正常运行。

**修复流程**：`opencli daemon stop` → Chrome 扩展关闭再打开 → `opencli doctor` 确认。

> 仅 `daemon stop` 不够——扩展处于崩溃状态，需手动重载。
