# 爱娃披萨店自助点餐系统正式上线方案

## 当前阶段

当前版本已从“会员管理”扩展为“自助点餐 + 店家接单 + 会员账本”的云端测试版：

- 已加入店员手机号验证码登录界面
- 已加入店员白名单管理
- 已按多门店结构保存数据
- 腾讯云短信环境变量未配置前，验证码为测试模式：`123456`
- 已接入腾讯云 CloudBase 云函数和云数据库
- 已新增消费者点餐端 `customer.html`
- 已新增店家后台订单、商品、退款/退货处理
- 已支持扫码点单 URL 参数，例如 `customer.html?table=3&source=store_qr`
- 消费者下单时先选择配送或到店取餐；到店取餐支持即时取餐和预约日期/时间

## 推荐上线架构

- 前端：店家后台网页应用 + 消费者扫码点餐 H5
- 云端：腾讯云 CloudBase 云开发
- 数据库：CloudBase 数据库
- 登录：店员手机号 + 腾讯云短信验证码
- 部署：CloudBase 静态网站托管或腾讯云静态网站
- 备份：CloudBase 数据库定期导出

## 已知腾讯云信息

- CloudBase / 腾讯云账号 ID：`100047037371`
- CloudBase 环境名称：`elva-pizza-test`
- CloudBase 环境 ID：`elva-pizza-test-d1far2ax4213b224`
- 地域：上海 `ap-shanghai`
- 套餐：免费体验版，控制台显示到期时间 `2027-01-02 23:59:59`

当前项目已新增 `cloudbase-config.js`，用于保存 CloudBase 环境配置。云函数已部署完成，当前 `enabled` 为 `true`，系统会通过 CloudBase 同步数据。

当前项目已部署 CloudBase 云函数：

- `membershipApi`：统一处理云端数据读取、保存、短信验证码登录
- 前端已支持“云端可用时同步，云端不可用时继续本地模式”

## 扫码点单方案

消费者点餐端是一个手机 H5 页面，部署后可以把访问地址生成二维码。

- 店内桌贴二维码：`https://你的域名/customer.html?table=3&source=store_qr`
- 外带/社群二维码：`https://你的域名/customer.html?source=wechat_group`
- `table` 参数会进入订单备注，方便后台知道来源或取餐点
- `source` 参数用于区分店内扫码、微信群、朋友圈、传单等来源

第一版建议先用 H5 二维码点单，速度最快，也方便在微信群传播。后续如需微信小程序，可复用 CloudBase 云函数和数据库模型。

## 数据模型

### stores 门店

| 字段 | 说明 |
| --- | --- |
| id | 门店 ID |
| name | 门店名称 |
| createdAt | 创建时间 |

### staff 店员

| 字段 | 说明 |
| --- | --- |
| id | 店员 ID |
| storeId | 所属门店 |
| name | 店员姓名 |
| phone | 登录手机号 |
| role | `manager` 店长 / `staff` 店员 |
| active | 是否允许登录 |
| createdAt | 创建时间 |

### members 会员

| 字段 | 说明 |
| --- | --- |
| id | 会员 ID |
| storeId | 所属门店 |
| name | 会员姓名 |
| phone | 会员手机号 |
| card | 会员卡号 |
| balance | 当前余额 |
| note | 备注 |
| createdAt | 创建时间 |

### transactions 流水

| 字段 | 说明 |
| --- | --- |
| id | 流水 ID |
| storeId | 所属门店 |
| memberId | 会员 ID |
| staffId | 操作店员 ID |
| type | `recharge` 充值 / `spend` 消费 / `refund` 退款 / `adjust` 调整 |
| amount | 实收或消费金额 |
| bonusAmount | 赠送金额 |
| balanceAfter | 交易后余额 |
| note | 备注 |
| createdAt | 创建时间 |

### bonusrules 充值赠送规则

| 字段 | 说明 |
| --- | --- |
| id | 规则 ID |
| storeId | 所属门店 |
| minAmount | 充值满多少 |
| bonusAmount | 赠送多少 |
| active | 是否启用 |
| createdAt | 创建时间 |

### products 商品

| 字段 | 说明 |
| --- | --- |
| id | 商品 ID |
| storeId | 所属门店 |
| name | 商品名称 |
| category | 分类 |
| price | 单价 |
| description | 描述 |
| image | 图片地址 |
| active | 是否上架 |
| soldOut | 是否售罄 |
| sort | 排序 |
| createdAt / updatedAt | 创建 / 更新时间 |

### orders 订单

| 字段 | 说明 |
| --- | --- |
| id / orderNo | 订单 ID / 展示单号 |
| storeId | 所属门店 |
| customerName / customerPhone | 顾客姓名 / 手机号 |
| memberId / isMember | 会员 ID / 是否会员 |
| items | 商品明细，含名称、单价、数量、退款数量 |
| totalAmount | 订单总额 |
| paidAmount | 已支付金额 |
| refundAmount | 已退款金额 |
| status | `pending` 待接单 / `making` 制作中 / `ready` 待取餐 / `completed` 已完成 / `cancelled` 已取消 / `refunded` 已退款 / `partial_refund` 部分退款 |
| paymentStatus | `paid` 已支付 / `unpaid` 未支付 |
| paymentMethod | 到店支付、会员余额、现金、微信支付等 |
| fulfillmentType | `pickup` 到店取餐 / `delivery` 配送 |
| pickupMode | `now` 即时取餐 / `scheduled` 预约取餐 |
| pickupDate / pickupTime | 预约取餐日期 / 时间 |
| deliveryAddress | 配送地址 |
| deliveryDate / deliveryTime | 期望送达日期 / 时间 |
| fulfillmentLabel | 后台展示用履约摘要 |
| note | 顾客备注、桌号、来源 |
| createdAt / updatedAt | 创建 / 更新时间 |

### refunds 退款

| 字段 | 说明 |
| --- | --- |
| id | 退款 ID |
| orderId | 关联订单 |
| memberId | 关联会员，可为空 |
| amount | 退款金额 |
| reason | 退款原因 |
| method | 退款方式：会员余额、现金、手动记录、微信支付 |
| status | 当前第一版为 `completed` |
| staffId | 操作店员 |
| createdAt | 创建时间 |

## 腾讯云接入步骤

1. 注册或登录腾讯云账号
2. 开通 CloudBase 云开发
3. 创建环境，例如 `aiwa-pizza-prod`
4. 创建数据库集合：`stores`、`staff`、`members`、`transactions`、`bonusrules`、`login_codes`
   - 新点餐版还需要：`categories`、`products`、`orders`、`refunds`
5. 开通腾讯云短信
6. 申请短信签名：建议使用门店营业执照主体
7. 申请短信模板：用于发送验证码
8. 部署云函数：`membershipApi`
9. 开启前端 CloudBase 同步
10. 上线前把默认店长手机号改为真实手机号

## 测试登录

当前版本默认创建：

- 门店：爱娃披萨店
- 店长手机号：`13800000000`
- 测试验证码：`123456`

正式上线时需要把店长手机号改为真实手机号，并配置腾讯云短信环境变量。

## 下一步云端配置

1. 把默认店长手机号 `13800000000` 改为真实店长手机号
2. 开通腾讯云短信，申请短信签名和验证码模板
3. 在 CloudBase 云函数 `membershipApi` 里配置短信环境变量：
   - `TENCENT_SECRET_ID`
   - `TENCENT_SECRET_KEY`
   - `TENCENT_SMS_SDK_APP_ID`
   - `TENCENT_SMS_SIGN_NAME`
   - `TENCENT_SMS_TEMPLATE_ID`
   - `TENCENT_SMS_REGION`，可选，默认 `ap-guangzhou`
   - `TENCENT_SMS_TEMPLATE_PARAMS`，可选，默认 `{code},{minutes}`
4. 部署到 CloudBase 静态网站托管或自有域名
5. 配置每日或每周数据库导出备份

## 相关账号是否继续有用

- CloudBase：继续有用，当前测试环境可以保留做开发测试；正式上线建议新建生产环境，例如 `aiwa-pizza-prod`。
- 腾讯云短信：继续有用，店员登录、未来消费者手机号登录/订单通知都能复用。
- 微信支付商户号：如果要真实在线支付、在线充值、原路退款，则必须开通。当前版本的消费者端充值是 MVP 模拟充值，正式收款前应改为微信支付回调入账。
- 微信小程序账号：不是第一版必须。若以后希望顾客在微信内获得更原生体验、支付更顺畅、可沉淀用户，则再申请小程序账号并复用现有后端。
