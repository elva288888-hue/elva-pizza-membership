#!/bin/zsh
set -e

cd "$(dirname "$0")"

PORT=4173
REUSE_SERVER=0
while lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; do
  PID="$(lsof -nP -tiTCP:${PORT} -sTCP:LISTEN | head -n 1)"
  COMMAND="$(ps -p "${PID}" -o command= 2>/dev/null || true)"
  if [[ "${COMMAND}" == *"local-test-server.js"* ]]; then
    REUSE_SERVER=1
    break
  fi
  PORT=$((PORT + 1))
done

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
fi
if [ -z "$LAN_IP" ]; then
  LAN_IP="127.0.0.1"
fi

ADMIN_URL="http://${LAN_IP}:${PORT}/index.html?local=1&localApi=1"
CUSTOMER_URL="http://${LAN_IP}:${PORT}/customer.html?table=3&source=store_qr&local=1&localApi=1&mockAuth=1"
QR_URL="http://127.0.0.1:${PORT}/mobile-test.html"
QR_URL_WITH_IP="${QR_URL}?ip=${LAN_IP}"

echo "爱娃披萨店手机测试"
echo "----------------------------------------"
echo "请确认手机和电脑连接同一个 Wi-Fi。"
echo "二维码页面: ${QR_URL_WITH_IP}"
echo "店家后台: ${ADMIN_URL}"
echo "消费者端: ${CUSTOMER_URL}"
echo ""
echo "后台测试登录:"
echo "手机号: 13800000000"
echo "验证码: 123456"
echo "----------------------------------------"

if [ "${REUSE_SERVER}" = "1" ]; then
  echo "检测到本地测试服务已在 ${PORT} 端口运行，直接打开页面。"
  open "${QR_URL_WITH_IP}"
  open "${ADMIN_URL}"
  exit 0
fi

(sleep 1; open "${QR_URL_WITH_IP}"; open "${ADMIN_URL}") &
if command -v node >/dev/null 2>&1; then
  PORT="${PORT}" node local-test-server.js
elif [ -x "/Users/dimengjiao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  PORT="${PORT}" /Users/dimengjiao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node local-test-server.js
else
  echo "没有找到 Node.js，无法启动共享测试服务。"
  exit 1
fi
