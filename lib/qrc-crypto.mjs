// QRC 歌词用的 3DES 实现。
//
// ⚠️ 这不是标准 DES。腾讯用的那份参考实现里有两处笔误，和标准 S 盒对不上：
// sbox2 第 24 个值是 15（标准是 14），sbox4 第 54 个值是 10（标准是 1）。
// 因此 Node 自带的 des-ede3 解不开 QRC，必须用这份。
//
// 移植自 MIT 协议的 QQMusicDecoder（DESHelper.cs）：
// https://github.com/WXRIW/QQMusicDecoder
const sbox1 = [
  14,  4, 13,  1,  2, 15, 11,  8,  3, 10,  6, 12,  5,  9,  0,  7,
   0, 15,  7,  4, 14,  2, 13,  1, 10,  6, 12, 11,  9,  5,  3,  8,
   4,  1, 14,  8, 13,  6,  2, 11, 15, 12,  9,  7,  3, 10,  5,  0,
  15, 12,  8,  2,  4,  9,  1,  7,  5, 11,  3, 14, 10,  0,  6, 13,
];
const sbox2 = [
  15,  1,  8, 14,  6, 11,  3,  4,  9,  7,  2, 13, 12,  0,  5, 10,
   3, 13,  4,  7, 15,  2,  8, 15, 12,  0,  1, 10,  6,  9, 11,  5,
   0, 14,  7, 11, 10,  4, 13,  1,  5,  8, 12,  6,  9,  3,  2, 15,
  13,  8, 10,  1,  3, 15,  4,  2, 11,  6,  7, 12,  0,  5, 14,  9,
];
const sbox3 = [
  10,  0,  9, 14,  6,  3, 15,  5,  1, 13, 12,  7, 11,  4,  2,  8,
  13,  7,  0,  9,  3,  4,  6, 10,  2,  8,  5, 14, 12, 11, 15,  1,
  13,  6,  4,  9,  8, 15,  3,  0, 11,  1,  2, 12,  5, 10, 14,  7,
   1, 10, 13,  0,  6,  9,  8,  7,  4, 15, 14,  3, 11,  5,  2, 12,
];
const sbox4 = [
   7, 13, 14,  3,  0,  6,  9, 10,  1,  2,  8,  5, 11, 12,  4, 15,
  13,  8, 11,  5,  6, 15,  0,  3,  4,  7,  2, 12,  1, 10, 14,  9,
  10,  6,  9,  0, 12, 11,  7, 13, 15,  1,  3, 14,  5,  2,  8,  4,
   3, 15,  0,  6, 10, 10, 13,  8,  9,  4,  5, 11, 12,  7,  2, 14,
];
const sbox5 = [
   2, 12,  4,  1,  7, 10, 11,  6,  8,  5,  3, 15, 13,  0, 14,  9,
  14, 11,  2, 12,  4,  7, 13,  1,  5,  0, 15, 10,  3,  9,  8,  6,
   4,  2,  1, 11, 10, 13,  7,  8, 15,  9, 12,  5,  6,  3,  0, 14,
  11,  8, 12,  7,  1, 14,  2, 13,  6, 15,  0,  9, 10,  4,  5,  3,
];
const sbox6 = [
  12,  1, 10, 15,  9,  2,  6,  8,  0, 13,  3,  4, 14,  7,  5, 11,
  10, 15,  4,  2,  7, 12,  9,  5,  6,  1, 13, 14,  0, 11,  3,  8,
   9, 14, 15,  5,  2,  8, 12,  3,  7,  0,  4, 10,  1, 13, 11,  6,
   4,  3,  2, 12,  9,  5, 15, 10, 11, 14,  1,  7,  6,  0,  8, 13,
];
const sbox7 = [
   4, 11,  2, 14, 15,  0,  8, 13,  3, 12,  9,  7,  5, 10,  6,  1,
  13,  0, 11,  7,  4,  9,  1, 10, 14,  3,  5, 12,  2, 15,  8,  6,
   1,  4, 11, 13, 12,  3,  7, 14, 10, 15,  6,  8,  0,  5,  9,  2,
   6, 11, 13,  8,  1,  4, 10,  7,  9,  5,  0, 15, 14,  2,  3, 12,
];
const sbox8 = [
  13,  2,  8,  4,  6, 15, 11,  1, 10,  9,  3, 14,  5,  0, 12,  7,
   1, 15, 13,  8, 10,  3,  7,  4, 12,  5,  6, 11,  0, 14,  9,  2,
   7, 11,  4,  1,  9, 12, 14,  2,  0,  6, 10, 13, 15,  3,  5,  8,
   2,  1, 14,  7,  4, 10,  8, 13, 15, 12,  9,  0,  3,  5,  6, 11,
];

// 初始置换 IP 的两张位表
const IP0 = [57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
             61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
const IP1 = [56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2,
             60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6];
// 轮函数最后的置换 P
const P = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9,
           1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24];

const KEY_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const KEY_PERM_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17,
                    9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
const KEY_PERM_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
                    13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const KEY_COMPRESSION = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9,
                         22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
                         40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47,
                         43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];

const ENCRYPT = 1;
const DECRYPT = 0;

// 取 a[off..] 这 8 个字节里的第 b 位，放到结果的第 c 位
const bitnum = (a, off, b, c) => ((((a[off + ((b / 32) | 0) * 4 + 3 - (((b % 32) / 8) | 0)] >>> (7 - (b % 8))) & 1) << c) >>> 0);
const bitnumIntR = (a, b, c) => ((((a >>> (31 - b)) & 1) << c) & 0xff);
const bitnumIntL = (a, b, c) => (((((a << b) >>> 0) & 0x80000000) >>> c) >>> 0);
const sboxBit = (a) => ((a & 0x20) | ((a & 0x1f) >>> 1) | ((a & 0x01) << 4));

function keySchedule(key, off, mode) {
  const schedule = Array.from({ length: 16 }, () => new Uint8Array(6));
  let c = 0;
  let d = 0;
  for (let i = 0; i < 28; i++) {
    c = (c | bitnum(key, off, KEY_PERM_C[i], 31 - i)) >>> 0;
    d = (d | bitnum(key, off, KEY_PERM_D[i], 31 - i)) >>> 0;
  }
  for (let i = 0; i < 16; i++) {
    const s = KEY_SHIFT[i];
    c = ((((c << s) >>> 0) | (c >>> (28 - s))) & 0xfffffff0) >>> 0;
    d = ((((d << s) >>> 0) | (d >>> (28 - s))) & 0xfffffff0) >>> 0;
    const row = schedule[mode === DECRYPT ? 15 - i : i];
    for (let j = 0; j < 24; j++) row[(j / 8) | 0] |= bitnumIntR(c, KEY_COMPRESSION[j], 7 - (j % 8));
    for (let j = 24; j < 48; j++) row[(j / 8) | 0] |= bitnumIntR(d, KEY_COMPRESSION[j] - 27, 7 - (j % 8));
  }
  return schedule;
}

function ip(input, off) {
  let s0 = 0;
  let s1 = 0;
  for (let i = 0; i < 32; i++) {
    s0 = (s0 | bitnum(input, off, IP0[i], 31 - i)) >>> 0;
    s1 = (s1 | bitnum(input, off, IP1[i], 31 - i)) >>> 0;
  }
  return [s0, s1];
}

function invIP(s0, s1, out, off) {
  const order = [3, 2, 1, 0, 7, 6, 5, 4];
  for (let k = 0; k < 8; k++) {
    let v = 0;
    for (let j = 0; j < 4; j++) {
      v |= bitnumIntR(s1, 7 - k + 8 * j, 7 - 2 * j);
      v |= bitnumIntR(s0, 7 - k + 8 * j, 6 - 2 * j);
    }
    out[off + order[k]] = v;
  }
}

const lrg = new Uint8Array(6);

function f(state, key) {
  const t1 = (bitnumIntL(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitnumIntL(state, 4, 5) |
    bitnumIntL(state, 3, 6) | ((state & 0x0f000000) >>> 3) | bitnumIntL(state, 8, 11) |
    bitnumIntL(state, 7, 12) | ((state & 0x00f00000) >>> 5) | bitnumIntL(state, 12, 17) |
    bitnumIntL(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitnumIntL(state, 16, 23)) >>> 0;
  const t2 = (bitnumIntL(state, 15, 0) | (((state & 0x0000f000) << 15) >>> 0) | bitnumIntL(state, 20, 5) |
    bitnumIntL(state, 19, 6) | (((state & 0x00000f00) << 13) >>> 0) | bitnumIntL(state, 24, 11) |
    bitnumIntL(state, 23, 12) | (((state & 0x000000f0) << 11) >>> 0) | bitnumIntL(state, 28, 17) |
    bitnumIntL(state, 27, 18) | (((state & 0x0000000f) << 9) >>> 0) | bitnumIntL(state, 0, 23)) >>> 0;

  lrg[0] = ((t1 >>> 24) & 0xff) ^ key[0];
  lrg[1] = ((t1 >>> 16) & 0xff) ^ key[1];
  lrg[2] = ((t1 >>> 8) & 0xff) ^ key[2];
  lrg[3] = ((t2 >>> 24) & 0xff) ^ key[3];
  lrg[4] = ((t2 >>> 16) & 0xff) ^ key[4];
  lrg[5] = ((t2 >>> 8) & 0xff) ^ key[5];

  let s = (((sbox1[sboxBit(lrg[0] >>> 2)] << 28) >>> 0) |
    (sbox2[sboxBit(((lrg[0] & 0x03) << 4) | (lrg[1] >>> 4))] << 24) |
    (sbox3[sboxBit(((lrg[1] & 0x0f) << 2) | (lrg[2] >>> 6))] << 20) |
    (sbox4[sboxBit(lrg[2] & 0x3f)] << 16) |
    (sbox5[sboxBit(lrg[3] >>> 2)] << 12) |
    (sbox6[sboxBit(((lrg[3] & 0x03) << 4) | (lrg[4] >>> 4))] << 8) |
    (sbox7[sboxBit(((lrg[4] & 0x0f) << 2) | (lrg[5] >>> 6))] << 4) |
    sbox8[sboxBit(lrg[5] & 0x3f)]) >>> 0;

  let r = 0;
  for (let i = 0; i < 32; i++) r = (r | bitnumIntL(s, P[i], i)) >>> 0;
  return r;
}

function desCrypt(input, inOff, out, outOff, schedule) {
  let [s0, s1] = ip(input, inOff);
  for (let i = 0; i < 15; i++) {
    const t = s1;
    s1 = (f(s1, schedule[i]) ^ s0) >>> 0;
    s0 = t;
  }
  s0 = (f(s1, schedule[15]) ^ s0) >>> 0;
  invIP(s0, s1, out, outOff);
}

function tripleDesKeySetup(key, mode) {
  return mode === ENCRYPT
    ? [keySchedule(key, 0, ENCRYPT), keySchedule(key, 8, DECRYPT), keySchedule(key, 16, ENCRYPT)]
    : [keySchedule(key, 16, DECRYPT), keySchedule(key, 8, ENCRYPT), keySchedule(key, 0, DECRYPT)];
}

// 对整段密文做 ECB 模式的 3DES 解密
export function tripleDesDecrypt(data, key) {
  const schedule = tripleDesKeySetup(key, DECRYPT);
  const out = Buffer.alloc(data.length - (data.length % 8));
  const tmp = Buffer.alloc(8);
  for (let o = 0; o + 8 <= out.length; o += 8) {
    desCrypt(data, o, tmp, 0, schedule[0]);
    desCrypt(tmp, 0, tmp, 0, schedule[1]);
    desCrypt(tmp, 0, out, o, schedule[2]);
  }
  return out;
}
