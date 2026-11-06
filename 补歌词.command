#!/bin/bash
# 双击运行：给 ~/Music/QQ音乐 里的歌批量抓逐字歌词（原文+翻译+罗马音）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export NODE_NO_WARNINGS=1
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$HOME/Music/QQ音乐"

command -v node >/dev/null || { echo "❌ 没找到 node，请先安装（brew install node）"; exit 2; }
echo "抓歌词：$OUT_DIR"
echo "（每首生成 .ttml 和 .lrc 两个文件，放在「歌词」子目录里）"
node "$HERE/lib/add-lyrics.mjs" --dir "$OUT_DIR" "$@"
code=$?
echo
[ -t 0 ] && [ -z "$NO_PAUSE" ] && read -n1 -rs -p "按任意键关闭窗口…" && echo
exit $code
