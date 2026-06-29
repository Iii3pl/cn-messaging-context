# 行级批量批准稳定模式（2026-06-26 实战整合）

经过 2026-06-26 多轮 14→10→7 条数据流批处理验证，`opencli eval` 路径的批量行级「通过」+ 弹窗确认已经收敛到一个稳定模式。本节把分散在多处章节的规则整合成一份可复用脚本。

## 1. 通用 batch 函数

```bash
# 通用行级通过 + 弹窗确认函数
# 用法：approve_row <session> <billId> [remark]
approve_row() {
  local SESS=$1
  local BID=$2
  local REMARK=${3:-"同意"}

  # 1. 点行内「通过」（按 billId 精确匹配行）
  opencli browser $SESS eval "
    (function(){
      const tr = Array.from(document.querySelectorAll('tr.ant-table-row'))
        .find(r => r.innerText.includes('$BID'));
      if(!tr) return 'NO_ROW';
      const btn = Array.from(tr.querySelectorAll('button')).find(b => {
        const t = b.innerText.replace(/\\s+/g,'');
        return t==='通过' || (t.includes('通')&&t.includes('过'));
      });
      if(!btn) return 'BTN_NOT_FOUND';
      btn.click();
      return 'CLICKED';
    })()
  " 2>&1 | tail -1

  sleep 5  # 等弹窗出现

  # 2. 找确认按钮（兼容「确认」/「知道了」两种变种）
  opencli browser $SESS eval "
    (function(){
      const btns = document.querySelectorAll('.ant-modal button');
      for(const b of btns){
        if(['确认','知道了'].includes(b.innerText.trim())) {
          b.click();
          return 'CLICKED_CONFIRM';
        }
      }
      return 'NO_CONFIRM_BTN';
    })()
  " 2>&1 | tail -1

  sleep 5  # 等 row 真正消除

  # 3. 回查 row 是否消失
  opencli browser $SESS eval "
    Array.from(document.querySelectorAll('tr.ant-table-row'))
      .find(r => r.innerText.includes('$BID')) ? 'STILL' : 'GONE'
  " 2>&1 | tail -1
}
```

## 2. 批量调用

```bash
SESS=gxs46xbg
for bid in 2026061562212066 2026062465101006 2026062465032087 2026062364724951; do
  echo "=== $bid ==="
  approve_row $SESS $bid
done
```

实测产出（2026-06-26 X1/X2/X6/X7 朱瑛洁/张智衡/陈泽松/吴祝昱 4 条绿灯，¥690.08 / ¥527.07 / ¥627.90 / ¥828.50）：

```
=== 2026061562212066 ===
CLICKED
CLICKED_CONFIRM
GONE
=== 2026062465101006 ===
CLICKED
CLICKED_CONFIRM
GONE
=== 2026062465032087 ===
CLICKED
CLICKED_CONFIRM
GONE
=== 2026062364724951 ===
CLICKED
CLICKED_CONFIRM
GONE
```

4/4 全部一次 GONE，DB 写入由 `navigate.mjs` / 列表消除隐式确认（opencli 路径不写本地 SQLite，需用列表回查判断真批）。

## 3. 与现有章节的关系

- **按钮匹配规则**：用 `b.innerText.replace(/\s+/g,'').includes('通') && b.innerText.replace(/\s+/g,'').includes('过')` 兼容预算「通 过」和普通「通过」（参见「按钮文字空格坑」章节）
- **弹窗 confirm 匹配**：`['确认','知道了']` 合并兼容合同用印（2026-06-25 发现）和普通报销（2026-06-18+）两种弹窗变种（参见「知道了」弹窗替代「确认」弹窗章节）
- **双步时序**：点「通过」→ sleep 5s → 点「确认」→ sleep 5s → 回查 rows。**不要再尝试单步（无 dialog 直接消除）路径**——2026-06-26 已确认该模式不再出现（参见「统一双步确认弹窗回归」章节）
- **MouseEvent 降级**：当 `b.click()` 返成功但 row 仍 STILL 时，降级 `dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}))`（参见「Confirm 按钮 MouseEvent 降级」reference）

## 4. 失败诊断

| 回查结果 | 含义 | 下一步 |
|---------|------|--------|
| `GONE` | 真批成功 | 进入下一条 |
| `STILL` + 无 dialog | 4s 假阳性，sleep 3s 重查（参见「4s 假阳性」章节） |
| `STILL` + dialog 仍在 | 弹窗没消；检查 `dialog.text` 是否「操作异常-没有权限」（参见「权限错误弹窗陷阱」章节） |
| `STILL` + dialog 已消 | 真未生效；用 `approve.mjs --force --skip-preaudit` 兜底 |
| `NO_ROW` | SPA 还没渲染或 about:blank（参见「opencli tab about:blank 恢复」章节） |
| `BTN_NOT_FOUND` | 页面在错误 tab（`#trip-app/homepage` 而非 `#/form-app/approval`） |

## 5. 与 approve.mjs 路径的对照

| 维度 | opencli eval（行级） | approve.mjs（Playwright Page） |
|------|----------------------|--------------------------------|
| 速度 | ⚡ 快（每条 ~12s） | 🐢 慢（每条 ~30-60s） |
| DB 写入 | ❌ 不写本地 SQLite | ✅ 写本地 SQLite |
| 投流单 | 偶发权限错误需降级 | 稳定成功（6/26 验证 X2/X3 沈煜 ¥1,980.20 / ¥9,900.99） |
| 预审 | 跳过 | 跑 `review.mjs` 全套 |
| 幽灵单据 | 可救活 | BUTTON_NOT_FOUND |
| 预算 ¥0 | 双步走通 | BUTTON_NOT_FOUND（按钮带空格） |

**优先 opencli eval 路径**（速度优势显著）。仅当遇到「操作异常-没有权限」弹窗或反复 STILL 时降级 approve.mjs。
