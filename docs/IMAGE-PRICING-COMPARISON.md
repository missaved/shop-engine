# 文生图 API 价格横向对比报告（官方 vs 第三方）

> 状态：**只读调研**（2026-09-01，未改任何代码）
> 背景：确认 Cloudflare Workers AI 免费档（~7 张/天）与按量价（$0.015/张）不适合作为项目批量出图主通道后，调研外部替代方案的价格。
> 结论先行：**Replicate / fal.ai 的 FLUX.1 schnell 按量价（~$0.003/张）比当前 minimax image-01 官方价（$0.0035/张）还便宜，且远低于 Cloudflare（$0.015/张）**；但换 provider 需重写限流/QUOTA 语义，且写实食物质量需实测。

---

## 1. 价格总表（1024×1024 单张，2026-08/09 核实）

| 提供商 | 模型 | 单张价格 | 免费额度 | 备注 |
|---|---|---|---|---|
| **Replicate** | FLUX.1 schnell | **~$0.003**（$3/千张） | 无（新号小额试用） | H100，官方模型 [价格卡](https://replicate.com/black-forest-labs/flux-schnell) |
| **fal.ai** | FLUX.1 schnell (1MP) | **$0.003** | 无 | [API 页](https://fal.ai/models/fal-ai/flux/schnell) 返回 price 0.003 |
| **MiniMax 官方** | image-01 | **$0.0035**（当前项目在用） | 无 | [官方定价页](https://minimax-ai.chat/models/minimax-image-01/)（第三方汇总站转述官方价） |
| **SiliconFlow（硅基流动）** | Z-Image-Turbo | $0.005 | 新用户 $1 | [定价页](https://www.siliconflow.com/zh/pricing) |
| **Segmind** | FLUX.1 schnell | $0.008 | 新号试用积分 | 按 GPU 秒计 $0.0072/s [成本博客](https://blog.segmind.com/flux-generation-cost-across-5-models-for-ai-images/) |
| **fal.ai / Replicate 转售** | MiniMax image-01 | $0.01 | 无 | 转售加价 ~2.9 倍 |
| **SiliconFlow** | FLUX.2 pro | $0.03 | 新用户 $1 | [定价页](https://www.siliconflow.com/zh/pricing) |
| **SiliconFlow** | FLUX.2 flex | $0.06 | 新用户 $1 | [定价页](https://www.siliconflow.com/zh/pricing) |
| **Segmind** | FLUX.1.1 pro | $0.05 | 试用积分 | 平段收费 |
| **Segmind** | FLUX.1 pro | $0.069 | 试用积分 | 平段收费 |
| **Segmind** | FLUX.1.1 pro ultra (4MP) | $0.075 | 试用积分 | 高清用途 |
| **Cloudflare Workers AI** | FLUX.1 schnell | **$0.015**（1363.64 Neurons） | **7 张/天** | [定价页](https://developers.cloudflare.com/workers-ai/platform/pricing/) |

> ⚠️ 价格均为调研时点数据，模型/定价经常调整，落地前需以各官方页为准。

## 2. 批量成本对比（以本项目全量预生成 ~1400 张为例）

| 通道 | 单价 | 1400 张总价 | 可行性 |
|---|---|---|---|
| Replicate flux-schnell | $0.003 | **~$4.2** | ✅ 最低 |
| fal.ai flux-schnell | $0.003 | **~$4.2** | ✅ 最低 |
| **MiniMax image-01（现状）** | $0.0035 | **~$4.9** | ✅ 已在用 |
| SiliconFlow Z-Image-Turbo | $0.005 | ~$7 | ✅ 国内可用 |
| Segmind flux-schnell | $0.008 | ~$11.2 | ✅ |
| Cloudflare FLUX | $0.015 | ~$21（免费档需 200 天） | ❌ 贵且慢 |
| Segmind flux-1.1-pro | $0.05 | ~$70 | 质量档 |
| Segmind ultra 4MP | $0.075 | ~$105 | 质量档 |

## 3. 关键洞察

1. **Replicate / fal.ai 是价格洼地**：FLUX.1 schnell ~$0.003/张，比 minimax 官方还便宜 ~15%，比 Cloudflare 便宜 5 倍。
2. **转售加价明显**：同样 MiniMax image-01，官方 $0.0035 → fal/Replicate 转售 $0.01（+186%）。想省钱必须直连官方 API，别走转售。
3. **FLUX 模型族价格梯度**（Segmind 实测）：schnell $0.008 → dev $0.020 → 1.1-pro $0.05 → ultra $0.075，跨度约 9 倍；做「批量菜品预设」用 schnell 档即可。
4. **国内备选**：SiliconFlow 的 Z-Image-Turbo $0.005/张，接近 minimax 官方价，且国内直连延迟低、新用户送 $1，值得作为「越南/中国餐饮市场」的备选评估。
5. **Cloudflare 定位不变**：仅适合「每天几张」的免费玩玩 / 单图重生成兜底，不适合批量。

## 4. 换 provider 的代价（不只是价格）

| 项 | minimax（现状） | Replicate / fal.ai / Segmind |
|---|---|---|
| 限流语义 | 1004/1042 退避、1008 → QUOTA 5h 复位（脚本已配套） | 429 限流，无 QUOTA 复位语义，`refill-img-loop.sh` 等要重写 |
| 鉴权 | `platform-settings.ts` 已有 DB 加密存储 | 需新增各平台 key 的存储/回退 |
| 图片归档 | `generateImage()` → `save()` 统一链路 | 返回 URL（Replicate/fal 托管）或 base64（SD 系），需适配下载/落盘 |
| 写实食物质量 | 已在生产验证（含敏感词踩坑记录） | FLUX schnell 食物写实需实测 3-5 张对比 |
| 品牌约束 | 酒水「中性描述不带商标」已验证 | FLUX 文本渲染弱，对无字 prompt 影响小 |

## 5. 建议（供决策）

| 方案 | 成本（1400 张） | 结论 |
|---|---|---|
| **维持 minimax 官方**（现状） | ~$4.9 | 体系成熟，无需改动 |
| **换 Replicate / fal.ai flux-schnell** | ~$4.2 | 略省 ~15%，但需重写限流语义 + 质量实测，收益小 |
| **SiliconFlow Z-Image-Turbo** | ~$7 | 国内直连、送 $1，适合作为「国内镜像/备选」评估 |
| **Cloudflare FLUX** | ~$21 | 仅免费档玩玩或单图兜底，不做批量 |

**个人倾向**：性价比角度「维持 minimax」仍是当下最优——价格差距 <15%，但省掉整套限流/重试体系重写成本；若未来想换，**Replicate 或 fal.ai 的 flux-schnell** 是最值得先做 3-5 张质量实测的候选。

## 6. 数据来源

- [Replicate flux-schnell 价格卡](https://replicate.com/black-forest-labs/flux-schnell)（$3/千张）
- [fal.ai flux-schnell API](https://fal.ai/models/fal-ai/flux/schnell)（price 0.003）
- [MiniMax image-01 定价](https://minimax-ai.chat/models/minimax-image-01/)（官方 $0.0035/张）
- [Segmind Flux 成本实测博客](https://blog.segmind.com/flux-generation-cost-across-5-models-for-ai-images/)（schnell→ultra 9 倍价差）
- [SiliconFlow 定价页](https://www.siliconflow.com/zh/pricing)（FLUX.2 / Z-Image-Turbo）
- [Cloudflare Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)（FLUX $0.015/张）
