# 薪福通页面结构参考 v2（2026-05-02 实测）

## 登录页面
- URL: `https://xft.cmbchina.com/#/index`
- title: 工作台·薪福通
- 登录方式 tabs: 手机号登录 / 密码登录 / 短信验证码
- 密码登录 tab: `div[role=tab][id=rc-tabs-0-tab-password]`
- 手机输入: `input#passwordLogin_phone[placeholder=请输入手机号]`
- 密码输入: `input#passwordLogin_password[placeholder=请输入密码]`
- 登录按钮: 文本为「登录」的 div/button

## 工作台
- URL: `https://xft.cmbchina.com/#/workbench`
- title: 工作台·薪福通
- 智能费控入口: `div.FullApplication_item__3Ruc3`（textContent 含「智能费控」）

## 审批列表（新版）
- URL: `https://xft.cmbchina.com/TripMainWeb/#/form-app/approval`
- title: 智能费控·薪福通
- Tabs: 待审批 / 已审批 / 抄送我
- 表格: 31 列 `<tr class="ant-table-row ant-table-row-level-0">`

### 31列表格列序
| 列 | 内容 | 提取字段 |
|----|------|---------|
| td[0] | checkbox | - |
| td[1] | 单据编号 | billId |
| td[2] | 智能审核结果 | - |
| td[3] | 金额 (CNY xxx) | amount |
| td[4] | 单据类型 | type |
| td[5] | 申请人 | applicant |
| td[6] | 供应商 | supplier |
| td[7] | 是否代理审批 | - |
| td[8] | 企业实付金额 | - |
| ... | (共 31 列) | - |

### 分页
- 元素：`.ant-pagination`
- 页码按钮：`.ant-pagination-item`

## 单据详情
- URL: `https://xft.cmbchina.com/TripMainWeb/#/trip-app/billDetail?billId=XXX&viewType=APPROVE_PEND...`
- title: 智能费控·薪福通

### 申请人格式（新）
```
施璐璐 - 000806 - 厦门小题旅行科技有限公司
```
正则可匹配空格+短横格式。

### 审批信息格式（新）
```
审批信息
发起申请 施璐璐 已申请 2026/04/30 15:11:35
一级部门审批 会签 黄少莹 已通过 2026/04/30 15:12:02
二级部门审批节点 会签 关晶 已通过 2026/04/30 22:18:21
四级部门审批节点 会签 吴亮 审批中
财务初审 会签 卢静谊
```
正则：`/^(\S+(?:审批节点|部门审批|发起申请)?)\s+(?:会签|依次审批|或签)?\s*(\S+)\s+(已通过|审批中|已拒绝|已申请|待审批)/`

### 费用明细格式（新）
```
费用信息
金额合计(CNY) 880.32
发票张数 12
...
服装道具(项目)新 分摊 325.71 部分报销 325.71 0.00 已关联5张发票
市内交通费(项目)新 分摊 23.60 22.91 0.69 已关联1张发票
```
正则：`/(.+?)新\s+分摊\s+([\d,.]+).*?已关联(\d+)张发票/`

### 审批按钮（⚠️ 关键）
```
底部操作区：
  通过  ← button.ant-btn.ant-btn-primary (ref:191)
  退回  ← button.ant-btn.ant-btn-default.ant-btn-dangerous
  评论
  转派
  更多

确认区：
  同意/确认  ← button.ant-btn.ant-btn-primary.guideStepOperateOkButton (ref:285)
  取消      ← button.ant-btn.ant-btn-default (ref:284)
  常用语
  上传图片
  上传附件
  取消确认
```

两步提交：点击「通过」（ref:191）→ 点击「确认」（ref:285）
只点「通过」不会提交。点击 `<button>` 本身，不能点内部 `<span>`。
`element.click()` 在 `<button>` 上直接有效，不需要 Vue 特殊处理。

## opencli 命令速查

```bash
# 状态
opencli browser state                    # 页面元素树
opencli browser eval '...'               # 执行 JS
opencli browser click <ref>              # 点击（按 ref）
opencli browser click '<css-selector>'   # 点击（按 CSS）
opencli browser type <ref> '<text>'      # 输入
opencli browser scroll down --amount 5000 # 滚动
opencli browser wait time 3              # 等待
opencli browser screenshot /tmp/x.png    # 截图
opencli browser open '<url>'             # 导航
opencli browser tab list                 # Tab 列表
opencli daemon stop                      # 修复断连

# 脚本
node scripts/health.mjs                  # 桥接健康检查
node scripts/navigate.mjs homepage       # 审批列表
node scripts/navigate.mjs bill <ID>      # 单据详情
node scripts/review.mjs <ID>             # 单笔审核
node scripts/review.mjs --batch          # 批量审核
node scripts/approve.mjs <ID> agree      # 执行审批
```
