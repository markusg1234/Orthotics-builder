/*
 * Photo pipeline checks.
 *
 * Synthesises a photo instead of needing fixtures: take a known design's outline,
 * draw it on a sheet of paper, warp the sheet through a perspective transform the
 * way a hand-held camera would, then assert the pipeline gets the design back.
 * Pure Node, no canvas, no dependencies.
 *
 *   node tests/check_photo.js
 */
'use strict';

require('../src/geometry.js');
require('../src/photo.js');
const G = globalThis.OrthoGeom;
const P = globalThis.OrthoPhoto;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  const line = (ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '');
  console.log(line);
}
function near(name, got, want, tol) {
  const d = Math.abs(got - want);
  check(name, d <= tol, `got ${got.toFixed(2)}, want ${want.toFixed(2)} (+-${tol}, off by ${d.toFixed(2)})`);
}

/* ---------- A tiny raster, enough to fake a photo ---------- */

function gray(w, h, fill) {
  return { width: w, height: h, data: new Uint8Array(w * h).fill(fill) };
}

function fillPoly(img, poly, value) {
  const w = img.width, h = img.height;
  let lo = Infinity, hi = -Infinity;
  for (const p of poly) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
  for (let y = Math.max(0, Math.floor(lo)); y <= Math.min(h - 1, Math.ceil(hi)); y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) img.data[y * w + x] = value;
    }
  }
}

// Seeded noise, so a failure is always reproducible.
function mulberry(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Build the sheet, then photograph it ---------- */

// mode 'print' fills the outline; mode 'trace' inks a band strictly OUTSIDE it,
// which is where a pen held upright against the foot actually leaves its mark --
// so the ink's inner edge is the true outline, and the pipeline should find it.
function drawSheet(sheet, outline, mode, spp, opts) {
  const o = opts || {};
  const w = Math.round(sheet.w * spp), h = Math.round(sheet.h * spp);
  const img = gray(w, h, 245);
  // Lay the foot along the sheet's long axis, centred, toes towards the top.
  let maxX = 0, loY = Infinity, hiY = -Infinity;
  for (const p of outline) { maxX = Math.max(maxX, p[0]); loY = Math.min(loY, p[1]); hiY = Math.max(hiY, p[1]); }
  const ox = (sheet.w - (hiY - loY)) / 2 - loY, oy = (sheet.h - maxX) / 2;
  const px = outline.map(p => [(p[1] + ox) * spp, (sheet.h - (p[0] + oy)) * spp]);

  if (mode === 'print') {
    fillPoly(img, px, 25);
  } else {
    const mask = { width: w, height: h, data: new Uint8Array(w * h) };
    fillPoly(mask, px, 1);
    const r = Math.max(1, Math.round((o.penMm != null ? o.penMm : 0.75) * spp));
    const grown = P.morph(mask.data, w, h, r, true);
    for (let i = 0; i < w * h; i++) if (grown[i] && !mask.data[i]) img.data[i] = 25;
    // Lift the pen for a moment, to prove the gap closing earns its keep.
    if (o.gapMm) {
      const gpx = Math.round(o.gapMm * spp), cx = Math.round(px[0][0]), cy = Math.round(px[0][1]);
      for (let y = cy - gpx; y <= cy + gpx; y++) {
        for (let x = cx - gpx; x <= cx + gpx; x++) {
          if (x >= 0 && y >= 0 && x < w && y < h) img.data[y * w + x] = 245;
        }
      }
    }
  }
  return img;
}

// Re-sample the sheet through a perspective transform into an RGBA "photo", on a
// darker floor, with a lighting gradient and noise so Otsu has real work to do.
function photograph(sheetImg, quad, pw, ph, seed) {
  const rnd = mulberry(seed || 1);
  const sw = sheetImg.width, sh = sheetImg.height;
  const h = P.solveHomography(quad, [[0, 0], [sw, 0], [sw, sh], [0, sh]]);
  const data = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const p = P.applyH(h, x + 0.5, y + 0.5);
      let v;
      if (p[0] < 0 || p[1] < 0 || p[0] >= sw || p[1] >= sh) {
        v = 90;                                             // the floor around the sheet
      } else {
        v = sheetImg.data[(p[1] | 0) * sw + (p[0] | 0)];
        v = v * (0.86 + 0.14 * (x / pw));                   // light falling off across the frame
      }
      v = Math.max(0, Math.min(255, v + (rnd() - 0.5) * 8));
      const j = (y * pw + x) * 4;
      data[j] = data[j + 1] = data[j + 2] = v;
      data[j + 3] = 255;
    }
  }
  return { width: pw, height: ph, data };
}

/* ---------- 1. Homography round trip ---------- */

{
  const src = [[12, 9], [80, 15], [76, 112], [9, 105]];
  const dst = [[0, 0], [210, 0], [210, 297], [0, 297]];
  const h = P.solveHomography(src, dst);
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const got = P.applyH(h, src[i][0], src[i][1]);
    worst = Math.max(worst, Math.hypot(got[0] - dst[i][0], got[1] - dst[i][1]));
  }
  check('homography maps its own four corners exactly', worst < 1e-6, `worst ${worst.toExponential(2)}`);
  const back = P.solveHomography(dst, src);
  const mid = P.applyH(back, 105, 148.5), fwd = P.applyH(h, mid[0], mid[1]);
  check('homography inverts', Math.hypot(fwd[0] - 105, fwd[1] - 148.5) < 1e-6);
}

/* ---------- 2. The measurement definitions match the design they came from ---------- */

const SHEET = P.SHEETS.a4;

function idealOutline(params) {
  return G.build(Object.assign({}, params, { coverage: 'full' }), { side: 'right' }).outline;
}

const CASES = [
  { length: 265, ballWidth: 100, heelWidth: 66 },
  { length: 232, ballWidth: 86, heelWidth: 58 },
  { length: 288, ballWidth: 112, heelWidth: 74 }
];

console.log('\nMeasuring the ideal outline (no photo involved)');
for (const c of CASES) {
  const p = G.sanitize(c), m = P.measureOutline(idealOutline(p));
  check(`case ${c.length}mm measures`, !m.error, m.error || '');
  if (m.error) continue;
  near(`  length ${c.length}`, m.length, p.length, 1);
  near(`  ball width ${c.ballWidth}`, m.maxWidth, p.ballWidth, 1.5);
  // The model's heelWidth is the widest point of the heel; this reads the span
  // 25 mm in from the back, the way the instructions tell you to measure. Close,
  // not identical, and that difference is the honest one to carry.
  near(`  heel width ${c.heelWidth}`, m.heelWidth, p.heelWidth, 4);
  check('  medial side is +y', Math.max.apply(null, m.poly.map(q => q[1])) > 0);
}

/* ---------- 3. Through a synthetic photo ---------- */

const QUAD = [[120, 90], [800, 150], [760, 1120], [95, 1050]];

function runPipeline(img, sheet, mode) {
  const corners = P.findQuad(img, sheet);
  if (!corners) return { error: 'no quad' };
  const rect = P.rectify(img, corners, sheet.w, sheet.h, 4);
  if (!rect) return { error: 'no rectify' };
  const out = P.extractOutline(rect, mode);
  if (out.error) return { error: out.error };
  const m = P.measureOutline(out.poly);
  if (m.error) return { error: m.error };
  m.corners = corners;
  return m;
}

for (const mode of ['print', 'trace']) {
  console.log(`\nThrough a photo, ${mode} mode`);
  for (const c of CASES) {
    const p = G.sanitize(c), poly = idealOutline(p);
    const ideal = P.measureOutline(poly);
    const sheetImg = drawSheet(SHEET, poly, mode, 4);
    const photo = photograph(sheetImg, QUAD, 900, 1200, 7);
    const got = runPipeline(photo, SHEET, mode);
    check(`case ${c.length}mm ${mode} reads`, !got.error, got.error || '');
    if (got.error) continue;
    // A blank rectangle has no up, so which corner comes first is ambiguous by a
    // half turn. That costs nothing: the rectified sheet may come out upside down
    // and measureOutline re-aligns to the foot's own long axis anyway.
    let worst = Infinity;
    for (let r = 0; r < 4; r++) {
      let w = 0;
      for (let i = 0; i < 4; i++) {
        const c = got.corners[(i + r) % 4];
        w = Math.max(w, Math.hypot(c[0] - QUAD[i][0], c[1] - QUAD[i][1]));
      }
      worst = Math.min(worst, w);
    }
    check('  sheet corners found within 6 px', worst < 6, `worst ${worst.toFixed(1)} px`);
    near('  length vs ideal', got.length, ideal.length, 1);
    near('  max width vs ideal', got.maxWidth, ideal.maxWidth, 1);
    near('  heel width vs ideal', got.heelWidth, ideal.heelWidth, 1.5);
    near('  length vs the design', got.length, p.length, 1.5);
    near('  ball width vs the design', got.maxWidth, p.ballWidth, 2);
  }
}

/* ---------- 4. A gap in the pen line ---------- */

console.log('\nGaps in the pen line');
{
  const p = G.sanitize(CASES[0]), poly = idealOutline(p), ideal = P.measureOutline(poly);
  const small = photograph(drawSheet(SHEET, poly, 'trace', 4, { gapMm: 0.8 }), QUAD, 900, 1200, 7);
  const got = runPipeline(small, SHEET, 'trace');
  check('a 1.6 mm gap is bridged', !got.error, got.error || '');
  if (!got.error) near('  length still right', got.length, ideal.length, 1.5);

  const big = photograph(drawSheet(SHEET, poly, 'trace', 4, { gapMm: 6 }), QUAD, 900, 1200, 7);
  const bad = runPipeline(big, SHEET, 'trace');
  check('a 12 mm gap is refused, not guessed', !!bad.error && /gap/i.test(bad.error), bad.error || 'no error raised');
}

/* ---------- 5. Refusing a photo it cannot use ---------- */

console.log('\nRefusals');
{
  const p = G.sanitize(CASES[0]), sheetImg = drawSheet(SHEET, idealOutline(p), 'print', 4);
  const tiny = [[380, 500], [530, 510], [525, 720], [375, 712]];     // sheet ~4% of the frame
  check('a sheet too small in frame is refused', P.findQuad(photograph(sheetImg, tiny, 900, 1200, 3), SHEET) === null);
  const flat = { width: 400, height: 500, data: new Uint8ClampedArray(400 * 500 * 4).fill(128) };
  const q = P.findQuad(flat, SHEET);
  check('a blank frame yields no outline', q === null || P.extractOutline(P.rectify(flat, q, SHEET.w, SHEET.h, 4), 'print').error !== undefined);
}

/* ---------- 6. Footprint shape to an arch band ---------- */

console.log('\nFootprint arch bands');
{
  check('a narrow midfoot reads as a high arch', P.archFromPrint(0.18).type === 'high');
  check('a middling midfoot reads as average', P.archFromPrint(0.35).type === 'average');
  check('a wide midfoot reads as low', P.archFromPrint(0.6).type === 'low');
  check('no ratio gives no suggestion', P.archFromPrint(0) === null && P.archFromPrint(null) === null);
  const bands = P.ARCH_BANDS.map(b => b.archHeight);
  check('the bands step down as the arch flattens', bands[0] > bands[1] && bands[1] > bands[2]);
}

/* ---------- 7. Side view: heights above the floor ---------- */

console.log('\nSide view');
{
  // A scene in millimetres on the vertical plane, y up from the floor: a 265 mm
  // foot with the top of its arch 22 mm up and 95 mm along.
  const FOOT = 265;
  const scene = { heel: [0, 0], toe: [FOOT, 0], apex: [95, 22] };
  // Photograph it square on, at some arbitrary scale and offset, y down.
  const square = pt => [140 + pt[0] * 2.1, 700 - pt[1] * 2.1];
  const marks = { heel: square(scene.heel), toe: square(scene.toe), apex: square(scene.apex) };
  const r = P.archFromSide(marks, { footLength: FOOT });
  check('side view reads', !r.error, r.error || '');
  if (!r.error) {
    near('  arch clear height', r.clearHeight, 22, 0.05);
    near('  how far along the arch peaks', r.apexDist, 95, 0.05);
    near('  arch peak', r.archPeak, (95 / FOOT) * 100, 0.1);

    // Full support means meeting the arch you actually stand on, so by default a
    // standing measurement is built whole.
    near('  by default it builds the whole arch', r.archHeight, 22, 0.05);
    near('  and the default fill is 100%', P.DEFAULT_FILL, 100, 0);
  }

  // The same foot photographed sitting reads higher, because the arch has sprung
  // back up. Taking the drop off has to land both routes on the same orthotic --
  // that is the whole point of the correction, and it is not less support.
  {
    const up = { heel: square([0, 0]), toe: square([FOOT, 0]), apex: square([95, 22 + P.ARCH_DROP]) };
    const sat = P.archFromSide(up, { footLength: FOOT, stance: 'sitting' });
    const stood = P.archFromSide(marks, { footLength: FOOT, stance: 'standing' });
    check('sitting reads the higher unloaded arch', !sat.error && sat.clearHeight > stood.clearHeight);
    near('  but both build the same orthotic', sat.archHeight, stood.archHeight, 0.05);
    near('  and the loaded height is the standing one', sat.loadedHeight, stood.clearHeight, 0.05);
    check('  building the raw sitting height would lift the arch instead',
      sat.clearHeight - stood.clearHeight > 5, `${sat.clearHeight.toFixed(1)} vs ${stood.clearHeight.toFixed(1)} mm`);
    // A foot flat enough that nothing is left to support must not go negative.
    const flatish = P.archFromSide({ heel: square([0, 0]), toe: square([FOOT, 0]), apex: square([95, 2]) }, { footLength: FOOT, stance: 'sitting' });
    check('  an arch under the drop builds nothing rather than going negative', flatish.archHeight === 0, String(flatish.archHeight));
  }

  {
    const at = (fill, stance) => P.archFromSide(marks, { footLength: FOOT, stance, fill });
    near('a half fill builds half the loaded arch', at(0.5, 'standing').archHeight, 11, 0.05);
    near('going over 100% lifts the arch above where it stands', at(1.2, 'standing').archHeight, 26.4, 0.05);
  }

  // The foot is the ruler, so the answer must not depend on how big it lands in
  // frame, nor on the photo being level -- only on it being square on.
  const far = pt => [600 + pt[0] * 0.55, 400 - pt[1] * 0.55];
  const small = P.archFromSide({ heel: far(scene.heel), toe: far(scene.toe), apex: far(scene.apex) }, { footLength: FOOT });
  near('a foot a quarter the size in frame reads the same', small.clearHeight, 22, 0.05);
  const rot = pt => {
    const c = Math.cos(0.21), s2 = Math.sin(0.21), x = pt[0] * 2.1, y = -pt[1] * 2.1;
    return [140 + x * c - y * s2, 700 + x * s2 + y * c];
  };
  const tilted = P.archFromSide({ heel: rot(scene.heel), toe: rot(scene.toe), apex: rot(scene.apex) }, { footLength: FOOT });
  near('a photo held at 12 degrees off level reads the same', tilted.clearHeight, 22, 0.05);

  // And the foot length it is given is exactly what sets the scale.
  const half = P.archFromSide(marks, { footLength: FOOT / 2 });
  near('halving the foot length halves the arch', half.clearHeight, 11, 0.05);

  const flat = P.archFromSide({ heel: square([0, 0]), toe: square([FOOT, 0]), apex: square([95, 0]) }, {});
  check('an arch at floor level is refused', !!flat.error, flat.error || 'no error raised');
  const upside = P.archFromSide({ heel: square([0, 0]), toe: square([FOOT, 0]), apex: square([95, -22]) }, {});
  check('an arch marked below the floor is refused', !!upside.error, upside.error || 'no error raised');
  const close = P.archFromSide({ heel: square([0, 0]), toe: square([8, 0]), apex: square([4, 10]) }, {});
  check('heel and toe too close together is refused', !!close.error, close.error || 'no error raised');
}

/* ---------- 8. What the designer does with the numbers ---------- */

console.log('\nFeeding the designer');
{
  // The tracing route sets the three foot measurements straight, and sanitize has
  // to accept them without clamping anything away.
  const p = G.sanitize(CASES[0]), m = P.measureOutline(idealOutline(p));
  const back = G.sanitize({ length: m.length, ballWidth: m.maxWidth, heelWidth: m.heelWidth });
  near('length survives sanitize', back.length, m.length, 0.01);
  near('ball width survives sanitize', back.ballWidth, m.maxWidth, 0.01);
  near('heel width survives sanitize', back.heelWidth, m.heelWidth, 0.01);

  // The insole route goes through the existing solver, which bisects ball width
  // so the design's widest point matches what was measured.
  const r = G.fromOrthotic({ coverage: 'full', style: 'solid', length: m.length, maxWidth: m.maxWidth, heelWidth: m.heelWidth }, G.DEFAULTS);
  check('fromOrthotic accepts photo measurements', !r.error, r.error || '');
  if (!r.error) {
    const md = G.measureDesign(r.params);
    near('  matched length', md.length, m.length, 1);
    near('  matched widest width', md.maxWidth, m.maxWidth, 1);
  }
}

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all photo checks passed');
