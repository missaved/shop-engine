# -*- coding: utf-8 -*-
# P1-3 订单号并发验收：并发下单全部成功，orderNo/displayNo 各不相同，无 unique 冲突
import asyncio, re, sys
from playwright.async_api import async_playwright

BASE = "http://192.168.5.210:3000"

async def place_order(browser, phone):
    ctx = await browser.new_context(viewport={"width": 390, "height": 844})
    page = await ctx.new_page()
    try:
        await page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle", timeout=30000)
        plus = page.get_by_role("button", name="+", exact=True)
        await plus.nth(0).click(); await page.wait_for_timeout(120)
        await plus.nth(0).click(); await page.wait_for_timeout(120)
        await page.fill("input[type=tel]", phone)
        await page.get_by_role("button", name="Đặt hàng", exact=True).click()
        await page.get_by_text("Đặt hàng thành công").wait_for(timeout=20000)
        m = re.search(r"CP-\d{6}-\d{3}", await page.inner_text("body"))
        return m.group(0) if m else "OK-但无号"
    except Exception as e:
        return f"FAIL:{str(e)[:100]}"
    finally:
        await ctx.close()

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        phones = ["0901110011", "0901110012", "0901110013"]
        results = await asyncio.gather(*[place_order(browser, ph) for ph in phones])
        await browser.close()

        ok = [r for r in results if r and r.startswith("CP-")]
        print("下单结果:", results)
        print(("✅" if len(ok) == len(phones) else "❌") + f" P1-3 并发 {len(phones)} 单全部成功  — {len(ok)}/{len(phones)}")
        uniq = len(set(ok))
        print(("✅" if uniq == len(ok) else "❌") + f" P1-3 displayNo 各不相同  — 去重后 {uniq}")
        sys.exit(0 if (len(ok) == len(phones) and uniq == len(ok)) else 1)

if __name__ == "__main__":
    asyncio.run(main())
