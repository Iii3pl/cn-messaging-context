/**
 * fast-approve.mjs — Row-level XFT approve path.
 *
 * This is for user-authorized "these billIds pass" batches. It avoids opening
 * each detail page: locate the bill row on the approval list, click the row's
 * approve button, drain any confirmation dialogs, then verify the row state.
 *
 * Safety: dry-run is the default. Real clicking requires --yes.
 *
 * Usage:
 *   node scripts/fast-approve.mjs --ids 202606...,202606... --dry-run
 *   node scripts/fast-approve.mjs --ids 202606...,202606... --yes
 */

import { ensureLoggedIn, APPROVAL_LIST } from './shared/session.mjs';
import { createPage, getOpencliInfo } from './shared/opencli.mjs';
import { openDb, findByBillId, recordApproval } from './shared/db.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs(argv) {
  const out = {
    ids: [],
    yes: false,
    dryRun: false,
    session: 'cmb-fast-approve',
    record: true,
    confirmLoops: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ids') {
      out.ids.push(...String(argv[++i] || '').split(','));
    } else if (arg === '--yes') {
      out.yes = true;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--session') {
      out.session = argv[++i] || out.session;
    } else if (arg === '--no-record') {
      out.record = false;
    } else if (arg === '--confirm-loops') {
      out.confirmLoops = Number(argv[++i] || out.confirmLoops);
    } else if (/^\d{10,}$/.test(arg)) {
      out.ids.push(arg);
    }
  }
  out.ids = [...new Set(out.ids.map(s => String(s).trim()).filter(Boolean))];
  out.dryRun = out.dryRun || !out.yes;
  return out;
}

function parseAmount(value) {
  const n = String(value || '').replace(/[^\d.-]/g, '');
  return n ? Number(n) : null;
}

async function readRows(page) {
  return page.evaluate(`
    (() => Array.from(document.querySelectorAll('tr.ant-table-row')).map((tr, i) => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').replace(/\\s+/g, ' ').trim());
      const buttons = Array.from(tr.querySelectorAll('button')).map(b => (b.innerText || '').replace(/\\s+/g, '').trim()).filter(Boolean);
      return {
        index: i + 1,
        billId: tds[1] || '',
        subject: tds[2] || '',
        amountText: tds[3] || '',
        type: tds[4] || '',
        applicant: tds[5] || '',
        buttons,
      };
    }))()
  `);
}

async function waitForRows(page, { attempts = 10, intervalMs = 1000 } = {}) {
  let rows = [];
  for (let i = 0; i < attempts; i++) {
    rows = await readRows(page);
    if (rows.length > 0) return rows;
    await sleep(intervalMs);
  }
  return rows;
}

function rowById(rows, billId) {
  return rows.find(r => r.billId === billId || String(r.billId || '').includes(billId)) || null;
}

async function clickRowApprove(page, billId) {
  return page.evaluate(`
    (() => {
      const bid = ${JSON.stringify(billId)};
      const norm = s => (s || '').replace(/\\s/g, '');
      const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const rows = Array.from(document.querySelectorAll('tr.ant-table-row'));
      const row = rows.find(r => (r.innerText || '').includes(bid));
      if (!row) return { ok: false, status: 'ROW_NOT_FOUND' };
      row.scrollIntoView({ block: 'center' });
      const buttons = Array.from(row.querySelectorAll('button')).filter(visible);
      const button = buttons.find(b => {
        const text = norm(b.innerText);
        return text.includes('通过') || (text.includes('通') && text.includes('过'));
      });
      if (!button) {
        return {
          ok: false,
          status: 'BUTTON_NOT_FOUND',
          rowText: (row.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
          buttons: buttons.map(b => (b.innerText || '').trim()),
        };
      }
      button.click();
      return { ok: true, status: 'CLICKED', buttonText: (button.innerText || '').trim() };
    })()
  `);
}

async function confirmDialogs(page, loops) {
  const events = [];
  for (let i = 0; i < loops; i++) {
    const event = await page.evaluate(`
      (() => {
        const norm = s => (s || '').replace(/\\s/g, '');
        const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const dialog = !!document.querySelector('.ant-modal, .ant-popover');
        const buttons = Array.from(document.querySelectorAll('.ant-modal button, .ant-popover button, button'))
          .filter(visible)
          .filter(b => {
            const text = norm(b.innerText);
            return text === '同意' || text === '确认' || text === '确定';
          });
        if (!buttons.length) return { clicked: false, dialog };
        const button = buttons[buttons.length - 1];
        const text = (button.innerText || '').trim();
        button.click();
        return { clicked: true, dialog, text };
      })()
    `);
    events.push(event);
    if (!event.clicked && !event.dialog) break;
    await sleep(event.clicked ? 2500 : 1000);
  }
  return events;
}

async function inspectBillState(page, billId) {
  return page.evaluate(`
    (() => {
      const bid = ${JSON.stringify(billId)};
      const body = document.body ? document.body.innerText || '' : '';
      const rows = Array.from(document.querySelectorAll('tr.ant-table-row'));
      const present = rows.some(r => (r.innerText || '').includes(bid));
      return {
        present,
        rowCount: rows.length,
        dialog: !!document.querySelector('.ant-modal, .ant-popover'),
        successToast: body.includes('同意成功') || body.includes('操作成功') || body.includes('审批成功'),
        url: location.href,
      };
    })()
  `);
}

function usage() {
  return {
    error: 'Usage: node scripts/fast-approve.mjs --ids BILL_ID[,BILL_ID...] [--dry-run|--yes] [--session NAME] [--no-record]',
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.ids.length === 0) {
  console.log(JSON.stringify(usage(), null, 2));
  process.exit(1);
}
if (args.ids.length > 30) {
  console.log(JSON.stringify({ error: 'TOO_MANY_IDS', max: 30, count: args.ids.length }, null, 2));
  process.exit(1);
}

const db = openDb();
try {
  const page = await createPage(args.session);
  const opencli = getOpencliInfo();
  await ensureLoggedIn(page);
  await page.goto(APPROVAL_LIST, { waitUntil: 'load', settleMs: 3000 });

  const beforeRows = await waitForRows(page);
  const plan = args.ids.map(id => {
    const row = rowById(beforeRows, id);
    const existing = findByBillId(db, id);
    return {
      billId: id,
      found: !!row,
      alreadyRecorded: !!existing,
      row,
      action: row ? 'click row approve button' : 'skip',
    };
  });

  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      opencli,
      ids: args.ids,
      rowsVisible: beforeRows.length,
      plan,
      note: 'No approval buttons were clicked. Re-run with --yes to execute exactly these billIds.',
    }, null, 2));
    process.exit(plan.every(p => p.found) ? 0 : 2);
  }

  const results = [];
  for (const item of plan) {
    if (!item.found) {
      results.push({ billId: item.billId, ok: false, status: 'ROW_NOT_FOUND' });
      continue;
    }

    const click = await clickRowApprove(page, item.billId);
    await sleep(1500);
    const confirmations = await confirmDialogs(page, args.confirmLoops);
    await sleep(3500);
    const state = await inspectBillState(page, item.billId);

    const ok = click.ok && (!state.present || state.successToast);
    const result = {
      billId: item.billId,
      ok,
      status: ok ? (state.present ? 'TOAST_BUT_ROW_PRESENT' : 'ROW_GONE') : 'NOT_VERIFIED',
      click,
      confirmations,
      state,
      row: item.row,
    };

    if (ok && args.record) {
      try {
        const dbResult = recordApproval(db, {
          billId: item.billId,
          type: item.row.type || 'unknown',
          applicant: item.row.applicant || '',
          amount: parseAmount(item.row.amountText),
          subject: item.row.subject || '',
          action: 'agree',
          remark: '同意',
        });
        result.db = dbResult;
      } catch (err) {
        result.db = { inserted: false, error: err.message || String(err) };
      }
    }

    results.push(result);
  }

  console.log(JSON.stringify({
    ok: results.every(r => r.ok),
    dryRun: false,
    opencli,
    results,
    note: 'For final authority after real approvals, re-run navigate.mjs homepage and confirm the target billIds are gone or their Wu Liang node is passed.',
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message || String(err), stack: err.stack }, null, 2));
  process.exitCode = 1;
} finally {
  db.close();
}
