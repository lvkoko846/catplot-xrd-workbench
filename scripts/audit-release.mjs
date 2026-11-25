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

let citationVersion = null;
const citationPath = join(ROOT, 'CITATION.cff');
if (!existsSync(citationPath)) violations.push('CITATION.cff：缺少引用元数据');
else {
  const citation = readFileSync(citationPath, 'utf8');
  for (const field of ['cff-version', 'title', 'type: software', 'repository-code', 'license: MIT', 'version']) {
    if (!citation.includes(field)) violations.push('CITATION.cff：缺少 ' + field);
  }
  citationVersion = citation.match(/^version:\s*["']?([^"'\s]+)/m)?.[1] || null;
}

const zenodoPath = join(ROOT, '.zenodo.json');
if (!existsSync(zenodoPath)) violations.push('.zenodo.json：缺少 Zenodo 存档元数据');
else {
  try {
    const metadata = JSON.parse(readFileSync(zenodoPath, 'utf8'));
    if (metadata.upload_type !== 'software' || metadata.license !== 'mit' || metadata.access_right !== 'open') violations.push('.zenodo.json：上传类型/许可/访问权限不符合公开软件要求');
    if (!Array.isArray(metadata.creators) || !metadata.creators.length || !metadata.creators[0].name) violations.push('.zenodo.json：缺少创作者');
    const hasRepository = Array.isArray(metadata.related_identifiers) && metadata.related_identifiers.some(item => item.identifier === 'https://github.com/lvkoko846/catplot-xrd-workbench' && item.relation === 'isDerivedFrom');
    if (!hasRepository) violations.push('.zenodo.json：缺少来源仓库 related identifier');
    if (citationVersion && metadata.version !== citationVersion) violations.push('CITATION.cff 与 .zenodo.json 版本不一致');
  } catch (error) {
    violations.push('.zenodo.json：JSON 无效 → ' + error.message);
  }
}

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

let demoSummary = '无演示数据文件';
const demoPath = join(ROOT, 'web', 'data', 'demo-spectra.json');
if (existsSync(demoPath)) {
  const doc = JSON.parse(readFileSync(demoPath, 'utf8'));
  const techniques = new Set();
  if (doc.schema !== 'catplot-demo-spectra/v1') violations.push('demo-spectra: schema 不受支持');
  if (!Array.isArray(doc.datasets) || !doc.datasets.length) violations.push('demo-spectra: 缺少数据集');
  for (const d of doc.datasets || []) {
    techniques.add(d.technique);
    if (!['xrd', 'raman', 'ftir', 'xps'].includes(d.technique)) violations.push('demo-spectra: 未知表征 ' + d.id);
    if (!['MIT', 'CC-BY-4.0'].includes(d.license)) violations.push('demo-spectra: 非白名单许可 ' + d.id + ' ' + d.license);
    if (!/^https:\/\//.test(d.source_url || '') || !d.citation || d.citation.length <= 20) violations.push('demo-spectra: 来源/引用不完整 ' + d.id);
    if (!d.x_unit || !d.y_unit) violations.push('demo-spectra: 缺少单位 ' + d.id);
    if (!Array.isArray(d.x) || !Array.isArray(d.y) || d.x.length !== d.y.length || d.x.length < 2) violations.push('demo-spectra: 数据数组无效 ' + d.id);
    else if (!d.x.every(Number.isFinite) || !d.y.every(Number.isFinite)) violations.push('demo-spectra: 含非有限数值 ' + d.id);
    if (!['none', 'snip', 'shirley', 'manual'].includes(d.default_bg)) violations.push('demo-spectra: 推荐背景无效 ' + d.id);
  }
  for (const technique of ['xrd', 'raman', 'ftir', 'xps']) if (!techniques.has(technique)) violations.push('demo-spectra: 缺少表征 ' + technique);
  demoSummary = (doc.datasets || []).length + ' 个真实公开谱 / ' + techniques.size + ' 种表征';
}

console.log('== 发布审计 ==  扫描文件 ' + files.length + ' 个（发布面：' + SCAN_DIRS.join(', ') + ' + README 数据扫描）');
console.log('license 分布（' + distSource + '）：' + (distribution ? JSON.stringify(distribution) : '无示例卡文件'));
console.log('演示数据：' + demoSummary);
if (violations.length) {
  console.log('违规 ' + violations.length + ' 条：');
  violations.forEach(v => console.log('  FAIL ' + v));
  process.exit(1);
}
console.log('PASS：发布面不含受限许可数据文件与受限品牌标识。');
process.exit(0);