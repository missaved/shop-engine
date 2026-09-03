import sys, uuid, json
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path("/root/shop-saas/app/tests/lib")))
from e2e_common import BASE, NAV_TIMEOUT, ACTION_TIMEOUT, ASSERT_TIMEOUT, db_exec
from playwright.sync_api import sync_playwright

SLUG = "demo-moto"; OWNER = "0901122334"; PWD = "demo1234"
OUT = Path("/root/shop-saas/app/tests/screenshots"); OUT.mkdir(parents=True, exist_ok=True)
TS = datetime.now().strftime("%m%d%H%M%S")

def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None

def max_no(sid):
    r = db_exec(f'SELECT COALESCE(MAX("orderNo"),0)::text FROM "Order" WHERE "shopId"=\'{sid}\'::text')
    return int(r[0]["value"]) if r else 0

def clear_test(sid):
    db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"displayNo\" LIKE 'MO-D-%'")

def mk(sid, order_no, plate, prog, status, total, paid, symptom, day_off=0):
    cfg = json.dumps({"motoProgress": prog, "plate": plate, "symptom": symptom})
    display = f"MO-D-{TS}-{order_no}"
    # createdAt 偏移（昨天则 -1 天）
    created = f"NOW() - INTERVAL '{day_off} days'"
    db_exec(
        f"INSERT INTO \"Order\" (id,\"shopId\",\"orderNo\",\"displayNo\",status,total,\"paidAmount\",items,config,\"createdAt\",\"updatedAt\") "
        f"VALUES (gen_random_uuid()::text,'{sid}'::text,{order_no},'{display}','{status}',{total},{paid},'[]'::jsonb,'{cfg}'::jsonb,{created},NOW())"
    )
    return display

def setup():
    sid = shop_id()
    if not sid: raise SystemExit("无 shop")
    clear_test(sid)
    n = max_no(sid)
    mk(sid, n+1, "30A12345", "repairing", "IN_PROGRESS", 500000, 0, ["转轴异响"])          # 进行中 未收
    mk(sid, n+2, "29B67890", "repairing", "IN_PROGRESS", 600000, 200000, ["刹车片磨损"])   # 进行中 部分付
    mk(sid, n+3, "30C24680", "picked_up", "COMPLETED", 400000, 400000, ["换机油"], 0)      # 终态当天 已收
    mk(sid, n+4, "31D13579", "picked_up", "COMPLETED", 300000, 300000, ["补胎"], 1)        # 终态昨天（仅查全部）
    mk(sid, n+5, "32E97531", "waiting_pickup", "READY", 200000, 0, ["洗车"]) # 待取(进行中) 未收
    # 取消单（config.motoProgress=null）
    db_exec(
        f"INSERT INTO \"Order\" (id,\"shopId\",\"orderNo\",\"displayNo\",status,total,\"paidAmount\",items,config,\"createdAt\",\"updatedAt\") "
        f"VALUES (gen_random_uuid()::text,'{sid}'::text,{n+6},'MO-D-{TS}-C','CANCELLED',150000,0,'[]'::jsonb,'{{\"plate\":\"33F0\",\"motoProgress\":null}}'::jsonb,NOW(),NOW())"
    )
    return sid

def login(ctx):
    page = ctx.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/zh/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', OWNER); page.fill('input[name="password"]', PWD)
    page.click('button[type="submit"]'); page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    page.goto(f"{BASE}/zh/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.wait_for_timeout(2600)
    return page

with sync_playwright() as p:
    setup()
    ctx = p.chromium.launch_persistent_context(
        user_data_dir=f"/tmp/pw-d-{uuid.uuid4().hex[:8]}", headless=True,
        args=["--no-sandbox","--disable-dev-shm-usage","--disable-web-security"],
        viewport={"width":390,"height":844}, locale="zh-CN", timezone_id="Asia/Ho_Chi_Minh",
        ignore_https_errors=True,
    )
    ctx.set_default_timeout(ASSERT_TIMEOUT); ctx.set_default_navigation_timeout(NAV_TIMEOUT)
    page = login(ctx)
    # 默认折叠态主页
    page.screenshot(path=str(OUT/"block-d-home-folded.png"), full_page=True)
    b = page.inner_text('body')
    print("=== 默认折叠态 ===")
    print("含车牌30A12345(进行中):", "30A12345" in b)
    print("含车牌30C24680(今天终态):", "30C24680" in b)
    print("含昨天终态31D13579(默认隐藏):", "31D13579" in b)
    print("含取消单33F0(默认隐藏):", "33F0" in b)
    # 点开进行中单（30A12345）看支付着色 + 收款面板 + 次要行
    try:
        page.get_by_text("30A12345").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(700)
        page.screenshot(path=str(OUT/"block-d-expanded.png"), full_page=True)
        # 展开支付面板
        page.get_by_text("收款").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(700)
        page.screenshot(path=str(OUT/"block-d-settle-panel.png"), full_page=True)
    except Exception as e:
        print("展开/收款面板失败:", str(e)[:160])
    # 点「查看全部」→ 昨天终态 + 取消单出现
    try:
        page.get_by_text("查看全部").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(900)
        page.screenshot(path=str(OUT/"block-d-showall.png"), full_page=True)
        b2 = page.inner_text('body')
        print("=== 查全部后 ===")
        print("昨天终态31D13579可见:", "31D13579" in b2)
        print("取消单33F0可见:", "33F0" in b2)
    except Exception as e:
        print("查看全部失败:", str(e)[:160])
    ctx.close()
