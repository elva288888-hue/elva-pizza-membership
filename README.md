# 爱娃披萨店自助点餐与会员管理

这是爱娃披萨店自助点餐与会员管理系统。当前版本在原会员充值、消费、余额和交易流水基础上，扩展了消费者扫码点餐端和店家接单后台。

## 自动化测试

项目使用 Node.js 内置测试运行器，并通过隔离的临时数据文件执行页面回归，不会修改真实商品、会员或订单数据。

```bash
pnpm test
```

也可以分别运行：

```bash
pnpm test:core
pnpm test:e2e
```

测试范围和最新结果见 `docs/automation-test-report.md`。

## 测试与生产发布

测试环境和生产环境使用独立的 CloudBase 环境、静态托管、云函数及数据库。发布必须先通过明确的目标环境构建和校验，具体命令见 `docs/deployment-environments.md`。

## 当前模式

本地开发默认连接 CloudBase 测试环境，生产发布必须通过独立的生产构建确认：

- 默认环境 ID：`elva-pizza-test-d1far2ax4213b224`
- 云函数：`membershipApi`
- 数据集合：`stores`、`staff`、`members`、`transactions`、`categories`、`products`、`orders`、`refunds`、`bonusrules`、`login_codes`
- `cloudbase-config.js` 里的 `enabled` 当前为 `true`

## 客户端入口

- 线上内测店家后台：`https://elva-pizza-test-d1far2ax4213b224-1448876255.tcloudbaseapp.com/index.html`
- 线上内测 H5 消费者点餐端：`https://elva-pizza-test-d1far2ax4213b224-1448876255.tcloudbaseapp.com/customer.html?source=internal_test`
- 本地店家后台：`index.html`
- 本地消费者点餐端：`customer.html`
- 微信小程序端：`miniprogram/`，当前消费者真实点餐主线
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
- 配送订单会请求定位，仅允许门店 3 公里内下单；默认配送费 5 元，商品金额满 58 元（含）自动免配送费。店长可在后台“设置 → 配送设置”修改规则，并在门店点击“使用门店当前位置”准确回填经纬度。
- 消费者手机号会识别会员；非会员下单时会自动创建会员档案。
- 消费者端支持会员余额支付和 H5 内测模拟支付/充值。真实在线充值必须等支付回调打通后再开放。
- 店家后台可查看订单、接单制作、标记待取餐、完成订单、取消订单。
- 店家后台订单支持预览和打印 58mm（57×50 热敏纸）订单小票。
- 店家后台可维护商品，上架/下架、标记售罄、编辑和删除商品。
- 退款/退货不删除原流水，而是生成退款记录；会员余额退款会回写会员余额并生成 `refund` 流水。

## 当前支付路线

消费者端主线切换为微信小程序：

- 店内和社群二维码后续指向小程序。
- 真实微信支付优先走 CloudBase「微信小程序支付」集成。
- 小程序端已预留微信支付和会员余额支付。
- H5 点餐页保留为临时演示入口；后台管理端继续使用当前 Web 管理页面。

接入小程序需要回填：

- `miniprogram/project.config.json`：把 `appid` 改成真实小程序 AppID
- `miniprogram/app.js`：把 `payFunction` 改成 CloudBase 生成的支付云函数名

详细步骤见 `docs/miniprogram-payment-plan.md`。
