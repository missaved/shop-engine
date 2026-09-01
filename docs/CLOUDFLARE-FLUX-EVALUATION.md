# Cloudflare Workers AI（FLUX）替代 minimax 出图 · 可行性评估

> 状态：**只读评估**（2026-08-29，未改任何代码）
> 背景：用户提供一篇「Cloudflare Pages + Workers AI 免费跑 Whisper / FLUX 文生图」教程，询问可否用它替代现有 minimax image-01 出图通道。
> 结论先行：**技术上完全可行、改动点极小，但免费额度不足以支撑批量预生成，且按量付费单价反而比 minimax 贵 4 倍；只适合做「兜底 provider」或「单图重生成」场景，不建议整体替换。**

---

## 1. 现状回顾（现有出图链路）

| 项 | 现有实现 |
|---|---|
| 出图模型 | minimax `image-01`（`app/lib/llm/image.ts` 的 `generateImage()`） |
| 存储 | `save()` → `public/uploads/presets/{country}/{subcategory}/{slug}-*.jpg` |
| 限流语义 | 1004/1042 退避重试 3 次；1008/持续限流 → `QUOTA:` 前缀，外层等 5h 复位（`generate-presets.mts` exit 3 / `refill-img-loop.sh` 睡 5h5m） |
| 兜底 | 偶发失败 → `PLACEHOLDER_URL` 占位图，事后 `refill-placeholder-images.mts` 补图 |
| 调用方 | `generate-presets.mts`、`refill-placeholder-images.mts`、`retry-sensitive-images.mts`、`preset-actions.ts::regeneratePresetImage` |
| 既有定案 | 2026-08-28 用户拍板「**出图只用 minimax**」 |

## 2. Cloudflare Workers AI 官方数据（2026-08-28 核实）

来源：[Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) / [2025-02-20 定价改版](https://developers.cloudflare.com/changelog/post/2025-02-20-updated-pricing-docs/) / [flux-1-schnell 模型页](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/)

- 免费额度：**10,000 Neurons / 天**（Free 与 Paid 计划都有）
- 超额单价：**$0.011 / 1,000 Neurons**
- FLUX.1 schnell（1024×1024）：**1363.64 Neurons ≈ $0.015 / 张**（首 MP；后续 MP 更便宜）
- 输出：`{"result": {"image": "<base64>"}}`；参数 `prompt`（≤2048 字符）+ `steps`（4-8）
- 调用方式：Worker Binding（`env.AI.run`）或直接 REST
  `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`，`Authorization: Bearer {API_TOKEN}`

## 3. 成本对比（关键结论）

| 场景 | minimax image-01 | CF FLUX.1 schnell |
|---|---|---|
| 单张单价（官方） | **$0.0035 / 张**（[MiniMax 官方定价](https://minimax-ai.chat/models/minimax-image-01/)） | **$0.015 / 张**（1363.64 Neurons） |
| 免费额度 | 无免费（按量付费） | 每天约 **7 张**（10,000 ÷ 1363.64） |
| 全量预生成 ~1400 张（35 类 × 40 道） | ~$4.9 | **~$21**（免费档需 200 天） |

> ⚠️ 教程原文「每天 10,000 Neurons 足够高频使用」是**错误**的：Neurons ≠ 次数，图像模型单张消耗 1k+ Neurons。且 CF 按量单价（$0.015/张）是 minimax（$0.0035/张）的 **4.3 倍**——「免费/便宜」只在每天 ≤7 张时成立。

## 4. 技术可行性（集成点）

- **改动极小**：仅 `app/lib/llm/image.ts` 的 `generateImage()` 内部实现需要改（加一个 provider 分支或替换调用）；返回仍是 base64 → `Buffer.from(b64,'base64')` → `save()` 链路**完全复用**，所有调用方零改动。
- **鉴权**：需新增 CF Account ID + API Token 两个密钥（可走现有 `platform-settings.ts` 加密存储或 env 回退）。
- **无需 Worker 中转**：Next.js 服务端直接调 REST 即可，教程里那套 Pages + Worker + CORS + `API_SECRET` 前端鉴权对本项目**不适用**（我们不是浏览器直连）。

## 5. 风险与取舍

1. **免费档撑不起批量**：全量预生成/占位图补全是本项目主场景，每天 7 张毫无意义；付费又贵 4 倍 → 不建议替换主通道。
2. **限流语义不同**：CF 免费额度耗尽返回 429/额度错误，没有 minimax 的 1008 语义；现有「QUOTA → exit 3 → 睡 5h」脚本逻辑要改造成「撞额度就停、次日续跑」。
3. **质量未验证**：FLUX.1 schnell 对「写实食物摄影」prompt 的还原度 vs minimax image-01 需实测（尤其酒水类「中性描述不带商标」的约束）。
4. **文本渲染弱**：FLUX 系列对图内文字不擅长，但本项目 prompt 已要求 no text，影响小。
5. **政策风险**：Workers AI 模型清单/定价经常调整（2025-02 刚改版一次），模型随时可能下架或变价。

## 6. 建议（供决策）

| 方案 | 适用性 |
|---|---|
| **A. 保持 minimax 主通道**（推荐） | 单价最低、语义已成熟、脚本体系配套齐全；维持「出图只用 minimax」定案 |
| **B. CF 作为兜底 provider** | 当 minimax 撞 QUOTA/断网时用 CF 补几张救急（每天 ≤7 张免费）；改动 = `generateImage()` 加 fallback 分支，成本低 |
| **C. 整体替换 CF** | 不推荐：贵 4 倍 + 免费额度不足 + 限流/补图体系要重写 |

## 7. 免费档能力全景（10,000 Neurons/天 到底能干多少）

> 数据源：[Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)（2026-08-28）/ [模型目录 86 个](https://developers.cloudflare.com/workers-ai/models/)（2026-08-12）/ [限流页](https://developers.cloudflare.com/workers-ai/platform/limits/)（2026-08-07）
> 规则：Free 与 Paid 计划都有 **10,000 Neurons/天** 免费额度；超出需 Paid 计划，按 $0.011/1,000 Neurons 计费。

### 免费额度换算（1 天 = 10,000 Neurons ≈ $0.11 价值）

| 能力 | 模型 | 单价 | 免费额度 ≈ 每天 |
|---|---|---|---|
| 文生图 | flux-1-schnell（1024²） | 1363.64 Neurons/张 | **≈ 7 张**（批量不够，玩玩够） |
| 语音转文字 | whisper-large-v3-turbo | $0.00051/音频分钟 | **≈ 3.6 小时** 音频 |
| 语音转文字 | whisper（普通版） | $0.00045/音频分钟 | ≈ 4 小时音频 |
| 文本生成 | llama-3.1-8b-instruct-fp8-fast | 4119 in / 34868 out Neurons 每 M | ≈ 29 万输出 tokens |
| 文本生成 | granite-4.0-h-micro（最省） | 1542 in / 10158 out | ≈ 98 万输出 tokens |
| 文本生成 | deepseek-v4-flash | 40000 in / 120000 out | ≈ 8.3 万输出 tokens |
| 文本生成 | glm-4.7-flash | 5500 in / 36400 out | ≈ 27 万输出 tokens |
| 文本嵌入 | bge / gemma-embedding 系列 | 按 token 极低 | 百万级向量 |
| 翻译/摘要/分类 | m2m100 / bart / distilbert | 按 token | 大量 |

### 支持的任务类型与代表模型（86 个，2026-08 目录）

- **文本生成（最丰富）**：deepseek-v4-flash/pro、glm-4.7-flash、glm-5.x、kimi-k2.x、qwen3、qwen2.5-coder、llama-3.x、gemma-3/4、mistral-small、gpt-oss-120b、nemotron、granite…
- **文生图**：flux-1-schnell、flux-2-dev、flux-2-klein-4b/9b、stable-diffusion-xl-base-1.0、sdxl-lightning、ldreamshaper-8-lcm、lucid-origin、phoenix-1.0、sd-img2img、sd-inpainting
- **语音识别**：whisper、whisper-large-v3-turbo、whisper-tiny-en、deepgram nova-3、deepgram flux（WebSocket 实时）
- **语音合成 TTS**：aura-1、aura-2-en/es、melotts
- **图像理解（视觉）**：llama-3.2-11b-vision、llama-4-scout、llava、moondream、uform-gen、qwen3.8-27b、gemma-3-12b（多模态）
- **嵌入/检索**：bge-base/large/small、bge-m3、embeddinggemma-300m、qwen3-embedding、plamo、bge-reranker
- **其他**：翻译 m2m100/indicTrans2、摘要 bart-large-cnn、图像分类 resnet-50、目标检测 detr、安全分类 llama-guard、VAD smart-turn-v2

### 限流（速率限制，与额度无关）

- 文本生成：300 req/min（部分模型 400-1500）
- 文生图：720 req/min（额度才是瓶颈）
- 语音/嵌入/其他：720-3000 req/min
- Beta 模型限流更低

### 对本项目的实用结论

| 用途 | 免费档够吗 | 备注 |
|---|---|---|
| 批量菜品出图（主场景） | ❌ 每天仅 ~7 张 | 维持 minimax 主通道 |
| **语音点餐/语音搜索**（未来功能） | ✅ 每天 ~3.6h 转写 | whisper-large-v3-turbo 支持中/越/英 |
| **菜单语音播报 TTS** | ✅ 按字符计费很省 | aura/melotts；项目已有 minimax TTS，可作备用 |
| LLM 文字兜底 | ✅ 小规模够用 | 但项目已有 deepseek/minimax，CF 免费档价值有限 |
| 菜品语义搜索/嵌入 | ✅ 百万级向量 | 若做 RAG 检索可考虑 |

## 8. 决策点（待用户拍板）

- [ ] 是否推翻「出图只用 minimax」定案？（方案 B 不需要推翻，只是补充）
- [ ] 是否接受 CF 按量单价 $0.015/张？（若走 B，仅作为 minimax 不可用时的免费兜底，几乎不花钱）
- [ ] 是否愿意先花 10 分钟做质量实测：同一批 `buildImagePrompt` 输出分别喂 minimax 与 FLUX，对比 3-5 张？
- [ ] 若走 B：提供 CF Account ID + API Token 后，按「先写计划 → 更新 TASK_PLAN.md → 再改代码」流程执行。
