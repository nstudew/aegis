// Генерация исходной иконки 1024x1024 (щит на градиенте) без внешних зависимостей.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const SIZE = 1024;
const lerp = (a, b, t) => a + (b - a) * t;

// Цвета градиента (indigo -> violet)
const c1 = [99, 102, 241];
const c2 = [168, 85, 247];

// SDF скруглённого квадрата: <=0 внутри.
function roundedBox(px, py, half, r) {
  const qx = Math.abs(px) - half + r;
  const qy = Math.abs(py) - half + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Силуэт щита: nx,ny центрированы, true если внутри.
function inShield(nx, ny) {
  const top = -0.95, bottom = 1.0;
  if (ny < top || ny > bottom) return false;
  const ty = (ny - top) / (bottom - top); // 0 сверху .. 1 снизу
  let halfW;
  if (ty < 0.5) halfW = 0.62;
  else halfW = 0.62 * Math.pow(1 - (ty - 0.5) / 0.5, 0.8); // плавно в острие
  if (ty < 0.14) {
    const k = ty / 0.14;
    halfW *= Math.sqrt(Math.max(0, 1 - (1 - k) * (1 - k)));
  }
  return Math.abs(nx) <= halfW;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let p = 0;
const half = SIZE * 0.46;
const corner = SIZE * 0.22;
const shieldScale = SIZE * 0.30; // полу-высота щита в пикселях

for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0; // filter byte
  for (let x = 0; x < SIZE; x++) {
    const cx = x - SIZE / 2;
    const cy = y - SIZE / 2;
    const v = y / (SIZE - 1);
    const t = (x / (SIZE - 1) + v) / 2;

    let r = Math.round(lerp(c1[0], c2[0], t));
    let g = Math.round(lerp(c1[1], c2[1], t));
    let b = Math.round(lerp(c1[2], c2[2], t));
    let a = 255;

    // Маска подложки (скруглённый квадрат) с мягким краем.
    const d = roundedBox(cx, cy, half, corner);
    if (d > 1.5) a = 0;
    else if (d > -1.5) a = Math.round(255 * (1 - (d + 1.5) / 3));

    // Щит.
    const nx = cx / shieldScale;
    const ny = (cy - SIZE * 0.02) / shieldScale;
    if (a > 0 && inShield(nx, ny)) {
      const hi = 1 - v * 0.18;
      r = Math.round(lerp(r, 255, 0.94) * hi);
      g = Math.round(lerp(g, 255, 0.94) * hi);
      b = Math.round(lerp(b, 255, 0.97) * hi);
    }

    raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
  }
}

const CRC_TABLE = (() => {
  const tb = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tb[n] = c >>> 0;
  }
  return tb;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6;
const idat = deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);

const out = new URL("../icon-src.png", import.meta.url);
writeFileSync(out, png);
console.log("Wrote", out.pathname, png.length, "bytes");
