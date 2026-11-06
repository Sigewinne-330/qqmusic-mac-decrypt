#!/bin/bash
# 双击运行：导出最新密钥 → 批量解密 QQ 音乐下载的 mflac/mgg → 输出到 ~/Music/QQ音乐
# → 给所有缺封面的歌补封面 → 给所有缺歌词的歌抓歌词 → 同步到 LyricsBlossom
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export NODE_NO_WARNINGS=1
HERE="$(cd "$(dirname "$0")" && pwd)"
QQ_DATA="$HOME/Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac"
IN_DIR="$QQ_DATA/iQmc"
OUT_DIR="$HOME/Music/QQ音乐"
KEY_DIR="$HERE/密钥"

finish() {
  echo
  # 双击运行时停在这里，方便看结果；在终端里手动运行时直接退出
  [ -t 0 ] && [ -z "$NO_PAUSE" ] && read -n1 -rs -p "按任意键关闭窗口…" && echo
  exit "$1"
}

for cmd in node python3; do
  command -v "$cmd" >/dev/null || { echo "❌ 没找到 $cmd，请先安装（brew install ${cmd/python3/python}）"; finish 2; }
done

echo "① 导出密钥库…"
mkdir -p "$KEY_DIR"
if ! python3 "$HERE/lib/dump_keys.py" -f -o "$KEY_DIR" || ! ls "$KEY_DIR"/qqmusic-mac-*.mmkv >/dev/null 2>&1; then
  echo "❌ 密钥导出失败。可能原因：QQ 音乐没登录过 / 客户端升级后格式变了 / 系统拒绝了访问其他 App 数据的权限。"
  finish 2
fi

echo "② 解密 $IN_DIR"
node "$HERE/lib/decrypt.mjs" --keys "$KEY_DIR" --in "$IN_DIR" --out "$OUT_DIR"
code=$?

echo
echo "③ 补封面（QQ 直接下载的歌不一定带内嵌封面）…"
node "$HERE/lib/add-covers.mjs" --dir "$OUT_DIR" --quiet 1
cover_code=$?

echo
echo "④ 补歌词（包括 QQ 直接下载、不用解密的歌）并同步到 LyricsBlossom…"
node "$HERE/lib/add-lyrics.mjs" --dir "$OUT_DIR" --quiet 1
lyrics_code=$?
# 按步骤顺序报第一个失败
for c in $cover_code $lyrics_code; do [ "$code" -eq 0 ] && code=$c; done
finish $code
