/** Minimal PNG decoder (8 bit RGB/RGBA, non interlaced), enough for Chromium screenshots. Dev only. */
import zlib from 'node:zlib';

export function decodePng(buf) {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const type = buf[25];
  const bpp = type === 6 ? 4 : 3;
  const chunks = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i);
    const t = buf.toString('ascii', i + 4, i + 8);
    if (t === 'IDAT') chunks.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (f === 1) row[x] = (row[x] + a) & 255;
      else if (f === 2) row[x] = (row[x] + b) & 255;
      else if (f === 3) row[x] = (row[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 4 + k] = row[x * bpp + k];
    prev = row;
  }
  return { width: w, height: h, data: out };
}

/** Mean absolute horizontal luminance gradient: high for sharp detail, near 0 when blurred. */
export function sharpness(buf) {
  const { width: w, height: h, data: d } = decodePng(buf);
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  let g = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) { const i = (y * w + x) * 4; g += Math.abs(lum(i) - lum(i - 4)); n++; }
  return n ? Math.round((g / n) * 10) / 10 : 0;
}

/** Share (%) of pixels within `tol` of colour `rgb` (e.g. a highlight tint) in a screenshot. */
export function colorShare(buf, rgb, tol = 6) {
  const { width: w, height: h, data: d } = decodePng(buf);
  let hit = 0;
  for (let i = 0; i < w * h * 4; i += 4) if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) hit++;
  return w * h ? Math.round((hit / (w * h)) * 1000) / 10 : 0;
}
