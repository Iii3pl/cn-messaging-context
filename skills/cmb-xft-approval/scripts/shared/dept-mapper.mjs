/**
 * shared/dept-mapper.mjs — 花名册 → 薪福通部门映射
 *
 * 动态通过 Python 读取花名册 Excel，生成薪福通部门名 → L2/L3/L4 映射表。
 * 花名册更新后自动跟随，无需手动维护字典。
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

const ROSTER_PATH = '/Volumes/运营中心-SU/小题 2026 年部门经营计划/10_人均权责分析/运营中心各部门花名册_20260125.xlsx';

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 通过 Python openpyxl 读取花名册，构建映射表
 */
function buildMap() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;

  if (!existsSync(ROSTER_PATH)) {
    _cache = new Map();
    _cacheTime = now;
    return _cache;
  }

  const py = `
import openpyxl, json, re, sys
wb = openpyxl.load_workbook('${ROSTER_PATH}', read_only=True)
ws = wb.active
headers = [c.value or '' for c in next(ws.iter_rows(min_row=1, max_row=1))]
col_l2 = headers.index('第二层部门') if '第二层部门' in headers else -1
col_l3 = headers.index('第三层部门') if '第三层部门' in headers else -1
col_l4 = headers.index('第四层部门') if '第四层部门' in headers else -1
if col_l2 < 0: sys.exit(1)

entries = []
seen = set()
for row in ws.iter_rows(min_row=2):
    l2 = str(row[col_l2].value or '').strip() if col_l2 < len(row) else ''
    l3 = str(row[col_l3].value or '').strip() if col_l3 >= 0 and col_l3 < len(row) else ''
    l4 = str(row[col_l4].value or '').strip() if col_l4 >= 0 and col_l4 < len(row) else ''
    if not l2: continue
    path = ' → '.join(filter(None, [l2, l3, l4]))
    # 去重
    key = path
    if key in seen: continue
    seen.add(key)
    entries.append({'l2':l2,'l3':l3,'l4':l4,'path':path})

# 构建映射键
mapping = []
for e in entries:
    keys = []
    if e['l3']: keys.append(e['l3'])
    if e['l4']: keys.append(e['l4'])
    # 提取 "X组" 短名
    m3 = re.search(r'([^a-zA-Z]+\\d+组)$', e['l3']) if e['l3'] else None
    if m3: keys.append(m3.group(1))
    m4 = re.search(r'([^a-zA-Z]+\\d+组)$', e['l4']) if e['l4'] else None
    if m4: keys.append(m4.group(1))
    mapping.append({'keys': list(set(keys)), 'l2': e['l2'], 'l3': e['l3'], 'l4': e['l4'], 'path': e['path']})

wb.close()
print(json.dumps(mapping, ensure_ascii=False))
`;
  try {
    const raw = execSync(`python3 -c "${py.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    if (!raw) return new Map();
    const entries = JSON.parse(raw);
    const map = new Map();
    for (const e of entries) {
      for (const key of e.keys) {
        if (!map.has(key)) map.set(key, e);
      }
    }
    _cache = map;
    _cacheTime = now;
    return map;
  } catch (err) {
    console.error('[dept-mapper] 花名册读取失败:', String(err.message || err).split('\n')[0]);
    _cache = new Map();
    _cacheTime = now;
    return _cache;
  }
}

/**
 * 从薪福通原始部门字符串解析 L2-L3-L4 路径
 */
export function resolveDept(rawDept) {
  if (!rawDept) return { l2: '', l3: '', l4: '', display: rawDept || '', source: 'empty' };

  const map = buildMap();
  if (map.size === 0) return { l2: '', l3: '', l4: '', display: rawDept, source: 'mapper_unavailable' };

  // Case 1: 完整路径（含 |）
  if (rawDept.includes('|')) {
    const parts = rawDept.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const l2 = parts[parts.length - 3] || '';
      const l3 = parts[parts.length - 2] || '';
      const l4 = parts[parts.length - 1] || '';
      return { l2, l3, l4, display: [l2, l3, l4].filter(Boolean).join(' → '), source: 'full_path' };
    }
  }

  // Case 2: ID-公司-组名 或 ID-组名
  const parts = rawDept.split('-');
  const lastPart = parts[parts.length - 1]?.trim();

  // 精确匹配
  if (map.has(lastPart)) {
    const e = map.get(lastPart);
    return { l2: e.l2, l3: e.l3, l4: e.l4, display: e.path, source: 'exact' };
  }

  // 模糊匹配
  for (const [key, entry] of map.entries()) {
    if (key.includes(lastPart) || lastPart.includes(key)) {
      return { l2: entry.l2, l3: entry.l3, l4: entry.l4, display: entry.path, source: 'fuzzy' };
    }
  }

  return { l2: '', l3: '', l4: '', display: rawDept, source: 'raw_fallback' };
}

export function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

export function mapperStats() {
  const map = buildMap();
  return { size: map.size, cached: !!_cache, rosterPath: ROSTER_PATH };
}
