import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const definitions = [
  {
    id: 'xred-tio2', technique: 'xrd', name: 'XRED · TiO₂ 双相实验谱', kind: 'experimental',
    file: 'tests/fixtures/real-xred/tio2-rutile-anatase.csv', license: 'MIT',
    source_url: 'https://github.com/WPEM/XRED',
    citation: 'WPEM/XRED: X-Ray phase Identification public Experimental Dataset, biphase/TiO2Rutile Anatase/data.csv',
    x_unit: '2θ (°)', y_unit: '强度 (a.u.)', wavelength_angstrom: 1.5406,
    note: '真实金红石+锐钛矿混合实验谱；波长为按主峰推断的 Cu Kα，并非数据集声明。',
    default_bg: 'snip', peak_params: { smooth: 7, noiseK: 3, minHeight: null, minProm: 0, minDist: 0.15, lo: null, hi: null }
  },
  {
    id: 'raman-formic-acid', technique: 'raman', name: 'Raman Noodles · 甲酸分解拉曼谱', kind: 'experimental',
    file: 'docs/post/data/raman-formic-acid.csv', license: 'MIT',
    source_url: 'https://github.com/raman-noodles/raman-spectra-decomp-analysis',
    citation: 'raman-noodles/raman-spectra-decomp-analysis: Formic Acid Raman public dataset',
    x_unit: '拉曼位移 (cm⁻¹)', y_unit: '拉曼强度 (a.u.)',
    note: '公开真实甲酸分解拉曼谱，仅用于通用寻峰与拟合演示；不将相对强度解释为物相含量。',
    default_bg: 'snip', peak_params: { smooth: 7, noiseK: 3, minHeight: null, minProm: 0, minDist: 2, lo: null, hi: null }
  },
  {
    id: 'drift-spent-hbn', technique: 'ftir', name: 'Zenodo · 反应后 h-BN DRIFT 谱', kind: 'experimental',
    file: 'docs/post/data/ftir-drift-spent-hbn.csv', license: 'CC-BY-4.0',
    source_url: 'https://zenodo.org/records/15180744',
    citation: 'Zenodo 15180744: Low-temperature oxidation of hexagonal boron nitride during oxidative dehydrogenation; DRIFT spectra/spent h-BN.txt',
    x_unit: '波数 (cm⁻¹)', y_unit: 'DRIFT 吸光度 (a.u.)',
    note: 'CC BY 4.0 公开 DRIFT 谱；谱图处理与峰指认需结合原研究背景，演示不构成官能团鉴定结论。',
    default_bg: 'manual', peak_params: { smooth: 7, noiseK: 3, minHeight: null, minProm: 0, minDist: 2, lo: null, hi: null }
  },
  {
    id: 'xps-c1s-hbn', technique: 'xps', name: 'Zenodo · h-BN C 1s XPS 谱', kind: 'experimental',
    file: 'docs/post/data/xps-c1s.csv', license: 'CC-BY-4.0',
    source_url: 'https://zenodo.org/records/15180744',
    citation: 'Zenodo 15180744: Low-temperature oxidation of hexagonal boron nitride during oxidative dehydrogenation; XPS/dif reactor geometry/VS-1.5/C 1s.TXT',
    x_unit: '结合能 (eV)', y_unit: 'XPS 强度 (counts)',
    note: '公开 C 1s 实测谱；演示 Shirley 背景与荷电校正。参考峰选择与化学态归属需人工核验。',
    default_bg: 'shirley', peak_params: { smooth: 5, noiseK: 3, minHeight: null, minProm: 0, minDist: 0.25, lo: null, hi: null }
  },
  {
    id: 'xps-b1s-hbn', technique: 'xps', name: 'Zenodo · h-BN B 1s XPS 谱', kind: 'experimental',
    file: 'docs/post/data/xps-b1s.csv', license: 'CC-BY-4.0',
    source_url: 'https://zenodo.org/records/15180744',
    citation: 'Zenodo 15180744: Low-temperature oxidation of hexagonal boron nitride during oxidative dehydrogenation; XPS/dif reactor geometry/VS-1.5/B 1s.TXT',
    x_unit: '结合能 (eV)', y_unit: 'XPS 强度 (counts)',
    note: '公开 B 1s 实测谱；适合演示双峰拟合与化学态面积比，峰数初值仍需按谱形人工确认。',
    default_bg: 'shirley', peak_params: { smooth: 5, noiseK: 3, minHeight: null, minProm: 0, minDist: 0.25, lo: null, hi: null }
  }
];

function readSpectrum(file) {
  const lines = readFileSync(join(ROOT, file), 'utf8').trim().split(/\r?\n/);
  const x = [], y = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length !== 2 || !cells.every(c => c.trim() && Number.isFinite(Number(c)))) {
      throw new Error(`${file}:${i + 1} 不是两列有限数值`);
    }
    x.push(Number(cells[0]));
    y.push(Number(cells[1]));
  }
  if (x.length < 3 || new Set(x).size !== x.length) throw new Error(`${file} 点数不足或存在重复 X`);
  for (let i = 1; i < x.length; i++) if (x[i] < x[i - 1]) throw new Error(`${file} X 非升序`);
  return { x, y };
}

const datasets = definitions.map(definition => ({ ...definition, ...readSpectrum(definition.file) }));
const techniques = ['xrd', 'raman', 'ftir', 'xps'].map(id => {
  const labels = { xrd: 'XRD', raman: '拉曼', ftir: '红外', xps: 'XPS' };
  return { id, label: labels[id], default_dataset: datasets.find(d => d.technique === id).id };
});
const payload = {
  schema: 'catplot-demo-spectra/v1',
  attribution: '公开实验数据按各条目许可再分发；模拟 XRD 由 CatPlot 固定种子程序生成，非真实实验。',
  techniques,
  datasets
};
const output = join(ROOT, 'web', 'data', 'demo-spectra.json');
writeFileSync(output, JSON.stringify(payload) + '\n');
console.log(`wrote ${relative(ROOT, output)}: ${datasets.length} spectra, ${(Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(1)} KiB`);
for (const dataset of datasets) console.log(`${dataset.id}: ${dataset.x.length} points, ${dataset.license}`);
