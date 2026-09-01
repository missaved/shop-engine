# SpotNear · 配置与部署选项总览

> 版本：v1.0 · 2026-08-31
> 范围：shop-engine（Next.js 16 App Router）所有可配置项
> 受众：自部署者 / 二次开发者 / 运维

---

## 1. 三大部署目标对照

| 维度 | 本地开发 | Vercel 部署 | 自部署 VPS |
|---|---|---|---|
| 命令 | `pnpm dev` | Vercel 自动构建 | `pnpm build && pnpm start` |
| 数据库 | docker-compose 起 Postgres | Vercel Postgres / Neon | docker-compose / 自建 |
| 图片存储 | local（`public/uploads`） | s3（R2，配 `img.spotnear.me`） | s3 或 local |
| 域名 | `localhost:3000` | `spotnear.me` | 自配 |
| 端口 | 3000 | 443 (HTTPS) | 自配 |

---

## 2. 环境变量

### 2.1 必填（核心）

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✓ | Prisma 连接串，例：`postgresql://user:pass@host:5433/db?schema=public` |
| `AUTH_SECRET` | ✓ | Auth.js 会话密钥，例：`openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | 生产 | `"true"`，让 Auth.js 信任反向代理头 |

### 2.2 存储（图片 / 上传）

完整说明见 `app/README.md` §存储配置。这里给出决策树：

```
本地开发              → 不设 STORAGE_DRIVER（默认 local）
Vercel / Serverless  → STORAGE_DRIVER=s3 + S3_* + STORAGE_PUBLIC_BASE_URL
自部署 VPS           → 看量：< 1000 张/天 用 local；更大用 s3
```

| 变量 | 取值 | 说明 |
|---|---|---|
| `STORAGE_DRIVER` | `local`（默认） / `s3` | 不设 = local，写 `public/uploads` |
| `STORAGE_PUBLIC_BASE_URL` | 如 `https://img.spotnear.me` | s3 模式图片公网基址 |
| `S3_ENDPOINT` | s3 必填 | 对象存储端点 |
| `S3_BUCKET` | s3 必填 | 桶名 |
| `S3_REGION` | s3 推荐 | R2 用 `auto` |
| `S3_ACCESS_KEY_ID` | s3 必填 | Access Key |
| `S3_SECRET_ACCESS_KEY` | s3 必填 | Secret Key |

### 2.3 业务可调

| 变量 | 默认 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `vi` | 默认语言（落地页 / 未识别 Accept-Language 时） |
| `NEXT_PUBLIC_BRAND_NAME` | `SpotNear` | 顶栏品牌名覆盖（仅品牌定制店可用） |
| `NEXT_PUBLIC_IMAGE_DOMAIN` | `img.spotnear.me` | 图片域名（与 STORAGE_PUBLIC_BASE_URL 一致） |
| `REMINDER_PRESET_KEY` | `default` | 提醒文案预设集 key |

### 2.4 可选（运维）

| 变量 | 默认 | 说明 |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `PORT` | `3000` | 启动端口 |
| `HEALTHCHECK_PATH` | `/api/health` | 健康检查路径 |

---

## 3. PWA / Manifest 选项

文件：`app/app/manifest.json`

| 字段 | 当前值 | 说明 |
|---|---|---|
| `name` | `SpotNear · 东南亚小商户开单工具` | 完整名（安装时显示） |
| `short_name` | `SpotNear` | 桌面图标下方名 |
| `start_url` | `/` | PWA 启动入口 |
| `scope` | `/` | PWA 作用域 |
| `display` | `standalone` | 全屏，去掉浏览器 UI |
| `theme_color` | `#0EA5A4` | 顶栏着色 |
| `background_color` | `#FAFAFA` | 启动屏背景 |
| `lang` | `zh-Hans` | 默认语言 |

**调色后必须同步**：BRAND.md §1 + tailwind.config.ts + manifest.json + app/globals.css。

---

## 4. 国际化（next-intl）

支持 6 种语言，文件位于 `app/messages/`：

| 文件 | 语言 |
|---|---|
| `zh.json` | 简体中文（默认 zh-Hans） |
| `zh-Hant.json` | 繁体中文 |
| `en.json` | English |
| `vi.json` | Tiếng Việt |
| `ms.json` | Bahasa Melayu |
| `th.json` | ภาษาไทย |

**新增字段**：所有 6 份 messages **必须同步加**，否则编译警告 + 兜底回退到 `zh`。

**新增语言**：在 `i18n/routing.ts` + `proxy.ts` 注册 locale，并把新文件丢进 `messages/`。

---

## 5. 主题色（Tailwind / shadcn）

色板权威：`BRAND.md §1`

| 用途 | Token | Tailwind class |
|---|---|---|
| 主按钮 | `--brand-primary` | `bg-primary text-primary-foreground` |
| 主按钮 hover | `--brand-primary-deep` | `hover:bg-primary/90` |
| 强调 / 提醒 | `--brand-accent` | `bg-amber-400` 等 |
| 错误 / 售罄 | `--danger` | `bg-destructive` |

---

## 6. 路由约定

| 路径 | 用途 |
|---|---|
| `/` | 落地页（自动重定向到默认 locale） |
| `/[locale]` | locale 前缀的落地页 |
| `/[locale]/[city]` | 城市门户聚合页 |
| `/[locale]/[city]/[vertical]` | 垂直入口 |
| `/[locale]/[city]/[vertical]/[slug]` | 单店客户侧 |
| `/[locale]/[city]/[vertical]/[slug]/track` | 查单页 |
| `/admin` | 老板后台（老板手机号+密码登录） |
| `/api/health` | 健康检查 |
| `/api/webhooks/*` | IM 回调（阶段2） |

---

## 7. pnpm 脚本

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发服务器（http://localhost:3000） |
| `pnpm build` | 生产构建 |
| `pnpm start` | 跑生产构建 |
| `pnpm tsc --noEmit` | 类型检查 |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | Prisma migrate deploy |
| `pnpm db:seed` | 种子数据 |
| `pnpm tsx scripts/build-brand-assets.mts` | **重建品牌物料**（改 BRAND.md 色板后必跑） |
| `pnpm tsx scripts/migrate-uploads-to-r2.mts` | local → R2 存量图迁移（带 `--dry-run`） |
| `pnpm test` | Playwright E2E |

---

## 8. 故障排查速查

| 症状 | 排查 |
|---|---|
| 图片 404 | 检查 `[storage] driver = ...` 启动日志 + `imageUrl` 路径 |
| 老板后台登录失败 | `AUTH_SECRET` 是否设置；`AUTH_TRUST_HOST` 生产是否 `"true"` |
| 多语言某字段显示 key 而非文字 | 检查 6 份 messages 是否都加了新字段 |
| OG 图不显示 | `pnpm build` 后看 `app/opengraph-image.png` 是否被 build pipeline 处理 |
| PWA 不弹"添加到主屏幕" | 必须 HTTPS；DevTools → Application → Manifest 看是否有错 |

---

## 9. 决策记录

- **2026-08-31**：单一 manifest 放 `app/app/`（Next.js 16 约定），删除 `public/manifest.json` 占位版。
- **2026-08-31**：logo PNG 用 sharp 一次性脚本生成，源 SVG 在 `public/brand/`。
- **2026-08-31**：6 种语言而非 3 种（含泰、马、繁中），覆盖东南亚实际市场。