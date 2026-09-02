import sys, uuid
sys.path.insert(0,'/root/shop-saas/app')
from playwright.sync_api import sync_playwright
B="http://192.168.5.210:3000"
def main():
    with sync_playwright() as p:
        b=p.chromium.launch_persistent_context("/tmp/pw-ui-"+uuid.uuid4().hex[:8], headless=True, args=["--no-sandbox","--disable-dev-shm-usage","--disable-web-security"], viewport={"width":390,"height":800}, timezone_id="Asia/Ho_Chi_Minh", ignore_https_errors=True)
        b.set_default_timeout(20000); b.set_default_navigation_timeout(40000)
        pg=b.new_page()
        csrf=pg.request.get(f"{B}/api/auth/csrf").json()["csrfToken"]
        pg.request.post(f"{B}/api/auth/callback/credentials", form={"csrfToken":csrf,"phone":"0901122335","password":"demo1234"})
        pg.goto(f"{B}/vi/dashboard", wait_until="domcontentloaded", timeout=40000)
        pg.get_by_text("Tất cả").first.click(timeout=15000); pg.wait_for_timeout(1200)
        pg.screenshot(path="/tmp/ui-boss.png", full_page=True)
        # 顾客自助下单
        pg.goto(f"{B}/vi/hcm/laundry/demolaud/order", wait_until="domcontentloaded", timeout=40000)
        pg.get_by_text("Theo món").first.click(timeout=15000); pg.wait_for_timeout(400)
        pg.screenshot(path="/tmp/ui-order.png", full_page=True)  # 截全页看溢出
main()
