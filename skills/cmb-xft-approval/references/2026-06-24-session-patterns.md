# 2026-06-24 实战模式记录

## 预算 ¥0 单：主页行级通过（无需详情页降级）

### 验证结论

预算 ¥0 单（subType=业务部门负责人）的「通过」按钮在主页审批列表 `/#/form-app/approval` 的行内即有，**不需要**跳转到 `/#/budget-app/budgetapprovaldetail` 详情页。

### 操作流程

```bash
# 1. 按钮文本带空格，用正则匹配，与详情页一致
# 2. 行内点击「通 过」后弹出 .ant-modal 对话框
# 3. 点「确认」→ toast「同意成功」→ row 消失
# 4. 总耗时约 8-10 秒/单（点通过 → sleep 4 → 确认 → sleep 4 → 回查）
```

### 与旧 skill 假设的差异

- 旧写「预算单仍需走详情页场景（主页行级通过路径不通时）」——但**本会话 4 条预算 ¥0 全部从主页行级成功通过**，无需跳详情页
- 旧写「¥0 预算单通过后列表不消除是预期」——本会话批完后 row 直接从 4→3 消除，没有残留
- 结论：**优先试主页行级，失败再降级详情页**

### 实战样本

| 单 | 申请人 | 按钮 | 弹窗 | 结果 |
|---:|--------|------|:----:|:----:|
| X2 | 黄张秋燕 ¥0 | 通 过（正则） | 确认 | ✅ row 消除 |
| X3 | 王孙锦 ¥0 | 通 过（正则） | 确认 | ✅ row 消除 |

---

## 投流费用申请单：opencli eval 行级通过

### 验证结论

投流费用申请单的 approve.mjs 路径 100% 返 `BUTTON_NOT_FOUND`（skill 已记录）。从主页行级用 `通过` 点击+弹窗 `确认` 可正常通过。

### 操作流程

与普通报销相同：行级找 `通过`（无空格）→ sleep 4 → 弹窗 `确认` → sleep 4 → row 消除。

### 实战样本

| 单 | 申请人 | 金额 | 弹窗 | 结果 |
|---:|--------|----:|:----:|:----:|
| X1 | 纪鹭伟 | ¥2,000 | 确认 | ✅ row 消除 |

---

## 供应商结算单：opencli eval 行级通过（未触发 toast 假阳性）

### 验证结论

本会话 5 条供应商结算单全部通过 opencli eval 行级点击成功，**未触发已知的 toast 假阳性**（toast 出现但 row 不消失）。

### 实战样本

| 单 | 申请人 | 金额 | 结果 |
|---:|--------|----:|:----:|
| X8 | 陈小香 | ¥10,548 | ✅ |
| X9 | 彭宁宁 | ¥15,325 | ✅ |
| X10 | 章梦佳 | ¥15,860.20 | ✅ |
| X2 | 彭宁宁（第二批） | ¥11,903.50 | ✅ |
| X1 | 黄靖玮（第二批） | ¥12,088.60 | ✅ |

### 提示

若出现 toast 假阳性（toast 出现但 row 持续不消失），走 `approve.mjs --force --skip-preaudit` 回退（skill 已有记录）。

---

## 通用审批 + 自定义长 remark 作上游沟通

### 场景

D1 叶龙 通用审批（三平台实名认证 ¥0），用户要求 approve 时 remark 写：
```
同意。情况属实，项目推进进度较快，小红书又是后置PO，作为特例突破公司流程，妥否，盼领导回复。
```

### 模式

remark 被用作**上游沟通载体**——通过审批流的 remark 字段向上级传递业务判断和请示，而不是仅作审批意见。

### 操作

```bash
dws oa approval approve --instance-id <iid> --task-id <tid> \
  --remark "同意。情况属实，项目推进进度较快，小红书又是后置PO，作为特例突破公司流程，妥否，盼领导回复。" -y
```

### 注意

- dws oa approval approve 的 `--remark` 参数支持长文本，未发现截断
- 用 `-y` 跳过二次确认
- 回查以 `success:true` + 列表消除为准

---

## 复合指令 remark 分组顺序（2026-06-24 实战验证）

### 指令

```
D1展开，23通过，D4通过，评论：附上BP的HC规划截图
```

### 执行顺序

1. **先批自定义 remark 的单**（D4 盘流恋 招聘需求，remark="附上BP的HC规划截图"）
2. **再批统一 remark 的单**（D2 傅怡情调休、D3 林燕玲加班，remark="同意"）
3. **最后展开**（D1 冯文盈 offer审批）

### 索引漂移

D4（原索引 4）先批移除后，D2（原 2）、D3（原 3）索引不变，安全。

### 统一 remark 批量命令

```bash
python3 /Volumes/SSD/.hermes/skills/openclaw-imports/dingtalk-approval-exec/scripts/fast_dws_approval.py approve --indices 2,3 --remark "同意"
```

---

## opencli eval 行级点击的 session 健康检查

### 实战观察

opencli tab 在 >5min 空闲后几乎必然死到 `about:blank`（本会话验证 3+ 次）。**在任何 opencli eval 操作前必须先做健康检查：**

```bash
ROWS=$(opencli browser cmb-nav eval "document.querySelectorAll('tr.ant-table-row').length" 2>&1 | tail -1)
if ! [[ "$ROWS" =~ ^[0-9]+$ ]] || [ "$ROWS" = "0" ]; then
  opencli browser cmb-nav open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"
  sleep 6
fi
```

### 恢复后验证

```bash
opencli browser cmb-nav eval "JSON.stringify({rows: document.querySelectorAll('tr.ant-table-row').length, hash: location.hash})"
# 应返 {"rows":N, "hash":"#/form-app/approval"} (N>0)
```

跳过 pre-check 直接开跑 → 必出 NO_ROW → 浪费一轮 → 每轮浪费 20-30s。
