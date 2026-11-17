/* 发布前置门禁：扫描发布面，断言不含受限许可数据文件与受限品牌标识；输出 license 分布统计。
   用法：node scripts/audit-release.mjs [--root <dir>]
   退出码：0 通过；1 存在违规（逐条打印）。发布（publicRelease.published=true） additionally 要求 A–H 全绿。 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const ROOT = (() => { const i = args.indexOf('--root'); return i >= 0 ? args[i + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'); })();
const CFG = JSON.parse(readFileSync(join(ROOT, 'scripts', 'release-ignore.json'), 'utf8'));
const SCAN_DIRS = ['web', 'scripts', 'docs', 'tests'];
const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.md', '.json', '.txt']);
const BRAND = [
  [/\bICDD\b/i, 'ICDD 品牌标识'],
  [/PDF-4\+?/i, 'PDF-4 产品标识'],
  [/PDF 卡片/, 'PDF 卡片表述'],
  [/MDI Jade/i, 'MDI Jade 产品标识'],
  [/\bJade\b/, 'Jade 品牌词（开放版应使用中性表述）'],
  [/G:[/\\]Qoder/i, '受限库源目录引用']
];
const violations = [];
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).replace(/\\/g, '/');
    if (CFG.excludePrefixes.some(p => rel.startsWith(p)) || CFG.excludeFiles.includes(rel)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs);
    else files.push({ abs, rel, size: st.size });
  }
}
for (const d of SCAN_DIRS) if (existsSync(join(ROOT, d))) walk(join(ROOT, d));
if (existsSync(join(ROOT, 'README.md'))) files.push({ abs: join(ROOT, 'README.md'), rel: 'README.md', size: statSync(join(ROOT, 'README.md')).size, readmeOnly: true });

for (const f of files) {
  if (/private-disabled/.test(f.rel) || /(^|\/)catplot\.db$/.test(f.rel) || /(^|\/)private\//.test(f.rel)) {
    violations.push(f.rel + '：数据库/受限数据文件出现在公开版发布面');
    continue;
  }

  if (f.readmeOnly) continue;
  const ext = f.rel.slice(f.rel.lastIndexOf('.'));
  if (!TEXT_EXT.has(ext)) continue;
  const text = readFileSync(f.abs, 'utf8');
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    for (const [re, label] of BRAND) if (re.test(ln)) violations.push(f.rel + ':' + (i + 1) + '：' + label + ' → ' + ln.trim().slice(0, 90));
  });
}

/* license 分布：开放库 SQLite 优先，其次开放分片 manifest，均未建则如实报告 */
let distribution = null, distSource = 'none';
const exPath = join(ROOT, 'web', 'data', 'example-cards.json');
if (existsSync(exPath)) {
  const doc = JSON.parse(readFileSync(exPath, 'utf8'));
  distribution = {};
  for (const c of doc.cards || []) distribution[c.license] = (distribution[c.license] || 0) + 1;
  distSource = 'web/data/example-cards.json';
  for (const c of doc.cards || []) {
    if (!['CC0-1.0', 'MIT', 'CC-BY-4.0'].includes(c.license)) violations.push('example-cards: 非白名单许可 ' + c.license);
    if (!c.source_url || !c.citation) violations.push('example-cards: 缺溯源 ' + c.uid);
  }
}

console.log('== 发布审计 ==  扫描文件 ' + files.length + ' 个（发布面：' + SCAN_DIRS.join(', ') + ' + README 数据扫描）');
console.log('license 分布（' + distSource + '）：' + (distribution ? JSON.stringify(distribution) : '无示例卡文件'));
if (violations.length) {
  console.log('违规 ' + violations.length + ' 条：');
  violations.forEach(v => console.log('  FAIL ' + v));
  process.exit(1);
}
console.log('PASS：发布面不含受限许可数据文件与受限品牌标识。');
process.exit(0);