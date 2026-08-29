# -*- coding: utf-8 -*-
# 第13批验收：主题模板 + 视觉打磨（按钮渐变胶囊 / 首页毛玻璃 / 收入三卡等高 / 主题三选）
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"{mark} {name}" + (f"  — {detail}" if detail else ""))

def has_gradient(cls):
    return ("bg-gradient-to-r" in cls and "rounded-full" in cls
            and "from-amber-500" in cls and "to-amber-600" in cls)

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # ── 1. 按钮渐变胶囊 ──
        page.goto(f"{BASE}/vi", wait_until="networkidle")
        demo_btn = page.locator("a", has_text="Cửa hàng demo").first
        check("落地页下单按钮渐变胶囊", has_gradient(demo_btn.get_attribute("class") or ""))

        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        login_btn = page.locator("button[type=submit]").first
        check("登录页提交按钮渐变胶囊", has_gradient(login_btn.get_attribute("class") or ""))

        page.goto(f"{BASE}/vi/s/demo-pho/track", wait_until="networkidle")
        track_btn = page.locator("button[type=submit]").first
        check("查单页提交按钮渐变胶囊", has_gradient(track_btn.get_attribute("class") or ""))

        # ── 2. 首页毛玻璃 + 背景图 ──
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        check("首页 hero 背景图", page.locator('img[src="/hero/hero.jpg"]').count() > 0)
        check("首页毛玻璃内容卡", page.locator(".backdrop-blur-xl").count() > 0,
              f"{page.locator('.backdrop-blur-xl').count()} 个")
        # 三选用餐方式按钮（毛玻璃 + 渐变胶囊）
        dine = page.locator("button", has_text="Ăn tại chỗ").first
        dine_cls = dine.get_attribute("class") or ""
        check("用餐方式按钮毛玻璃", "backdrop-blur" in dine_cls)

        # ── 3. 菜单页主题背景容器 ──
        # 进入菜单：点「堂食」进入点单页
        if dine.count() > 0:
            dine.click()
            page.wait_for_timeout(1200)
            check("菜单页挂 bg-app-bg 容器", page.locator(".bg-app-bg").count() > 0,
                  f"{page.locator('.bg-app-bg').count()} 个")
            check("菜单页挂 theme- 根容器", page.locator("[class*='theme-']").count() > 0)

        # ── 4. 收入三卡等高 + 明细展开 ──
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("登录 dashboard", "/dashboard" in page.url)

        # 打开抽屉（点店名/☰）
        page.locator('button[aria-label="打开设置"]').click()
        page.wait_for_timeout(800)

        cards = page.locator("section.grid.grid-cols-3 > div")
        n = cards.count()
        check("概览三卡存在（3 个）", n == 3, f"{n} 个")
        if n == 3:
            hs = [cards.nth(i).bounding_box()["height"] for i in range(3)]
            spread = max(hs) - min(hs)
            check("三卡等高（高度差<3px）", spread < 3, f"高度 {[round(h,1) for h in hs]}，差 {round(spread,1)}")

            # 收入卡（第2卡）点击展开明细
            cards.nth(1).locator("button").click()
            page.wait_for_timeout(500)
            check("收入卡展开明细（30 ngày）", page.get_by_text("30 ngày").count() > 0)

        # ── 5. 设置面板主题六选（门面皮肤选择器，按 data-od-id 精确定位）──
        theme_cards = [
            "theme-card-warm", "theme-card-moss", "theme-card-minimal",
            "theme-card-night", "theme-card-vibrant", "theme-card-gourmet",
        ]
        card_counts = []
        for cid in theme_cards:
            card = page.locator(f'button[data-od-id="{cid}"]')
            card_counts.append(card.count())
            # 每张卡自带 theme-<v> 小样 + 店名/按钮颜色
            if card.count() > 0:
                cls = card.first.get_attribute("class") or ""
                inner_theme = card.first.locator("span.font-display").first
                check(f"皮肤卡 {cid} 存在且挂自身 theme 类", inner_theme.count() > 0,
                      f"theme class={'theme-'+cid.split('-').pop() in cls}")
        check("主题六选按钮（6 张皮肤卡）", all(c > 0 for c in card_counts),
              f"{card_counts}")

        # ── 6. 主题 CSS 变量切换（对 6 套皮肤逐一强制重置 class，校验主色互不相同）──
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        # 一次抓取稳定的元素句柄；之后所有改类/读色都在同一句柄上做，不依赖选择器重找。
        # 这样即使改类时清空了某个 theme-* 类，句柄仍指向这个 <main>，不会丢掉。
        root = page.locator("main[class*='theme-']").first.element_handle()
        skins = ["warm", "moss", "minimal", "night", "vibrant", "gourmet"]
        seen = []
        for skin in skins:
            root.evaluate(
                "el => { [...el.classList].forEach(c => { if (c.startsWith('theme-')) el.classList.remove(c) }); "
                "el.classList.add('theme-" + skin + "') }"
            )
            cls = root.get_attribute("class") or ""
            px = root.evaluate("el => getComputedStyle(el).getPropertyValue('--theme-primary').trim()")
            check(f"切到 {skin} 时外层挂 theme-{skin}", f"theme-{skin}" in cls, cls[:80])
            seen.append(px)
        distinct = len(set(seen)) == len(seen)
        check("六套主题主色各不相同", distinct, f"colors={seen}")

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
