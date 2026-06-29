/**
 * keepalive.mjs — 交互式 session keepalive
 * 不只 navigate，还会点击元素模拟真实操作，防止 XFT 判定为"长时间未操作"
 * 使用 OpenCLI daemon profile: tvrvbmjk
 */
import { createPage } from './shared/opencli.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PAGES = [
  'https://xft.cmbchina.com/TripMainWeb/#/trip-app/homepage',
  'https://xft.cmbchina.com/TripMainWeb/#/form-app/approval',
];

async function keepalive() {
  const page = await createPage('xft-keepalive');
  const url = PAGES[Math.floor(Math.random() * PAGES.length)];
  
  try {
    await page.goto(url, { waitUntil: 'load', settleMs: 5000 });
    await sleep(3000);
    
    // Check for session expired
    const title = await page.evaluate('document.title');
    if (title.includes('招商银行') && !title.includes('智能费控')) {
      console.error('[keepalive] Session expired — need manual re-login');
      return { ok: false, reason: 'SESSION_EXPIRED' };
    }
    
    // Simulate interaction: hover over first table row or menu item
    await page.evaluate(`(() => {
      // Try to click a non-destructive element
      const rows = document.querySelectorAll('tr.ant-table-row, .ant-menu-item, .nav-item');
      for (const el of rows) {
        if (el.offsetParent) {
          el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
          return;
        }
      }
      // Fallback: scroll page
      window.scrollBy(0, 50);
      setTimeout(() => window.scrollBy(0, -50), 1000);
    })()`);
    
    await sleep(1000);
    console.log(`[keepalive] ✅ Refreshed ${url} with interaction`);
    return { ok: true, url };
  } catch (e) {
    console.error(`[keepalive] ❌ ${e.message}`);
    return { ok: false, reason: e.message };
  }
}
keepalive().then(r => console.log(JSON.stringify(r)));
