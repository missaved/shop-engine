import sys, uuid
sys.path.insert(0,'/root/shop-saas/app')
from playwright.sync_api import sync_playwright
B="http://192.168.5.210:3000"
with sync_playwright() as p:
    b=p.chromium.launch_persistent_context("/tmp/pw-u4-"+uuid.uuid4().hex[:8], headless=True, args=["--no-sandbox","--disable-dev-shm-usage","--disable-web-security"], viewport={"width":390,"height":800}, timezone_id="Asia/Ho_Chi_Minh", ignore_https_errors=True)
    b.set_default_timeout(20000); b.set_default_navigation_timeout(40000)
    pg=b.new_page()
    # 落地页
    pg.goto(f"{B}/vi/hcm/laundry/demolaud/storefront", wait_until="domcontentloaded", timeout=40000); pg.wait_for_timeout(1000)
    pg.get_by_text("Tôi muốn giặt").first.click(timeout=15000); pg.wait_for_timeout(600)
    pg.screenshot(path="/tmp/ui-storefront-gate.png", full_page=True)
    # 顾客 /my（先建顾客单? 直接登录看空/有单）
    csrf=pg.request.get(f"{B}/api/auth/csrf").json()["csrfToken"]
    pg.request.post(f"{B}/api/auth/callback/customer-credentials", form={"csrfToken":csrf,"phone":"0987000011","password":"demo1234"})
    pg.goto(f"{B}/vi/hcm/laundry/demolaud/my", wait_until="domcontentloaded", timeout=40000); pg.wait_for_timeout(2000)
    pg.screenshot(path="/tmp/ui-my.png", full_page=True)
main
