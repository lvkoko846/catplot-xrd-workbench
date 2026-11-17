"""公开示例卡生成（离线，零网络）：2 张 CC0 COD CIF 经 pymatgen 计算 + XRED(MIT) 实验峰表。
输出 web/data/example-cards.json。用法：python scripts/build-examples.py"""
import json, os, re, datetime
from pymatgen.analysis.diffraction.xrd import XRDCalculator
from pymatgen.io.cif import CifParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures', 'real-xred')
OUT = os.path.join(ROOT, 'web', 'data', 'example-cards.json')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

cards = []
calc = XRDCalculator(wavelength='CuKa')
for cif, uid in [('1010942.cif', 'COD-1010942'), ('1530150.cif', 'COD-1530150')]:
    s = CifParser(os.path.join(FIX, cif)).parse_structures(primitive=False, check_occu=False)[0]
    pat = calc.get_pattern(s, scaled=True, two_theta_range=(10, 90))
    peaks = []
    for x, y, d, h in zip(pat.x, pat.y, pat.d_hkls, pat.hkls):
        hkl = h[0]['hkl'] if isinstance(h, list) else h['hkl']
        peaks.append({'d': round(float(d), 5), 'i': round(float(y), 2), 't': round(float(x), 4),
                      'hkl': ' '.join(str(int(v)) for v in hkl)})
    peaks.sort(key=lambda p: -p['i'])
    name = 'Anatase' if uid.endswith('1010942') else 'Rutile'
    cards.append({
        'uid': uid, 'name': name, 'formula': 'TiO2',
        'source': 'COD', 'source_id': uid.split('-')[1],
        'source_url': 'https://www.crystallography.net/cod/' + uid.split('-')[1] + '.html',
        'license': 'CC0-1.0', 'pattern_type': 'computed',
        'citation': 'Crystallography Open Database entry ' + uid.split('-')[1] + ' (CC0-1.0); pattern computed with pymatgen XRDCalculator',
        'wavelength': 1.5406,
        'calc_params': {'wavelength': 1.5406, 'two_theta_range': [10, 90], 'scaled': True,
                        'lp_correction': 'pymatgen default Lorentz-polarization', 'debye_waller': False,
                        'symprec': 0.1, 'preferred_orientation': 'none', 'instrument_broadening': 'none'},
        'peaks': peaks, 'n_peaks': len(peaks), 'max_i': peaks[0]['i'] if peaks else 0,
    })

# XRED 实验峰表（MIT）：局部极大 + 间隔去重
rows = [l.split(',') for l in open(os.path.join(FIX, 'tio2-rutile-anatase.csv'), encoding='utf-8').read().strip().splitlines()]
pts = [(float(a), float(b)) for a, b in rows]
ymax = max(y for _, y in pts)
cand = [(x, y) for i, (x, y) in enumerate(pts) if 2 <= i < len(pts) - 2 and y >= pts[i - 1][1] and y > pts[i + 1][1] and y > 0.10 * ymax]
cand.sort(key=lambda p: -p[1])
ded = []
for x, y in cand:
    if not any(abs(x - q[0]) < 0.35 for q in ded):
        ded.append((x, y))
ded.sort()
lam = 1.5406
import math
peaks = [{'d': round(lam / (2 * math.sin(math.radians(x / 2))), 5), 'i': round(y, 1), 't': round(x, 4), 'hkl': None} for x, y in ded]
cards.append({
    'uid': 'XRED-TiO2-mix', 'name': 'TiO2 rutile+anatase mixture (experimental)', 'formula': 'TiO2',
    'source': 'XRED', 'source_id': 'biphase/TiO2Rutile Anatase/data.csv',
    'source_url': 'https://github.com/WPEM/XRED',
    'license': 'MIT', 'pattern_type': 'experimental',
    'citation': 'XRED — X-Ray phase Identification public Experimental Dataset (MIT), git sha 47c11492a296c777467c26194f9f2ac9ed4aeb7a',
    'wavelength': lam,
    'calc_params': None,
    'note': '波长为峰位推断（Cu Kα），非数据集声明；实验峰表由原始谱局部极大提取，hkl 未指认',
    'peaks': peaks, 'n_peaks': len(peaks), 'max_i': peaks[0]['i'] if peaks else 0,
})

doc = {
    'format': 'catplot-example-cards', 'library_version': 'examples-1',
    'generatedAt': datetime.datetime.now().isoformat(timespec='seconds'),
    'generator': 'pymatgen XRDCalculator (CuKa, scaled, 10-90 deg) + XRED peak extraction',
    'note': '公开示例卡：CC0 计算图谱 + MIT 实验峰表；无温度因子/仪器宽化/择优取向；仅供演示与拟合对照，非物相鉴定结论',
    'cards': cards,
}
json.dump(doc, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('example cards:', [(c['uid'], c['license'], c['pattern_type'], c['n_peaks']) for c in cards])
print('written', OUT, os.path.getsize(OUT), 'bytes')