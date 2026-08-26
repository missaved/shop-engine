# shop-engine · 轻量开单引擎

> 阶段 1 引擎（Next.js + Prisma + Auth.js + shadcn + next-intl），**独立 git 仓库**，与 medusa-shop 零共享。
> 唯一权威方向：`../DIRECTION.md`；开发计划：`../TASK_PLAN.md`。

## 当前状态

- [x] 独立 git 仓库地基（2026-08-26，空仓库，main 分支）
- [x] 引擎骨架（2026-08-26 完成）：
  - Next.js 16.3.2（App Router + TS 严格 + Tailwind 4，Turbopack）
  - Prisma 7.10（driver adapter `@prisma/adapter-pg`），schema：Shop / Product / Order / Reminder（jsonb config + vertical）
  - 租户隔离 `lib/tenant.ts`（getShopBySlug / assertShopOwned），`lib/prisma.ts` 单例
  - next-intl 4.13（zh/en/vi，`proxy.ts` 重定向 locale，`app/[locale]` 结构）
  - 落地页三语 + `/api/health` 健康检查
- [ ] 老板侧一页后台（Auth.js + 订单列表 + 复制摘要发 Zalo + 标记收款 + 售罄/营业时间/起送价）—— 下一步

## 本地开发

```bash
docker-compose up -d          # 起数据库（127.0.0.1:5433）
pnpm db:migrate               # 建表/迁移
pnpm db:seed                  # 种子数据（演示店 demo-pho）
pnpm dev                      # http://localhost:3000
```

## 隔离边界

- 本目录是干净起点，不含任何 Medusa 代码/依赖。
- medusa-shop（/root/medusa-shop）= 冻结演示样板，仅作产品逻辑/文案/UX 参考。
- 依赖、端口、数据库一律独立，不复用 medusa-shop 的任何配置。
