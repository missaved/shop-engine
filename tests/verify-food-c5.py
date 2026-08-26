# -*- coding: utf-8 -*-
# 第五批验收：C1 今日概览 / C3 桌台简表 / D1 新单冒泡 / D2 完成通知 / D3 复购提醒
import re
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
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844})

        # ============ 1. 老板登录 ============
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("C1 老板登录进入 dashboard", "/dashboard" in page.url, page.url)

        # ============ 2. C1 今日概览统计卡片 ============
        body = page.inner_text("body")
        check("C1 今日订单卡片", "Đơn hôm nay" in body)
        check("C1 今日营业额卡片", "Doanh thu hôm nay" in body)
        check("C1 进行中卡片", "Đang xử lý" in body)

        # ============ 3. C3 桌台简表 ============
        check("C3 桌台标题", "Bàn" in body)
        # 数据库已有 dine_in 订单 tableNo=Bàn 3，应出现在简表
        check("C3 桌号 Bàn 3 显示", "Bàn 3" in body)

        # ============ 4. 客户下单（新 context，生成今日 dine_in 订单 + D1 提醒）============
        ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
        m = ctx2.new_page()
        m.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        # 第一个商品 Bánh mì thịt 35k，点 + 两次 = 70k（达起送 50k）
        first_li = m.locator("ul li").first
        first_li.get_by_role("button", name="+", exact=True).click()
        first_li.get_by_role("button", name="+", exact=True).click()
        # 填桌号 + 手机号
        m.fill("input[placeholder='Bàn 5']", "Bàn 9")
        m.fill("input[type=tel]", "0909999000")
        m.click("button[type=submit]")
        # 显式等待下单成功页（server action 异步，networkidle 不可靠）
        m.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
        done_text = m.inner_text("body")
        m_display = re.search(r"CP-\d{6}-\d{3}", done_text)
        check("客户下单成功", m_display is not None, m_display.group(0) if m_display else "")
        if not m_display:
            check("D1 新单号解析", False, done_text[:300])
            ctx2.close()
            browser.close()
            summarize()
            return
        display = m_display.group(0)
        ctx2.close()

        # ============ 5. D1 新单冒泡：回 dashboard 刷新，出现「Đơn mới」提醒 ============
        page.reload(wait_until="networkidle")
        body = page.inner_text("body")
        check("D1 提醒区标题", "Việc cần làm" in body)
        check("D1 新单提醒出现", "Đơn mới" in body)
        check("D1 新订单号入列表", display in body)

        # ============ 6. D2 完成通知：推进到 READY ============
        card = page.locator(f"div.rounded-xl", has_text=display).last
        # 推进：PENDING → IN_PROGRESS → READY（点两次「Tiếp tục」）
        card.get_by_role("button", name="Tiếp tục").click()
        page.wait_for_timeout(1500)
        card = page.locator(f"div.rounded-xl", has_text=display).last
        card.get_by_role("button", name="Tiếp tục").click()
        page.get_by_text("Đã xong").wait_for(timeout=15000)  # D2 提醒出现
        check("D2 出餐完成提醒出现", True)

        # ============ 7. D3 复购提醒：推进到 COMPLETED（21 天后，今天不冒泡）============
        card = page.locator(f"div.rounded-xl", has_text=display).last
        card.get_by_role("button", name="Tiếp tục").click()
        page.wait_for_timeout(1500)
        # 复购提醒 dueAt 是 21 天后，不应出现在今日待办（页面不显示「Nhắc mua lại」）
        body = page.inner_text("body")
        check("D3 复购提醒今天不冒泡", "Nhắc mua lại" not in body)

        browser.close()
    summarize()

def summarize():
    fails = [r for r in results if not r[1]]
    print("\n" + "=" * 50)
    print(f"共 {len(results)} 项检查，通过 {len(results)-len(fails)} 项，失败 {len(fails)} 项")
    if fails:
        print("失败项：")
        for name, _, detail in fails:
            print(f"  - {name}: {detail}")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
