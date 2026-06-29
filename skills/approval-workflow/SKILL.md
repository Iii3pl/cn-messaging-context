---
name: approval-workflow
description: |
  统一的审批工作流 skill：支持钉钉 OA 审批和薪福通（CMB XFT）审批。
  当用户询问审批列表、待审批、审批详情、通过/拒绝审批时使用。
  触发词：我的审批列表、待审批、钉钉审批、薪福通审批、CMB审批、XFT审批、审批通过、同意审批、拒绝审批。
---

# 审批工作流 Skill

统一的审批处理入口，支持：
1. **钉钉 OA 审批** - 通过 DWS CLI 或 MCP 工具
2. **薪福通审批** - 通过 opencli 浏览器自动化

## 快速开始

### 查看待审批列表

```bash
# 钉钉 OA 审批
python3 ${HERMES_HOME}/skills/openclaw-imports/dingtalk-approval-exec/scripts/fast_dws_approval.py list

# 薪福通审批
node ${XFT_SKILL_HOME}/scripts/navigate.mjs homepage
```

### 执行审批

**钉钉 OA：**
```bash
# 通过指定审批
python3 ${HERMES_HOME}/skills/openclaw-imports/dingtalk-approval-exec/scripts/fast_dws_approval.py approve --indices 1 --remark "同意"
```

**薪福通：**
```bash
# 审核 + 执行
node ${XFT_SKILL_HOME}/scripts/review.mjs --batch
node ${XFT_SKILL_HOME}/scripts/approve.mjs <billId> agree "同意"
```

## 配置

### 环境变量

创建 `.env` 文件（参考 `.env.example`）：

```bash
# 钉钉配置
DINGTALK_USER_ID=your_user_id
DINGTALK_USER_NAME=your_name

# 薪福通配置
XFT_SESSION_NAME=your_opencli_session_name
XFT_DB_PATH=~/.hermes/data/cmb_approvals.db

# Hermes 主目录（可选，默认：~/.hermes）
HERMES_HOME=~/.hermes
```

### 钉钉审批配置

1. 安装 DWS CLI：`npm install -g @openclaw/dws`
2. 登录：`dws auth login`
3. 验证：`dws auth status`

### 薪福通审批配置

1. 安装 opencli：`npm install -g opencli`
2. 启动 daemon：`opencli daemon start`
3. 登录薪福通：在 Chrome 中访问 `https://xft.cmbchina.com` 并登录

## 使用指南

### 钉钉 OA 审批

#### 1. 查看待审批

```bash
python3 ${HERMES_HOME}/skills/openclaw-imports/dingtalk-approval-exec/scripts/fast_dws_approval.py list
```

输出示例：
```
Found 3 pending approvals:

#1 林虹提交的 offer审批（人力专用）
   Status: RUNNING
   Instance ID: 30ezX-bCSpiaKrd9ucfpqg05091782704486

#2 李馨月提交的付费软件或平台申请单
   Status: RUNNING
   Instance ID: jScxOnW3SmOJR2me-Bzenw05091782202422
```

#### 2. 执行审批

```bash
# 通过单条
python3 ${HERMES_HOME}/skills/openclaw-imports/dingtalk-approval-exec/scripts/fast_dws_approval.py approve --indices 1 --remark "同意"

# 批量通过
python3 ${HERMES_HOME}/skills/openclaw-imports/dingtalk-approval-exec/scripts/fast_dws_approval.py approve --all --remark "同意"
```

#### 3. 转交审批

```bash
# 先获取转交目标的用户 ID
dws contact user search --keyword "王玉晶"

# 转交
dws oa approval redirect-task --task-id <taskId> --to-actioner-id <userId> --remark "转交审批"
```

### 薪福通审批

#### 1. 查看待审批列表

```bash
node ${XFT_SKILL_HOME}/scripts/navigate.mjs homepage
```

#### 2. 审核分析

```bash
# 批量审核
node ${XFT_SKILL_HOME}/scripts/review.mjs --batch

# 单笔审核
node ${XFT_SKILL_HOME}/scripts/review.mjs <billId>
```

审核输出包含：
- 风险标记（riskFlags）
- 建议（suggestion）
- 审批链
- 发票明细
- 费用拆分

#### 3. 执行审批

```bash
# 详细模式（打开详情页）
node ${XFT_SKILL_HOME}/scripts/approve.mjs <billId> agree "同意"

# 快速模式（行级按钮，默认 dry-run）
node ${XFT_SKILL_HOME}/scripts/fast-approve.mjs --ids <billId> --dry-run

# 真实执行
node ${XFT_SKILL_HOME}/scripts/fast-approve.mjs --ids <billId> --yes
```

## 高级功能

### 钉钉审批

#### 审批安全规则

**执行前必须：**
1. 重新拉取当前列表（不使用缓存）
2. 定位用户的 taskId（`userId` + `taskStatus=RUNNING`）
3. 展示审批详情并获得用户明确授权

**禁止：**
- 批量盲批（必须逐条或用户明确授权）
- 使用缓存的 taskId
- 仅凭 `processInstanceResult=agree` 判定为可跳过

#### 已知问题处理

**DWS CLI 路径：**
- `dws oa approval detail` 可能返回 PARAM_ERROR（部分审批类型）
- 降级到 MCP 工具或 ts-node 脚本

**MCP 路径：**
- `get_processInstance_detail` 不返回 `activityId`
- 需要并行会签判定时，降级到 ts-node

### 薪福通审批

#### Session 自愈

```bash
# 健康检查
node ${XFT_SKILL_HOME}/scripts/health-check.mjs

# 自动自愈
node ${XFT_SKILL_HOME}/scripts/self-heal.mjs
```

#### 数据库查询

```bash
# 查看审批记录
sqlite3 ${XFT_DB_PATH} "SELECT * FROM approvals ORDER BY approved_at DESC LIMIT 20;"
```

## 故障排查

### 钉钉审批

**问题：** `list-pending` 返回 0 但页面有审批
**解决：** 
1. 检查 DWS auth：`dws auth status`
2. 交叉验证：`dws oa approval list-pending --format json`
3. 可能是接口盲区，建议用户在钉钉 App 处理

**问题：** `approve` 返回 `success=false`
**解决：**
1. 重新拉取详情，定位正确的 taskId
2. 检查是否为并行会签节点
3. 降级到 `dws oa approval approve --task-id <tid>`

### 薪福通审批

**问题：** `navigate.mjs` 返回 0 条
**解决：**
1. 检查 session：`opencli browser <session> eval "document.title"`
2. 如果 `about:blank`，重新打开页面
3. 运行自愈：`node scripts/self-heal.mjs`

**问题：** 审批点击后未生效
**解决：**
1. 检查是否需要两步确认（通过 → 确认）
2. 验证 DB 记录：`sqlite3 ${XFT_DB_PATH} "SELECT * FROM approvals WHERE bill_id='<id>'"`
3. 查看 `clickVerified` 字段

## 参考资料

- 钉钉审批详细文档：`references/dingtalk-approval.md`
- 薪福通审批详细文档：`cmb-xft-approval/SKILL.md`
- 故障排查：`references/troubleshooting.md`

## 贡献

欢迎提交 Issue 和 Pull Request！

提交前请确保：
1. 移除所有硬编码的个人路径
2. 使用环境变量或配置文件
3. 更新相关文档
