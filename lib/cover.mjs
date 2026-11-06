// 补封面：从 QQ 音乐本地数据库找到专辑 mid，下载官方封面图并嵌入音频文件。
// 封面图来自 QQ 音乐公开图床 y.gtimg.cn，只发送专辑 mid，不带任何账号信息。
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const QQ_DB = `${process.env.HOME}/Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac/qqmusic.sqlite`;
const COVER_SIZES = ['800x800', '500x500', '300x300'];

// QQ 音乐可能正在写这个库，复制一份再读，避免互相干扰
export function loadSongIndex(dbPath = QQ_DB) {
  const index = { byPath: new Map(), byStem: new Map() };
  if (!existsSync(dbPath)) return index;
  const dir = mkdtempSync(join(tmpdir(), 'qm-db-'));
  const copy = join(dir, 'qqmusic.sqlite');
  try {
    copyFileSync(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, copy + suffix);
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    // K_SONG_RESERVE9 = 专辑 mid（拼封面图地址用），K_SONG_RESERVE12 = 时长（毫秒，抓歌词用）
    const rows = db.prepare(
      'SELECT file, id, name, singer, album, K_SONG_RESERVE9 AS albumMid, K_SONG_RESERVE12 AS durationMs FROM SONGS',
    ).all();
    db.close();
    for (const row of rows) {
      if (!row.file) continue;
      // 文件系统给的名字是分解形式（NFD），数据库里是合成形式（NFC），统一成 NFC 才能对上
      index.byPath.set(row.file.normalize(), row);
      const stem = basename(row.file, extname(row.file)).normalize();
      if (!index.byStem.has(stem)) index.byStem.set(stem, row);
    }
  } catch {
    // 数据库读不了就当作没有，调用方会跳过补封面
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return index;
}

export function findSong(index, { qqPath, stem }) {
  return (qqPath && index.byPath.get(qqPath.normalize())) || (stem && index.byStem.get(stem.normalize())) || null;
}

export function hasCover(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.split('\n').some((l) => l.trim() === 'video');
}

export function downloadCover(albumMid, outFile) {
  for (const size of COVER_SIZES) {
    const url = `https://y.gtimg.cn/music/photo_new/T002R${size}M000${albumMid}.jpg`;
    const r = spawnSync('curl', ['-sfL', '--max-time', '20', '-o', outFile, url]);
    if (r.status === 0 && existsSync(outFile) && readFileSync(outFile).subarray(0, 2).toString('hex') === 'ffd8') {
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', outFile], { encoding: 'utf8' });
      const [w, h] = probe.stdout.trim().split(',').map(Number);
      if (w && h) return { file: outFile, width: w, height: h, size };
    }
  }
  return null;
}

// OGG 的封面要按 FLAC 图片块格式打包后 base64 存进 METADATA_BLOCK_PICTURE 注释
function pictureBlockBase64(cover) {
  const img = readFileSync(cover.file);
  const mime = Buffer.from('image/jpeg', 'ascii');
  const u32 = (v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v);
    return b;
  };
  return Buffer.concat([
    u32(3), // 图片类型：封面正面
    u32(mime.length), mime,
    u32(0), // 描述为空
    u32(cover.width), u32(cover.height), u32(24), u32(0),
    u32(img.length), img,
  ]).toString('base64');
}

// 只改容器里的元数据，音频流原样拷贝，不重新编码。
// 写入方式是「原地覆盖」而不是替换文件，这样文件原有的扩展属性（访达图标、
// QQ 音乐自己写的属性）不会丢失。覆盖前先校验新内容，并留一份备份可回滚。
export function embedCover(file, ext, cover, workDir) {
  const out = join(workDir, `cover-out.${ext}`);
  let args;
  if (ext === 'ogg') {
    const meta = join(workDir, 'cover-meta.txt');
    writeFileSync(meta, `;FFMETADATA1\nMETADATA_BLOCK_PICTURE=${pictureBlockBase64(cover)}\n`);
    args = ['-i', file, '-i', meta, '-map', '0', '-map_metadata', '1', '-c', 'copy', '-f', 'ogg', out];
  } else if (ext === 'mp3') {
    args = ['-i', file, '-i', cover.file, '-map', '0:a', '-map', '1:v', '-c', 'copy', '-id3v2_version', '3',
      '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-f', 'mp3', out];
  } else if (ext === 'flac') {
    // comment 决定 FLAC PICTURE 块里的图片类型。不写的话 ffmpeg 填 0（其他），
    // 这里明确写成 3（封面正面），部分播放器和整理工具只认类型 3。
    args = ['-i', file, '-i', cover.file, '-map', '0:a', '-map', '1:v', '-c', 'copy',
      '-disposition:v:0', 'attached_pic', '-metadata:s:v', 'comment=Cover (front)',
      '-f', 'flac', out];
  } else {
    args = ['-i', file, '-i', cover.file, '-map', '0:a', '-map', '1:v', '-c', 'copy',
      '-disposition:v:0', 'attached_pic', '-f', ext === 'm4a' ? 'mp4' : ext, out];
  }
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    rmSync(out, { force: true });
    throw new Error(r.stderr.trim().split('\n')[0] || 'ffmpeg 失败');
  }
  if (!hasCover(out)) {
    rmSync(out, { force: true });
    throw new Error('生成的文件里读不到封面');
  }

  const backup = join(workDir, `backup.${ext}`);
  copyFileSync(file, backup);
  try {
    writeFileSync(file, readFileSync(out)); // 原地截断重写，保留 inode 和扩展属性
    if (!hasCover(file)) throw new Error('写入后读不到封面');
  } catch (e) {
    writeFileSync(file, readFileSync(backup)); // 回滚
    throw e;
  } finally {
    rmSync(backup, { force: true });
    rmSync(out, { force: true });
  }
}

// 访达不读取 FLAC/OGG 的内嵌封面，只显示文件的自定义图标（存在扩展属性里）。
// QQ 音乐自己下载的文件就是这么做的，这里用同样的方式让访达也能看到封面。
export function hasFinderIcon(file) {
  const r = spawnSync('xattr', [file], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.includes('com.apple.ResourceFork');
}

export function extractEmbeddedCover(file, outFile) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-map', '0:v', '-c', 'copy', outFile]);
  return r.status === 0 && existsSync(outFile) ? outFile : null;
}

const SET_ICON_JXA = `ObjC.import("AppKit");
function run(argv) {
  var img = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
  if (!img.js) return "IMAGE_FAIL";
  return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(img, argv[1], 0) ? "OK" : "SET_FAIL";
}`;

// 只写扩展属性（图标），不改动音频文件本身
export function setFinderIcon(file, jpgPath) {
  const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', SET_ICON_JXA, jpgPath, file], { encoding: 'utf8' });
  if (r.status !== 0 || r.stdout.trim() !== 'OK') {
    throw new Error(`设置访达图标失败：${(r.stdout + r.stderr).trim().split('\n')[0]}`);
  }
}

// 给一个音频文件补封面，返回描述结果的字符串（或 null 表示没做任何事）
export function addCoverTo(file, ext, song, workDir) {
  if (!song?.albumMid) return null;
  const cover = downloadCover(song.albumMid, join(workDir, 'cover.jpg'));
  if (!cover) return null;
  embedCover(file, ext, cover, workDir);
  let note = `封面 ${cover.size}`;
  if (!hasFinderIcon(file)) {  // 已经有图标就不动它
    try {
      setFinderIcon(file, cover.file);
      note += '+访达图标';
    } catch {
      note += '（访达图标失败）';
    }
  }
  rmSync(cover.file, { force: true });
  return note;
}

// 只补访达图标：优先用文件里已有的内嵌封面，没有就按专辑 mid 下载
export function ensureFinderIcon(file, song, workDir) {
  if (hasFinderIcon(file)) return null;
  const jpg = join(workDir, 'icon.jpg');
  rmSync(jpg, { force: true });
  let img = extractEmbeddedCover(file, jpg);
  let source = '用内嵌封面';
  if (!img && song?.albumMid) {
    const cover = downloadCover(song.albumMid, jpg);
    img = cover?.file ?? null;
    source = '下载封面';
  }
  if (!img) return null;
  setFinderIcon(file, img);
  rmSync(jpg, { force: true });
  return `访达图标（${source}）`;
}
