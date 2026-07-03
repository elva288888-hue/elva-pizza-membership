# 爱娃披萨店会员管理

这是爱娃披萨店会员管理系统，用于记录会员充值、赠送、消费、余额和交易流水。

## 当前模式

当前已开启 CloudBase 云端同步：

- 环境 ID：`elva-pizza-test-d1far2ax4213b224`
- 云函数：`membershipApi`
- 数据集合：`stores`、`staff`、`members`、`transactions`、`bonusrules`、`login_codes`
- `cloudbase-config.js` 里的 `enabled` 当前为 `true`

## CloudBase 云端状态

云函数已部署，基础集合已创建。首次调用会自动初始化门店“爱娃披萨店”和默认店长账号。

## 测试登录

- 店长手机号：`13800000000`
- 测试验证码：`123456`

正式上线时需要接入腾讯云短信，把测试验证码替换为真实短信验证码。
