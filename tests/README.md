# tests/ · 阶段 1 Playwright 验收脚本

shop-engine（food 垂直）阶段 1 的端到端验收脚本。每个脚本对应 [TASK_PLAN.md](../../TASK_PLAN.md) 里的一项验收记录（问题 1–15）。

## 前置条件

1. **dev server 运行于 3000 端口**：`cd /root/shop-saas/app && pnpm dev`（绑定 0.0.0.0:3000）
2. **demo 数据存在**：demo-pho 店 + 老板账号（手机号 `0901234567` / 密码 `demo1234`）
3. **Python + Playwright**：`pip install playwright && playwright install chromium`

## 运行

```bash
cd /root/shop-saas/app
python3 tests/verify-order-filter.py
```

脚本顶部 `BASE = "http://192.168.5.210:3000"` 可按需改为 `http://localhost:3000`（仅 `verify-food-p12.py` 因 PWA 需 secure context 已用 localhost）。

## 脚本清单

### 核心回归（建议优先跑，覆盖主要流程）
| 脚本 | 覆盖 |
| --- | --- |
| `verify-order-filter.py` | 订单类型徽章 + 筛选/搜索（问题 14） |
| `verify-track-detail.py` | 客户查单页规格/加料（问题 13） |
| `verify-order-detail.py` | 老板端订单明细规格/加料（问题 12） |
| `verify-category.py` | 菜单分类（问题 11） |
| `verify-optiongroups-edit.py` | 规格组编辑（问题 10） |
| `verify-extras-edit.py` | 加料编辑（问题 9） |
| `verify-admin-ui.py` | 老板端 admin UI 打磨 |
| `verify-upload.py` | 图片上传 |
| `verify-product-sort.py` | 商品排序上移/下移（问题 16） |
| `verify-product-append.py` | 新增商品排末尾（问题 17） |

### P0/P1 安全与体验批
`verify-food-p01.py` ~ `verify-food-p21.py` — 登录限流 / 下单校验 / Toast / 锚点 / 查单限流 / 权限边界 / 幂等键 / 会话 / 售罄 / 实时轮询 / PWA（p12 用 localhost）/ 订单号并发 / 确认弹窗 / 空态等。

### food 垂直点单缺陷
`verify-food-bug1.py` ~ `verify-food-bug6.py` — 起送价 / 配送费 / 购物车明细 / 规格选择；`verify-food-c5.py`、`verify-food-e1.py` — C5 / E1 备注口味。

### 整体回归 & UI
`verify-food-regress.py`、`verify-food-regress2.py` — 整体回归；`verify-ui.py`、`verify-visual-consistency.py` — UI 一致性。

## 注意

- 部分脚本会**修改 demo 数据**（下单 / 编辑商品），跑完需按脚本末尾 `ORDER_NO` 提示清理测试订单与关联 Reminder。
- 脚本**非幂等**（依赖 demo 数据当前状态），重跑前先确认 demo 数据已还原（商品 extras/optionGroups/category 等）。
- 调试脚本（`/tmp` 下 `dbg-*` / `diag-*` / `debug-*`）为一次性排查脚本，无回归价值，未固化于此。
