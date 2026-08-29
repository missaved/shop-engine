#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 批次回归：10 个 UI/UX 问题全量验证
#   1 外带中国手机号下单（归一化）  2 语音 12 语种文件  3 客户端语言自动识别（含 boss 端）
#   4 成功页（去复制摘要/实时查单主按钮/推荐卡）  5 admin 退出登录
#   6/7/8 订单折叠 + 排序（active 在前 terminal 在后）
#   9 无号单查单（仅静态查看）  10 扫码桌号真正附带（URL → 预填 → config.tableNo）
# 前置：服务已启动（192.168.5.210:3000）、DB 容器 shop-engine-db、ADMIN/OWNER 账号已 seed
import os
import re
import subprocess
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
SLUG = "demo-pho"
DISPLAY_RE = re.compile(r"CP-\d{6}-\d{3}")
SOUNDS_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "sounds"))

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'✅' if ok else '❌'} {name}" + (f"  — {detail}" if detail else ""))


def sql(q):
    r = subprocess.run(
        ["docker", "exec", "shop-engine-db", "psql", "-U", "shop_engine", "-d", "shop_engine", "-At", "-c", q],
        capture_output=True, text=True,
    )
    return r.stdout.strip()


def place_order_current(p, phone=""):
    """已在菜单页：加第一个商品 → 加购 → 购物车 → 填号(可选) → 下单 → 返回 displayNo"""
    p.locator("ul.grid li button").first.click(timeout=5000)
    p.wait_for_timeout(600)
    p.locator("button:has-text('加入购物车')").click(timeout=5000)
    p.wait_for_timeout(400)
    p.locator("button:has-text('购物车')").last.click(timeout=5000)
    p.wait_for_timeout(400)
    if phone:
        p.locator("input[type=tel]").fill(phone)
    p.locator("button[type=submit]").click(timeout=5000)
    p.wait_for_timeout(1200)
    p.locator("text=下单成功").first.wait_for(timeout=8000)
    body = p.text_content("body") or ""
    m = DISPLAY_RE.search(body)
    if not m:
        raise RuntimeError("成功页未提取到 displayNo")
    return m.group(0)


def place_order(p, phone=""):
    """完整下单：欢迎页选外带 → 菜单加购 → 下单"""
    p.goto(f"{BASE}/zh/s/{SLUG}", wait_until="networkidle")
    try:
        p.locator("button:has-text('外带')").first.click(timeout=3000)
        p.wait_for_timeout(400)
    except Exception:
        pass
    return place_order_current(p, phone)


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        vp = {"width": 390, "height": 844}

        # ============ 场景 1：中国手机号下单 + 归一化查单 ============
        print("场景 1 · 外带中国手机号下单/查单")
        ctx1 = b.new_context(locale="zh-CN", viewport=vp)
        pg1 = ctx1.new_page()
        no1 = place_order(pg1, "+86 138 0013 8000")
        check("1a 成功页无「复制摘要」按钮", pg1.locator("text=复制摘要").count() == 0)
        check("1b 成功页「实时查单」主按钮", pg1.locator("text=实时查单").count() > 0)
        check("1c 成功页推荐区标题", pg1.locator("text=可能你还想吃").count() > 0)
        rec_a = pg1.locator("div.grid.grid-cols-2 a")
        check("1d 推荐卡 ≥1", rec_a.count() >= 1, f"count={rec_a.count()}")
        body1 = pg1.text_content("body") or ""
        check("1e 成功页提示含手机号原文", "+86 138 0013 8000" in body1)

        ctx2 = b.new_context(locale="zh-CN")
        pg2 = ctx2.new_page()
        pg2.goto(f"{BASE}/zh/s/{SLUG}/track?orderNo={no1}&phone=13800138000", wait_until="networkidle")
        body2 = pg2.text_content("body") or ""
        check("1f 中国手机号查单命中（裸号归一化）",
              no1 in body2
              and pg2.locator("text=未找到匹配订单").count() == 0
              and pg2.locator("text=未找到该订单").count() == 0)

        # ============ 场景 2：无号单（仅静态查看） ============
        print("场景 2 · 无号单下单 + 新设备仅静态查看")
        ctx3 = b.new_context(locale="zh-CN", viewport=vp)
        pg3 = ctx3.new_page()
        no2 = place_order(pg3, "")
        hint = pg3.locator("p", has_text=re.compile("请用订单号|请用手机号")).first
        ht = hint.text_content() or ""
        check("2a 无号单成功页 trackHintNoPhone 无空占位", "请用订单号" in ht and "请用手机号" not in ht, ht)
        link3 = pg3.locator("a:has-text('实时查单')").first
        href3 = link3.get_attribute("href") or ""
        check("2b 无号单实时查单链接不带 &phone=", "&phone=" not in href3, href3)

        ctx4 = b.new_context(locale="zh-CN")
        pg4 = ctx4.new_page()
        pg4.goto(f"{BASE}/zh/s/{SLUG}/track?orderNo={no2}", wait_until="networkidle")
        body4 = pg4.text_content("body") or ""
        check("2c 无号单新设备查单命中",
              no2 in body4
              and pg4.locator("text=未找到匹配订单").count() == 0
              and pg4.locator("text=未找到该订单").count() == 0)
        check("2d 无号单无凭证 → 无删除数据按钮", pg4.locator("text=删除我的数据").count() == 0)
        check("2e 无号单无凭证 → 无加菜区", pg4.locator("text=点 + 加一份").count() == 0)
        pg4.goto(f"{BASE}/zh/s/{SLUG}/track?orderNo={no2}&phone=13800138000", wait_until="networkidle")
        check("2f 无号单带错号 → 未找到匹配", pg4.locator("text=未找到匹配订单").count() > 0)
        pg4.goto(f"{BASE}/zh/s/{SLUG}/track?orderNo={no1}", wait_until="networkidle")
        check("2g 带号单无号查 → 未找到该订单", pg4.locator("text=未找到该订单").count() > 0)

        # ============ 场景 3：扫码桌号真正附带 ============
        print("场景 3 · 扫码带桌号")
        ctx5 = b.new_context(locale="zh-CN", viewport=vp)
        pg5 = ctx5.new_page()
        pg5.goto(f"{BASE}/zh/s/{SLUG}?table=B%C3%A0n%205", wait_until="networkidle")
        check("3z 扫码直达菜单（无欢迎页选餐）", pg5.locator("button:has-text('外带')").count() == 0)
        # 桌号输入框在购物车抽屉的堂食结算表单内 → 加购后打开抽屉验证预填
        pg5.locator("ul.grid li button").first.click(timeout=5000)
        pg5.wait_for_timeout(600)
        pg5.locator("button:has-text('加入购物车')").click(timeout=5000)
        pg5.wait_for_timeout(400)
        pg5.locator("button:has-text('购物车')").last.click(timeout=5000)
        pg5.wait_for_timeout(400)
        ti = pg5.locator("input[placeholder='Bàn 5']")
        check("3a 桌号输入框在结算表单（堂食）", ti.count() > 0)
        if ti.count():
            check("3b 桌号预填 Bàn 5", ti.input_value() == "Bàn 5", repr(ti.input_value()))
        pg5.locator("button[type=submit]").click(timeout=5000)
        pg5.wait_for_timeout(1200)
        pg5.locator("text=下单成功").first.wait_for(timeout=8000)
        body3s = pg5.text_content("body") or ""
        no3 = DISPLAY_RE.search(body3s).group(0)
        cfg_type = sql(f"SELECT config->>'orderType' FROM \"Order\" WHERE \"displayNo\"='{no3}';")
        cfg_tbl = sql(f"SELECT config->>'tableNo' FROM \"Order\" WHERE \"displayNo\"='{no3}';")
        check("3c 下单 orderType=dine_in", cfg_type == "dine_in", repr(cfg_type))
        check("3d 下单 config.tableNo=Bàn 5", cfg_tbl == "Bàn 5", repr(cfg_tbl))
        # 无号桌号单在查单页应显示桌号（静态查看可见）
        pg5.goto(f"{BASE}/zh/s/{SLUG}/track?orderNo={no3}", wait_until="networkidle")
        body5 = pg5.text_content("body") or ""
        check("3e 查单页显示桌号", f"桌号: Bàn 5" in body5)

        # ============ 场景 4：dashboard 折叠 + 排序 ============
        print("场景 4 · 订单折叠 + 排序")
        # 只改本次会话创建的无号单 no2 → CANCELLED（测试夹具）
        sql(f"UPDATE \"Order\" SET status='CANCELLED' WHERE \"displayNo\"='{no2}';")
        ctx6 = b.new_context(locale="zh-CN", viewport=vp)
        pg6 = ctx6.new_page()
        pg6.goto(f"{BASE}/zh/login", wait_until="networkidle")
        pg6.fill("input[name=phone]", "0901234567")
        pg6.fill("input[name=password]", "demo1234")
        pg6.click("button[type=submit]")
        pg6.wait_for_url("**/dashboard", timeout=15000)
        pg6.wait_for_load_state("networkidle")
        pg6.wait_for_timeout(600)
        order_nos = pg6.eval_on_selector_all(
            "div[id^='order-']",
            "els => els.map(e => (e.textContent.match(/CP-\\d{6}-\\d{3}/) || [])[0]).filter(Boolean)",
        )
        check("4a 排序 active 在前 terminal 在后",
              no2 in order_nos and len(order_nos) >= 2 and order_nos[0] != no2 and order_nos.index(no2) > 0,
              f"order={order_nos}")
        fold = pg6.locator(f"div[id^='order-']:has-text('{no2}')").first
        ft = fold.text_content() or ""
        check("4b CANCELLED 默认折叠（▸ 行）", "▸" in ft)
        check("4c 折叠行无收款区", not any(k in ft for k in ["收全款", "标记收款", "实收"]))
        fold.click()
        pg6.wait_for_timeout(500)
        fold2 = pg6.locator(f"div[id^='order-']:has-text('{no2}')").first
        ft2 = fold2.text_content() or ""
        check("4d 展开后仍无收款区（终端守卫）", not any(k in ft2 for k in ["收全款", "标记收款", "实收"]))
        check("4e 展开后有折叠按钮", fold2.locator("button[aria-label='折叠']").count() > 0)

        # ============ 场景 5：admin 退出登录 ============
        print("场景 5 · 平台运营端退出")
        ctx7 = b.new_context(locale="zh-CN", viewport=vp)
        pg7 = ctx7.new_page()
        pg7.goto(f"{BASE}/zh/login", wait_until="networkidle")
        pg7.fill("input[name=phone]", "0900000000")
        pg7.fill("input[name=password]", "demo1234")
        pg7.click("button[type=submit]")
        pg7.wait_for_url("**/admin", timeout=15000)
        pg7.wait_for_load_state("networkidle")
        check("5a admin 页有退出登录按钮", pg7.locator("button:has-text('退出登录')").count() > 0)
        pg7.on("dialog", lambda d: d.accept())
        pg7.locator("button:has-text('退出登录')").click()
        pg7.wait_for_url("**/login", timeout=10000)
        check("5b 退出后回登录页", "/login" in pg7.url, pg7.url)

        # ============ 场景 6：语言自动识别（客户端） ============
        print("场景 6 · 语言自动识别")
        ctx8 = b.new_context(locale="vi-VN", viewport=vp)
        pg8 = ctx8.new_page()
        pg8.goto(f"{BASE}/en/s/{SLUG}", wait_until="networkidle")
        pg8.wait_for_timeout(1500)
        check("6a 浏览器 vi-VN 打开 /en 自动跳 /vi", "/vi/" in pg8.url, pg8.url)
        ctx9 = b.new_context(locale="zh-Hant-TW", viewport=vp)
        pg9 = ctx9.new_page()
        pg9.goto(f"{BASE}/en/s/{SLUG}", wait_until="networkidle")
        pg9.wait_for_timeout(1500)
        check("6b 浏览器 zh-Hant 自动跳 /zh-Hant", "/zh-Hant/" in pg9.url, pg9.url)

        # ============ 场景 7：语音文件 ============
        print("场景 7 · 语音 12 文件")
        found = {f for f in os.listdir(SOUNDS_DIR) if f.endswith(".mp3")} if os.path.isdir(SOUNDS_DIR) else set()
        need = {f"{p}.{l}.mp3" for p in ["new-order", "call-waiter"] for l in ["zh", "zh-Hant", "en", "vi", "ms", "th"]}
        check("7a 语音 12 文件齐备", need <= found, f"found={len(found)}")
        # 文件非空（>10KB 防损坏）
        sizes = {f: os.path.getsize(os.path.join(SOUNDS_DIR, f)) for f in need if os.path.exists(os.path.join(SOUNDS_DIR, f))}
        check("7b 全部非空（>10KB）", all(s > 10240 for s in sizes.values()),
              f"min={min(sizes.values()) if sizes else 0}")

        b.close()

    print(f"\n===== 结果：{len(PASS)} 通过 / {len(FAIL)} 失败 =====")
    for name in FAIL:
        print(f"  ❌ {name}")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
