// 从 QQ 音乐抓取逐字歌词（原文 + 中文翻译 + 罗马音），落盘成 TTML 和增强型 LRC。
//
// 歌曲 ID 直接取自本地 qqmusic.sqlite，和你下载的文件严格一一对应，不靠歌名搜索。
//
// 歌词有版权，仅供你自己收藏的歌曲离线使用，请勿传播。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { tripleDesDecrypt } from './qrc-crypto.mjs';

const API = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QRC_KEY = Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL', 'latin1');
// 翻译/罗马音的时间戳只精确到 10ms，和逐字歌词的行首会差几毫秒，按最近的配对
const MATCH_TOLERANCE_MS = 100;

const b64 = (s) => Buffer.from(String(s ?? ''), 'utf8').toString('base64');

export async function fetchRawLyrics({ songId, title, artist, album, durationMs }) {
  const body = {
    comm: {
      ct: 11, cv: '1003006', v: '1003006', os_ver: '15',
      tmeAppID: 'qqmusiclight', nettype: 'NETWORK_WIFI', udid: '0',
    },
    request: {
      method: 'GetPlayLyricInfo',
      module: 'music.musichallSong.PlayLyricInfo',
      param: {
        albumName: b64(album), crypt: 1, ct: 19, cv: 2111,
        interval: Math.round((durationMs ?? 0) / 1000),
        lrc_t: 0, qrc: 1, qrc_t: 0, roma: 1, roma_t: 0,
        singerName: b64(artist), songID: Number(songId),
        songName: b64(title), trans: 1, trans_t: 0, type: 0,
      },
    },
  };
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'okhttp/3.14.9', Cookie: 'tmeLoginType=-1;' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`接口返回 HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0 || json.request?.code !== 0) {
    throw new Error(`接口返回错误码 ${json.code || json.request?.code}`);
  }
  return json.request.data;
}

function decryptField(hex) {
  if (!hex) return '';
  return inflateSync(tripleDesDecrypt(Buffer.from(hex, 'hex'), QRC_KEY)).toString('utf8');
}

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

// QRC 正文形如 [行起始ms,行时长ms]字(起始,时长)字(起始,时长)
export function parseQrc(text) {
  const wrapped = text.match(/LyricContent="([\s\S]*?)"\/>/);
  const content = wrapped ? unescapeXml(wrapped[1]) : text;
  const tags = {};
  const lines = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const tag = line.match(/^\[(\w+):([^\]]*)\]$/);
    if (tag) {
      tags[tag[1]] = tag[2];
      continue;
    }
    const head = line.match(/^\[(\d+),(\d+)\]/);
    if (!head) continue;
    const start = Number(head[1]);
    const end = start + Number(head[2]);
    const words = [];
    for (const m of line.slice(head[0].length).matchAll(/((?:(?!\(\d+,\d+\)).)*)\((\d+),(\d+)\)/g)) {
      const t = m[1].replace(/\r/g, '');
      if (!t) continue;
      words.push({ start: Number(m[2]), end: Number(m[2]) + Number(m[3]), text: t });
    }
    lines.push({ start, end, words, text: words.map((w) => w.text).join('') });
  }
  return { tags, lines };
}

// 翻译是普通的逐行 LRC
export function parseLrc(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(/^\[(\d+):(\d+)[.:](\d+)\](.*)$/);
    if (!m) continue;
    const body = m[4].trim();
    if (!body) continue;
    out.push({ t: Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3].padEnd(3, '0')), text: body });
  }
  return out;
}

function nearest(entries, ms) {
  let best = null;
  let bestDiff = Infinity;
  for (const e of entries) {
    const d = Math.abs(e.t - ms);
    if (d < bestDiff) {
      bestDiff = d;
      best = e;
    }
  }
  return bestDiff <= MATCH_TOLERANCE_MS ? best.text : null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function ttmlTime(ms) {
  return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(ms % 1000, 3)}`;
}
function lrcTime(ms) {
  return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(Math.round((ms % 1000) / 10))}`;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildTtml(doc, meta) {
  const { lines, lang } = doc;
  const head = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml"',
    '    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"',
    '    xmlns:itunes="http://itunes.apple.com/lyric-ttml-extensions"',
    '    xmlns:amll="http://www.example.com/ns/amll"',
    `    xml:lang="${lang}" itunes:timing="Word">`,
    '  <head>',
    '    <metadata>',
    '      <ttm:agent type="person" xml:id="v1"/>',
    `      <amll:meta key="musicName" value="${esc(meta.title)}"/>`,
    `      <amll:meta key="artists" value="${esc(meta.artist)}"/>`,
    `      <amll:meta key="album" value="${esc(meta.album)}"/>`,
    `      <amll:meta key="qqMusicId" value="${esc(String(meta.songId))}"/>`,
    '    </metadata>',
    '  </head>',
    `  <body dur="${ttmlTime(lines.at(-1)?.end ?? 0)}">`,
    '    <div>',
  ];
  const body = lines.map((line, i) => {
    const parts = [`      <p begin="${ttmlTime(line.start)}" end="${ttmlTime(line.end)}" ttm:agent="v1" itunes:key="L${i + 1}">`];
    for (const w of line.words) {
      parts.push(`<span begin="${ttmlTime(w.start)}" end="${ttmlTime(w.end)}">${esc(w.text)}</span>`);
    }
    if (line.trans) parts.push(`<span ttm:role="x-translation" xml:lang="zh-CN">${esc(line.trans)}</span>`);
    if (line.roma) parts.push(`<span ttm:role="x-roman">${esc(line.roma)}</span>`);
    return parts.join('') + '</p>';
  });
  return [...head, ...body, '    </div>', '  </body>', '</tt>', ''].join('\n');
}

// 增强型 LRC（A2）：行时间戳 + 每个字前面一个 <时间戳>；翻译作为同时间戳的下一行。
export function buildLrc(doc, meta) {
  const out = [
    `[ti:${meta.title}]`,
    `[ar:${meta.artist}]`,
    `[al:${meta.album}]`,
    '[by:QQ音乐解密工具]',
  ];
  if (doc.tags?.offset) out.push(`[offset:${doc.tags.offset}]`);
  for (const line of doc.lines) {
    const words = line.words.map((w) => `<${lrcTime(w.start)}>${w.text}`).join('');
    out.push(`[${lrcTime(line.start)}]${words}`);
    if (line.trans) out.push(`[${lrcTime(line.start)}]${line.trans}`);
  }
  return out.join('\n') + '\n';
}

const INSTRUMENTAL = /此歌曲为没有填词的纯音乐/;

// 返回 { doc, meta } 或 null（纯音乐）
export async function buildLyricsDoc(song) {
  const meta = {
    songId: song.id,
    title: song.name ?? '',
    artist: song.singer ?? '',
    album: song.album ?? '',
  };
  const data = await fetchRawLyrics({ ...meta, durationMs: song.durationMs });
  const origText = decryptField(data.lyric);
  if (!origText.trim()) throw new Error('这首歌没有歌词');
  if (INSTRUMENTAL.test(origText)) return null;

  const orig = parseQrc(origText);
  if (!orig.lines.length) throw new Error('歌词解析不出任何行');
  const hasWordTiming = orig.lines.some((l) => l.words.length > 1);

  const trans = data.trans ? parseLrc(decryptField(data.trans)) : [];
  const romaDoc = data.roma ? parseQrc(decryptField(data.roma)) : { lines: [] };
  const roma = romaDoc.lines.map((l) => ({ t: l.start, text: l.text }));

  for (const line of orig.lines) {
    line.trans = trans.length ? nearest(trans, line.start) : null;
    line.roma = roma.length ? nearest(roma, line.start) : null;
  }
  const lang = /[ぁ-んァ-ヶ]/.test(orig.lines.map((l) => l.text).join('')) ? 'ja' : 'und';
  return {
    doc: { ...orig, lang },
    meta,
    stats: {
      lines: orig.lines.length,
      hasWordTiming,
      trans: orig.lines.filter((l) => l.trans).length,
      roma: orig.lines.filter((l) => l.roma).length,
    },
  };
}

// 给一首歌写歌词文件，返回一句人话说明结果
export async function writeLyricsFor(song, stem, outDir, { overwrite = false } = {}) {
  const ttmlFile = join(outDir, `${stem}.ttml`);
  const lrcFile = join(outDir, `${stem}.lrc`);
  if (!overwrite && existsSync(ttmlFile) && existsSync(lrcFile)) return '歌词已存在';

  const built = await buildLyricsDoc(song);
  if (!built) return '纯音乐，无歌词';
  const { doc, meta, stats } = built;
  writeFileSync(ttmlFile, buildTtml(doc, meta));
  writeFileSync(lrcFile, buildLrc(doc, meta));
  const bits = [stats.hasWordTiming ? `逐字 ${stats.lines} 行` : `逐行 ${stats.lines} 行`];
  if (stats.trans) bits.push(`翻译 ${stats.trans}`);
  if (stats.roma) bits.push(`罗马音 ${stats.roma}`);
  return `歌词 ${bits.join('，')}`;
}

// ─── 同步到 LyricsBlossom ───────────────────────────────────────────────
// LyricsBlossom 的本地歌词库机制（实测）：
// - 目录里每首歌是一对文件：「歌手 - 歌名 - 专辑.ttml」+「同名.ttml.meta.json」
// - App 启动时删掉 lyrics_index.db 重建，只收录有 meta.json 且歌手不为空的歌
// - 播放时用播放器报上来的歌手/歌名/专辑查索引，所以 meta 里必须填音频文件自己的标签
//   （IINA 报的就是这些），而不是 QQ 曲库里带中文括号翻译的名字
// - 手动「指定歌词」生成的 meta 是 lyricsSource: "custom"，我们绝不覆盖
export const BLOSSOM_DIR = `${process.env.HOME}/Library/Application Support/LyricsBlossom/Lyrics`;
const GENERATED_BY = 'QQ音乐解密';
const AUDIO_EXTS = ['.flac', '.ogg', '.mp3', '.m4a'];

function audioTags(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:format_tags:stream_tags', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const j = JSON.parse(r.stdout);
  const tags = {};
  for (const t of [...(j.streams ?? []).map((s) => s.tags), j.format?.tags]) {
    for (const [k, v] of Object.entries(t ?? {})) tags[k.toLowerCase()] ??= v;
  }
  return { title: tags.title ?? '', artists: tags.artist ?? '', album: tags.album ?? '', durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000) };
}

const safeName = (s) => s.replace(/[/:]/g, '_').trim();
const sameSong = (a, b) => ['title', 'artists', 'album'].every((k) => (a[k] ?? '').normalize() === (b[k] ?? '').normalize());

function readMetas(target) {
  const metas = [];
  for (const name of readdirSync(target).filter((n) => n.endsWith('.ttml.meta.json'))) {
    try {
      metas.push({ name, meta: JSON.parse(readFileSync(join(target, name), 'utf8')) });
    } catch {
      // 读不了的 meta 不管它
    }
  }
  return metas;
}

export function isBlossomRunning() {
  return spawnSync('pgrep', ['-x', 'LyricsBlossom']).status === 0;
}

// musicDir：音频所在目录；lyricsDir：我们生成的歌词目录（歌名和音频文件同名）
export function syncToLyricsBlossom(musicDir, lyricsDir, target = BLOSSOM_DIR) {
  if (!existsSync(target)) return null;
  const stats = { written: 0, same: 0, custom: 0, noTags: 0, cleaned: 0 };
  const metas = readMetas(target);
  const ours = new Map(); // 我们生成的歌词内容 → 用来识别旧版同步留下的副本

  for (const name of readdirSync(lyricsDir).filter((n) => n.endsWith('.ttml')).sort()) {
    const stem = basename(name, '.ttml');
    const content = readFileSync(join(lyricsDir, name));
    ours.set(content.toString('base64'), stem);
    const audio = AUDIO_EXTS.map((e) => join(musicDir, stem + e)).find((f) => existsSync(f));
    const tags = audio && audioTags(audio);
    if (!tags?.title || !tags.artists) {
      stats.noTags++; // 没有歌手 LyricsBlossom 不收录，放过去也没用
      continue;
    }
    // 你在 LyricsBlossom 里手动指定过的歌，一律不碰
    if (metas.some(({ meta }) => meta.lyricsSource !== 'local' && sameSong(meta, tags))) {
      stats.custom++;
      continue;
    }
    const base = safeName([tags.artists, tags.title, tags.album].filter(Boolean).join(' - ')) + '.ttml';
    const meta = { album: tags.album, artists: tags.artists, bundleId: 'com.colliderli.iina', durationMs: tags.durationMs,
      format: 'ttml', generatedBy: GENERATED_BY, lyricsSource: 'local', sourceApp: 'com.colliderli.iina', title: tags.title };
    const metaText = JSON.stringify(meta, null, 2) + '\n';
    const ttmlPath = join(target, base);
    const metaPath = `${ttmlPath}.meta.json`;
    if (existsSync(ttmlPath) && existsSync(metaPath) && readFileSync(ttmlPath).equals(content) && readFileSync(metaPath, 'utf8') === metaText) {
      stats.same++;
      continue;
    }
    writeFileSync(ttmlPath, content);
    writeFileSync(metaPath, metaText);
    stats.written++;
  }

  // 清理旧版同步留下的「歌手-歌名.ttml」：没有 meta，LyricsBlossom 根本不读。
  // 只删和我们生成的歌词逐字节相同、且文件名就是当初的音频名的副本。
  for (const name of readdirSync(target).filter((n) => n.endsWith('.ttml'))) {
    const p = join(target, name);
    if (existsSync(`${p}.meta.json`)) continue;
    const stem = ours.get(readFileSync(p).toString('base64'));
    if (stem && stem === basename(name, '.ttml')) {
      rmSync(p);
      stats.cleaned++;
    }
  }
  return { ...stats, target };
}
