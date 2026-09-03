#!/usr/bin/env python3
# 洗衣(E2E-15)：顾客匿名自助下单防线回归（审计四轮 I）
#   g1 负向：填非法手机号提交 → 服务端拒绝（0 落库；UI 走 #441 系既有 throw 渲染，不以此断言）
#   g2/g3 限流：匿名(无登录会话)连发合法提交，前 10 次成功落单、第 11 次起被拦（DB 停增在 10）
# 手法：匿名 context 直开自助下单页 /vi/hcm/laundry/demolaud/order，每次填唯一手机号；
#       注入唯一 X-Forwarded-For 隔离限流桶（防与其它匿名流量共桶）；断言一律走 DB count（UI throw 文案
#       在生产构建被 React #441 吞——既有行为，food 等所有 throw action 同此，见 plans 十七节局限）
import sys, time, uuid
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, db_exec,
)

SCRIPT_TAG = "laundry-e2e-15-anon-submit-limit"
FLOW = "洗衣：匿名自助下单防线（手机号校验 + IP 频率限流）"
SLUG = "demolaud"
UNIQ = "0901555999"      # 合法测试手机号（定位/清理自建单）
BAD = "abc1234"          # 非法手机号（含字母 → normalize 后仍非纯数字，PHONE_RE 拒绝）
MAX_OK = 10              # 与服务端 ANON_SUBMIT_OPTS.max 对齐


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def count_orders(phone):
    r = db_exec(f"SELECT COUNT(*) FROM \"Order\" WHERE \"shopId\"='{shop_id()}'::text AND \"customerPhone\"='{phone}'")
    return int(r[0]["cols"][0]) if r and r[0].get("cols") else 0


def cleanup():
    sid = shop_id()
    if not sid: return
    db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"customerPhone\" IN ('{UNIQ}','{BAD}')")


def fresh_ctx(p, tag):
    xff = f"203.0.113.{uuid.uuid4().hex[:2].upper()}"
    ctx = new_context(p, tag=tag, locale="vi-VN")
    ctx.set_extra_http_headers({"X-Forwarded-For": xff})
    return ctx


def open_order(ctx):
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/order", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def fill_phone(page, phone):
    page.get_by_placeholder("SĐT khách").fill(phone, timeout=ASSERT_TIMEOUT)


def submit_click(page):
    page.get_by_role("button", name="Gửi yêu cầu").click(timeout=ACTION_TIMEOUT)


def wait_db_count(phone, target, deadline=12.0):
    """轮询 DB：该手机号订单数达到 target 即返回 True；超时返回当前值（供判定停增）"""
    end = time.time() + deadline
    while time.time() < end:
        if count_orders(phone) >= target:
            return True
        time.sleep(0.4)
    return False


def main():
    cleanup(); started = datetime.now(); records = []
    if not shop_id():
        print("缺 demolaud 店"); return 1
    with make_browser() as p:
        # —— g1：非法手机号负向（独立桶，非法号不计入限流——throw 在限流块之前）——
        ctx1 = fresh_ctx(p, "laund15g1"); page1 = open_order(ctx1)
        fill_phone(page1, BAD); submit_click(page1)
        time.sleep(3.5)  # 等 server action 完成
        n_bad = count_orders(BAD)
        records.append(run_assertion(lambda: n_bad == 0, "g1", "非法手机号提交被拒且不落库", script_tag=SCRIPT_TAG, screenshot_page=page1))
        ctx1.close()

        # —— g2/g3：匿名合法连发，第 11 次应被限（DB 停增在 10）——
        ctx2 = fresh_ctx(p, "laund15g2"); page2 = open_order(ctx2)
        # 前 10 次：每次提交后等 count +1
        for i in range(1, MAX_OK + 1):
            fill_phone(page2, UNIQ); submit_click(page2)
            if not wait_db_count(UNIQ, i):
                break  # 提前停 → g2 断言会失败暴露
            time.sleep(0.5)  # 防连点过快被同窗口计入下一单（串行足够）
        ok_reached = count_orders(UNIQ)
        records.append(run_assertion(lambda: ok_reached == MAX_OK, "g2", f"前 {MAX_OK} 次合法提交全落单（实际 {ok_reached}）", script_tag=SCRIPT_TAG, screenshot_page=page2))
        # 第 11 次提交：等待后 count 应仍 = MAX_OK（被拦，未新增）
        fill_phone(page2, UNIQ); submit_click(page2)
        time.sleep(3.5)
        stayed = count_orders(UNIQ)
        records.append(run_assertion(lambda: stayed == MAX_OK, "g3", f"第 {MAX_OK+1} 次被限流拦截、DB 停增在 {MAX_OK}（现 {stayed}）", script_tag=SCRIPT_TAG, screenshot_page=page2))
        ctx2.close()
    cleanup()
    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
