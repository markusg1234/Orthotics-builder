/*
 * Photo measurement for Orthotics Builder.
 * Pure JavaScript, no dependencies. Everything works on a plain
 * { width, height, data } RGBA buffer, so the browser can hand it a canvas and
 * Node can test it without one.
 *
 * The sheet of paper is a rectangle of known size, so its four corners in the
 * photo give a homography onto millimetre space. That removes perspective
 * outright rather than merely scaling by a reference length, which is the part
 * hand-held photos otherwise get wrong: a 15 degree tilt is worth millimetres.
 */
(function (root) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Sheets to lay a foot on. Two A4 taped along the long edge covers feet over
  // 290 mm, which do not fit on one sheet at all.
  const SHEETS = {
    a4: { id: 'a4', label: 'A4', detail: '210 x 297 mm', w: 210, h: 297 },
    letter: { id: 'letter', label: 'US Letter', detail: '216 x 279 mm', w: 216, h: 279 },
    a4x2: { id: 'a4x2', label: 'Two A4', detail: '420 x 297 mm, taped along the long edge', w: 420, h: 297 }
  };

  /* ---------- Pixels ---------- */

  function toGray(img) {
    const n = img.width * img.height, d = img.data, g = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    }
    return { width: img.width, height: img.height, data: g };
  }

  // Box-average down to maxDim on the long side. Finding the sheet does not need
  // full resolution, and the corners are scaled back up afterwards.
  function downscale(gr, maxDim) {
    const f = Math.max(1, Math.ceil(Math.max(gr.width, gr.height) / maxDim));
    if (f === 1) return { width: gr.width, height: gr.height, data: gr.data, scale: 1 };
    const w = Math.max(1, Math.floor(gr.width / f)), h = Math.max(1, Math.floor(gr.height / f));
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let dy = 0; dy < f; dy++) {
          const sy = y * f + dy;
          if (sy >= gr.height) break;
          for (let dx = 0; dx < f; dx++) {
            const sx = x * f + dx;
            if (sx >= gr.width) break;
            s += gr.data[sy * gr.width + sx]; c++;
          }
        }
        out[y * w + x] = c ? (s / c) | 0 : 0;
      }
    }
    return { width: w, height: h, data: out, scale: 1 / f };
  }

  // Otsu: the grey level that best splits the histogram in two. No threshold to
  // tune, which matters because lighting is never the same twice.
  function otsu(data) {
    const hist = new Float64Array(256);
    for (let i = 0; i < data.length; i++) hist[data[i]]++;
    const n = data.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sumB = 0, best = -1, bestT = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = n - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; bestT = t; }
    }
    return bestT;
  }

  /* ---------- Masks ---------- */

  // The largest 4-connected run of set cells, as a new mask.
  function largestBlob(mask, w, h) {
    const n = w * h, lab = new Int32Array(n).fill(-1), stack = new Int32Array(n);
    let best = -1, bestN = 0, id = 0;
    for (let s = 0; s < n; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      let top = 0, count = 0;
      stack[top++] = s; lab[s] = id;
      while (top) {
        const p = stack[--top], x = p % w, y = (p - x) / w;
        count++;
        if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack[top++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack[top++] = p + 1; }
        if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack[top++] = p - w; }
        if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack[top++] = p + w; }
      }
      if (count > bestN) { bestN = count; best = id; }
      id++;
    }
    const out = new Uint8Array(n);
    if (best >= 0) for (let i = 0; i < n; i++) if (lab[i] === best) out[i] = 1;
    return { mask: out, size: bestN };
  }

  // Everything reachable from the frame edge without crossing a set cell.
  // Whatever is left over is enclosed: inside the pen loop, or a hole in a blob.
  function reachableFromBorder(mask, w, h) {
    const n = w * h, out = new Uint8Array(n), stack = new Int32Array(n);
    let top = 0;
    const push = p => { if (!mask[p] && !out[p]) { out[p] = 1; stack[top++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (top) {
      const p = stack[--top], x = p % w, y = (p - x) / w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    return out;
  }

  // Separable box dilate (grow) or erode (shrink) by radius r. Outside the frame
  // counts as unset when growing and set when shrinking, so edges hold still.
  function morph(mask, w, h, r, grow) {
    if (r <= 0) return mask;
    const want = grow ? 1 : 0, edge = grow ? 0 : 1;
    const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let d = -r; d <= r; d++) {
          const xx = x + d, s = xx < 0 || xx >= w ? edge : mask[row + xx];
          if (s === want) { v = want; break; }
        }
        a[row + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = grow ? 0 : 1;
        for (let d = -r; d <= r; d++) {
          const yy = y + d, s = yy < 0 || yy >= h ? edge : a[yy * w + x];
          if (s === want) { v = want; break; }
        }
        b[y * w + x] = v;
      }
    }
    return b;
  }

  /* ---------- Finding the sheet ---------- */

  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // Hull candidates. Every hull vertex is the extreme set cell of its own row or
  // column, so taking just those loses nothing and keeps the hull input tiny.
  function extremeCells(mask, w, h) {
    const pts = [];
    for (let y = 0; y < h; y++) {
      let lo = -1, hi = -1;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (lo < 0) lo = x; hi = x; }
      if (lo >= 0) { pts.push([lo, y]); if (hi !== lo) pts.push([hi, y]); }
    }
    for (let x = 0; x < w; x++) {
      let lo = -1, hi = -1;
      for (let y = 0; y < h; y++) if (mask[y * w + x]) { if (lo < 0) lo = y; hi = y; }
      if (lo >= 0) { pts.push([x, lo]); if (hi !== lo) pts.push([x, hi]); }
    }
    return pts;
  }

  // Four corners of a hull without assuming any ordering: the point farthest from
  // the centroid, the point farthest from that, then the extreme point either side
  // of the line between the two. Walking 1-2-3-4 is then always a simple quad.
  function quadFromHull(hull) {
    if (hull.length < 4) return null;
    let cx = 0, cy = 0;
    for (const p of hull) { cx += p[0]; cy += p[1]; }
    cx /= hull.length; cy /= hull.length;
    const farthest = (ax, ay) => {
      let bi = 0, bd = -1;
      for (let i = 0; i < hull.length; i++) {
        const dx = hull[i][0] - ax, dy = hull[i][1] - ay, d = dx * dx + dy * dy;
        if (d > bd) { bd = d; bi = i; }
      }
      return bi;
    };
    const i1 = farthest(cx, cy), i3 = farthest(hull[i1][0], hull[i1][1]);
    const a = hull[i1], c = hull[i3];
    const ex = c[0] - a[0], ey = c[1] - a[1];
    let i2 = -1, i4 = -1, d2 = 0, d4 = 0;
    for (let i = 0; i < hull.length; i++) {
      const s = (hull[i][0] - a[0]) * ey - (hull[i][1] - a[1]) * ex;
      if (s > d2) { d2 = s; i2 = i; }
      if (-s > d4) { d4 = -s; i4 = i; }
    }
    if (i2 < 0 || i4 < 0 || i1 === i3) return null;
    return [i1, i2, i3, i4];
  }

  // Total-least-squares line through points: a point on it and a unit direction.
  function fitLine(pts) {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) {
      const dx = p[0] - cx, dy = p[1] - cy;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    // Principal eigenvector of the 2x2 covariance, in closed form.
    const t = (sxx - syy) / 2, r = Math.sqrt(t * t + sxy * sxy), lam = (sxx + syy) / 2 + r;
    let vx = sxy, vy = lam - sxx;
    if (Math.abs(vx) + Math.abs(vy) < 1e-9) { vx = lam - syy; vy = sxy; }
    if (Math.abs(vx) + Math.abs(vy) < 1e-9) { vx = 1; vy = 0; }
    const n = Math.hypot(vx, vy);
    return { x: cx, y: cy, dx: vx / n, dy: vy / n };
  }

  function intersect(l1, l2) {
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / den;
    return [l1.x + l1.dx * t, l1.y + l1.dy * t];
  }

  // Each side of the quad carries a run of hull points. Fitting a line to each run
  // and intersecting neighbours puts the corners on sub-pixel positions, which a
  // single hull vertex never is.
  function refineQuad(hull, idx) {
    const n = hull.length, lines = [];
    let diag = 0;
    for (let k = 0; k < 4; k++) {
      const a = hull[idx[k]], b = hull[idx[(k + 2) % 4]];
      diag = Math.max(diag, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    for (let k = 0; k < 4; k++) {
      const s = idx[k], e = idx[(k + 1) % 4], run = [];
      for (let i = s; ; i = (i + 1) % n) { run.push(hull[i]); if (i === e || run.length > n) break; }
      // Drop the end points: they belong to the corners, not to the side.
      const inner = run.length >= 5 ? run.slice(1, -1) : run;
      lines.push(inner.length >= 2 ? fitLine(inner) : null);
    }
    const out = [];
    for (let k = 0; k < 4; k++) {
      const raw = hull[idx[k]], a = lines[(k + 3) % 4], b = lines[k];
      const p = a && b ? intersect(a, b) : null;
      // A degenerate fit can throw a corner across the frame; keep the hull vertex then.
      out.push(p && Math.hypot(p[0] - raw[0], p[1] - raw[1]) < 0.1 * diag ? p : raw.slice());
    }
    return out;
  }

  // Order the corners the way the destination rectangle expects: the first side
  // along the sheet's long edge, wound to match so the result is not mirrored.
  function orderQuad(q, mmW, mmH) {
    let c = q.slice();
    const len = (a, b) => Math.hypot(c[a][0] - c[b][0], c[a][1] - c[b][1]);
    const sideA = (len(0, 1) + len(2, 3)) / 2, sideB = (len(1, 2) + len(3, 0)) / 2;
    if ((mmW >= mmH) !== (sideA >= sideB)) c = [c[1], c[2], c[3], c[0]];
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) c = [c[0], c[3], c[2], c[1]];
    return c;
  }

  // Four points in order, turning the same way at every corner. A quad that fails
  // this is wound through itself, and rectifying it gives nonsense.
  function isConvexQuad(q) {
    if (!q || q.length !== 4) return false;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (z === 0) return false;
      if (sign === 0) sign = z > 0 ? 1 : -1;
      else if ((z > 0 ? 1 : -1) !== sign) return false;
    }
    return true;
  }

  // Gross sanity checks. Detection only has to get close enough that dragging the
  // markers is quick, so these catch blunders and leave the rest to the eye.
  function quadLooksLikeSheet(q, w, h, sheet) {
    if (!isConvexQuad(q)) return false;
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) / 2 < 0.25 * w * h) return false;
    const len = (a, b) => Math.hypot(q[a][0] - q[b][0], q[a][1] - q[b][1]);
    const sa = (len(0, 1) + len(2, 3)) / 2, sb = (len(1, 2) + len(3, 0)) / 2;
    if (sa < 1e-6 || sb < 1e-6) return false;
    const got = Math.max(sa, sb) / Math.min(sa, sb);
    const want = Math.max(sheet.w, sheet.h) / Math.min(sheet.w, sheet.h);
    // Loose, because perspective foreshortens one pair of sides.
    return got > want * 0.6 && got < want * 1.5;
  }

  // The sheet's four corners in the photo, or null to fall back to dragging them.
  function findQuad(img, sheet, opts) {
    const o = opts || {};
    const sm = downscale(toGray(img), o.detectDim || 400);
    const n = sm.width * sm.height, t = otsu(sm.data), bright = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (sm.data[i] >= t) bright[i] = 1;
    const blob = largestBlob(bright, sm.width, sm.height);
    if (blob.size < 0.15 * n) return null;
    const hull = convexHull(extremeCells(blob.mask, sm.width, sm.height));
    const idx = quadFromHull(hull);
    if (!idx) return null;
    const q = refineQuad(hull, idx).map(p => [p[0] / sm.scale, p[1] / sm.scale]);
    if (!quadLooksLikeSheet(q, img.width, img.height, sheet)) return null;
    return orderQuad(q, sheet.w, sheet.h);
  }

  /* ---------- Homography ---------- */

  // The homography taking the four src points to the four dst points, with h8
  // fixed at 1: an 8x8 system solved by Gaussian elimination with partial pivoting.
  function solveHomography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {
      let piv = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-12) return null;
      if (piv !== c) {
        const t = A[piv]; A[piv] = A[c]; A[c] = t;
        const u = b[piv]; b[piv] = b[c]; b[c] = u;
      }
      for (let r = c + 1; r < 8; r++) {
        const f = A[r][c] / A[c][c];
        if (!f) continue;
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = new Float64Array(9);
    h[8] = 1;
    for (let r = 7; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < 8; k++) s -= A[r][k] * h[k];
      h[r] = s / A[r][r];
    }
    return h;
  }

  function applyH(h, x, y) {
    const d = h[6] * x + h[7] * y + h[8];
    return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
  }

  // Resample the quad into millimetre space. Solving the homography the other way
  // round, millimetres to pixels, gives the backward map sampling wants, so there
  // is no matrix to invert.
  function rectify(img, corners, mmW, mmH, pxPerMm) {
    const gr = toGray(img), ppm = pxPerMm || 4;
    const W = Math.max(1, Math.round(mmW * ppm)), H = Math.max(1, Math.round(mmH * ppm));
    const h = solveHomography([[0, 0], [mmW, 0], [mmW, mmH], [0, mmH]], corners);
    if (!h) return null;
    const sw = gr.width, sh = gr.height, sd = gr.data, out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const my = (y + 0.5) / ppm;
      for (let x = 0; x < W; x++) {
        const mx = (x + 0.5) / ppm;
        const d = h[6] * mx + h[7] * my + h[8];
        const sx = (h[0] * mx + h[1] * my + h[2]) / d, sy = (h[3] * mx + h[4] * my + h[5]) / d;
        if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) { out[y * W + x] = 255; continue; }
        const x0 = sx | 0, y0 = sy | 0;
        const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const fx = sx - x0, fy = sy - y0;
        const top = sd[y0 * sw + x0] + (sd[y0 * sw + x1] - sd[y0 * sw + x0]) * fx;
        const bot = sd[y1 * sw + x0] + (sd[y1 * sw + x1] - sd[y1 * sw + x0]) * fx;
        out[y * W + x] = (top + (bot - top) * fy) | 0;
      }
    }
    return { width: W, height: H, data: out, pxPerMm: ppm, mmW, mmH };
  }

  /* ---------- Outline ---------- */

  // Moore-neighbour tracing: walk the set cells that touch the outside.
  function traceBoundary(mask, w, h) {
    let s = -1;
    for (let i = 0; i < w * h; i++) if (mask[i]) { s = i; break; }
    if (s < 0) return [];
    const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    const sx = s % w, sy = (s - sx) / w, out = [];
    // Raster order found it, so nothing above or left is set: we came from the west.
    let cx = sx, cy = sy, back = 4;
    const cap = 8 * (w + h);
    for (let step = 0; step < cap; step++) {
      out.push([cx, cy]);
      let moved = false;
      for (let k = 1; k <= 8; k++) {
        const nd = (back + k) & 7, nx = cx + D[nd][0], ny = cy + D[nd][1];
        if (on(nx, ny)) {
          back = (nd + 4) & 7;
          cx = nx; cy = ny;
          moved = true;
          break;
        }
      }
      if (!moved) break;
      if (cx === sx && cy === sy && out.length > 3) break;
    }
    return out;
  }

  // Douglas-Peucker, with an explicit stack so a long boundary cannot blow the call stack.
  function simplify(pts, tol) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = 1; keep[pts.length - 1] = 1;
    while (stack.length) {
      const seg = stack.pop(), a = seg[0], b = seg[1];
      if (b <= a + 1) continue;
      const ax = pts[a][0], ay = pts[a][1];
      const dx = pts[b][0] - ax, dy = pts[b][1] - ay, len = Math.hypot(dx, dy);
      let bi = -1, bd = tol;
      for (let i = a + 1; i < b; i++) {
        const d = len < 1e-9
          ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
          : Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
        if (d > bd) { bd = d; bi = i; }
      }
      if (bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }

  // A closed outline in millimetres, from a rectified sheet.
  //   'trace' - a pen line drawn around the foot: a thin closed curve.
  //   'print' - a wet footprint, an insole or an orthotic: already a filled shape.
  function extractOutline(rect, mode, opts) {
    const o = opts || {}, w = rect.width, h = rect.height, n = w * h, ppm = rect.pxPerMm;
    const t = otsu(rect.data), ink = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (rect.data[i] < t) ink[i] = 1;
    let solid;
    if (mode === 'trace') {
      // Bridge gaps in the pen line, keep what the line encloses, then grow that
      // back out to the line's inner edge: with the pen held upright, the inner
      // edge is where the foot actually was. Closing also rounds off concavities
      // at the same scale, which costs nothing here because every measurement
      // taken below is an outer extreme.
      const r = Math.max(1, Math.round((o.closeMm != null ? o.closeMm : 2.5) * ppm / 2));
      const thick = morph(ink, w, h, r, true);
      const outside = reachableFromBorder(thick, w, h);
      const inside = new Uint8Array(n);
      let count = 0;
      for (let i = 0; i < n; i++) if (!thick[i] && !outside[i]) { inside[i] = 1; count++; }
      if (count < 0.02 * n) {
        return { error: 'No closed tracing found. Check the pen line has no gaps, and that the whole tracing sits inside the sheet without touching an edge.' };
      }
      if (count > 0.9 * n) return { error: 'Nearly the whole sheet reads as foot. Retake the photo in even light with the sheet filling the frame.' };
      solid = morph(largestBlob(inside, w, h).mask, w, h, r, true);
    } else {
      const big = largestBlob(ink, w, h);
      if (big.size < 0.02 * n) return { error: 'Nothing dark enough found on the sheet. Check the photo is sharp and evenly lit.' };
      if (big.size > 0.9 * n) return { error: 'Nearly the whole sheet reads as dark. Retake the photo in even light.' };
      // Keep the shape plus anything it encloses, so a logo or a dry patch inside
      // a footprint does not punch a hole in it.
      const outside = reachableFromBorder(big.mask, w, h);
      solid = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (!outside[i]) solid[i] = 1;
    }
    const px = traceBoundary(solid, w, h);
    if (px.length < 16) return { error: 'Could not trace an outline. Try a sharper photo with more contrast.' };
    const mm = px.map(p => [(p[0] + 0.5) / ppm, (p[1] + 0.5) / ppm]);
    return { poly: simplify(mm, o.tolMm != null ? o.tolMm : 0.3), threshold: t, mask: solid };
  }

  /* ---------- Measuring ---------- */

  // Width of a closed polyline at station xs, by ray casting.
  function spanAt(pts, xs) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
      if ((x1 - xs) * (x2 - xs) <= 0 && x1 !== x2) {
        const y = y1 + (y2 - y1) * (xs - x1) / (x2 - x1);
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
    }
    return [lo, hi];
  }

  // Translate and rotate so a sits at the origin and b lies on +x.
  function align(poly, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    return poly.map(p => {
      const px = p[0] - a[0], py = p[1] - a[1];
      return [px * ux + py * uy, -px * uy + py * ux];
    });
  }

  // Measure an outline the way the README tells you to measure a foot, so the two
  // routes into the designer cannot disagree.
  function measureOutline(poly) {
    if (!poly || poly.length < 8) return { error: 'Outline too small to measure.' };
    // The farthest-apart pair of points is the back of the heel and the longest toe.
    let ai = 0, bi = 0, best = -1;
    for (let i = 0; i < poly.length; i++) {
      for (let j = i + 1; j < poly.length; j++) {
        const dx = poly[j][0] - poly[i][0], dy = poly[j][1] - poly[i][1], d = dx * dx + dy * dy;
        if (d > best) { best = d; ai = i; bi = j; }
      }
    }
    const L = Math.sqrt(best);
    if (!(L > 20)) return { error: 'Outline too small to measure.' };
    const width = (p, x) => { const s = spanAt(p, x); return isFinite(s[0]) ? s[1] - s[0] : 0; };
    let pts = align(poly, poly[ai], poly[bi]);
    // Which end is the heel? The heel is round, so it is still wide close to the
    // tip; the far end tapers into one toe.
    if (width(pts, 0.88 * L) > width(pts, 0.12 * L)) pts = align(poly, poly[bi], poly[ai]);

    let maxWidth = 0, maxWidthAt = 0;
    for (let i = 1; i < 200; i++) {
      const x = L * i / 200, s = width(pts, x);
      if (s > maxWidth) { maxWidth = s; maxWidthAt = x; }
    }
    // 2-3 cm in from the back, as the measuring instructions say.
    const heelWidth = width(pts, Math.min(25, 0.2 * L));
    let midWidth = Infinity;
    for (let i = 0; i <= 40; i++) {
      const s = width(pts, L * (0.4 + 0.2 * i / 40));
      if (s > 0 && s < midWidth) midWidth = s;
    }

    // Which edge is the inside of the foot? The medial edge is the one that dips
    // towards the centre line at the arch. Flip so medial is +y, the convention
    // the geometry engine uses for a right foot.
    const sag = sign => {
      const x0 = 0.15 * L, x1 = 0.7 * L, s0 = spanAt(pts, x0), s1 = spanAt(pts, x1);
      if (!isFinite(s0[0]) || !isFinite(s1[0])) return 0;
      const yEnd = sign > 0 ? s1[1] : s1[0], yStart = sign > 0 ? s0[1] : s0[0];
      let total = 0;
      for (let i = 1; i < 20; i++) {
        const x = x0 + (x1 - x0) * i / 20, s = spanAt(pts, x);
        if (!isFinite(s[0])) continue;
        const y = sign > 0 ? s[1] : s[0], chord = yStart + (yEnd - yStart) * i / 20;
        total += sign > 0 ? chord - y : y - chord;
      }
      return total;
    };
    if (sag(-1) > sag(1)) pts = pts.map(p => [p[0], -p[1]]);
    const mid = spanAt(pts, 0.5 * L), yc = isFinite(mid[0]) ? (mid[0] + mid[1]) / 2 : 0;
    pts = pts.map(p => [p[0], p[1] - yc]);

    return {
      length: L,
      maxWidth,
      maxWidthAt,
      heelWidth,
      midWidth: isFinite(midWidth) ? midWidth : null,
      csi: isFinite(midWidth) && maxWidth > 0 ? midWidth / maxWidth : null,
      poly: pts
    };
  }

  /* ---------- Footprint shape to a starting arch ---------- */

  // The midfoot-to-forefoot width ratio of a print is the long-standing
  // Chippaux-Smirak index. Published cut-offs scatter badly and most of the
  // validation is in children, so this picks somewhere to start feeling from,
  // never a diagnosis. A high arch leaves a gap worth filling; a flat foot gets a
  // lower, broader support so it is held up rather than jammed.
  const ARCH_BANDS = [
    { max: 0.25, type: 'high', archHeight: 18, archSpread: 60,
      say: 'a high arch: the print barely touches through the middle' },
    { max: 0.45, type: 'average', archHeight: 14, archSpread: 65,
      say: 'an average arch' },
    { max: Infinity, type: 'low', archHeight: 10, archSpread: 72,
      say: 'a low or flat arch: most of the middle of the foot is touching' }
  ];

  function archFromPrint(csi) {
    if (!(csi > 0)) return null;
    for (const b of ARCH_BANDS) {
      if (csi <= b.max) {
        return { type: b.type, say: b.say, csi, archHeight: b.archHeight, archSpread: b.archSpread };
      }
    }
    return null;
  }

  /* ---------- Side view ---------- */

  // The arch is at its lowest when you are standing on it, and that loaded shape
  // is the one an orthotic has to meet: build to it and the support runs the whole
  // length of the arch, which is the point of the thing.
  //
  // A measurement taken sitting is of an arch you will never stand on, so the drop
  // comes off first -- about 7 mm, the middle of the usual 6 to 9 mm of navicular
  // drop. That subtraction is not less support. It is what turns an unloaded
  // measurement into the loaded one, and it is the same correction the arch fill
  // of plaster casting makes. Build the sitting height in full and the orthotic
  // lifts the arch above where it stands rather than supporting it there.
  const ARCH_DROP = 7;
  const DEFAULT_FILL = 100;

  // Your own foot is the ruler, so there is nothing to stand up beside it and
  // nothing in front of the arch. The back of the heel and the tip of the longest
  // toe both sit on the floor, so the line between them is the floor and their
  // separation is the foot length already measured. The arch height is then simply
  // how far the top of the arch stands off that line.
  //
  // This scales but does not correct perspective, which is why the photo wants to
  // be low and square on: a camera tilted 15 degrees reads the arch about 3% high.
  // The published photographic method works the same way and agrees with calipers
  // well, though it does tend to read a little high.
  function archFromSide(marks, opts) {
    const o = opts || {};
    const L = o.footLength > 0 ? o.footLength : 265;
    const h = marks.heel, t = marks.toe, a = marks.apex;
    const dx = t[0] - h[0], dy = t[1] - h[1], span = Math.hypot(dx, dy);
    if (!(span > 40)) {
      return { error: 'The heel and the toe markers are almost on top of each other. Put one on the back of your heel and one on the tip of your longest toe, both where they meet the floor.' };
    }
    const mm = L / span, ux = dx / span, uy = dy / span;
    const px = a[0] - h[0], py = a[1] - h[1];
    const along = (px * ux + py * uy) * mm;    // towards the toes, along the floor
    const clear = (px * uy - py * ux) * mm;    // off the floor line, positive is up
    if (!(clear > 0)) {
      return { error: 'The arch marker came out level with the floor or below it. Put it on the highest point of the arch underneath your foot, and check the heel and toe markers are both down at the floor.' };
    }
    if (clear > 60) return { error: 'The arch came out over 60 mm above the floor, which is too high to be right. Check all three markers.' };
    const apexDist = clamp(along, 0, L);
    const sitting = o.stance === 'sitting';
    const loaded = sitting ? Math.max(0, clear - ARCH_DROP) : clear;
    const fill = o.fill != null ? o.fill : DEFAULT_FILL / 100;
    return {
      clearHeight: clear,
      loadedHeight: loaded,
      stance: sitting ? 'sitting' : 'standing',
      apexDist,
      footLength: L,
      fill,
      archHeight: loaded * fill,
      archPeak: clamp((apexDist / L) * 100, 0, 100)
    };
  }

  root.OrthoPhoto = {
    SHEETS, ARCH_BANDS, ARCH_DROP, DEFAULT_FILL,
    toGray, downscale, otsu, morph, largestBlob, reachableFromBorder,
    convexHull, isConvexQuad, findQuad, orderQuad, solveHomography, applyH, rectify,
    traceBoundary, simplify, extractOutline, spanAt, measureOutline,
    archFromPrint, archFromSide
  };
})(typeof window !== 'undefined' ? window : globalThis);
