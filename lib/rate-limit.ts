// 内存登录失败限流（阶段 1 单实例够用；多实例部署需换 Redis 等共享存储）
// 维度：IP + 手机号，双 key 各自限流。
// 第 20 批 A1：限流通用化分层——owner 档保持原有 5 次/60s 行为；admin 档更严（3 次/5 分钟
//   + 1 小时累计 6 次失败 → 封禁 1 小时），杜绝平台管理员账号被爆破。
type Attempt = {
  count: number // 当前窗口失败次数
  resetAt: number // 窗口重置时间
  bannedUntil?: number // 累计封禁到期时间（undefined = 未封禁）
  history: number[] // 累计失败时间戳（触发累计封禁用）
}

const store = new Map<string, Attempt>()

// 限流档位参数
export type RateLimitOpts = {
  max: number // 窗口内最大失败次数
  windowMs: number // 窗口长度
  historyMs?: number // 累计封禁窗口（缺省 = 不启用累计封禁）
  historyMax?: number // 累计窗口内最大失败次数（达到即封禁）
  banMs?: number // 封禁时长
}

// owner 档：5 次/60s，无累计封禁（保持原有行为不变）
const OWNER_OPTS: RateLimitOpts = { max: 5, windowMs: 60 * 1000 }

// admin 档：3 次/5 分钟窗口 + 1 小时累计 6 次失败 → 封禁 1 小时
export const ADMIN_LIMIT_OPTS: RateLimitOpts = {
  max: 3,
  windowMs: 5 * 60 * 1000,
  historyMs: 60 * 60 * 1000,
  historyMax: 6,
  banMs: 60 * 60 * 1000,
}

// 修剪累计窗口外的时间戳（保持 history 不长驻内存）
function pruneHistory(rec: Attempt, historyMs: number): void {
  const cutoff = Date.now() - historyMs
  rec.history = rec.history.filter((t) => t >= cutoff)
}

// 是否已触发限流（封禁中，或窗口内失败次数达阈值）
export function isRateLimited(key: string, opts: RateLimitOpts = OWNER_OPTS): boolean {
  const rec = store.get(key)
  if (!rec) return false
  const now = Date.now()
  // 累计封禁优先：封禁期内一律拒绝
  if (rec.bannedUntil !== undefined && now < rec.bannedUntil) return true
  // 窗口过期自动释放
  if (now >= rec.resetAt) {
    store.delete(key)
    return false
  }
  return rec.count >= opts.max
}

// 记录一次失败：窗口计数 +1；启用累计封禁时计入历史，达到 historyMax 即封禁
export function recordFailure(key: string, opts: RateLimitOpts = OWNER_OPTS): void {
  const now = Date.now()
  let rec = store.get(key)
  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: now + opts.windowMs, history: [] }
    store.set(key, rec)
  }
  rec.count += 1
  if (opts.historyMs && opts.historyMax && opts.banMs) {
    pruneHistory(rec, opts.historyMs)
    rec.history.push(now)
    if (rec.history.length >= opts.historyMax) {
      // 封禁由 bannedUntil 接管，重置窗口计数与历史
      rec.bannedUntil = now + opts.banMs
      rec.count = 0
      rec.history = []
    }
  }
}

// 登录成功，清空该 key 的失败记录
export function clearFailures(key: string): void {
  store.delete(key)
}

// 从 Request 提取客户端 IP（兼容反向代理 x-forwarded-for / x-real-ip）
export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}
