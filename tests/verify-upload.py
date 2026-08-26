# -*- coding: utf-8 -*-
# 问题5 菜品图片上传验收：登录 → 选图上传 → 预览 → 提交 → 菜单页展示
import base64
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"{mark} {name}" + (f"  — {detail}" if detail else ""))

def main():
    # 生成 1x1 PNG 测试图
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    open("/tmp/test-upload.png", "wb").write(png)

    name = f"Món ảnh {int(time.time())}"

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # 1. 登录 dashboard
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("登录 dashboard", "/dashboard" in page.url, page.url)

        # 2. 新增商品表单：填名称/价格 + 上传图片
        fi = page.locator("input[type=file]").first
        check("存在文件上传入口", fi.count() > 0)
        page.set_input_files("input[type=file]", "/tmp/test-upload.png")

        # 3. 等上传完成：预览 img 出现，src 以 /uploads/ 开头
        try:
            img = page.locator("img[src^='/uploads/']").first
            img.wait_for(timeout=15000)
            src = img.get_attribute("src")
            check("上传后预览回填 /uploads/", bool(src and src.startswith("/uploads/")), src)
        except Exception as e:
            check("上传后预览回填 /uploads/", False, str(e)[:120])
            src = None

        # 4. 上传后的图片 URL 可直接访问（静态目录）
        if src:
            try:
                with urllib.request.urlopen(BASE + src, timeout=10) as r:
                    ok = r.status == 200 and r.headers.get("content-type", "").startswith("image/")
                check("图片 URL 可直访（静态）", ok, f"{src} -> {r.status}")
            except Exception as e:
                check("图片 URL 可直访（静态）", False, str(e)[:120])

        # 5. 填名称/价格并提交（AddProductForm）
        # 注意：订单列表有大量 type=number 实收输入框，必须用 [required] 定位商品价格/名称
        page.fill("input[type=number][required]", "25000")
        name_input = page.locator("input[type=text][required]").first
        name_input.fill(name)
        page.get_by_role("button", name="Thêm", exact=True).click()
        page.wait_for_timeout(2000)
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("新增商品出现在列表", name in body, name)

        # 6. 菜单页展示该商品图片
        ctx2 = b.new_context(viewport={"width": 390, "height": 844})
        m = ctx2.new_page()
        m.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        li = m.locator("ul li", has_text=name).first
        ok_img = li.locator("img[src^='/uploads/']").count() > 0
        check("菜单页该商品展示图片", ok_img, name)
        ctx2.close()

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
