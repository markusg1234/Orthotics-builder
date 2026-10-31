// Mesh checks for src/geometry.js. Run with: node tests/check_mesh.js
// Every case must give a closed, consistently wound (watertight) mesh with positive volume.
require('../src/geometry.js');
const G = globalThis.OrthoGeom;

function check(params, side) {
  const m = G.build(params, { side });
  const { pos, tri, nSurf } = m;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) return 'non-finite vertex';
  const edges = new Map();
  for (let t = 0; t < tri.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tri[t + e], b = tri[t + (e + 1) % 3];
      if (a === b) return 'degenerate triangle';
      const k = a + ',' + b;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  for (const [k, c] of edges) {
    const [a, b] = k.split(',');
    if (c !== 1 || edges.get(b + ',' + a) !== 1) return 'not watertight at edge ' + k;
  }
  for (let k = 0; k < nSurf; k++) {
    if (pos[k * 3 + 2] - pos[(nSurf + k) * 3 + 2] < 0.99) return 'thinner than 1 mm at vertex ' + k;
  }
  for (let k = 2; k < pos.length; k += 3) if (pos[k] < -1e-6) return 'below the build plate';
  if (!(m.stats.volume > 0)) return 'non-positive volume';
  const p = G.sanitize(params);
  const expected = G.COVERAGE_END[p.coverage] * p.length;
  if (Math.abs(m.stats.length - expected) > 0.01) return 'length mismatch';
  return null;
}

const cases = [
  {},
  { coverage: 'full' },
  { coverage: 'sulcus' },
  { style: 'shell' },
  { coverage: 'full', style: 'shell', metPad: 5, rearPost: 4, forePost: -3, heelLift: 6 },
  { length: 150, ballWidth: 55, heelWidth: 35, archHeight: 30, heelCup: 25 },
  { length: 340, ballWidth: 135, heelWidth: 95, archHeight: 0, heelCup: 0, lateralArch: 0, style: 'shell' },
  { rearPost: -8, forePost: 8, archPeak: 52, archSpread: 90, metPad: 8, metPadPos: 68 },
  { length: 'oops', ballWidth: -5, coverage: 'nope', style: 42 }
];

let failed = 0;
for (const c of cases) {
  for (const side of ['right', 'left']) {
    const err = check(c, side);
    if (err) { failed++; console.error(`FAIL ${side} ${JSON.stringify(c)}: ${err}`); }
  }
}
const stl = G.toSTL([G.build({})]);
const n = new DataView(stl).getUint32(80, true);
if (stl.byteLength !== 84 + 50 * n) { failed++; console.error('FAIL STL size'); }

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log(`all ${cases.length * 2} mesh cases and the STL writer passed`);
