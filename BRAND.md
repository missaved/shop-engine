# SpotNear · 品牌规范（Brand Guidelines）
> 版本：v1.0 · 2026-08-31
> 域名：spotnear.me（图床：img.spotnear.me）
> 项目：shop-engine（Next.js 16 App Router）

本文件是 SpotNear 品牌物料的唯一视觉/排版来源。所有 logo、图标、OG 图、落地页 hero 都以此为准；改色板/字体前必须先改本文件。

---

## 1. 色板（Color Tokens）

| Token | 值 | 用途 |
|---|---|---|
| `--brand-primary` | `#0EA5A4` | 主色（按钮、链接、Logo 针身） |
| `--brand-primary-deep` | `#0F766E` | 主色加深（hover、激活态、文字配底） |
| `--brand-primary-soft` | `#CCFBF1` | 主色浅底（chip、tag、info 卡片） |
| `--brand-accent` | `#FACC15` | 强调色（提醒、订单号、新订单小红点） |
| `--ink-900` | `#0A0A0A` | 主文字、深底 |
| `--ink-700` | `#3F3F46` | 次级文字 |
| `--ink-500` | `#71717A` | muted 文字、占位、说明 |
| `--ink-300` | `#D4D4D8` | 分隔线、disabled |
| `--paper` | `#FAFAFA` | 主背景 |
| `--paper-elevated` | `#FFFFFF` | 卡片背景 |
| `--danger` | `#EF4444` | 错误、删除、售罄 |

**对比度**：所有正文 ≥ `#71717A` on `#FAFAFA`（已验证 4.6:1）；Logo 主色用于大块底/线，不放 12px 文字。

---

## 2. 字体栈（Typography）

| 场景 | 字体栈 |
|---|---|
| 中文简 | `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` |
| 中文繁 | `"PingFang TC", "Microsoft JhengHei", sans-serif` |
| 越南文 | `"Be Vietnam Pro", "Inter", system-ui, sans-serif` |
| 泰文 | `"Noto Sans Thai", "Inter", system-ui, sans-serif` |
| 马来文 | `"Inter", system-ui, sans-serif` |
| 英文 | `"Inter", system-ui, -apple-system, "Segoe UI", sans-serif` |
| Logo / 数字 | `"Inter", "SF Pro Display", system-ui, sans-serif`（700 权重） |

**字号梯度**（rem，base 16px）：

| Token | px | 用途 |
|---|---|---|
| `text-xs` | 12 | 标注、时间戳 |
| `text-sm` | 14 | 表格、菜单项 |
| `text-base` | 16 | 正文 |
| `text-lg` | 18 | 次标题 |
| `text-xl` | 20 | 卡片标题 |
| `text-2xl` | 24 | 区段标题 |
| `text-3xl` | 30 | 落地页 hero（移动） |
| `text-4xl` | 36 | 落地页 hero（桌面） |

---

## 3. Logo 规则

### 3.1 主 Logo（横排）
- 形式：定位针（pin/drop）+ "SpotNear" 文字
- 针尖朝下、文字在针右侧水平排列
- 文件：`public/brand/logo.svg`
- 安全区：上下左右各留 **1× 文字 x-height** 空白
- 最小宽度：移动端 ≥ 96px，桌面 ≥ 160px

### 3.2 Mark（纯图形）
- 形式：仅定位针
- 文件：`public/brand/logo-mark.svg`、`app/app/icon.svg`
- 用作：favicon、apple-touch-icon、OG 图主图、PWA 启动图

### 3.3 禁用场景
- ❌ 不要把 Logo 文字换成其他字体
- ❌ 不要给针加描边或阴影
- ❌ 不要把 Logo 放到底色与 `--brand-primary` 对比度 < 3:1 的图上
- ❌ 不要把 mark 旋转超过 ±5°

---

## 4. 图标系统（Iconography）

- 库：`lucide-react`（已对齐 shadcn 默认）
- 描边宽度：1.5px（默认） / 2px（强调场景）
- 圆角：`rounded-md`（默认） / `rounded-full`（圆形按钮）
- 颜色：继承 `currentColor`，由父级 `text-*` 控制

---

## 5. 语气与文案（Tone & Voice）

- **直接、克制、不煽情**。对老板说话，不用华丽词。
- 中英越三语对齐；专有名（SpotNear / Zalo / VietQR）保留原文。
- 落地页副标：≤ 20 字；按钮：≤ 6 字；错误提示：≤ 30 字 + 一个修复动作。

---

## 6. 文件清单（与代码对应）

| 物料 | 路径 |
|---|---|
| 主 Logo SVG | `app/public/brand/logo.svg` |
| Mark SVG | `app/public/brand/logo-mark.svg` |
| Logo PNG 多尺寸 | `app/public/brand/logo-{512,256,128,64}.png` |
| Favicon ICO | `app/app/favicon.ico` |
| App Icon SVG | `app/app/icon.svg` |
| Apple Touch Icon | `app/app/apple-icon.png` |
| OG Image | `app/app/opengraph-image.png` |
| Manifest | `app/app/manifest.json` |
| 三语/六语 brand 文案 | `app/messages/*.json` 的 `brand.*` |
| 配置选项文档 | `app/docs/OPTIONS.md` |

---

## 7. 修订记录

- v1.0（2026-08-31）：初版。主色 `#0EA5A4`，Logo = 定位针 + SpotNear 横排，6 语文案。