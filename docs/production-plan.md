# 爱娃披萨店会员管理正式上线方案

## 当前阶段

当前版本是“正式版骨架”：

- 已加入店员手机号验证码登录界面
- 已加入店员白名单管理
- 已按多门店结构保存数据
- 当前验证码为测试模式：`123456`
- 数据仍保存在浏览器本地，后续接腾讯云后替换为云数据库

## 推荐上线架构

- 前端：当前网页应用
- 云端：腾讯云 CloudBase 云开发
- 数据库：CloudBase 数据库
- 登录：店员手机号 + 腾讯云短信验证码
- 部署：CloudBase 静态网站托管或腾讯云静态网站
- 备份：CloudBase 数据库定期导出

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

### bonus_rules 充值赠送规则

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
4. 创建数据库集合：`stores`、`staff`、`members`、`transactions`、`bonus_rules`
5. 开通腾讯云短信
6. 申请短信签名：建议使用门店营业执照主体
7. 申请短信模板：用于发送验证码
8. 增加云函数：
   - `sendLoginCode`：发送验证码
   - `verifyLoginCode`：验证验证码并创建登录会话
   - `syncData`：读写会员、流水、规则
9. 把当前本地数据层替换为 CloudBase API
10. 上线前导入初始门店和店长手机号

## 测试登录

当前版本默认创建：

- 门店：爱娃披萨店
- 店长手机号：`13800000000`
- 测试验证码：`123456`

正式上线时需要把店长手机号改为真实手机号，并接入腾讯云短信。
