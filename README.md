# 爱娃披萨店自助点餐与会员管理

这是爱娃披萨店自助点餐与会员管理系统。当前版本在原会员充值、消费、余额和交易流水基础上，扩展了消费者扫码点餐端和店家接单后台。

## 当前模式

当前已开启 CloudBase 云端同步：

- 环境 ID：`elva-pizza-test-d1far2ax4213b224`
- 云函数：`membershipApi`
- 数据集合：`stores`、`staff`、`members`、`transactions`、`categories`、`products`、`orders`、`refunds`、`bonusrules`、`login_codes`
- `cloudbase-config.js` 里的 `enabled` 当前为 `true`

## 客户端入口

- 线上内测店家后台：`https://elva-pizza-test-d1far2ax4213b224-1448876255.tcloudbaseapp.com/index.html`
- 线上内测消费者点餐端：`https://elva-pizza-test-d1far2ax4213b224-1448876255.tcloudbaseapp.com/customer.html?source=internal_test`
- 本地店家后台：`index.html`
- 本地消费者点餐端：`customer.html`
- 扫码点单链接可带参数：
  - 店内桌号/取餐点：`customer.html?table=3&source=store_qr`
  - 社群宣传二维码：`customer.html?source=wechat_group`

部署到 CloudBase 静态网站托管后，把消费者点餐端 URL 生成二维码即可贴在店里或发到群里。

## CloudBase 云端状态

云函数已部署，基础集合已创建。首次调用会自动初始化门店“爱娃披萨店”和默认店长账号。

## 测试登录

- 店长手机号：`13800000000`
- 在腾讯云短信环境变量未配置前，测试验证码：`123456`

## 腾讯云短信配置

云函数已支持真实短信验证码。需要在 CloudBase 云函数 `membershipApi` 里配置以下环境变量：

- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`
- `TENCENT_SMS_SDK_APP_ID`
- `TENCENT_SMS_SIGN_NAME`
- `TENCENT_SMS_TEMPLATE_ID`
- `TENCENT_SMS_REGION`，可选，默认 `ap-guangzhou`
- `TENCENT_SMS_TEMPLATE_PARAMS`，可选，默认 `{code},{minutes}`

建议验证码模板包含两个变量：验证码和有效分钟数，例如“您的验证码为{1}，{2}分钟内有效”。

## 当前 MVP 范围

- 消费者可浏览商品、加入购物车、提交订单、选择配送或到店取餐、查看订单记录。
- 消费者端改为授权后点餐，本地测试使用 `mockAuth=1` 模拟微信授权，不再在下单页要求填写姓名和手机号。
- 到店取餐支持即时取餐，也支持选择取餐日期和具体时间。
- 配送订单支持填写配送地址和期望送达日期/时间。
- 消费者手机号会识别会员；非会员下单时会自动创建会员档案。
- 消费者端支持会员余额支付和模拟充值。正式上线收款建议接微信支付后再开放真实在线充值。
- 店家后台可查看订单、接单制作、标记待取餐、完成订单、取消订单。
- 店家后台可维护商品，上架/下架、标记售罄、编辑和删除商品。
- 退款/退货不删除原流水，而是生成退款记录；会员余额退款会回写会员余额并生成 `refund` 流水。
