#!/bin/bash
# 双击运行：导出最新密钥 → 启动本地网页版（带 musicex 密钥匹配修复的 um-react）→ 打开浏览器和相关文件夹
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
QQ_DATA="$HOME/Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac"
KEY_DIR="$HERE/密钥"
PORT=8686   # 端口固定不变，浏览器里保存的密钥设置才会一直在
URL="http://localhost:$PORT/"

echo "① 导出密钥库…"
mkdir -p "$KEY_DIR"
python3 "$HERE/lib/dump_keys.py" -f -o "$KEY_DIR" || echo "⚠️  密钥导出失败，只能解密文件里自带密钥的旧格式"

open "$KEY_DIR"                              # 密钥库文件：拖到网页「设置 → QMCv2 密钥 → 导入数据库」
[ -d "$QQ_DATA/iQmc" ] && open "$QQ_DATA/iQmc"   # QQ 音乐下载的加密文件：拖到网页主页

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "② 网页版已经在运行"
  open "$URL"
  exit 0
fi

echo "② 启动网页版（关闭这个窗口或按 Ctrl+C 即停止）"
node "$HERE/lib/serve.mjs" "$HERE/网页版" "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
open "$URL"
wait $SERVER
