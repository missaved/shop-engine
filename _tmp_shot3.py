import sys, uuid
sys.path.insert(0,'/root/shop-saas/app')
from playwright.sync_api import sync_playwright
B="http://192.168.5.210:3000"
with sync_playwright() as p:
    b=p.chromium.launch_persistent_context("/tmp/pw-u3-"+uuid.uuid4().hex[:8], headless=True, args=["--no-sandbox","--disable-dev-shm-usage","--disable-web-security"], viewport={"width":390,"height":800}, timezone_id="Asia/Ho_Chi_Minh", ignore_https_errors=True)
    b.set_default_timeout(20000); b.set_default_navigation_timeout(40000)
    pg=b.new_page()
    csrf=pg.request.get(f"{B}/api/auth/csrf").json()["csrfToken"]
    pg.request.post(f"{B}/api/auth/callback/credentials", form={"csrfToken":csrf,"phone":"0901122335","password":"demo1234"})
    pg.goto(f"{B}/vi/dashboard", wait_until="domcontentloaded", timeout=40000)
    pg.get_by_text("Ready").first.click(timeout=15000); pg.wait_for_timeout(1200)
    pg.screenshot(path="/tmp/ui-boss-ready.png", full_page=True)
main
