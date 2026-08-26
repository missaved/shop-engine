# -*- coding: utf-8 -*-
# 问题7 UI 美感验收：demo 商品配图 + amber 主色 + 抽屉动画 + 下单回归
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
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")

        # 1. demo 商品配图：至少 4 张 /demo/ 图
        demo_imgs = page.locator("img[src^='/demo/']").count()
        check("demo 商品显示图片（≥4）", demo_imgs >= 4, f"{demo_imgs} 张")

        # 2. Phở bò tái 显示对应图
        pho_li = page.locator("ul li", has_text="Phở bò tái").first
        pho_src = pho_li.locator("img").first.get_attribute("src") or ""
        check("Phở bò tái 图片路径正确", "/demo/pho-bo-tai.svg" in pho_src, pho_src)

        # 3. 商品行 + 按钮为 amber 主色
        plus_btn = pho_li.get_by_role("button", name="+", exact=True).first
        plus_cls = plus_btn.get_attribute("class") or ""
        check("加购按钮 amber 主色", "bg-amber-500" in plus_cls)

        # 4. 点 Phở bò tái 的 + → 加购抽屉 slide-up
        plus_btn.click()
        page.wait_for_timeout(400)
        sheet = page.locator("div.animate-slide-up").first
        check("加购抽屉 slide-up 动画", sheet.count() > 0)

        # 5. 加购抽屉「加入购物车」按钮 amber
        add_btn = page.locator("button", has_text="Thêm vào giỏ").first
        add_cls = add_btn.get_attribute("class") or ""
        check("加入购物车按钮 amber", "bg-amber-500" in add_cls)

        # 6. 加入购物车 → 悬浮购物车栏渐变
        add_btn.click()
        page.wait_for_timeout(400)
        cart_bar = page.locator("button", has_text="Giỏ hàng").first
        cart_bar.wait_for(timeout=5000)
        bar_cls = cart_bar.get_attribute("class") or ""
        check("悬浮购物车栏 amber 渐变", "from-amber-500" in bar_cls)

        # 7. 点购物车栏 → 购物车抽屉 slide-up
        cart_bar.click()
        page.wait_for_timeout(400)
        sheets = page.locator("div.animate-slide-up").count()
        check("购物车抽屉 slide-up", sheets >= 1, f"{sheets} 个动画面板")

        # 8. 下单回归（堂食，不填手机号）
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            check("下单回归成功（堂食）", True)
        except Exception as e:
            check("下单回归成功（堂食）", False, str(e)[:100])

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
