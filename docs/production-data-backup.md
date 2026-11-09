# 正式环境数据备份与恢复说明

## 保护范围

生产环境：`elva-pizza-prod-d3f8fae10cb05aca`

每日备份覆盖全部正式集合，重点包括：

- `orders`：订单及订单商品快照；
- `transactions`：充值、消费、退款和余额流水；
- `refunds`：退款事实；
- `members`：会员当前余额与身份关联；
- `customer_profiles`：小程序客户资料；
- 商品、分类、门店、员工、配送配置、迁移记录和临时登录数据；
- 云存储对象清单；
- CloudBase 当前可用回档时间点和范围。

## 备份位置

```text
/Users/dimengjiao/Documents/AiwaPizza-Backups/production/
```

每次备份使用北京时间命名，例如：

```text
2026-11-09T19-34-03/
```

目录权限为仅当前电脑用户可访问。备份包含客户个人信息，不应发送到公开网盘、代码仓库或聊天群。

## 文件说明

- 每个集合对应一个 `<collection>.ndjson` 文件，每行是一条 JSON 记录；
- `manifest.json` 记录集合数量、文件大小和 SHA-256 校验值；
- `cloud-storage-manifest.json` 记录商品图片等云存储对象的路径、大小和 ETag；
- `LATEST` 指向最近一次成功完成的备份目录。

只有所有集合均成功导出、存储清单和回档范围均成功取得后，备份目录才会正式生成。中途失败的临时目录会被清理，不会伪装成成功备份。

## 手工执行

在项目目录运行：

```bash
npm run backup:production
```

也可直接使用工作区 Node.js 运行：

```bash
node scripts/backup-production-data.js
```

## 验证方法

1. 打开最新目录的 `manifest.json`；
2. 确认 `orders`、`transactions`、`members`、`refunds` 的 `count` 符合预期；
3. 使用 `shasum -a 256 <文件>` 重新计算哈希，并与清单中的 `sha256` 比较；
4. 确认 `rollback.restoreTimes` 中存在最近一天的 CloudBase 回档点；
5. 每季度在非生产环境进行一次抽样恢复演练。

## 恢复原则

正式环境发生误删或错误写入时：

1. 先停止相关后台操作或有问题的发布版本，记录事故时间；
2. 不要直接覆盖生产集合；
3. 优先使用 CloudBase 回档功能恢复为新集合，例如 `orders_restore_YYYYMMDD`；
4. 比较原集合、回档集合和本地备份，确认需要补回的记录；
5. 对订单、流水、退款和会员余额一起恢复并复核关联关系；
6. 经核对后再切换或合并数据，保留操作记录；
7. 恢复后重新执行月度数据核对。

本地 NDJSON 备份用于长期追溯和平台回档窗口之外的恢复证据，不应在未经核对时整库直接导回生产环境。

## 仍需注意

- CloudBase 自动回档和本机独立备份是两套保护：前者便于近期快速恢复，后者用于长期追溯；
- 本机损坏或丢失仍可能影响本地副本，建议后续将整个 `AiwaPizza-Backups` 目录同步到一个受控、加密且仅店主可访问的外部存储；
- 生产 CloudBase 套餐必须持续有效，备份无法替代续费和服务可用性保障。
