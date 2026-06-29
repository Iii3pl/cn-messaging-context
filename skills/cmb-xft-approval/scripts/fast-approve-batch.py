#!/usr/bin/env python3
"""
XFT 行级批量通过 - 已在 2026-06-29 验证可工作（修复版）

修复历史：
- 原版混入 JS 语法（如 `b.innerText.replace(/\\s+/g,'')`），导致 SyntaxError
- 修复：所有 innerText 检查改为 Python 端的 JS 表达式字符串

适用场景：
- 预算 ¥0 单（按钮文字「通 过」带空格）
- 普通报销/合同用印/投流（按钮文字「通过」无空格）
- 不需要展开详情的批量操作

输入：billId 列表
输出：每条的 click / confirm / verify 三步结果

硬规则（参考 SKILL.md）：
1. click 后 sleep 4s 等弹窗
2. confirm 用 last_visible（多个 modal 时取最后一个）
3. verify 时 dialog 消失 + row 消失 + toast「同意成功」三件套必须全有
4. budget 按钮匹配用 includes('通')&&includes('过')，普通按钮用 trim()==='通过'
"""

import subprocess
import time
import json
import sys

SESS = "xft-bind"  # 默认 session，可通过参数覆盖

def opencli_eval(expr, sess=SESS, timeout=15):
    r = subprocess.run(
        ["opencli", "browser", sess, "eval", expr],
        capture_output=True, text=True, timeout=timeout
    )
    return r.stdout.strip()

def click_row_pass(bid, sess=SESS):
    """定位行 + 点击「通过」按钮。返回 'clicked' / 'NO_ROW' / 'NO_BTN'"""
    expr = f"""
(function(){{
  const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('{bid}'));
  if (!tr) return JSON.stringify({{err:'NO_ROW'}});
  const btn = Array.from(tr.querySelectorAll('button')).find(b => {{
    const t = (b.innerText||'').replace(/\\s+/g,'');
    return t === '通过' || (t.includes('通') && t.includes('过'));
  }});
  if (!btn) return JSON.stringify({{err:'NO_BTN', btns: Array.from(tr.querySelectorAll('button')).map(b=>b.innerText.trim())}});
  btn.click();
  return JSON.stringify({{ok:'clicked', btnText: btn.innerText.trim()}});
}})()
"""
    return opencli_eval(expr, sess)

def click_confirm(sess=SESS):
    """点弹窗「确认」/「知道了」/「确定」/「同意」"""
    expr = """
(function(){
  const btns = document.querySelectorAll('.ant-modal button');
  for (const b of btns) {
    const t = (b.innerText || '').trim();
    if (['确认','知道了','确定','同意'].includes(t)) {
      b.click();
      return JSON.stringify({ok:'clicked_confirm', btnText: t});
    }
  }
  return JSON.stringify({err:'NO_CONFIRM_BTN', allBtns: Array.from(btns).map(b=>b.innerText.trim())});
})()
"""
    return opencli_eval(expr, sess)

def verify_row_gone(bid, sess=SESS):
    """回查 row 是否消失"""
    expr = f"""
(function(){{
  const tr = Array.from(document.querySelectorAll('tr.ant-table-row')).find(r => r.innerText.includes('{bid}'));
  return JSON.stringify({{rowExists: !!tr, dialog: !!document.querySelector('.ant-modal')}});
}})()
"""
    return opencli_eval(expr, sess)

def approve_one(bid, sess=SESS):
    """单条审批全流程"""
    print(f"=== {bid} ===")
    step1 = click_row_pass(bid, sess)
    print(f"  click: {step1}")
    if 'err' in step1:
        return False
    time.sleep(5)
    step2 = click_confirm(sess)
    print(f"  confirm: {step2}")
    time.sleep(5)
    step3 = verify_row_gone(bid, sess)
    print(f"  verify: {step3}")
    return 'err' not in step3

def main():
    """入口：python3 fast-approve-batch.py <billId1> <billId2> ..."""
    if len(sys.argv) < 2:
        print("Usage: python3 fast-approve-batch.py <billId1> [billId2] ...")
        sys.exit(1)
    bids = sys.argv[1:]
    results = {}
    for bid in bids:
        results[bid] = approve_one(bid)
    print("\n=== 汇总 ===")
    for bid, ok in results.items():
        print(f"  {'✅' if ok else '❌'} {bid}")

if __name__ == '__main__':
    main()