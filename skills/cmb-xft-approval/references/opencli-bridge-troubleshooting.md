# OpenCLI Bridge 断连恢复流程

> 验证日期：2026-05-02
> 环境：macOS + Chrome + opencli v1.7.8

---

## 诊断

```bash
opencli doctor
```

正常输出：
```
[OK] Daemon: running on port 19825 (v1.7.8)
[OK] Extension: connected (v1.0.2)
[OK] Connectivity: connected in 0.2s
```

故障输出：
```
[OK] Daemon: running on port 19825 (v1.7.8)
[MISSING] Extension: not connected
[FAIL] Connectivity: failed (Browser Bridge extension not connected)
```

## 架构

```
opencli CLI → daemon (:19825) → Chrome Extension → Chrome Browser
```

Daemon 和扩展通过 WebSocket 通信。Daemon 可以自动重启，但扩展崩溃后不会自动恢复 WebSocket 连接。

## 恢复步骤

### Step 1: 停止 daemon

```bash
opencli daemon stop
```

### Step 2: 重载 Chrome 扩展

1. 打开 `chrome://extensions/`
2. 找到 **OpenCLI** 扩展
3. **关闭开关 → 再打开**（强制重连 WebSocket）

> 如果扩展消失：重新「加载已解压的扩展程序」，选择扩展目录。

### Step 3: 验证

```bash
opencli doctor
# 预期：[OK] Extension: connected
```

## 常见误区

- ❌ `opencli daemon stop && opencli doctor` — daemon 会 auto-start，但扩展仍断连，doctor 依旧报错
- ❌ 刷新 Chrome 页面 — 对 WebSocket 连接无效
- ✅ 必须重载扩展（关闭再打开）才能重建 WebSocket

## 预防

- 长时间未使用后，扩展可能因 Chrome 休眠而断连
- 每次审批会话前先跑 `opencli doctor` 确认连通性
- `ensureLoggedIn` 内置 3 次 auto-heal 重试，覆盖短暂断连
