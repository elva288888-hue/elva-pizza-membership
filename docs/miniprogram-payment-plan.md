# 微信小程序支付接入计划

> 当前状态：主线切换到微信小程序。H5 版本保留为临时演示和后台管理入口，消费者真实点餐与真实微信支付优先走小程序。

## 当前决定

消费者端以微信小程序为正式方向：扫码进入小程序点餐，使用微信支付或会员余额支付。支付闭环优先使用 CloudBase「集成与模板 → 集成中心 → 微信小程序支付」生成的 HTTP 云函数。

## 你需要在控制台完成

1. 注册或登录微信小程序账号，并拿到小程序 AppID。
2. 在微信支付商户平台确认商户号已开通。
3. 确认微信支付商户号已绑定该小程序 AppID。
4. 在 CloudBase 新版控制台打开当前环境 `elva-pizza-test`。
5. 进入 `集成与模板`，选择 `微信小程序支付`。
6. 按页面提示录入商户号、AppID、API v3 密钥、证书序列号和商户私钥。
7. 创建完成后，记录生成的支付云函数名，例如 `miniapp-wxpay-xxxxxx`。

## 代码中需要填的位置

创建支付集成后，把云函数名填到：

```js
// miniprogram/app.js
payFunction: "miniapp-wxpay-xxxxxx"
```

同时把 `project.config.json` 里的 `appid` 从 `touristappid` 改成真实小程序 AppID。

当前环境 ID 已配置为：

```js
envId: "elva-pizza-test-d1far2ax4213b224"
```

## 支付闭环目标

- 小程序调用 `membershipApi.createMiniProgramPendingOrder` 创建待支付订单。
- 调用 CloudBase 微信支付集成 HTTP 云函数创建支付单。
- 小程序调用 `wx.requestPayment`。
- 微信支付回调到 CloudBase 支付云函数。
- 回调成功后由后端确认订单、写入流水。
- 只有回调确认成功后，会员余额才增加，订单才进入后台待接单。

## 当前代码状态

`miniprogram/` 目录已经创建了基础小程序点餐端：

- `pages/order/order`：商品、购物车、取餐方式、付款入口
- `pages/orders/orders`：我的订单
- 数据读取：通过 `membershipApi.getMiniProgramData` 读取小程序所需的门店、分类、商品和会员信息
- 订单查询：通过 `membershipApi.getMiniProgramOrders` 只读取当前微信身份/手机号对应订单
- 微信支付：先通过 `membershipApi.createMiniProgramPendingOrder` 生成待支付订单，再通过 CloudBase 支付 HTTP 云函数下单
- 会员余额支付：通过 `membershipApi.createMiniProgramOrder` 在后端扣款、生成流水并落单
- 真支付入口：等待 CloudBase 支付云函数名后启用

下一步重点是把支付集成函数的返回参数和业务回调结构接入 `membershipApi`，避免前端直接写入已支付订单。

## 已预留的后端接口

`membershipApi` 已增加小程序专用接口：

- `getMiniProgramData`：小程序首页加载商品、分类、门店和会员状态
- `getMiniProgramOrders`：查询当前顾客订单
- `createMiniProgramPendingOrder`：微信支付前创建待支付订单并生成全局唯一订单号
- `createMiniProgramOrder`：会员余额支付时创建已支付订单并扣会员余额
- `confirmPaidMiniProgramOrder`：支付完成后确认待支付订单为已支付，并生成后台流水
- `recordPaidMiniProgramOrder`：微信支付回调确认成功后创建已支付订单

微信支付正式接入时，支付云函数回调里应调用 `confirmPaidMiniProgramOrder`，传入 `out_trade_no`/订单号、`transaction_id` 和金额，由后端把待支付订单改为已支付并写入流水。前端 `wx.requestPayment` 成功后可以做一次兜底确认，但最终仍应以后端回调为准。

## 本地开发检查

1. 用微信开发者工具打开 `miniprogram/project.config.json`。
2. 确认云开发环境为 `elva-pizza-test-d1far2ax4213b224`。
3. 上传并部署 `cloudfunctions/membershipApi`。
4. 在小程序首页确认能看到商品分类和购物车。
5. 未配置 `payFunction` 前，微信支付按钮会提示先配置支付集成，这是预期行为。
