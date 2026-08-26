# -*- coding: utf-8 -*-
# P1-2 PWA 离线验收：localhost（secure context）下 sw 注册 + 断网可离线打开菜单页
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"  # localhost 是 secure context，sw 可用（局域网 IP 则非 secure）
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # 第一次加载：注册 sw（sw 在 load 后注册，第一次导航未被接管）
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        try:
            page.evaluate("async () => { await navigator.serviceWorker.ready; }")
            swReady = True
        except Exception as e:
            swReady = False
        check("P1-2 service worker 注册成功", swReady, "ready resolved")

        # 第二次加载（在线）：sw 已接管，缓存导航 HTML
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1500)

        # 断网 + reload：应命中 sw 缓存
        ctx.set_offline(True)
        try:
            page.reload(wait_until="domcontentloaded", timeout=15000)
            body = page.inner_text("body")
            offline = "Bánh mì thịt" in body or "Phở" in body
            check("P1-2 断网后菜单页仍可打开并显示商品", offline,
                  "含商品名" if offline else f"body 前 100 字: {body[:100]!r}")
        except Exception as e:
            check("P1-2 断网后菜单页仍可打开并显示商品", False, str(e)[:150])

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
