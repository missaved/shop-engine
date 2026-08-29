// @ts-nocheck — 一次性浏览器验证（非生产代码，不参与交付）
// 验证：语言混杂修复（服务端组件 + 客户端导航）、菜单分组、全屏铺满、设置页 2FA 开关
import 'dotenv/config'
import { chromium } from '/tmp/pw-check/node_modules/playwright-core/index.mjs'
import { decryptSecret, totpForTime } from '../lib/totp'
import { prisma } from '../lib/prisma'

const BASE = 'https://app.spotnear.me'
const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
if (!admin?.totpSecret) throw new Error('admin 无 TOTP')
const secret = decryptSecret(admin.totpSecret)
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })
const page = await (await browser.newContext()).newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('cloudflareinsights')) errors.push('console: ' + m.text().slice(0, 160))
})

// 0. 全页加载 /admin/en/login（无需登录）：title 无硬编码中文、文案英文
await page.goto(BASE + '/admin/en/login', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(1500)
console.log('[en登录页] title=' + JSON.stringify(await page.title()))
const enBody = await page.locator('body').innerText()
console.log('[en登录页] 含硬编码中文「平台运营/切换语言」=' + (enBody.includes('平台运营') || enBody.includes('切换语言')) + ' 含 Admin only=' + enBody.includes('Admin only'))

// 1. 真实表单两步登录 → 客户端导航到 /admin/zh（正是此前 client 回退 en 的场景）
await page.goto(BASE + '/admin/zh/login', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.locator('input[name="phone"]').fill(admin.phone)
await page.locator('input[name="password"]').fill(process.env.ADMIN_PW ?? '')
await page.locator('form button[type="submit"]').click()
// 等 OTP 输入出现或密码出错提示
await page.waitForTimeout(3000)
const hasOtp = await page.locator('input[name="otp"]').count()
if (hasOtp) {
  await page.locator('input[name="otp"]').fill(totpForTime(secret, Math.floor(Date.now() / 1000)))
  await page.locator('form button[type="submit"]').click()
  await page.waitForTimeout(4500)
}
console.log('登录后 url=' + page.url())

// 2. 总览页：侧边栏（client）+ 服务端文本（getTranslations）+ 快捷链接（params locale）
const nav = await page.locator('nav').first().innerText()
console.log('侧边栏:\n' + nav)
console.log('侧边栏 含英文Overview=' + nav.includes('Overview') + ' 含中文总览=' + nav.includes('总览'))
const quick = await page.locator('main a[href*="/admin/"]').evaluateAll((els) => els.map((a) => a.getAttribute('href')))
console.log('快捷链接=' + JSON.stringify(quick))
console.log('快捷链接用zh=' + quick.every((h) => h.includes('/admin/zh/')))
const ovBody = await page.locator('body').innerText()
console.log('总览 含「总店铺」=' + ovBody.includes('总店铺') + ' 含 Total=' + (ovBody.includes('Total shops') || ovBody.includes('Total orders')))
const mainCls = await page.locator('main > div').first().getAttribute('class') ?? ''
console.log('内容区 全屏铺满(去max-w)=' + !mainCls.includes('max-w-6xl') + ' | class=' + mainCls)

// 3. 客户端导航点击「营收看板」（验证 client 导航下服务端组件语言）
await page.locator('nav a[href*="/analytics"]').first().click()
await page.waitForTimeout(2500)
console.log('点击后 url=' + page.url() + ' h1=' + JSON.stringify(await page.locator('h1').first().textContent().catch(() => null)))
const anaBody = await page.locator('body').innerText()
console.log('看板 含「本月营收」=' + anaBody.includes('本月营收'))

// 4. 设置页：2FA 开关 + 语言 + 层级占位
await page.goto(BASE + '/admin/zh/settings', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2000)
const setBody = await page.locator('body').innerText()
console.log('设置页 含「已开启」=' + setBody.includes('已开启') + ' 含「关闭双重验证」=' + setBody.includes('关闭双重验证') + ' 含「界面语言」=' + setBody.includes('界面语言') + ' 含「即将开放」=' + setBody.includes('即将开放'))

console.log('ERRORS=' + JSON.stringify(errors, null, 1))
await browser.close()
await prisma.$disconnect()
