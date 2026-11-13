# 测试与生产环境发布

项目长期保留两套完全独立的 CloudBase 环境：

- 测试：`elva-pizza-test-d1far2ax4213b224`
- 生产：`elva-pizza-prod-d3f8fae10cb05aca`

两套环境的静态托管、云函数、数据库集合和业务数据互不共用。

## 测试发布

```bash
pnpm build:test
tcb hosting deploy .build/deploy/test / -e elva-pizza-test-d1far2ax4213b224
```

## 生产发布

生产构建必须显式确认生产环境 ID，否则脚本会中止：

```bash
CONFIRM_PRODUCTION_ENV=elva-pizza-prod-d3f8fae10cb05aca pnpm build:production
tcb hosting deploy .build/deploy/production / -e elva-pizza-prod-d3f8fae10cb05aca
```

任何新功能都应先发布测试环境并完成实机验证，再使用同一份源代码构建生产包。

## 小程序发布

测试版和正式版必须从同一提交构建，业务代码完全相同，仅 CloudBase 环境 ID 不同：

```bash
pnpm build:miniprogram:test
CONFIRM_PRODUCTION_ENV=elva-pizza-prod-d3f8fae10cb05aca pnpm build:miniprogram:production
```

- `.build/miniprogram/test` 仅用于开发版和体验版，连接 CloudBase test。
- `.build/miniprogram/production` 仅用于提交审核和正式发布，连接 CloudBase prod。
- 禁止直接从 `miniprogram/` 源码目录上传；源码目录不是可发布产物。
- 正式包提交审核后，可以再上传同版本号的 test 构建作为开发/体验版；审核快照不会被后续开发版覆盖。
- 禁止将 test 构建提交审核，也禁止让体验测试产生的数据进入 prod。

上传前必须登录微信小程序后台，实时记录“线上版本、审核版本、开发版本”三个版本号。新版本号必须高于其中最高版本；禁止从旧截图、历史对话、Git 标签或本地文件推断当前线上版本。上传完成后必须复核版本号、构建目标和 CloudBase 环境 ID。

## 生产数据保护

- 测试与生产数据库禁止自动同步、合并或互相覆盖。
- 正式发布只更新代码和云函数，不迁移测试会员、余额、订单、支付、退款或流水。
- 正式环境业务数据默认只读。任何写操作必须先核对环境 ID、精确记录、当前状态、影响范围和恢复方案。
- 批量更新、迁移、清理或结构调整正式数据前必须先备份，并单独取得明确授权。
- 微信支付、退款和余额调整必须先服务端查单，成功后写入审计流水；禁止只改数据库余额。

每次正式发布均应将对应提交推送到 GitHub，并创建与小程序版本一致的 Git 标签（例如 `v1.0.4`），用于后续审计和回滚。
