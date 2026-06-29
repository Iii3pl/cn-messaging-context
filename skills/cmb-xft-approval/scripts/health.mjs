/**
 * 薪福通桥接健康检查 (opencli v1.7.8)
 * Usage: node health.mjs
 */
import { loadSendCommand } from './shared/opencli.mjs';

const MAX_RETRIES = 3;

async function main() {
  const sendCommand = await loadSendCommand();
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const result = await sendCommand('exec', { code: 'document.title', session: 'health', surface: 'browser' });
      if (result !== undefined && result !== null) {
        console.log(JSON.stringify({ ok: true, title: result, retries: i }));
        return;
      }
    } catch (err) {
      if (i < MAX_RETRIES - 1) {
        console.error(`Retry ${i+1}/${MAX_RETRIES}: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  console.log(JSON.stringify({ ok: false, reason: 'DAEMON_UNREACHABLE', fix: 'opencli daemon stop && 刷新Chrome扩展' }));
}

main();
