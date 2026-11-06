#!/bin/bash
# 双击运行：给 ~/Music/QQ音乐 里缺封面的歌批量补上专辑封面
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export NODE_NO_WARNINGS=1
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$HOME/Music/QQ音乐"

command -v node >/dev/null || { echo "❌ 没找到 node，请先安装（brew install node）"; exit 2; }
echo "补封面：$OUT_DIR"
echo "（补内嵌封面供播放器读取，补访达图标供访达显示）"
node "$HERE/lib/add-covers.mjs" --dir "$OUT_DIR"
code=$?
echo
[ -t 0 ] && [ -z "$NO_PAUSE" ] && read -n1 -rs -p "按任意键关闭窗口…" && echo
exit $code
