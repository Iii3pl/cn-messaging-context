# MouseEvent dispatch for stubborn confirm dialogs

## Problem

In certain XFT dialogs, `btn.click()` (the DOM method) does not trigger the Vue event system. The button appears clickable (not disabled), `btn.click()` returns without error, but no submission happens — the dialog stays open, the row does not disappear, and no toast appears.

## Root cause

薪福通's Vue 2 event handlers are bound to `v-on:click` / `@click`, which listens for native MouseEvents **dispatched on the element**, not synthetic click() calls. `btn.click()` is a DOM Level 2 convenience method that dispatches a `click` event with default properties — but Vue sometimes requires a full `MouseEvent` with `bubbles: true` and `view: window` for the handler chain to fire correctly.

## Verified fix

```javascript
btn.dispatchEvent(new MouseEvent('click', {
  bubbles: true,
  cancelable: true,
  view: window
}));
```

## When to use

1. **Primary**: `btn.click()` is attempted first (in opencli eval or Playwright).  
2. **Fallback (this technique)**: after `btn.click()` succeeds (no exception) but:
   - Dialog stays open, AND
   - Row is still in list, AND
   - No `同意成功` toast appeared

## Sample (2026-06-26: 江灵星 ¥1,055.76 员工日常报销单)

```bash
# First attempt: btn.click() on 确认 button
# → Dialog still visible, row still in list (STILL_THERE)

# Second attempt: same btn, but dispatchEvent(MouseEvent)
eval_result=$(opencli browser $SESS eval "JSON.stringify((function(){
  const d=document.querySelector('.ant-modal');
  if(!d)return'NO_MODAL';
  const btn=Array.from(d.querySelectorAll('button'))
    .find(b=>b.innerText.trim()==='确认');
  if(!btn)return'BTN_NOT_FOUND';
  btn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
  return'MOUSE_CLICKED';
})())")
# → Dialog text still visible (residual), but row GONE → ✅
```

## Note: residual dialog

After `dispatchEvent` clears the row, the `.ant-modal` DOM element may remain visible — this is a stale / residual dialog that did not auto-close but no longer blocks the backend approval. The residual dialog text still shows "同意 + 确认" etc. **Ignore it** — confirm by checking the row is gone + toast appeared. Clicking `取消` closes the residual dialog cleanly.
