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
