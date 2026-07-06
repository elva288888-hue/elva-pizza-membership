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

ADMIN_URL="http://127.0.0.1:${PORT}/index.html?local=1&localApi=1"
CUSTOMER_URL="http://127.0.0.1:${PORT}/customer.html?table=3&source=store_qr&local=1&localApi=1&mockAuth=1"
QR_URL="http://127.0.0.1:${PORT}/mobile-test.html"

echo "爱娃披萨店本地测试"
echo "----------------------------------------"
echo "店家后台: ${ADMIN_URL}"
echo "消费者点餐端: ${CUSTOMER_URL}"
echo "手机扫码测试: ${QR_URL}"
echo ""
echo "后台测试登录:"
echo "手机号: 13800000000"
echo "验证码: 123456"
echo ""
echo "提示: 关闭这个终端窗口即可停止本地服务。"
echo "----------------------------------------"

if [ "${REUSE_SERVER}" = "1" ]; then
  echo "检测到本地测试服务已在 ${PORT} 端口运行，直接打开页面。"
  open "${QR_URL}"
  open "${ADMIN_URL}"
  open "${CUSTOMER_URL}"
  exit 0
fi

(sleep 1; open "${QR_URL}"; open "${ADMIN_URL}"; open "${CUSTOMER_URL}") &
if command -v node >/dev/null 2>&1; then
  PORT="${PORT}" node local-test-server.js
elif [ -x "/Users/dimengjiao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  PORT="${PORT}" /Users/dimengjiao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node local-test-server.js
else
  echo "没有找到 Node.js，无法启动共享测试服务。"
  exit 1
fi
