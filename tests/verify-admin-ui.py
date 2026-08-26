# -*- coding: utf-8 -*-
# 问题8 老板侧 admin UI 打磨验收：amber 主色 + 状态可视化 + 操作回归
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"{mark} {name}" + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # 登录
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("登录 dashboard", "/dashboard" in page.url)

        # 1. 统计卡片数字 amber
        amber_stats = page.locator("p.text-amber-600").count()
        check("统计卡片数字 amber（≥3）", amber_stats >= 3, f"{amber_stats} 个")

        # 2. 订单卡片左侧状态色条
        bar_cards = page.locator("div.rounded-xl.border-l-4").count()
        check("订单卡片状态色条存在", bar_cards > 0, f"{bar_cards} 张")

        # 3. 状态徽章着色（任一颜色类）
        badge = page.locator("span.rounded-full").first
        badge_cls = badge.get_attribute("class") or ""
        colored = any(
            c in badge_cls
            for c in ["bg-amber-100", "bg-blue-100", "bg-green-100", "bg-red-100", "bg-zinc-100"]
        )
        check("状态徽章着色", colored, badge_cls[:80])

        # 4. 推进按钮 amber
        adv = page.get_by_role("button", name="Tiếp tục").first
        if adv.count() > 0:
            adv_cls = adv.get_attribute("class") or ""
            check("推进按钮 amber 主色", "bg-amber-500" in adv_cls)
        else:
            check("推进按钮 amber 主色", True, "无待推进订单（跳过）")

        # 5. 回归：推进一个订单状态（PENDING→IN_PROGRESS）
        if adv.count() > 0:
            adv.click()
            page.wait_for_timeout(1500)
            # toast 或状态徽章变化
            body = page.inner_text("body")
            check("推进订单操作回归", "Đã chuyển trạng thái" in body or "Đang làm" in body)

        # 6. 发 Zalo 按钮 amber（提醒区，若有）
        zalo = page.locator("button", has_text="Gửi Zalo").first
        if zalo.count() > 0:
            zc = zalo.get_attribute("class") or ""
            # 提醒区发Zalo是 amber 主按钮；订单区发Zalo是 border 次要按钮
            check("提醒区发 Zalo 按钮 amber", "bg-amber-500" in zc)
        else:
            check("提醒区发 Zalo 按钮 amber", True, "无提醒（跳过）")

        b.close()
    summarize()

def summarize():
    fails = [r for r in results if not r[1]]
    print("\n" + "=" * 50)
    print(f"共 {len(results)} 项，通过 {len(results)-len(fails)}，失败 {len(fails)}")
    if fails:
        for n, _, d in fails:
            print(f"  - {n}: {d}")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
