// 给缺封面的歌批量补上专辑封面（不重新编码，只改元数据）。
// 两样都补：音频内的内嵌封面（播放器读）和文件的访达图标（访达读）。
// 用法：node add-covers.mjs --dir <音乐目录> [--quiet 1]
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { addCoverTo, ensureFinderIcon, findSong, hasCover, hasFinderIcon, loadSongIndex } from './cover.mjs';

const AUDIO_EXT = new Set(['.flac', '.ogg', '.mp3', '.m4a']);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!opts.dir) throw new Error('缺少参数 --dir');
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const quiet = opts.quiet === '1'; // 只列出有变化和出错的歌
  if (spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('需要 ffmpeg（brew install ffmpeg）');
  if (!existsSync(opts.dir)) throw new Error(`找不到目录：${opts.dir}`);

  const songIndex = loadSongIndex();
  if (songIndex.byStem.size === 0) throw new Error('读不到 QQ 音乐曲库数据库，无法查专辑封面');
  if (!quiet) console.log(`   曲库记录：${songIndex.byStem.size} 首`);

  const workDir = mkdtempSync(join(tmpdir(), 'qm-cover-'));
  const files = readdirSync(opts.dir)
    .filter((n) => !n.startsWith('.') && AUDIO_EXT.has(extname(n).toLowerCase()))
    .filter((n) => statSync(join(opts.dir, n)).isFile())
    .sort();
  const stats = { ok: 0, had: 0, miss: 0, fail: 0, icon: 0, iconHad: 0 };

  for (const name of files) {
    const file = join(opts.dir, name);
    const ext = extname(name).slice(1).toLowerCase();
    const stem = basename(name, extname(name));
    const song = findSong(songIndex, { stem });

    // 访达图标只写扩展属性，不改音频内容，所以所有文件都补
    if (hasFinderIcon(file)) {
      stats.iconHad++;
    } else {
      try {
        const iconNote = ensureFinderIcon(file, song, workDir);
        if (iconNote) {
          stats.icon++;
          console.log(`🖼  ${name}（${iconNote}）`);
        }
      } catch (e) {
        console.log(`❌ ${name}：${e.message}`);
        stats.fail++;
      }
    }

    if (hasCover(file)) {
      stats.had++;
      continue;
    }
    try {
      if (!song) {
        stats.miss++;
        if (!quiet) console.log(`➖ ${name}：曲库里没有这首歌的记录`);
        continue;
      }
      const note = addCoverTo(file, ext, song, workDir);
      if (!note) {
        stats.miss++;
        console.log(`➖ ${name}：下载不到封面图`);
        continue;
      }
      if (!hasCover(file)) throw new Error('写入后仍读不到封面');
      stats.ok++;
      console.log(`✅ ${name}（${note}）`);
    } catch (e) {
      stats.fail++;
      console.log(`❌ ${name}：${e.message}`);
    }
  }

  rmSync(workDir, { recursive: true, force: true });
  console.log(`\n内嵌封面：新增 ${stats.ok} 首，本来就有 ${stats.had} 首，没找到 ${stats.miss} 首。`);
  console.log(`访达图标：新增 ${stats.icon} 首，本来就有 ${stats.iconHad} 首。失败 ${stats.fail} 首。`);
  process.exitCode = stats.fail ? 1 : 0;
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exitCode = 2;
}
