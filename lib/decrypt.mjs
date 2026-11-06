// QQ 音乐 Mac 下载文件批量解密：mflac → flac，mgg → ogg。
// 解密算法来自 Unlock Music 的 @unlock-music/crypto（与 um-react 网页版同一份代码）。
//
// 用法：node decrypt.mjs --keys <密钥目录> --in <加密文件目录> --out <输出目录>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import * as um from '@unlock-music/crypto';
import { addCoverTo, findSong, loadSongIndex } from './cover.mjs';
import { writeLyricsFor } from './lyrics.mjs';

const ENCRYPTED_EXT = /\.(mflac\w*|mgg\w*|mmp4)$/i;
const OUTPUT_EXTS = ['flac', 'ogg', 'm4a', 'mp3'];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
  for (const k of ['keys', 'in', 'out']) {
    if (!opts[k]) throw new Error(`缺少参数 --${k}`);
  }
  return opts;
}

// 移植自 um-react src/util/MMKVParser.ts + src/util/mmkv/qm.ts
function parseMMKV(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 4;
  const end = 4 + view.getUint32(0, true);
  const readInt = () => {
    let v = 0;
    let shift = 0;
    let b;
    do {
      b = view.getUint8(off++);
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return v;
  };
  const readStr = () => {
    const n = readInt();
    const s = buf.subarray(off, off + n).toString('utf8').normalize();
    off += n;
    return s;
  };
  readInt(); // skip unused str
  const map = new Map();
  while (off < end) {
    const key = readStr();
    const len = readInt();
    if (len === 0) continue;
    map.set(basename(key).normalize(), readStr());
  }
  return map;
}

function loadKeys(dir) {
  const keys = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mmkv'))) {
    for (const [k, v] of parseMMKV(readFileSync(join(dir, f)))) keys.set(k, v);
  }
  return keys;
}

function detectExt(b) {
  const ascii = (o, n) => Buffer.from(b.subarray(o, o + n)).toString('latin1');
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(4, 4) === 'ftyp') return 'm4a';
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

function decryptFile(path, keys) {
  const raw = new Uint8Array(readFileSync(path));
  const footer = um.QMCFooter.parse(raw.subarray(Math.max(0, raw.byteLength - 1024)));
  const footerSize = footer ? footer.size : 0;
  const embeddedKey = footer?.ekey;
  const mediaName = footer?.mediaName;
  footer?.free();

  // 查找顺序：文件内嵌密钥 → 文件名精确匹配 → musicex 媒体文件名精确匹配。不做模糊匹配，找不到就明确报错。
  const name = basename(path).normalize();
  const ekey = embeddedKey || keys.get(name) || (mediaName && keys.get(mediaName.normalize()));
  if (!ekey) {
    throw new Error(`密钥库里找不到这首歌的密钥（文件名 ${name}${mediaName ? `，媒体名 ${mediaName}` : ''}）`);
  }

  const data = raw.slice(0, raw.byteLength - footerSize);
  const qmc2 = new um.QMC2(ekey);
  try {
    const CHUNK = 1 << 20;
    for (let o = 0; o < data.length; o += CHUNK) qmc2.decrypt(data.subarray(o, o + CHUNK), o);
  } finally {
    qmc2.free();
  }
  const ext = detectExt(data);
  if (!ext) throw new Error('解密结果不是可识别的音频（密钥可能不对应这首歌）');
  return { data, ext };
}

function ffprobe(path, entries) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'json', path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe 失败：${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}

function pcmDigest(path, fmt) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'quiet', '-i', path, '-f', fmt, '-']);
    const hash = createHash('md5');
    let bytes = 0;
    p.stdout.on('data', (c) => {
      hash.update(c);
      bytes += c.length;
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ md5: hash.digest('hex'), bytes }) : reject(new Error(`ffmpeg 退出码 ${code}`))));
  });
}

// 完整性校验：FLAC 用文件头 STREAMINFO 里的原始音频 MD5 和采样数比对；其他格式要求完整解码无错误。
async function verify(path, ext) {
  if (ext === 'flac') {
    const head = readFileSync(path).subarray(0, 42);
    const want = Buffer.from(head.subarray(26, 42)).toString('hex');
    const info = ffprobe(path, 'stream=bits_per_raw_sample,channels,duration_ts').streams[0];
    const bits = Number(info.bits_per_raw_sample);
    const fmt = { 16: 's16le', 24: 's24le', 32: 's32le' }[bits];
    if (!fmt || /^0+$/.test(want)) return '跳过 MD5（文件未记录）';
    const { md5, bytes } = await pcmDigest(path, fmt);
    const samples = bytes / (bits / 8) / info.channels;
    if (md5 !== want) throw new Error('FLAC MD5 校验不一致');
    if (samples !== Number(info.duration_ts)) throw new Error(`采样数不一致（${samples} ≠ ${info.duration_ts}）`);
    return 'MD5 一致';
  }
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], { encoding: 'utf8' });
  const errors = r.stderr.trim();
  if (r.status !== 0 || errors) throw new Error(`完整解码出错：${errors.split('\n')[0]}`);
  return '完整解码无错误';
}

// 文件没有任何标签时，按 QQ 音乐的「歌手-歌名」文件名补上（无损重封装，不重新编码）。
function fillTagsIfMissing(path, ext, stem) {
  const tags = ffprobe(path, 'format_tags:stream_tags');
  const hasTitle = [tags.format?.tags, ...(tags.streams ?? []).map((s) => s.tags)].some(
    (t) => t && Object.keys(t).some((k) => k.toLowerCase() === 'title'),
  );
  const dash = stem.indexOf('-');
  if (hasTitle || dash <= 0) return false;
  const artist = stem.slice(0, dash).trim();
  const title = stem.slice(dash + 1).trim();
  const tmp = path + '.tagging';
  const r = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-i', path, '-map', '0', '-c', 'copy',
    '-metadata', `artist=${artist}`, '-metadata', `title=${title}`,
    '-f', ext === 'm4a' ? 'mp4' : ext, tmp,
  ], { encoding: 'utf8' });
  if (r.status !== 0) {
    rmSync(tmp, { force: true });
    throw new Error(`补标签失败：${r.stderr.trim().split('\n')[0]}`);
  }
  renameSync(tmp, path);
  return true;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await um.ready;
  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
  if (!hasFfmpeg) console.log('⚠️  没找到 ffmpeg，将跳过完整性校验和补标签（brew install ffmpeg 可安装）');

  const keys = loadKeys(opts.keys);
  console.log(`   密钥库：${keys.size} 条`);
  const songIndex = loadSongIndex();
  const workDir = mkdtempSync(join(tmpdir(), 'qm-decrypt-'));
  if (!existsSync(opts.in)) throw new Error(`找不到 QQ 音乐下载目录：${opts.in}`);
  mkdirSync(opts.out, { recursive: true });
  const lyricsDir = join(opts.out, '歌词');
  mkdirSync(lyricsDir, { recursive: true });

  const files = readdirSync(opts.in).filter((n) => ENCRYPTED_EXT.test(n)).sort();
  const stats = { ok: 0, skip: 0, fail: 0 };
  for (const name of files) {
    const stem = basename(name, extname(name));
    const existing = OUTPUT_EXTS.map((e) => `${stem}.${e}`).find((n) => existsSync(join(opts.out, n)));
    if (existing) {
      stats.skip++;
      continue;
    }
    const tmp = join(opts.out, `.${stem}.decrypting`);
    try {
      const { data, ext } = decryptFile(join(opts.in, name), keys);
      writeFileSync(tmp, data);
      const song = findSong(songIndex, { qqPath: `/iQmc/${name}`, stem });
      const notes = [];
      if (hasFfmpeg) {
        if (fillTagsIfMissing(tmp, ext, stem)) notes.push('已补标签');
        try {
          notes.push(addCoverTo(tmp, ext, song, workDir) ?? '无封面');
        } catch (e) {
          notes.push(`封面失败：${e.message}`);
        }
        notes.push(await verify(tmp, ext));
      }
      // 音频先落地，歌词再抓：歌词是锦上添花，拿不到不该影响解密结果
      renameSync(tmp, join(opts.out, `${stem}.${ext}`));
      try {
        notes.push(song ? await writeLyricsFor(song, stem, lyricsDir) : '曲库里查不到，跳过歌词');
      } catch (e) {
        notes.push(`歌词失败：${e.message}`);
      }
      const note = notes.join('，');
      stats.ok++;
      console.log(`✅ ${name} → ${stem}.${ext}${note ? `（${note}）` : ''}`);
    } catch (e) {
      rmSync(tmp, { force: true });
      stats.fail++;
      console.log(`❌ ${name}：${e.message}`);
    }
  }
  rmSync(workDir, { recursive: true, force: true });
  console.log(`\n完成：新解密 ${stats.ok} 首，已存在跳过 ${stats.skip} 首，失败 ${stats.fail} 首。输出目录：${opts.out}`);
  process.exitCode = stats.fail ? 1 : 0;
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exitCode = 2;
});
