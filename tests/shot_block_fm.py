import sys, uuid
from pathlib import Path
sys.path.insert(0, str(Path("/root/shop-saas/app/tests/lib")))
from e2e_common import BASE, NAV_TIMEOUT, ACTION_TIMEOUT, ASSERT_TIMEOUT
from playwright.sync_api import sync_playwright

OWNER = "0901122334"; PWD = "demo1234"
OUT = Path("/root/shop-saas/app/tests/screenshots"); OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        user_data_dir=f"/tmp/pw-fm-{uuid.uuid4().hex[:8]}", headless=True,
        args=["--no-sandbox","--disable-dev-shm-usage","--disable-web-security"],
        viewport={"width":390,"height":844}, locale="zh-CN", timezone_id="Asia/Ho_Chi_Minh",
        ignore_https_errors=True,
    )
    ctx.set_default_timeout(ASSERT_TIMEOUT); ctx.set_default_navigation_timeout(NAV_TIMEOUT)
    page = ctx.new_page()
    page.goto(f"{BASE}/zh/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', OWNER); page.fill('input[name="password"]', PWD)
    page.click('button[type="submit"]'); page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.goto(f"{BASE}/zh/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.wait_for_timeout(2600)
    page.screenshot(path=str(OUT/"block-fm-home.png"), full_page=True)
    b = page.inner_text('body')
    print("=== 主页（F-m 极简后） ===")
    for kw in ["今日实收","待取车辆","待提醒","欠款总额","每日流水","Sổ thu","Thu hôm nay"]:
        print(f"  含[{kw}](应 False 表示已移):", kw in b)
    # 开抽屉验证 MotoLedger 收入
    try:
        page.get_by_text("☰").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(700)
        page.screenshot(path=str(OUT/"block-fm-drawer.png"), full_page=True)
        b2 = page.inner_text('body')
        print("=== 抽屉 ===")
        for kw in ["每日流水","Sổ thu","Thu hôm nay","每日流水"]:
            print(f"  含[{kw}](应 True 表示已入抽屉):", kw in b2)
    except Exception as e:
        print("开抽屉失败:", str(e)[:160])
    ctx.close()
