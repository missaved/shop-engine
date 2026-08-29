// @ts-nocheck — 一次性静态核对（非交付）：admin 树全部 t() key 在 6 语 messages 中是否存在
// 覆盖 orders 页 statusKey 修复 + 任意静态 key 缺失（比单页浏览器检查更全面）
import fs from 'fs'
import path from 'path'

const locales = ['zh', 'zh-Hant', 'en', 'vi', 'ms', 'th']
const msgs = {}
for (const l of locales) msgs[l] = JSON.parse(fs.readFileSync(`messages/${l}.json`, 'utf8'))

// 收集 admin 相关文件
const files = []
const walk = (dir) => {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e.name)) files.push(p)
  }
}
walk('app/admin')
walk('components/admin')
if (fs.existsSync('lib/admin-actions.ts')) files.push('lib/admin-actions.ts')

const resolvePath = (obj, key) => {
  let cur = obj
  for (const p of key.split('.')) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p]
    else return undefined
  }
  return cur
}

// 1) statusKey 逻辑复现：IN_PROGRESS → InProgress（与 orders/page.tsx 同规则），验证 6 语 key 存在
const statusKey = (s) => {
  const cc = s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  return cc.charAt(0).toUpperCase() + cc.slice(1)
}
const ORDER_STATUSES = ['PENDING', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED']
let bad = 0
for (const l of locales) {
  for (const s of ORDER_STATUSES) {
    const key = `status${statusKey(s)}`
    if (typeof resolvePath(msgs[l].admin, key) !== 'string') {
      bad++
      console.log(`[缺] ${l}.admin.${key}`)
    }
  }
}
console.log(`statusKey 修复核对：5 状态 × 6 语 = ${ORDER_STATUSES.length * locales.length} 项，缺失 ${bad}`)

// 2) 全量静态 key 核对：解析每个文件的 namespace，t('x') / getTranslations ns
let missing = []
let checked = 0
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  // 变量名 → 命名空间：const t = useTranslations('admin') / const tl = useTranslations('login') ...
  const nsMap = new Map()
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    nsMap.set(m[1], m[2])
  }
  // 直接以命名空间为参数的形式：useTranslations('x') 用作 t
  for (const m of src.matchAll(/\(\s*\(\s*['"]([^'"]+)['"]\s*\)\s*=>\s*useTranslations\(\s*['"]([^'"]+)['"]/g)) {
    nsMap.set(m[1], m[2])
  }
  for (const m of src.matchAll(/\b(\w+)\s*\(\s*['"]([^'"${}]+)['"]\s*\)/g)) {
    const varName = m[1]
    const key = m[2]
    if (key.startsWith('/') || key.startsWith('.')) continue // 非 i18n 调用（路径等）
    if (/[${}]/.test(key)) continue
    const ns = nsMap.get(varName)
    if (ns === undefined) continue // 非翻译调用（router.push、redirect 等）
    checked++
    const resolved = resolvePath(msgs.zh, `${ns}.${key}`)
    if (typeof resolved !== 'string') {
      missing.push(`${f}: ns=${ns} ${varName}('${key}')`)
    }
  }
}
console.log(`静态 key 核对：共 ${checked} 个静态 t()，缺失 ${missing.length}`)
for (const x of missing.slice(0, 40)) console.log('  [缺] ' + x)
