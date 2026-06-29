# 2026-06-22 批量审批实战踩坑汇总

本会话一次性处理 30+ 条审批（钉钉 OA + 薪福通混合），暴露 5 个实战陷阱，已 patch 到 SKILL.md 主体。本文档保留详细执行记录、错误样本、调试脚本，供未来会话溯源。

## 陷阱 1：X5/X8 同 billId 误判（用户直接纠正）

**会话上下文**：
- 第一轮批量：D2/D5/D7 + X1 = 4 单通过 ✅
- 第二轮批量：D1 熊怡然合同 / D2 陈阳加班 / X2 陈小香 16,152 / X4 吴秋霞 ¥0 预算 / X8 王子昕 5,000 = 5 单
  - 4 单正常 approve.mjs 通过，**X8 王子昕 5,000 走 approve.mjs 返回 `ok:true, dbSaved:true`**
  - 我汇报"D2 X1 X2 X3 X4 X5 全部通过"——**漏标 X8**（输出解析时因 JSON 多行拼接 `last_json = None`，误以为 parse err）
  - X4 (吴秋霞 ¥0 预算) 因 BUTTON_NOT_FOUND 走 opencli eval 兜底（点"通 过"+"确认"），但 DB 无记录

**第三轮用户问 "审批列表"**：
- 拉列表发现 X8 (2026061963666421) 仍在，X4 (2026061662744505) 已消
- 我立即 SQLite 回查：
  ```
  2026061963666421|王子昕|5000.0|agree|2026-06-22T06:30:02.903Z
  2026060960205316|陈小香|16152.0|agree|2026-06-22T06:28:41.299Z
  ```
- X2 (陈小香) DB 同意 + 列表已消 → 真过 ✅
- X8 (王子昕) DB 同意 + **列表仍含** → 两种可能：
  - **真情况 A**（吴亮节点已过，审批链后续财务/CFO 节点，列表不消除是预期）
  - **真情况 B**（脚本返回成功但实际点击未生效，DB 写入是 INSERT OR IGNORE 缓存命中假象）
- 我汇报"X8 实际已生效，X4 已生效但 DB 无记录（¥0 预算正常）"——**没有明确指出 X5/X8 billId 相同 = 缓存残留**

**第四轮用户给复合指令 "X2 4 展开"**：
- 用户指的 X2/X4 是上一轮的 X2 (陈小香 16,152 已过) / X4 (吴秋霞 ¥0 已过)
- 当次列表的 X2/X4 实际是 (叶龙 4,000) / (吴秋霞 ¥0 又出现，新流入)
- **我按位置索引盲批，把"已过"当成"展开"** ——用户立刻纠正"X2 4 上一轮已过"

**修复要点**（已写入 SKILL.md）：
- 复合指令必须**先拉列表 + SQLite 交叉验证**再执行
- 已过单 + 列表已消 → 跳过，告知"本会话已过"
- 已过单 + 列表仍含 → 优先 opencli eval 兜底（不依赖 approve.mjs）
- **任何"汇报已过"必须三重确认**：DB 写入 + 列表消除 + opencli eval row 检查

## 陷阱 2：approve.mjs 输出 JSON 截尾解析

**症状**：批量跑 approve.mjs 时，`out.splitlines()[-1]` 抓到的不是完整 JSON：
- `}]` —— 数组片段
- `null,` —— 字段分隔
- `}` —— 孤立闭合括号

**原因**：approve.mjs 输出 stdout 是**多 JSON 块拼接**：
1. 中间 `preaudit.checks[]` 块（含 status/severity/message 多个对象）
2. 末尾 `{"ok":true,"action":"agree","clickVerified":true,"dbSaved":true,"preaudit":{...}}` 块

每条 approve 输出 200-500 行 stdout，**最后一行 ≠ 末尾 JSON 块的最后一行**。

**修复算法**：
```python
def parse_approve_output(out):
    # 反向 brace-counting
    start = out.rfind('\n{\n')
    if start < 0:
        return None
    try:
        return json.loads(out[start+1:].strip())
    except json.JSONDecodeError:
        # 兜底：从末尾找 '{' 配对
        end = out.rstrip().rfind('}')
        if end < 0:
            return None
        # 反向找匹配的 '{'
        depth = 0
        for i in range(end, -1, -1):
            if out[i] == '}': depth += 1
            elif out[i] == '{':
                depth -= 1
                if depth == 0:
                    return json.loads(out[i:end+1])
        return None
```

**实战样本**（X4/X8 输出尾段）：
```
}
{
  "ok": false,
  "error": "BUTTON_NOT_FOUND",
  "billId": "2026061662744505",
  ...
}
```
最后一行 `}` 是 `preaudit.checks[]` 的闭合，不是主结果块的末尾。

## 陷阱 3：opencli tab vs Playwright Page 双 context 切换

**问题链**：
1. 第一轮跑 X1 (approve.mjs --force) → 走 Playwright Page
2. X1 成功后用户 X1/X2/X3 批量，发现 X3 (差旅报销 1,755.6) BUTTON_NOT_FOUND
3. 切 opencli eval 兜底
4. opencli tab 一直在 about:blank（从未加载薪福通 SPA）
5. `opencli browser <s> open <url>` 写完 URL 不 sleep → eval 报 0 rows

**修复流程**（已写入 SKILL.md）：
```bash
# 1. 写入 URL（注意：只写地址栏，Vue SPA 不会自动启动）
opencli browser gxs46xbg open "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"

# 2. 必须 sleep 等 SPA 挂载
sleep 6

# 3. 验证 URL 生效 + SPA 挂载
opencli browser gxs46xbg eval "location.href"  # 必须含 /form-app/approval
opencli browser gxs46xbg eval "document.querySelectorAll('tr.ant-table-row').length"  # > 0
```

**关键点**：
- `opencli doctor` 不报 bridge 断（gxs46xbg connected v1.0.20）→ 桥接 OK
- `self-heal.mjs` 报 session 正常（走 Playwright 检测，独立判定）→ session OK
- opencli tab about:blank 不等于 session 过期，**是 opencli tab 自身没加载 SPA**

**严禁**：
- `opencli browser <s> open <url>` 后立即 eval（无 sleep）
- `eval "location.reload()"`（SPA 未挂载时 reload 无效）
- 因 opencli tab about:blank 判定 session 过期（与 self-heal.mjs 结果冲突时，以 self-heal 为准）

## 陷阱 4：用户偏好 — 重复指令必须按身份匹配

**用户原话**（第四轮纠正）："X2 4 上一轮已过"——直接指出 Agent 按位置索引盲批。

**已写入 SKILL.md 主体**（"复合指令 + 列表漂移陷阱"章节）：

> 用户对"按位置盲批已过单"零容忍。复合指令（如"X2 4 展开"、"X1 2 4 通过"）必须先重新拉主页列表 → 按 billId / 申请人 / 类型 / 金额 身份匹配用户上一轮看到的目标 → 跳过已不在列表 / 已批过的单 → 对仍存在的目标执行。

**硬规则**：
1. 复合指令前**必须**重新拉 `navigate.mjs homepage` 拿当次 billId/申请人/类型
2. 对用户报的每个序号，SQLite 查 DB（`approved_at > datetime('now','-1 hour')`）
3. 命中 DB + 列表已消 → 跳过（已过）
4. 命中 DB + 列表仍含 → opencli eval 兜底重批
5. 未命中 DB + 列表含 → 走身份匹配，确认是用户指的那条
6. 未命中 DB + 列表不含 → 明确告知"该单已不在待审批列表"

## 陷阱 5：批量 timeout 切断

**症状**：terminal 默认 5min timeout，批量 5-8 条 approve.mjs 跑到第 5-6 条可能被切。

**实战**：第一轮 4 单 OK，第二轮 5 单跑 X4 时 tail -30 已显示部分 X3/X4 截尾输出，但 Python 脚本完整捕获了 stdout。

**对策**：
- 分批 5-8 条/批，批间 `sleep 1`
- 每批结束 `sqlite3 ... "SELECT COUNT(*) FROM approvals WHERE approved_at > datetime('now','-5 minutes')"` 验落地数
- 任何一条返 `BILL_NOT_FOUND` / `BUTTON_NOT_FOUND` → 报用户后等指令，**不**自动重试

## 调试脚本（可复用）

`/tmp/xft_pass3.py`（最终版三重判定）：
```python
import subprocess, json, sqlite3

SCRIPT_DIR = "/Users/wuliang/.hermes/skills/openclaw-imports/cmb-xft-approval"

def parse_approve_output(out):
    """反向 brace-counting 解析 approve.mjs 末尾 JSON"""
    start = out.rfind('\n{\n')
    if start < 0:
        return None
    try:
        return json.loads(out[start+1:].strip())
    except:
        end = out.rstrip().rfind('}')
        depth = 0
        for i in range(end, -1, -1):
            if out[i] == '}': depth += 1
            elif out[i] == '{':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(out[i:end+1])
                    except:
                        return None
        return None

# 跑批
for tag, bid, name, btype, amt in XFT:
    r = subprocess.run(["node", f"{SCRIPT_DIR}/scripts/approve.mjs", bid, "agree", "同意", "--force"],
                       capture_output=True, text=True, timeout=90)
    result = parse_approve_output(r.stdout)
    # result 可能为 None（parse err）→ 仍要回查 DB + list

# DB 回查（最权威）
conn = sqlite3.connect("/Users/wuliang/.hermes/data/cmb_approvals.db")
for tag, bid, *_ in XFT:
    row = conn.execute("SELECT action, approved_at FROM approvals WHERE bill_id=?", (bid,)).fetchone()
    # row = None → DB 未写；row = (action, ts) → DB 已写
conn.close()

# 列表回查（最直观）
r = subprocess.run(["node", f"{SCRIPT_DIR}/scripts/navigate.mjs", "homepage"],
                   capture_output=True, text=True, timeout=60)
d = json.loads(r.stdout)
bills_in_list = {b['billId'] for b in d.get('bills', [])}
# bills_in_list 不含 billId → 真过；含 → 可能是预算/幽灵/未生效
```

## OpenCLI eval 行级兜底脚本（X3/X4 等 BUTTON_NOT_FOUND 场景）

```python
import subprocess

SESSION = "gxs46xbg"

# 1. 加载 SPA
subprocess.run(["opencli", "browser", SESSION, "open",
                "https://xft.cmbchina.com/TripMainWeb/#/form-app/approval"],
               capture_output=True)
time.sleep(6)

# 2. 验证
r = subprocess.run(["opencli", "browser", SESSION, "eval",
                    "document.querySelectorAll('tr.ant-table-row').length"],
                   capture_output=True, text=True)
print(f"rows = {r.stdout.strip()}")  # 必须 > 0

# 3. 精确定位 row + 点按钮
def click_row_button(bill_id, button_text_contains=None, button_text_exact=None):
    if button_text_contains:
        # 预算 "通 过" 带空格
        js = f"""
        (function(){{
          const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('{bill_id}'));
          const btn = tr ? Array.from(tr.querySelectorAll('button')).find(b => b.innerText.includes('{button_text_contains[0]}') && b.innerText.includes('{button_text_contains[1]}')) : null;
          btn?.click();
          return btn ? 'clicked' : 'not found';
        }})()
        """
    else:
        js = f"""
        (function(){{
          const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('{bill_id}'));
          const btn = tr ? Array.from(tr.querySelectorAll('button')).find(b => b.innerText.trim() === '{button_text_exact}') : null;
          btn?.click();
          return btn ? 'clicked' : 'not found';
        }})()
        """
    r = subprocess.run(["opencli", "browser", SESSION, "eval", js],
                       capture_output=True, text=True)
    return r.stdout.strip()

# 4. 等弹窗 + 点确认
time.sleep(4)
r = subprocess.run(["opencli", "browser", SESSION, "eval",
                    "!!document.querySelector('.ant-modal')"],
                   capture_output=True, text=True)
print(f"modal = {r.stdout.strip()}")  # 必须是 true

# 5. 点确认
js = """
(function(){
  const btn = Array.from(document.querySelectorAll('.ant-modal button')).find(b => b.innerText.trim() === '确认');
  btn?.click();
  return btn ? 'clicked' : 'not found';
})()
"""
subprocess.run(["opencli", "browser", SESSION, "eval", js], capture_output=True)
time.sleep(4)

# 6. 三件套硬信号
r = subprocess.run(["opencli", "browser", SESSION, "eval",
                    "JSON.stringify({modal: !!document.querySelector('.ant-modal'), rows: document.querySelectorAll('tr.ant-table-row').length, toast: document.body.innerText.includes('同意成功')})"],
                   capture_output=True, text=True)
print(r.stdout.strip())  # 必须 modal=false + rows-1 + toast=true
```

## 关联文档

- SKILL.md "复合指令 + 列表漂移陷阱" 章节（用户偏好）
- SKILL.md "批量执行结果判定" 章节（三重判定算法）
- SKILL.md "opencli tab vs Playwright Page 双 context 切换" 章节
- 旧文档 `references/eval-batch-workflow.md`（2026-06-09 验证 46/47 兜底）—— 本次实战扩展
