/*
 * Orthotic geometry engine — scan-free, measurement-driven.
 * Pure JavaScript, no dependencies. Builds a closed, printable triangle mesh
 * (millimetres, Z up, X from heel to toe, +Y = medial side of a RIGHT foot).
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    side: 'right',        // right | left | pair (pair is a view/export option)
    length: 265,          // foot length, heel to longest toe (mm)
    ballWidth: 100,       // widest part across the ball of the foot (mm)
    heelWidth: 66,        // widest part of the heel (mm)
    coverage: '3q',       // 3q | sulcus | full
    archHeight: 15,       // medial arch rise above the base (mm)
    archPeak: 42,         // arch peak position, % of foot length from heel
    archSpread: 65,       // how far across the foot the arch reaches (%)
    lateralArch: 2,       // outer (lateral) arch rise (mm)
    heelCup: 12,          // heel cup wall height (mm)
    heelLift: 0,          // extra height under the heel (mm)
    rearPost: 0,          // rearfoot post angle, + raises inner side (deg)
    metPad: 0,            // metatarsal pad height (mm)
    metPadPos: 63,        // met pad centre, % of foot length
    forePost: 0,          // forefoot post angle, + raises inner side (deg)
    style: 'solid',       // solid (flat base) | shell (hollow under arch)
    shellThick: 3,        // thickness at heel and arch (mm)
    foreThick: 2,         // thickness at forefoot (mm)
    material: 'tpu'
  };

  const LIMITS = {
    length: [150, 340], ballWidth: [55, 135], heelWidth: [35, 95],
    archHeight: [0, 30], archPeak: [32, 52], archSpread: [35, 90], lateralArch: [0, 8],
    heelCup: [0, 25], heelLift: [0, 15], rearPost: [-8, 8],
    metPad: [0, 8], metPadPos: [55, 68], forePost: [-8, 8],
    shellThick: [1.5, 8], foreThick: [1, 6]
  };

  const COVERAGE_END = { '3q': 0.67, sulcus: 0.80, full: 1.0 };
  const DENSITY = { tpu: 1.21, petg: 1.27, pla: 1.24 }; // g/cm^3

  const N_ROWS = 150;   // along the length
  const N_COLS = 56;    // across the width

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function smooth(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function smoother(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Monotone cubic Hermite interpolation (Fritsch–Carlson): smooth, no overshoot.
  function makeInterp(xs, ys) {
    const n = xs.length, d = new Array(n - 1), m = new Array(n);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] +
        (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }

  function sanitize(input) {
    const p = Object.assign({}, DEFAULTS, input || {});
    for (const k in LIMITS) {
      const v = Number(p[k]);
      p[k] = Number.isFinite(v) ? clamp(v, LIMITS[k][0], LIMITS[k][1]) : DEFAULTS[k];
    }
    if (!COVERAGE_END[p.coverage]) p.coverage = DEFAULTS.coverage;
    if (p.style !== 'shell') p.style = 'solid';
    if (!DENSITY[p.material]) p.material = DEFAULTS.material;
    // keep the heel narrower than the ball so the outline stays sensible
    p.heelWidth = Math.min(p.heelWidth, p.ballWidth * 0.95, p.length * 0.36);
    return p;
  }

  /* ---------- Outline: medial offset m(x) and lateral offset l(x) from the foot axis ---------- */
  function makeOutline(p) {
    const L = p.length, W = p.ballWidth, H = p.heelWidth;
    const rh = Math.min(H / 2, 0.2 * L);
    const mi = makeInterp(
      [rh, 0.25 * L, 0.45 * L, 0.72 * L, 0.86 * L, L],
      [0.5 * H, 0.5 * H, 0.5 * (0.5 * H + 0.45 * W) - 0.025 * W, 0.45 * W, 0.42 * W, 0.34 * W]);
    const li = makeInterp(
      [rh, 0.30 * L, 0.47 * L, 0.66 * L, 0.84 * L, L],
      [0.5 * H, 0.56 * H, 0.5 * (0.56 * H + 0.55 * W) + 0.01 * W, 0.55 * W, 0.44 * W, 0.30 * W]);

    const baseM = x => (x < rh ? 0.5 * H * Math.sqrt(Math.max(0, 1 - (1 - x / rh) ** 2)) : mi(x));
    const baseL = x => (x < rh ? 0.5 * H * Math.sqrt(Math.max(0, 1 - (1 - x / rh) ** 2)) : li(x));

    const xe = COVERAGE_END[p.coverage] * L;
    let capStart, yc, pm, pl;
    if (p.coverage === 'full') {
      capStart = 0.84 * L; yc = 0.18 * W; pm = 2.6; pl = 1.5;           // toe shape, big toe longest
    } else {
      const w = baseM(xe) + baseL(xe);
      capStart = xe - (p.coverage === '3q' ? 0.18 : 0.22) * w;      // gently rounded distal edge
      yc = (baseM(capStart) - baseL(capStart)) / 2 + 0.12 * w;          // longer on the inner side
      pm = 2.5; pl = 1.6;
    }
    function edges(x) {
      let m = baseM(x), l = baseL(x);
      if (x > capStart) {
        const s = clamp((x - capStart) / (xe - capStart), 0, 1);
        m = yc + (m - yc) * Math.sqrt(Math.max(0, 1 - s ** pm));
        l = -yc + (l + yc) * Math.sqrt(Math.max(0, 1 - s ** pl));
      }
      return [m, l];
    }
    return { edges, xe, yc, L, W, H };
  }

  /* ---------- Height field ---------- */
  function makeHeights(p, ol) {
    const L = p.length, W = p.ballWidth, xe = ol.xe, fEnd = xe / L;
    const A = p.archHeight, LA = p.lateralArch, C = p.heelCup, P = p.metPad;
    const fs = 0.16, fpk = clamp(p.archPeak / 100, fs + 0.08, Math.min(0.70, fEnd - 0.01) - 0.08);
    const fae = Math.min(0.70, fEnd - 0.01);
    const cupR = 8 + 0.8 * C;
    const spread = p.archSpread / 100;
    const rp = (p.rearPost * Math.PI) / 180, fp = (p.forePost * Math.PI) / 180;
    const xp = (p.metPadPos / 100) * L, yp = -0.04 * W;
    const aProx = 0.10 * L, aDist = 0.045 * L, bPad = 0.17 * W;

    function gArch(f) {
      if (f <= fs || f >= fae) return 0;
      return f < fpk ? 0.5 - 0.5 * Math.cos(Math.PI * (f - fs) / (fpk - fs))
        : 0.5 + 0.5 * Math.cos(Math.PI * (f - fpk) / (fae - fpk));
    }
    function gLat(f) {
      const a = 0.24, pk = 0.40, b = Math.min(0.60, fEnd - 0.02);
      if (f <= a || f >= b) return 0;
      return f < pk ? 0.5 - 0.5 * Math.cos(Math.PI * (f - a) / (pk - a))
        : 0.5 + 0.5 * Math.cos(Math.PI * (f - pk) / (b - pk));
    }

    return function (x, y, m, l, d) {
      const f = x / L;
      let t = lerp(p.shellThick, p.foreThick, smooth(0.55, 0.72, f));
      if (p.coverage !== 'full') t = lerp(t, Math.min(t, 1.2), smooth(xe - 16, xe, x)); // skive the end

      // Posts and lifts sit underneath the shell
      const wR = 1 - smooth(0.30, 0.55, f), wF = smooth(0.55, 0.72, f);
      let post = p.heelLift * (1 - smooth(0.28, 0.55, f));
      if (rp > 0) post += Math.tan(rp) * (y + l) * wR;
      else if (rp < 0) post += Math.tan(-rp) * (m - y) * wR;
      if (fp > 0) post += Math.tan(fp) * (y + l) * wF;
      else if (fp < 0) post += Math.tan(-fp) * (m - y) * wF;

      // Contours of the shell
      const span = m + l;
      const tn = span > 1e-6 ? clamp((y + l) / span, 0, 1) : 0.5; // 0 = outer edge, 1 = inner edge
      const arch = A * gArch(f) * smoother(1 - spread, 1.0, tn);
      const lat = LA * gLat(f) * smoother(0.6, 1.0, 1 - tn);
      let cup = 0;
      if (C > 0 && d < cupR) cup = C * (1 - smooth(0.25, 0.50, f)) * (1 - d / cupR) ** 2;
      let pad = 0;
      if (P > 0) {
        const dx = x - xp, a = dx < 0 ? aProx : aDist;
        const r = Math.sqrt((dx / a) ** 2 + ((y - yp) / bPad) ** 2);
        if (r < 1) pad = P * 0.5 * (1 + Math.cos(Math.PI * r));
      }

      // Smooth maximum, so the heel cup wall flows into the arch instead of stacking on it
      const a = arch + lat, k = Math.min(4, 0.5 * Math.min(a, cup));
      let shell = Math.max(a, cup);
      if (k > 1e-6) {
        const h = clamp(0.5 + (0.5 * (a - cup)) / k, 0, 1);
        shell = lerp(cup, a, h) + k * h * (1 - h);
      }
      const top = t + post + shell + pad;
      const bottom = p.style === 'shell' ? (arch + lat) * smooth(0.20, 0.34, f) : 0;
      return [top, bottom];
    };
  }

  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
    const c = vx * vx + vy * vy;
    let t = c > 0 ? (wx * vx + wy * vy) / c : 0;
    t = clamp(t, 0, 1);
    const dx = wx - t * vx, dy = wy - t * vy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ---------- Mesh builder ---------- */
  function build(input, opts) {
    const p = sanitize(input);
    const mirror = (opts && opts.side ? opts.side : p.side) === 'left';
    const ol = makeOutline(p);
    const hf = makeHeights(p, ol);
    const N = N_ROWS, M = N_COLS, xe = ol.xe;

    // Rows (dense near both ends) and columns (dense near both edges)
    const xs = new Float64Array(N + 1), vs = new Float64Array(M + 1);
    for (let i = 0; i <= N; i++) xs[i] = xe * (1 - Math.cos((Math.PI * i) / N)) / 2;
    for (let j = 0; j <= M; j++) vs[j] = (1 - Math.cos((Math.PI * j) / M)) / 2;
    const ml = [];
    for (let i = 0; i <= N; i++) ml.push(ol.edges(xs[i]));

    // Surface sample points (x, y) — heel pole, grid rows 1..N-1, toe pole
    const nSurf = 2 + (N - 1) * (M + 1);
    const sx = new Float64Array(nSurf), sy = new Float64Array(nSurf);
    const sm = new Float64Array(nSurf), sl = new Float64Array(nSurf);
    const heelPole = 0, toePole = nSurf - 1;
    const gi = (i, j) => 1 + (i - 1) * (M + 1) + j;
    sx[heelPole] = 0; sy[heelPole] = 0; sm[heelPole] = 0; sl[heelPole] = 0;
    sx[toePole] = xe; sy[toePole] = ol.yc; sm[toePole] = ol.yc; sl[toePole] = -ol.yc;
    for (let i = 1; i < N; i++) {
      const [m, l] = ml[i];
      for (let j = 0; j <= M; j++) {
        const k = gi(i, j);
        sx[k] = xs[i]; sy[k] = m - vs[j] * (m + l); sm[k] = m; sl[k] = l;
      }
    }

    // Outline loop, counter-clockwise from above: heel → outer edge → toe → inner edge
    const loop = [heelPole];
    for (let i = 1; i < N; i++) loop.push(gi(i, M));
    loop.push(toePole);
    for (let i = N - 1; i >= 1; i--) loop.push(gi(i, 0));

    // Distance to the edge (only needed where the heel cup lives)
    const cupR = 8 + 0.8 * p.heelCup, dLimit = 0.55 * p.length + cupR;
    const dist = new Float64Array(nSurf).fill(1e9);
    if (p.heelCup > 0) {
      const lx = loop.map(k => sx[k]), ly = loop.map(k => sy[k]), nl = loop.length;
      for (let k = 0; k < nSurf; k++) {
        const x = sx[k];
        if (x > dLimit) continue;
        let best = 1e9;
        for (let s = 0; s < nl; s++) {
          const ax = lx[s], bx = lx[(s + 1) % nl];
          if (Math.min(ax, bx) > x + cupR + 1 || Math.max(ax, bx) < x - cupR - 1) continue;
          const dd = segDist(x, sy[k], ax, ly[s], bx, ly[(s + 1) % nl]);
          if (dd < best) best = dd;
        }
        dist[k] = best;
      }
    }

    // Vertices: top surface [0, nSurf), bottom surface [nSurf, 2 nSurf)
    const pos = new Float32Array(nSurf * 2 * 3);
    let maxTop = 0;
    for (let k = 0; k < nSurf; k++) {
      const [top, bot] = hf(sx[k], sy[k], sm[k], sl[k], dist[k]);
      const y = mirror ? -sy[k] : sy[k];
      pos[k * 3] = sx[k]; pos[k * 3 + 1] = y; pos[k * 3 + 2] = top;
      const b = (nSurf + k) * 3;
      pos[b] = sx[k]; pos[b + 1] = y; pos[b + 2] = bot;
      if (top > maxTop) maxTop = top;
    }

    // Triangles: top, bottom, then side walls
    const tris = [];
    const B = nSurf;
    const pushTop = (a, b, c) => tris.push(a, b, c);
    const pushBot = (a, b, c) => tris.push(B + a, B + c, B + b);
    // poles
    for (let j = 0; j < M; j++) {
      const r0 = gi(1, j), r1 = gi(1, j + 1);
      pushTop(heelPole, r1, r0);
      const q0 = gi(N - 1, j), q1 = gi(N - 1, j + 1);
      pushTop(toePole, q0, q1);
    }
    for (let i = 1; i < N - 1; i++) {
      for (let j = 0; j < M; j++) {
        const a = gi(i, j), b = gi(i, j + 1), c = gi(i + 1, j), d = gi(i + 1, j + 1);
        pushTop(a, b, d); pushTop(a, d, c);
      }
    }
    const nTop = tris.length / 3;
    for (let j = 0; j < M; j++) {
      const r0 = gi(1, j), r1 = gi(1, j + 1);
      pushBot(heelPole, r1, r0);
      const q0 = gi(N - 1, j), q1 = gi(N - 1, j + 1);
      pushBot(toePole, q0, q1);
    }
    for (let i = 1; i < N - 1; i++) {
      for (let j = 0; j < M; j++) {
        const a = gi(i, j), b = gi(i, j + 1), c = gi(i + 1, j), d = gi(i + 1, j + 1);
        pushBot(a, b, d); pushBot(a, d, c);
      }
    }
    const nBot = tris.length / 3 - nTop;
    for (let s = 0; s < loop.length; s++) {
      const u = loop[s], w = loop[(s + 1) % loop.length];
      tris.push(B + u, B + w, w);
      tris.push(B + u, w, u);
    }
    const tri = new Uint32Array(tris);
    if (mirror) for (let t = 0; t < tri.length; t += 3) { const tmp = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = tmp; }

    // Stats
    let vol = 0;
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
      vol += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) -
        pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) +
        pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
    }
    let maxWidth = 0, minY = 1e9, maxY = -1e9;
    for (let i = 0; i <= N; i++) maxWidth = Math.max(maxWidth, ml[i][0] + ml[i][1]);
    for (let k = 0; k < nSurf; k++) { const y = pos[k * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const outline = loop.map(k => [sx[k], mirror ? -sy[k] : sy[k]]);

    return {
      params: p, pos, tri, nSurf,
      counts: { top: nTop, bottom: nBot, wall: tri.length / 3 - nTop - nBot },
      outline,
      stats: {
        length: xe, maxWidth, maxHeight: maxTop, volume: vol / 1000, // cm^3
        weight: (vol / 1000) * DENSITY[p.material], minY, maxY
      }
    };
  }

  /* ---------- Binary STL ---------- */
  function toSTL(meshes) {
    let n = 0;
    for (const m of meshes) n += m.tri.length / 3;
    const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const header = 'Orthotics Builder - binary STL, units mm';
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 32);
    dv.setUint32(80, n, true);
    let o = 84;
    for (const m of meshes) {
      const { pos, tri } = m, ox = m.offsetX || 0, oy = m.offsetY || 0;
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
        for (const v of [a, b, c]) {
          dv.setFloat32(o, pos[v] + ox, true); dv.setFloat32(o + 4, pos[v + 1] + oy, true);
          dv.setFloat32(o + 8, pos[v + 2], true); o += 12;
        }
        dv.setUint16(o, 0, true); o += 2;
      }
    }
    return buf;
  }

  /* ---------- Shoe size to foot length (approximate, Brannock-style) ---------- */
  function lengthFromShoeSize(system, size) {
    const s = Number(size);
    if (!Number.isFinite(s)) return null;
    switch (system) {
      case 'eu': return (s / 1.5 - 1.5) * 10;
      case 'au-m': return (25.4 * (s + 23)) / 3;     // AU/UK men's
      case 'us-m': return (25.4 * (s + 22)) / 3;
      case 'au-w': return (25.4 * (s + 21)) / 3;     // AU/US women's
      default: return null;
    }
  }

  function warnings(input) {
    const p = sanitize(input), w = [];
    const ratioW = p.ballWidth / p.length, ratioH = p.heelWidth / p.ballWidth;
    if (ratioW < 0.32 || ratioW > 0.46) w.push('Ball width is unusual for this foot length. Most feet are 34–42% as wide as they are long — check the measurement.');
    if (ratioH < 0.55 || ratioH > 0.85) w.push('Heel width is usually 60–80% of the ball width. Measure the heel about 2–3 cm forward from the back.');
    if (p.archHeight > 22) w.push('Arch heights above about 20 mm feel aggressive for most people. Start lower and go up 2 mm at a time.');
    if (Math.abs(p.rearPost) > 6 || Math.abs(p.forePost) > 6) w.push('Posts steeper than 6° are uncommon outside a podiatrist\'s prescription.');
    if (p.metPad > 0 && p.coverage === '3q' && p.metPadPos > 64) w.push('The met pad sits at the very end of a 3/4 shell. Move it back or choose sulcus or full length.');
    if (p.style === 'shell' && p.shellThick < 2.5 && p.material !== 'tpu') w.push('Rigid shells under 2.5 mm can crack. Use 2.5–3.5 mm for PETG or PLA.');
    return w;
  }

  root.OrthoGeom = { DEFAULTS, LIMITS, COVERAGE_END, build, toSTL, lengthFromShoeSize, warnings, sanitize };
})(typeof window !== 'undefined' ? window : globalThis);
