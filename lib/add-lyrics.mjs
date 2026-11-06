// 给已经解密出来的歌批量抓逐字歌词（原文 + 中文翻译 + 罗马音）。
// 用法：node add-lyrics.mjs --dir <音乐目录> [--overwrite 1] [--quiet 1]
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { findSong, loadSongIndex } from './cover.mjs';
import { isBlossomRunning, syncToLyricsBlossom, writeLyricsFor } from './lyrics.mjs';

const AUDIO_EXT = new Set(['.flac', '.ogg', '.mp3', '.m4a']);
const REQUEST_GAP_MS = 300; // 别把接口打太急

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!opts.dir) throw new Error('缺少参数 --dir');
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const quiet = opts.quiet === '1';
  if (!existsSync(opts.dir)) throw new Error(`找不到目录：${opts.dir}`);
  const lyricsDir = join(opts.dir, '歌词');
  mkdirSync(lyricsDir, { recursive: true });

  const songIndex = loadSongIndex();
  if (songIndex.byStem.size === 0) throw new Error('读不到 QQ 音乐曲库数据库，没法定位歌曲');
  if (!quiet) {
    console.log(`   曲库记录：${songIndex.byStem.size} 首`);
    console.log(`   歌词输出：${lyricsDir}\n`);
  }

  const files = readdirSync(opts.dir)
    .filter((n) => !n.startsWith('.') && AUDIO_EXT.has(extname(n).toLowerCase()))
    .filter((n) => statSync(join(opts.dir, n)).isFile())
    .sort();
  const stats = { ok: 0, had: 0, skip: 0, fail: 0 };

  for (const name of files) {
    const stem = basename(name, extname(name));
    const song = findSong(songIndex, { stem });
    if (!song) {
      stats.skip++;
      if (!quiet) console.log(`➖ ${name}：曲库里没有这首歌的记录`);
      continue;
    }
    try {
      const note = await writeLyricsFor(song, stem, lyricsDir, { overwrite: opts.overwrite === '1' });
      if (note === '歌词已存在') {
        stats.had++;
        continue;
      }
      if (note === '纯音乐，无歌词') {
        stats.skip++;
        if (!quiet) console.log(`➖ ${name}：纯音乐，没有歌词`);
        continue;
      }
      stats.ok++;
      console.log(`✅ ${name}（${note}）`);
      await sleep(REQUEST_GAP_MS);
    } catch (e) {
      stats.fail++;
      console.log(`❌ ${name}：${e.message}`);
      await sleep(REQUEST_GAP_MS);
    }
  }

  console.log(`\n歌词：新增 ${stats.ok} 首，本来就有 ${stats.had} 首，没有歌词/查不到 ${stats.skip} 首，失败 ${stats.fail} 首。`);
  const sync = syncToLyricsBlossom(opts.dir, lyricsDir, opts.blossom);
  if (sync) {
    console.log(`同步到 LyricsBlossom：写入 ${sync.written} 首，已是最新 ${sync.same} 首，你手动指定过的 ${sync.custom} 首未改动`
      + `${sync.noTags ? `，缺歌手标签跳过 ${sync.noTags} 首` : ''}${sync.cleaned ? `，清理旧版副本 ${sync.cleaned} 个` : ''}。`);
    if (sync.written && isBlossomRunning()) console.log('   LyricsBlossom 正在运行：它只在启动时重建本地歌词索引，重启一下 App 新歌词才会生效。');
  }
  process.exitCode = stats.fail ? 1 : 0;
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exitCode = 2;
});
