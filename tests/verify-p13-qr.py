# -*- coding: utf-8 -*-
# 第13批补充验收：物料二维码「桌号台卡」——预览布局 + 下载合成 PNG（含桌号/店名/三语）
import sys
import struct
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"{mark} {name}" + (f"  — {detail}" if detail else ""))

def png_size(path):
    with open(path, 'rb') as f:
        data = f.read(33)
    w, h = struct.unpack('>II', data[16:24])
    return w, h

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

        # 打开抽屉
        page.locator('button[aria-label="打开设置"]').click()
        page.wait_for_timeout(800)

        # 桌号输入框
        table_input = page.locator('input[placeholder="Số bàn (tùy chọn)"]')
        check("台卡桌号输入框存在", table_input.count() > 0)
        if table_input.count() == 0:
            b.close()
            summarize()
            return
        table_input.fill("A12")
        page.wait_for_timeout(300)

        # 预览卡桌号（text-6xl 大字号）
        table_no = page.locator("span.text-6xl", has_text="A12")
        check("预览卡超大桌号显示", table_no.count() > 0)

        # 三语分行
        zh = page.locator("span", has_text="扫码点单").count()
        vi = page.locator("span", has_text="Quét mã gọi món").count()
        en = page.locator("span", has_text="Scan to order").count()
        check("三语宣传分行显示", zh > 0 and vi > 0 and en > 0,
              f"zh={zh} vi={vi} en={en}")

        # 等待二维码生成（img 出现 + 下载按钮可用）
        page.locator('img[alt="店铺二维码"]').wait_for(state="visible", timeout=10000)
        dl_btn = page.locator("button", has_text="Tải mã QR")
        page.wait_for_timeout(500)

        # 触发下载，捕获文件
        try:
            with page.expect_download(timeout=15000) as dl_info:
                dl_btn.click()
            download = dl_info.value
            fname = download.suggested_filename
            check("下载文件名 table-A12.png", fname == "table-A12.png", fname)
            path = download.path()
            w, h = png_size(path)
            check("台卡 PNG 尺寸 640×800", w == 640 and h == 800, f"{w}×{h}")
        except Exception as e:
            check("触发下载合成台卡", False, f"{type(e).__name__}: {e}")

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
