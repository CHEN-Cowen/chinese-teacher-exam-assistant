#!/usr/bin/env bash
# 在容器内运行一次性 Node 脚本，并正确处理模块解析。
#
# 为什么需要它：
#   CJS 的 require 以【脚本文件所在目录】为起点逐级向上找 node_modules，
#   与进程 cwd 无关。因此
#     docker exec -w /app node /tmp/x.cjs      # 仍然失败
#     process.chdir('/app')                    # 仍然失败
#   只有两件事有效：
#     1) 脚本落在 /app 子树内（例如 /app/dist），相对导入与向上查找才能成立；
#     2) 显式传 NODE_PATH=/app/node_modules，兜住裸包名（仅 CJS 生效）。
#
# 用法：
#   ./run-in-container.sh <container> <local-script> [args...]
#
# 示例：
#   ./run-in-container.sh jiaozhao-standalone-backend-1 ./trigger.cjs <sourceId>
#
# 环境变量：
#   RUN_DIR    容器内落地目录，默认 /app/dist
#   NODE_PATH  容器内模块搜索路径，默认 /app/node_modules
#   KEEP=1     运行结束后保留脚本（默认删除，删除需 root，脚本会自动 -u 0）
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "用法: $0 <container> <local-script> [args...]" >&2
  exit 2
fi

CONTAINER="$1"
SCRIPT="$2"
shift 2

RUN_DIR="${RUN_DIR:-/app/dist}"
NODE_PATH_DIR="${NODE_PATH:-/app/node_modules}"
KEEP="${KEEP:-0}"

if [ ! -f "$SCRIPT" ]; then
  echo "本地脚本不存在: $SCRIPT" >&2
  exit 1
fi

case "$SCRIPT" in
  *.mjs)
    echo "提示: .mjs 走 ESM 解析，NODE_PATH 不生效；靠落点在 /app 子树内解析裸包名。" >&2
    ;;
esac

BASE="$(basename "$SCRIPT")"
DEST="$RUN_DIR/$BASE"

# 落地目录必须存在且可写；不存在说明容器拓扑与预期不符，直接报错而不是猜路径
if ! docker exec "$CONTAINER" sh -c "test -d '$RUN_DIR'" >/dev/null 2>&1; then
  echo "容器内目录不存在: $RUN_DIR（用 RUN_DIR 指定实际目录）" >&2
  exit 1
fi

cleanup() {
  if [ "$KEEP" = "1" ]; then
    echo "[keep] $CONTAINER:$DEST" >&2
    return 0
  fi
  # /app 通常属 root，非 root 删除会 Permission denied，必须提权
  docker exec -u 0 "$CONTAINER" sh -c "rm -f '$DEST'" >/dev/null 2>&1 || {
    echo "[warn] 清理失败，请手动执行: docker exec -u 0 $CONTAINER rm -f $DEST" >&2
    return 0
  }
}
trap cleanup EXIT

docker cp "$SCRIPT" "$CONTAINER:$DEST"
docker exec -e "NODE_PATH=$NODE_PATH_DIR" "$CONTAINER" node "$DEST" "$@"
