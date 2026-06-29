#!/usr/bin/env node
// ghost-clear.mjs — 尝试通过 opencli CDP 硬刷新 XFT 审批页来清除幽灵单据
// 结论: 无效 (2026-06-06 验证)。幽灵是服务端数据一致性问题，客户端无解。
// 保留作为诊断脚本：输出 pendingBefore/pendingAfter 供判断。

import { execFileSync } from 'node:child_process';

// ⚠️ opencli 1.8.3 起 session 改为位置参数：opencli browser <session> <command>
// 运行前确认 profile: opencli profile list
const SESSION = process.env.OPENCLI_XFT_SESSION || 'uz3357c8';
const TARGET_URL = 'https://xft.cmbchina.com/TripMainWeb/#/form-app/approval';
const WAIT_TIMEOUT_MS = Number(process.env.GHOST_CLEAR_TIMEOUT_MS || 30000);
const POLL_MS = 1000;

function opencli(args, options = {}) {
  return execFileSync('opencli', ['browser', SESSION, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 15000,
  }).trim();
}

function evalInTab(tab, code, options = {}) {
  return opencli(['eval', '--tab', String(tab), code], options);
}

function listTabs() {
  return opencli(['tab', 'list']);
}

function parseJsonMaybe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function findXftTab(rawTabs) {
  const parsed = parseJsonMaybe(rawTabs);
  if (Array.isArray(parsed)) {
    const tab = parsed.find((item) => {
      const haystack = `${item.url || ''} ${item.title || ''}`.toLowerCase();
      return haystack.includes('xft.cmbchina.com') || haystack.includes('tripmainweb');
    }) || parsed[0];
    // opencli 1.8.3 returns 'page' field, not 'id'
    return tab?.page ?? tab?.id ?? tab?.tabId ?? tab?.targetId ?? tab?.index ?? tab?.name;
  }
  return null;
}

function extractCountFromEvalOutput(raw) {
  const parsed = parseJsonMaybe(raw);
  if (typeof parsed === 'number') return parsed;
  const match = raw.match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

function getPendingCount(tab) {
  const code = String.raw`
(() => {
  const labels = ['待审批','待我审批','待处理','待办','审批'];
  const candidates = [];
  function readNumber(value) {
    const match = String(value || '').match(/\d+/);
    return match ? Number(match[0]) : null;
  }
  for (const el of document.querySelectorAll('*')) {
    const text = (el.innerText || el.textContent || '').replace(/\s+/g,' ').trim();
    if (!text || text.length > 120) continue;
    const hasLabel = labels.some(l => text.includes(l));
    const n = readNumber(text);
    if (hasLabel && n !== null) candidates.push(n);
  }
  return candidates.length ? Math.max(...candidates) : 0;
})()`;
  return extractCountFromEvalOutput(evalInTab(tab, code, { timeout: 15000 }));
}

function waitForRenderAndCount(tab) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastCount = null;
  while (Date.now() < deadline) {
    const readyRaw = evalInTab(tab,
      'document.readyState + "|" + !!document.querySelector("#app, #root, .ant-spin, .adm-spin-loading, [class*=approval], [class*=Approval]")',
      { timeout: 10000 });
    const count = getPendingCount(tab);
    lastCount = count;
    if (readyRaw.includes('complete|true') || readyRaw.includes('interactive|true')) return count;
    const until = Date.now() + POLL_MS;
    while (Date.now() < until) { /* busy-wait */ }
  }
  return lastCount;
}

function run() {
  const rawTabs = listTabs();
  const targetTab = findXftTab(rawTabs);
  if (!targetTab) throw new Error('No XFT tab found in browser session ' + SESSION);

  const pendingBefore = getPendingCount(targetTab);
  evalInTab(targetTab, 'location.reload(true)', { timeout: 10000 });
  evalInTab(targetTab, 'sessionStorage.clear(); localStorage.clear();', { timeout: 10000 });
  opencli(['open', TARGET_URL], { timeout: 15000 });
  const pendingAfter = waitForRenderAndCount(targetTab);

  return { success: true, pendingBefore, pendingAfter, method: 'hard-reload+clear-storage+navigate' };
}

try {
  console.log(JSON.stringify(run()));
} catch (error) {
  console.log(JSON.stringify({
    success: false, pendingBefore: null, pendingAfter: null,
    method: 'hard-reload+clear-storage+navigate',
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
}
