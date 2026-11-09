const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  try {
    const headers = event.headers || event.header || {};
    const body = event.isBase64Encoded
      ? Buffer.from(String(event.body || ""), "base64").toString("utf8")
      : String(event.body || event.rawBody || "");
    const result = await cloud.callFunction({
      name: process.env.PAYMENT_FUNCTION || "partnerPay",
      data: {
        action: "handlePaymentNotification",
        payload: { headers, body },
      },
    });
    if (!result.result?.ok) {
      return response(500, { code: "FAIL", message: result.result?.message || "支付通知处理失败" });
    }
    return response(200, { code: "SUCCESS", message: "成功" });
  } catch (error) {
    console.error("[wxpayNotify]", error);
    return response(500, { code: "FAIL", message: error.message || "支付通知处理失败" });
  }
};

function response(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(data),
  };
}
