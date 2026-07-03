# 爱娃披萨店会员管理正式上线方案

## 当前阶段

当前版本已进入“云端测试版”：

- 已加入店员手机号验证码登录界面
- 已加入店员白名单管理
- 已按多门店结构保存数据
- 当前验证码为测试模式：`123456`
- 已接入腾讯云 CloudBase 云函数和云数据库

## 推荐上线架构

- 前端：当前网页应用
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

- `membershipApi`：统一处理云端数据读取、保存、验证码测试登录
- 前端已支持“云端可用时同步，云端不可用时继续本地模式”

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
| type | `recharge` 充值 / `spend` 消费 / `adjust` 调整 |
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

## 腾讯云接入步骤

1. 注册或登录腾讯云账号
2. 开通 CloudBase 云开发
3. 创建环境，例如 `aiwa-pizza-prod`
4. 创建数据库集合：`stores`、`staff`、`members`、`transactions`、`bonusrules`、`login_codes`
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

正式上线时需要把店长手机号改为真实手机号，并接入腾讯云短信。

## 下一步云端配置

1. 把默认店长手机号 `13800000000` 改为真实店长手机号
2. 开通腾讯云短信，申请短信签名和验证码模板
3. 把 `membershipApi` 里的测试验证码替换为真实短信验证码发送逻辑
4. 部署到 CloudBase 静态网站托管或自有域名
5. 配置每日或每周数据库导出备份
