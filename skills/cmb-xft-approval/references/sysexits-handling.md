# Sysexits 退出码处理

薪福通 skill v4 起 `approve.mjs` / `navigate.mjs` / `review.mjs` 的 exit code 遵循 [sysexits.h](https://man.openbsd.org/sysexits) 语义（与 opencli 一致），agent 调用方应**优先看 exit code 决定路由**，parse JSON 拿细节。

## 退出码表

| Code | sysexits 常量 | 含义 | 触发场景 | Agent 动作 |
|---:|---|---|---|---|
| 0 | EX_OK | 成功 | 审批已生效 / DB 已有记录 | 报告成功 |
| 1 | EX_ERR | 通用错误 | BUTTON_NOT_FOUND / 未知异常 / 预审阻断 | 看 JSON.error 字段，提示用户 |
| 66 | EX_NO_DATA | 无数据 | 列表空 / 单据已处理 | 跳过，列下一条 |
| 75 | EX_TEMPFAIL | 临时失败 | 网络超时 / 页面未渲染 / HEAL_FAILED | 重试 1-2 次，仍失败再升级 |
| 77 | EX_NOPERM | 无权限 / 需认证 | SESSION_EXPIRED / 验证码 | 提示用户手动登录，**走 bind 模式** |
| 78 | EX_CONFIG | 配置错误 | 参数缺失 / 单号错误 / JSON 解析失败 | 立即停止，提示用户修正参数 |

## 优先级判断伪代码

```python
import subprocess, json

def run_approve(bill_id, force=False):
    cmd = ["node", "scripts/approve.mjs", bill_id]
    if force: cmd.append("--force")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    code = r.returncode

    # Fast-path by exit code
    if code == 0:
        return {"status": "ok", "raw": r.stdout}
    if code == 66:  # EX_NO_DATA
        return {"status": "skip", "reason": "already processed or not in list"}
    if code == 75:  # EX_TEMPFAIL
        return {"status": "retry", "reason": "transient failure"}
    if code == 77:  # EX_NOPERM
        return {"status": "auth_required", "reason": "session expired, need manual login"}
    if code == 78:  # EX_CONFIG
        return {"status": "config_error", "reason": "bad parameters"}

    # code == 1: 看 JSON.error 字段细判
    try:
        data = json.loads(r.stdout.splitlines()[-1])
    except Exception:
        return {"status": "unknown", "raw": r.stdout}

    err = data.get("error", "")
    if err == "PREAUDIT_BLOCKED":
        return {"status": "blocked", "data": data}  # 提示用户加 --force
    if err == "BUTTON_NOT_FOUND":
        return {"status": "page_drift", "data": data}  # 改走 opencli eval 兜底
    return {"status": "error", "data": data}
```

## 旧 vs 新对比

### 旧（字符串 grep）
```bash
out=$(node approve.mjs "$bill" 2>&1 | tail -1)
if echo "$out" | grep -q '"ok":true'; then ...   # 易碎
fi
```

**问题**：
- 多行 JSON 中 `"ok":false` 和 `"ok":true` 都在输出里，grep 抓错
- 业务错误（PREAUDIT_BLOCKED）跟运行时错误（DB 崩）都返 exit 1，没法 fast-path
- 用户说"批一下"时，agent 不知道是该重试还是该提示

### 新（exit code 优先）
```bash
node approve.mjs "$bill"
case $? in
  0)   echo "✅ 通过" ;;
  66)  echo "⏭️  跳过：已处理或不在列表" ;;
  75)  echo "🔄 重试 1 次..." ;;
  77)  echo "🔐 需要重新登录，提示用户走 bind 模式" ;;
  78)  echo "❌ 参数错误，停止" ;;
  1)   # parse JSON.error 字段细分
esac
```

## 配合 opencli sysexits

opencli 自身的 sysexits：
- 0 成功 / 66 无数据 / 69 Browser Bridge 未连接 / 75 超时 / 77 需认证 / 78 配置错误 / 130 Ctrl-C

xft skill 现在的 exit code 已经和 opencli **对齐 0/66/75/77/78**，只在 agent 业务判断的细节上用 exit 1 + JSON.error 区分。

## 受影响脚本

| 脚本 | 改动 |
|------|------|
| `scripts/approve.mjs` | 已加 EXIT 常量；BILL_NOT_FOUND → 78；SESSION_EXPIRED → 77；HEAL_FAILED → 75 |
| `scripts/navigate.mjs` | 后续 PR：pending=0 → 66 |
| `scripts/review.mjs` | 后续 PR：单据全空 → 66 |
