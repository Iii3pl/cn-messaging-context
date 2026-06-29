/**
 * shared/opencli.mjs — Resolve the active OpenCLI package at runtime.
 *
 * The local PATH, npm global root, and Homebrew global package can drift apart.
 * Keep all XFT scripts on one resolver so OpenCLI upgrades do not require
 * editing every script import.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function tryExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

function packageRootFromOpencliBin() {
  const bin = tryExec('which', ['opencli']);
  if (!bin) return null;
  try {
    const real = realpathSync(bin);
    const marker = '/node_modules/@jackwener/opencli/';
    const idx = real.indexOf(marker);
    if (idx >= 0) return real.slice(0, idx + marker.length - 1);
    if (real.endsWith('/dist/src/main.js')) {
      return resolve(dirname(real), '../..');
    }
  } catch {
    return null;
  }
  return null;
}

function candidateRoots() {
  const npmRoot = tryExec('npm', ['root', '-g']);
  return unique([
    process.env.OPENCLI_MODULE_ROOT,
    npmRoot ? join(npmRoot, '@jackwener', 'opencli') : null,
    packageRootFromOpencliBin(),
    '/Volumes/SSD/.hermes/node/lib/node_modules/@jackwener/opencli',
    '/opt/homebrew/lib/node_modules/@jackwener/opencli',
    '/Users/wuliang/.nvm/versions/node/v22.22.0/lib/node_modules/@jackwener/opencli',
  ]);
}

export function resolveOpencliRoot() {
  const roots = candidateRoots();
  for (const root of roots) {
    if (existsSync(join(root, 'dist', 'src', 'browser', 'page.js'))) {
      return root;
    }
  }
  throw new Error(`OPENCLI_MODULE_NOT_FOUND: checked ${roots.join(', ')}`);
}

export function getOpencliInfo() {
  const root = resolveOpencliRoot();
  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    version = pkg.version || version;
  } catch {
    // keep unknown
  }
  return { root, version };
}

export async function loadPageClass() {
  const root = resolveOpencliRoot();
  const mod = await import(pathToFileURL(join(root, 'dist', 'src', 'browser', 'page.js')).href);
  if (!mod.Page) throw new Error(`OPENCLI_PAGE_CLASS_NOT_FOUND: ${root}`);
  return mod.Page;
}

/**
 * Default window mode for XFT scripts.
 *
 * - 'background' (default): automation window stays in the background, user's
 *   foreground Chrome is never disturbed. This is what we want 99% of the time
 *   so approval runs don't steal focus.
 * - 'foreground': bring the automation window to front. Useful when the user
 *   needs to manually drag a slider / read a captcha.
 *
 * Override with:  OPENCLI_WINDOW=foreground node scripts/approve.mjs ...
 *                 or env var OPENCLI_XFT_WINDOW=foreground
 */
function getDefaultWindowMode() {
  if (process.env.OPENCLI_XFT_WINDOW === 'foreground') return 'foreground';
  if (process.env.OPENCLI_XFT_WINDOW === 'background') return 'background';
  // Honor the upstream opencli default too
  if (process.env.OPENCLI_WINDOW === 'foreground') return 'foreground';
  // Default to background for XFT — don't disturb user's foreground browser.
  return 'background';
}

/**
 * Create a new Page instance.
 *
 * @param {string} name - Session name (e.g. 'cmb-approve', 'cmb-nav', 'cmb-review')
 * @param {object} [opts]
 * @param {string} [opts.windowMode] - 'background' (default) or 'foreground'
 * @param {number} [opts.idleTimeout] - Tab lease idle timeout in ms (default 60000)
 * @returns {Promise<import('@jackwener/opencli').Page>}
 */
export async function createPage(name, opts = {}) {
  const Page = await loadPageClass();
  const windowMode = opts.windowMode || getDefaultWindowMode();
  const idleTimeout = opts.idleTimeout || 60000;
  return new Page(name, idleTimeout, undefined, windowMode);
}

export async function loadSendCommand() {
  const root = resolveOpencliRoot();
  const mod = await import(pathToFileURL(join(root, 'dist', 'src', 'browser', 'daemon-client.js')).href);
  if (!mod.sendCommand) throw new Error(`OPENCLI_SENDCOMMAND_NOT_FOUND: ${root}`);
  return mod.sendCommand;
}
