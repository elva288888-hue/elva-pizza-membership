const http = require("http");
const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", async () => {
    try {
      const result = await cloud.callFunction({
        name: process.env.PAYMENT_FUNCTION || "partnerPay",
        data: {
          action: "handlePaymentNotification",
          payload: { headers: request.headers, body },
        },
      });
      if (!result.result?.ok) {
        send(response, 500, { code: "FAIL", message: result.result?.message || "支付通知处理失败" });
        return;
      }
      send(response, 200, { code: "SUCCESS", message: "成功" });
    } catch (error) {
      console.error("[wxpayNotify]", error);
      send(response, 500, { code: "FAIL", message: error.message || "支付通知处理失败" });
    }
  });
}).listen(9000);

function send(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}
