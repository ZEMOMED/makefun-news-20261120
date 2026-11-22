'use strict';
// main.ts — draws one editorial plate: the world's news of Friday 20 November 2026.
// Pure Node 22, no dependencies, no network. Writes /output/entry.png (1024x1024, RGB).
// Everything here is hand-rolled on purpose: PNG writer, TrueType rasterizer, layout.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const W = 1024;
const H = 1024;

/* ------------------------------------------------------------------ colours */

const PAPER = [244, 238, 227];
const INK = [22, 20, 17];
const MUTED = [104, 95, 84];
const RULE = [196, 185, 168];
const ACCENT = [176, 49, 32];
const SEA = [26, 38, 45];
const SKY = [232, 222, 205];
const SMOKE = [110, 104, 96];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/* ------------------------------------------------------------------- canvas */

function canvas(w, h, bg) {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = bg[0];
    data[i * 3 + 1] = bg[1];
    data[i * 3 + 2] = bg[2];
  }
  return { w, h, data };
}

function blend(cv, x, y, col, a) {
  if (a === undefined || a === null) a = 1;
  if (!(a > 0)) return;
  if (a > 1) a = 1;
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 3;
  const d = cv.data;
  d[i] = Math.round(d[i] * (1 - a) + col[0] * a);
  d[i + 1] = Math.round(d[i + 1] * (1 - a) + col[1] * a);
  d[i + 2] = Math.round(d[i + 2] * (1 - a) + col[2] * a);
}

function fillRect(cv, x0, y0, x1, y1, col, a) {
  const xa = Math.max(0, Math.round(x0));
  const xb = Math.min(cv.w, Math.round(x1));
  const ya = Math.max(0, Math.round(y0));
  const yb = Math.min(cv.h, Math.round(y1));
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) blend(cv, x, y, col, a);
}

// Vertical gradient inside a rectangle (used for the sky and the sea).
function vGradient(cv, x0, y0, x1, y1, top, bottom) {
  const xa = Math.max(0, Math.round(x0));
  const xb = Math.min(cv.w, Math.round(x1));
  const ya = Math.max(0, Math.round(y0));
  const yb = Math.min(cv.h, Math.round(y1));
  for (let y = ya; y < yb; y++) {
    const t = yb > ya ? (y - ya) / (yb - ya) : 0;
    const col = mix(top, bottom, t);
    for (let x = xa; x < xb; x++) {
      const i = (y * cv.w + x) * 3;
      cv.data[i] = col[0];
      cv.data[i + 1] = col[1];
      cv.data[i + 2] = col[2];
    }
  }
}

function fillDisc(cv, cx, cy, r, col, a) {
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(cv.h, Math.ceil(cy + r));
  for (let y = ya; y < yb; y++) {
    const dy = y + 0.5 - cy;
    const w = r * r - dy * dy;
    if (w <= 0) continue;
    const half = Math.sqrt(w);
    const xa = Math.max(0, Math.floor(cx - half));
    const xb = Math.min(cv.w, Math.ceil(cx + half));
    for (let x = xa; x < xb; x++) {
      // 4x4 coverage on the rim only keeps the edge soft without slowing the body.
      const px = x + 0.5 - cx;
      const d = Math.sqrt(px * px + dy * dy);
      const cov = Math.max(0, Math.min(1, r + 0.5 - d));
      if (cov > 0) blend(cv, x, y, col, a * cov);
    }
  }
}

// A soft radial falloff, for a sun's haze or a fire's light.
function fillGlow(cv, cx, cy, r, col, aMax, power) {
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(cv.h, Math.ceil(cy + r));
  for (let y = ya; y < yb; y++) {
    const dy = y + 0.5 - cy;
    const xa = Math.max(0, Math.floor(cx - r));
    const xb = Math.min(cv.w, Math.ceil(cx + r));
    for (let x = xa; x < xb; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) continue;
      const a = aMax * Math.pow(1 - d, power || 2);
      if (a > 0.002) blend(cv, x, y, col, a);
    }
  }
}

/* ---------------------------------------------- polygon fill (antialiased) */

const SUBROWS = 4;

// contours: array of arrays of [x, y] in device pixels; nonzero winding.
function fillContours(cv, contours, col, alpha) {
  if (alpha === undefined || alpha === null) alpha = 1;
  const edges = [];
  let ymin = Infinity;
  let ymax = -Infinity;
  let xmin = Infinity;
  let xmax = -Infinity;
  for (const c of contours) {
    const n = c.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = c[i];
      const b = c[(i + 1) % n];
      if (a[1] === b[1]) continue;
      edges.push([a[0], a[1], b[0], b[1]]);
      if (a[1] < ymin) ymin = a[1];
      if (a[1] > ymax) ymax = a[1];
      if (a[0] < xmin) xmin = a[0];
      if (a[0] > xmax) xmax = a[0];
      if (b[1] < ymin) ymin = b[1];
      if (b[1] > ymax) ymax = b[1];
      if (b[0] < xmin) xmin = b[0];
      if (b[0] > xmax) xmax = b[0];
    }
  }
  if (!edges.length) return;
  const y0 = Math.max(0, Math.floor(ymin));
  const y1 = Math.min(cv.h, Math.ceil(ymax));
  const xa = Math.max(0, Math.floor(xmin));
  const xb = Math.min(cv.w, Math.ceil(xmax) + 1);
  if (xb <= xa || y1 <= y0) return;
  const span = xb - xa;
  const row = new Float32Array(span);
  const xs = [];

  for (let y = y0; y < y1; y++) {
    row.fill(0);
    let touched = false;
    for (let s = 0; s < SUBROWS; s++) {
      const sy = y + (s + 0.5) / SUBROWS;
      xs.length = 0;
      for (let e = 0; e < edges.length; e++) {
        const ed = edges[e];
        const ay = ed[1];
        const by = ed[3];
        if (ay <= sy) {
          if (by > sy) xs.push([ed[0] + ((sy - ay) / (by - ay)) * (ed[2] - ed[0]), 1]);
        } else if (by <= sy) {
          xs.push([ed[0] + ((sy - ay) / (by - ay)) * (ed[2] - ed[0]), -1]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      let start = 0;
      for (let k = 0; k < xs.length; k++) {
        const prev = wind;
        wind += xs[k][1];
        if (prev === 0 && wind !== 0) {
          start = xs[k][0];
        } else if (prev !== 0 && wind === 0) {
          let sxa = start - xa;
          let sxb = xs[k][0] - xa;
          touched = true;
          if (sxb < 0 || sxa > span) continue;
          if (sxa < 0) sxa = 0;
          if (sxb > span) sxb = span;
          const ia = Math.floor(sxa);
          const ib = Math.floor(sxb);
          const w = 1 / SUBROWS;
          if (ia === ib) {
            row[ia] += (sxb - sxa) * w;
          } else {
            row[ia] += (ia + 1 - sxa) * w;
            for (let x = ia + 1; x < ib; x++) row[x] += w;
            if (ib < span) row[ib] += (sxb - ib) * w;
          }
        }
      }
    }
    if (!touched) continue;
    for (let x = 0; x < span; x++) {
      const a = row[x];
      if (a > 0.001) blend(cv, xa + x, y, col, Math.min(1, a) * alpha);
    }
  }
}

function strokePolyline(cv, pts, width, col, alpha) {
  const hw = width / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * hw;
    const ny = (dx / len) * hw;
    fillContours(
      cv,
      [[[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]],
      col,
      alpha,
    );
  }
}

function line(cv, x0, y0, x1, y1, col, width, alpha) {
  strokePolyline(cv, [[x0, y0], [x1, y1]], width, col, alpha === undefined ? 1 : alpha);
}

/* ------------------------------------------------------------ TrueType font */

function readTables(buf) {
  const numTables = buf.readUInt16BE(4);
  const t = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = buf.toString('latin1', off, off + 4);
    t[tag] = { offset: buf.readUInt32BE(off + 8), length: buf.readUInt32BE(off + 12) };
  }
  return t;
}

function loadFont(file) {
  const buf = fs.readFileSync(file);
  const t = readTables(buf);
  const head = t.head.offset;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const locFmt = buf.readInt16BE(head + 50);
  const numGlyphs = buf.readUInt16BE(t.maxp.offset + 4);
  const numH = buf.readUInt16BE(t.hhea.offset + 34);
  const asc = buf.readInt16BE(t.hhea.offset + 4);
  const desc = buf.readInt16BE(t.hhea.offset + 6);

  const adv = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) {
    const i = g < numH ? g : numH - 1;
    adv[g] = buf.readUInt16BE(t.hmtx.offset + i * 4);
  }

  const locaOff = t.loca.offset;
  const glyfOff = t.glyf.offset;
  const loca = new Uint32Array(numGlyphs + 1);
  for (let g = 0; g <= numGlyphs; g++) {
    const raw = locFmt === 0 ? buf.readUInt16BE(locaOff + g * 2) * 2 : buf.readUInt32BE(locaOff + g * 4);
    loca[g] = raw + glyfOff; // loca holds offsets from the start of glyf
  }

  // cmap: prefer a full Unicode (format 12) map, else the BMP one (format 4).
  let best12 = 0;
  let best4 = 0;
  const cmapOff = t.cmap.offset;
  const nSub = buf.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < nSub; i++) {
    const rec = cmapOff + 4 + i * 8;
    const pid = buf.readUInt16BE(rec);
    const eid = buf.readUInt16BE(rec + 2);
    const so = cmapOff + buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(so);
    if (format === 12 && (pid === 3 || pid === 0)) best12 = so;
    if (format === 4 && pid === 3 && eid === 1 && !best4) best4 = so;
    if (format === 4 && pid === 0 && !best4) best4 = so;
  }

  function lookup(cp) {
    if (best12) {
      const nGroups = buf.readUInt32BE(best12 + 12);
      let lo = 0;
      let hi = nGroups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = best12 + 16 + mid * 12;
        const s = buf.readUInt32BE(g);
        const e = buf.readUInt32BE(g + 4);
        if (cp < s) hi = mid - 1;
        else if (cp > e) lo = mid + 1;
        else return buf.readUInt32BE(g + 8) + (cp - s);
      }
      return 0;
    }
    if (best4) {
      const segX2 = buf.readUInt16BE(best4 + 6);
      const endBase = best4 + 14;
      const startBase = endBase + segX2 + 2;
      const deltaBase = startBase + segX2;
      const rangeBase = deltaBase + segX2;
      let lo = 0;
      let hi = segX2 / 2 - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const end = buf.readUInt16BE(endBase + mid * 2);
        const start = buf.readUInt16BE(startBase + mid * 2);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else {
          const delta = buf.readInt16BE(deltaBase + mid * 2);
          const ro = buf.readUInt16BE(rangeBase + mid * 2);
          if (ro === 0) return (cp + delta) & 0xffff;
          const gi = buf.readUInt16BE(rangeBase + mid * 2 + ro + (cp - start) * 2);
          return gi === 0 ? 0 : (gi + delta) & 0xffff;
        }
      }
      return 0;
    }
    return 0;
  }

  function glyphContours(gid, depth) {
    if (gid >= numGlyphs || depth > 4) return [];
    const o = loca[gid];
    const end = loca[gid + 1];
    if (end <= o) return [];
    const nc = buf.readInt16BE(o);
    if (nc < 0) {
      // composite glyph: place components, then carry on.
      const out = [];
      let p = o + 10;
      for (;;) {
        const flags = buf.readUInt16BE(p);
        const comp = buf.readUInt16BE(p + 2);
        p += 4;
        let dx;
        let dy;
        if (flags & 0x0001) {
          dx = buf.readInt16BE(p);
          dy = buf.readInt16BE(p + 2);
          p += 4;
        } else {
          dx = buf.readInt8(p);
          dy = buf.readInt8(p + 1);
          p += 2;
        }
        let a = 1;
        let b = 0;
        let cc = 0;
        let d = 1;
        if (flags & 0x0008) {
          a = d = buf.readInt16BE(p) / 16384;
          p += 2;
        } else if (flags & 0x0040) {
          a = buf.readInt16BE(p) / 16384;
          d = buf.readInt16BE(p + 2) / 16384;
          p += 4;
        } else if (flags & 0x0080) {
          a = buf.readInt16BE(p) / 16384;
          b = buf.readInt16BE(p + 2) / 16384;
          cc = buf.readInt16BE(p + 4) / 16384;
          d = buf.readInt16BE(p + 6) / 16384;
          p += 8;
        }
        for (const c of glyphContours(comp, depth + 1)) {
          out.push(
            c.map(([x, y]) => [a * x + cc * y + dx, b * x + d * y + dy]),
          );
        }
        if (!(flags & 0x0020)) break;
      }
      return out;
    }
    const endPts = [];
    let p = o + 10;
    for (let i = 0; i < nc; i++) {
      endPts.push(buf.readUInt16BE(p));
      p += 2;
    }
    const nPts = endPts.length ? endPts[endPts.length - 1] + 1 : 0;
    if (!nPts) return [];
    const insLen = buf.readUInt16BE(p);
    p += 2 + insLen;

    const flags = new Uint8Array(nPts);
    for (let i = 0; i < nPts; ) {
      const f = buf.readUInt8(p++);
      flags[i++] = f;
      if (f & 0x08) {
        const rep = buf.readUInt8(p++);
        for (let r = 0; r < rep && i < nPts; r++) flags[i++] = f;
      }
    }
    const xs = new Int32Array(nPts);
    let v = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 0x02) {
        const d = buf.readUInt8(p++);
        v += f & 0x10 ? d : -d;
      } else if (!(f & 0x10)) {
        v += buf.readInt16BE(p);
        p += 2;
      }
      xs[i] = v;
    }
    const ys = new Int32Array(nPts);
    v = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 0x04) {
        const d = buf.readUInt8(p++);
        v += f & 0x20 ? d : -d;
      } else if (!(f & 0x20)) {
        v += buf.readInt16BE(p);
        p += 2;
      }
      ys[i] = v;
    }

    const out = [];
    let start = 0;
    for (let ci = 0; ci < nc; ci++) {
      const stop = endPts[ci];
      const pts = [];
      for (let i = start; i <= stop; i++) pts.push([xs[i], ys[i], (flags[i] & 1) === 1]);
      start = stop + 1;
      out.push(pts);
    }
    return out;
  }

  return { buf, unitsPerEm, adv, lookup, glyphContours, asc, desc, numGlyphs };
}

// Turn one TrueType contour (mix of on-curve and off-curve points) into
// straight segments, flattening the quadratic curves.
/* Walk a TrueType contour once: on-curve points become line ends, off-curve
   points become quadratic control points, and the walk stops where it began. */
function flattenContour(pts, scale, dx, dy) {
  const n = pts.length;
  if (n < 2) return [];
  const at = (i) => {
    const q = pts[((i % n) + n) % n];
    return [q[0] * scale + dx, dy - q[1] * scale];
  };
  const on = (i) => pts[((i % n) + n) % n][2];
  const out = [];
  const put = (p) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) return;
    out.push(p);
  };
  const quad = (p0, c, p1) => {
    const len = Math.hypot(p0[0] - c[0], p0[1] - c[1]) + Math.hypot(p1[0] - c[0], p1[1] - c[1]);
    const steps = Math.max(3, Math.min(16, Math.ceil(len / 2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      put([
        u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
        u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
      ]);
    }
  };

  let s = -1;
  for (let i = 0; i < n; i++) if (pts[i][2]) {
    s = i;
    break;
  }

  if (s === -1) {
    // all off-curve: begin at the midpoint of the first pair and never restart
    const a = at(0);
    const b = at(1);
    let cur = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    out.push(cur);
    for (let k = 1; k < n + 1; k++) {
      const c = at(k);
      const d = at(k + 1);
      const mid = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
      quad(cur, c, mid);
      cur = mid;
    }
    return out;
  }

  out.push(at(s));
  let cur = at(s);
  let i = s + 1;
  for (let guard = 0; guard < n + 2; guard++) {
    if (on(i)) {
      cur = at(i);
      put(cur);
      i += 1;
    } else if (on(i + 1)) {
      const p = at(i + 1);
      quad(cur, at(i), p);
      cur = p;
      i += 2;
    } else {
      const c = at(i);
      const d = at(i + 1);
      const mid = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
      quad(cur, c, mid);
      cur = mid;
      i += 1;
    }
    if (i >= s + n) break;
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
    else break;
  }
  return out;
}

const glyphCache = new Map();

function glyphPaths(font, gid, scale) {
  const key = `${font.id}:${gid}:${scale.toFixed(3)}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const raw = font.glyphContours(gid, 0);
  const out = raw.map((c) => flattenContour(c, scale, 0, 0)).filter((c) => c.length > 2);
  glyphCache.set(key, out);
  return out;
}

/* --------------------------------------------------------------------- text */

function measure(font, text, size, track) {
  const scale = size / font.unitsPerEm;
  let x = 0;
  for (const ch of text) {
    const gid = font.lookup(ch.codePointAt(0));
    x += font.adv[gid] * scale + (track || 0);
  }
  return x;
}

function drawText(cv, font, text, x, baseY, size, col, opts) {
  const o = opts || {};
  const track = o.track || 0;
  const scale = size / font.unitsPerEm;
  let pen = x;
  if (o.align === 'center') pen = x - measure(font, text, size, track) / 2;
  else if (o.align === 'right') pen = x - measure(font, text, size, track);
  const weight = o.weight || 0; // faux-bold by a second strike
  const alpha = o.alpha === undefined ? 1 : o.alpha;
  for (const ch of text) {
    const gid = font.lookup(ch.codePointAt(0));
    if (gid) {
      const paths = glyphPaths(font, gid, scale);
      // one glyph is one set of contours: the counters are holes only when
      // they are filled with the outline in the same winding pass.
      const moved = paths.map((c) => c.map(([px, py]) => [px + pen, py + baseY]));
      if (moved.length) {
        fillContours(cv, moved, col, alpha);
        if (weight > 0) {
          fillContours(cv, moved.map((c) => c.map(([px, py]) => [px + weight, py])), col, alpha);
        }
      }
    }
    pen += font.adv[gid] * scale + track;
  }
  return pen;
}

function wrap(font, text, size, width, track) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (measure(font, test, size, track) <= width || !cur) cur = test;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/* ---------------------------------------------------------------------- png */

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, 'latin1'), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePNG(cv) {
  const raw = Buffer.alloc((cv.w * 3 + 1) * cv.h);
  for (let y = 0; y < cv.h; y++) {
    raw[y * (cv.w * 3 + 1)] = 0;
    Buffer.from(cv.data.buffer, y * cv.w * 3, cv.w * 3).copy(raw, y * (cv.w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- the plate */

const here = __dirname;
const serif = loadFont(path.join(here, 'fonts', 'InstrumentSerif-Regular.ttf'));
serif.id = 'serif';
const serifItalic = loadFont(path.join(here, 'fonts', 'InstrumentSerif-Italic.ttf'));
serifItalic.id = 'serifI';
const sans = loadFont(path.join(here, 'fonts', 'Inter.ttf'));
sans.id = 'sans';

const cv = canvas(W, H, PAPER);
const M = 64;
const CW = W - M * 2;
const warnings = [];
function fits(tag, lines, max) {
  if (lines.length > max) warnings.push(tag + ': ' + lines.length + ' lines');
}

/* masthead ----------------------------------------------------------------- */

drawText(cv, sans, 'FRIDAY 20 NOVEMBER 2026', M, 90, 12, INK, { track: 3.1, weight: 0.6 });
drawText(cv, sans, 'WORLD EDITION', W - M, 90, 12, ACCENT, { track: 3.1, align: 'right', weight: 0.6 });
fillRect(cv, M, 102, W - M, 104.2, INK);

drawText(cv, serif, 'ONE DAY', M - 4, 218, 116, INK, { track: 1 });
const npW = measure(serif, 'ONE DAY', 116, 1);
drawText(cv, serifItalic, 'the world in a single frame', M + npW + 26, 196, 23, MUTED);
drawText(cv, sans, 'VOL. I   N\u00B0 324', W - M, 196, 11, MUTED, { track: 2.2, align: 'right' });
fillRect(cv, M, 236, W - M, 239.5, INK);

/* lead --------------------------------------------------------------------- */

drawText(cv, sans, 'THE LEAD', M, 268, 10.5, ACCENT, { track: 2.8, weight: 0.5 });

const lead = 'A tanker burns in Hormuz, a Russian missile falls on Poland';
const leadLines = wrap(serif, lead, 45, CW - 4, -0.5);
fits('lead', leadLines, 2);
leadLines.forEach((ln, i) => drawText(cv, serif, ln, M, 312 + i * 49, 45, INK, { track: -0.5 }));

const deck =
  'The war with Iran reached the water and the war in Ukraine reached the edge of NATO, as Saudi jets struck Yemen, a Mexican kingpin was seized and a mathematician claimed the Riemann hypothesis.';
const deckLines = wrap(serifItalic, deck, 20.5, CW - 120, 0);
fits('deck', deckLines, 3);
const deckTop = 312 + leadLines.length * 49 + 12;
deckLines.forEach((ln, i) => drawText(cv, serifItalic, ln, M, deckTop + i * 26, 20.5, MUTED));

/* plate: the strait -------------------------------------------------------- */

const artTop = 452;
const artBot = 640;
const horizon = 586;
const AX0 = M;
const AX1 = W - M;
const sunX = AX0 + 700;

vGradient(cv, AX0, artTop, AX1, horizon, [228, 217, 198], [252, 247, 238]);
// a low sun, softened by haze rather than ringed
fillGlow(cv, sunX, horizon - 30, 96, [232, 170, 136], 0.5, 2.4);
fillDisc(cv, sunX, horizon - 30, 42, [212, 122, 84], 0.94);

// far shore, off to port
fillContours(
  cv,
  [[[AX0, horizon - 1], [AX0, horizon - 8], [AX0 + 62, horizon - 11], [AX0 + 134, horizon - 5], [AX0 + 210, horizon - 9], [AX0 + 268, horizon - 3], [AX0 + 268, horizon - 1]]],
  [188, 176, 158],
);

vGradient(cv, AX0, horizon, AX1, artBot, [46, 64, 72], [14, 23, 29]);
// the sun's track, broken by the swell
for (let i = 0; i < 24; i++) {
  const yy = horizon + 2 + i * 2.1;
  const wd = 104 - i * 3.4;
  if (wd <= 6) break;
  fillRect(cv, sunX - wd / 2 + i * 1.1, yy, sunX + wd / 2 + i * 1.1, yy + 1, [255, 238, 214], 0.12);
}
for (let i = 0; i < 34; i++) {
  const yy = horizon + 4 + i * 1.55;
  const x0 = AX0 + ((i * 137) % 700);
  const len = 26 + ((i * 53) % 90);
  fillRect(cv, x0, yy, Math.min(x0 + len, AX1 - 2), yy + 0.9, [206, 228, 234], 0.045 + (i % 4) * 0.016);
}

/* the tanker: a long low hull, accommodation aft, one funnel, a foremast */
const deckY = 568;
const plumes = [
  [470, 546, 156],
  [520, 528, 190],
  [586, 512, 214],
];
for (let p = 0; p < plumes.length; p++) {
  const px = plumes[p][0];
  const py = plumes[p][1];
  const len = plumes[p][2];
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const cx = px + t * t * len * 0.8 + Math.sin(i * 1.7 + p) * 5;
    const cy = py - t * len * 0.9;
    const r = (9 + t * 30) * (p === 1 ? 1.05 : p === 2 ? 0.78 : 1);
    const tone = p === 2 ? [132, 125, 114] : [96, 90, 82];
    fillDisc(cv, cx, cy, r, tone, 0.11 * (1 - t * 0.55));
  }
}

fillContours(cv, [[[374, deckY], [642, deckY - 4], [630, 598], [388, 600]]], [26, 24, 22]);
fillRect(cv, 380, deckY - 4, 636, deckY + 2, [26, 24, 22]);
fillRect(cv, 556, 534, 612, deckY, [26, 24, 22]); // accommodation
fillRect(cv, 572, 514, 592, 534, [26, 24, 22]); // funnel
fillRect(cv, 570, 512, 594, 516, [26, 24, 22]);
for (let w = 0; w < 3; w++) fillRect(cv, 564 + w * 16, 540, 573 + w * 16, 548, SKY);
line(cv, 430, deckY, 430, 524, [26, 24, 22], 3); // deck crane
line(cv, 430, 526, 478, 518, [26, 24, 22], 2.4);
line(cv, 474, 519, 474, 534, [26, 24, 22], 1.2);
line(cv, 396, deckY, 396, 522, [26, 24, 22], 2); // foremast
line(cv, 388, 528, 404, 528, [26, 24, 22], 1.4);
line(cv, 386, deckY - 2, 552, deckY - 2, [214, 236, 240], 1, 0.3); // rail

// fire: three tones, in front of the smoke, with its light thrown on the water
fillGlow(cv, 482, 548, 78, [234, 140, 78], 0.3, 2.1);
fillContours(
  cv,
  [[[452, deckY + 2], [462, 522], [476, 546], [492, 500], [508, 542], [522, deckY + 2]]],
  [186, 58, 32],
);
fillContours(
  cv,
  [[[460, deckY + 2], [470, 534], [480, 552], [494, 518], [506, 550], [516, deckY + 2]]],
  [228, 118, 52],
);
fillContours(
  cv,
  [[[468, deckY + 2], [477, 542], [483, 552], [494, 532], [502, 552], [509, deckY + 2]]],
  [250, 206, 138],
);
for (let i = 0; i < 14; i++) {
  const yy = 592 + i * 3.2;
  const wd = 76 - i * 4;
  if (wd <= 4) break;
  fillRect(cv, 482 - wd / 2 + i * 1.4, yy, 482 + wd / 2 + i * 1.4, yy + 1.2, [236, 138, 74], 0.16);
}
line(cv, 374, deckY, 640, deckY - 4, [104, 150, 160], 1, 0.35); // waterline

fillRect(cv, AX0, artTop - 1, AX1, artTop, RULE);
fillRect(cv, AX0, artBot, AX1, artBot + 1, RULE);
drawText(
  cv,
  sans,
  'THE STRAIT OF HORMUZ \u00B7 A TANKER BURNING OFF KHASAB, OMAN',
  AX0 + 13,
  artBot - 11,
  8.5,
  [252, 245, 234],
  { track: 1.5, alpha: 0.85 },
);

/* briefs ------------------------------------------------------------------- */

const briefs = [
  {
    n: '01',
    kicker: 'POLAND',
    head: 'A Russian missile lands inside NATO',
    body:
      'A Kh-101 hits a field near Nowy Lipowiec, 60 miles from a coalition exercise; air-raid alerts sound in the southeast.',
  },
  {
    n: '02',
    kicker: 'YEMEN',
    head: 'Saudi jets hit Hodeidah and the north',
    body:
      'The coalition strikes Houthi smuggling at the port and targets in Sanaa, Saada and Taiz. 193 fighters are reported hit.',
  },
  {
    n: '03',
    kicker: 'NIGERIA',
    head: 'A funeral boat capsizes: 24 dead',
    body:
      'A vessel carrying mourners overturns in Bayelsa State. Twenty-four people are pulled from the water alive.',
  },
  {
    n: '04',
    kicker: 'MEXICO',
    head: 'An FBI fugitive is seized in Sinaloa',
    body:
      'Special forces take Fausto Isidro Meza Flores, a Ten Most Wanted kingpin, in Guasave. Gun battles follow.',
  },
  {
    n: '05',
    kicker: 'MATHEMATICS',
    head: 'A claimed proof of Riemann',
    body:
      'Levent Alp\u00F6ge of Anthropic publishes a proof of the 167-year-old conjecture, made with Claude.',
  },
  {
    n: '06',
    kicker: 'STRAIT OF HORMUZ',
    head: 'A tanker ablaze off Oman',
    body:
      'The IRGC navy and UKMTO report an oil tanker damaged and on fire near Khasab as it tried to transit the strait.',
  },
];

const colW = (CW - 56) / 3;
const gridTop = 664;
const rowPitch = 126;
briefs.forEach((b, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const x = M + col * (colW + 28);
  const y = gridTop + row * rowPitch;
  drawText(cv, sans, b.n, x, y + 2, 9.5, ACCENT, { track: 1.8, weight: 0.5 });
  drawText(cv, sans, b.kicker, x + 21, y + 2, 9.5, MUTED, { track: 1.8, weight: 0.4 });
  fillRect(cv, x, y + 8, x + colW, y + 9, RULE);
  const hl = wrap(serif, b.head, 20, colW - 2, 0);
  fits(b.kicker, hl, 2);
  hl.forEach((ln, k) => drawText(cv, serif, ln, x, y + 31 + k * 20.5, 20, INK));
  const bl = wrap(sans, b.body, 11.5, colW - 2, 0);
  fits(b.kicker + ' body', bl, 3);
  bl.forEach((ln, k) => drawText(cv, sans, ln, x, y + 70 + k * 14.5, 11.5, [62, 57, 50]));
});

/* also today ---------------------------------------------------------------- */

const alsoTop = 900;
fillRect(cv, M, alsoTop, W - M, alsoTop + 1, INK);
drawText(cv, sans, 'ALSO TODAY', M, alsoTop + 20, 9.5, ACCENT, { track: 2.2, weight: 0.5 });
const also =
  'Italy stops for a general strike \u00B7 Iraq agrees a joint operations centre with Kata\u2019ib Hezbollah \u00B7 three Salvadoran soldiers die in Haiti \u00B7 Haiti and El Salvador plan three new prisons';
const alsoLines = wrap(sans, also, 11.5, CW - 92, 0);
fits('also', alsoLines, 2);
alsoLines.forEach((ln, k) => drawText(cv, sans, ln, M + 92, alsoTop + 20 + k * 14.5, 11.5, [62, 57, 50]));

/* footer -------------------------------------------------------------------- */

const footY = alsoTop + 20 + alsoLines.length * 14.5 + 14;
fillRect(cv, M, footY, W - M, footY + 1, RULE);
drawText(
  cv,
  sans,
  'SOURCES  AP \u00B7 AL JAZEERA \u00B7 BBC \u00B7 ARAB NEWS \u00B7 AFP \u00B7 WIKIPEDIA CURRENT EVENTS FOR 20 NOVEMBER 2026',
  M,
  footY + 16,
  8.5,
  MUTED,
  { track: 0.9 },
);
drawText(cv, sans, 'ONE PLATE A DAY', W - M, footY + 16, 8.5, MUTED, { track: 1.4, align: 'right' });
if (footY + 16 > H - 20) warnings.push('footer too low: ' + (footY + 16));

if (warnings.length) console.error('layout warnings: ' + warnings.join(' | '));

const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const outFile = path.join(outDir, 'entry.png');
fs.mkdirSync(outDir, { recursive: true });
const png = encodePNG(cv);
fs.writeFileSync(outFile, png);
console.error('wrote ' + outFile + ' (' + png.length + ' bytes, ' + W + 'x' + H + ')');
