// 内存登录失败限流（阶段 1 单实例够用；多实例部署需换 Redis 等共享存储）
// 维度：IP + 手机号，双 key 各自限流；阈值 5 次失败 / 60 秒窗口
type Attempt = { count: number; resetAt: number }

const store = new Map<string, Attempt>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 60 * 1000

// 是否已触发限流（窗口内失败次数达到阈值）
export function isRateLimited(key: string): boolean {
  const rec = store.get(key)
  if (!rec) return false
  if (Date.now() >= rec.resetAt) {
    store.delete(key)
    return false
  }
  return rec.count >= MAX_ATTEMPTS
}

// 记录一次失败
export function recordFailure(key: string): void {
  const t = Date.now()
  const rec = store.get(key)
  if (!rec || t >= rec.resetAt) {
    store.set(key, { count: 1, resetAt: t + WINDOW_MS })
  } else {
    rec.count += 1
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
