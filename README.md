# shop-engine · 轻量开单引擎

> 阶段 1 引擎（Next.js + Prisma + Auth.js + shadcn + next-intl），**独立 git 仓库**，与 medusa-shop 零共享。
> 唯一权威方向：`../DIRECTION.md`；开发计划：`../TASK_PLAN.md`。

## 当前状态

- [x] 独立 git 仓库地基（2026-08-26，空仓库，main 分支）
- [ ] 引擎骨架（Next.js + Prisma + 租户隔离）—— 下一步

## 隔离边界

- 本目录是干净起点，不含任何 Medusa 代码/依赖。
- medusa-shop（/root/medusa-shop）= 冻结演示样板，仅作产品逻辑/文案/UX 参考。
- 依赖、端口、数据库一律独立，不复用 medusa-shop 的任何配置。
