// 客户端全局音频单例：老板端新单/呼叫服务员提示音。
// AudioContext 必须由「用户手势」解锁后才能发声（浏览器 autoplay 政策），
// 因此做成模块级单例：登录页点「登录」按钮的手势即可解锁，跨路由（客户端导航）复用，
// 进入 dashboard 后即使挂机不再交互，playBeep 也能直接发声。
let ctx: AudioContext | null = null

// 解锁：创建并 resume AudioContext。需在用户手势（点/触/按键）回调里调用才有效；
// resume 幂等，可反复调用（每次用户交互都触发一次，确保尽早解锁）。
export function unlockAudio(): void {
  try {
    const ac = ctx ?? (ctx = new AudioContext())
    if (ac.state === 'suspended') void ac.resume()
  } catch {
    // 不支持 Web Audio 时静默
  }
}

// 播放提示音：880→1100Hz 双音，比单音更醒目。
// 播放前先 await resume，避免 suspended 状态下首次播放被静默吞掉。
export async function playBeep(): Promise<void> {
  try {
    const ac = ctx ?? (ctx = new AudioContext())
    if (ac.state === 'suspended') await ac.resume()
    const now = ac.currentTime
    ;[880, 1100].forEach((freq, i) => {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.value = 0.2
      osc.connect(gain).connect(ac.destination)
      osc.start(now + i * 0.18)
      osc.stop(now + i * 0.18 + 0.16)
    })
  } catch {
    // 音频不可用时静默，不影响刷新
  }
}

// 语音 buffer 缓存：同一条提示反复播放不必重复 fetch/decode
const voiceBufferCache = new Map<string, AudioBuffer>()
// 播放中的 source：保持引用防 GC 提前停止（Web Audio 经典坑），onended 再移除
const activeSources = new Set<AudioBufferSourceNode>()

// 预加载语音：提前 fetch + decode 进缓存，播放时零延迟。
// decodeAudioData 在 suspended 的 AudioContext 上也能执行，故不强制 resume。
export async function preloadVoices(urls: string[]): Promise<void> {
  try {
    const ac = ctx ?? (ctx = new AudioContext())
    for (const url of urls) {
      if (voiceBufferCache.has(url)) continue
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const arr = await res.arrayBuffer()
        voiceBufferCache.set(url, await ac.decodeAudioData(arr))
      } catch {
        // 单个语音加载失败跳过，不影响其它
      }
    }
  } catch {
    // 不支持 Web Audio 时静默
  }
}

// 播放预生成语音（public/sounds/*.mp3）：复用全局 AudioContext，解码后播放，
// 不受 autoplay 政策影响（ctx 已由用户手势解锁）。语音文件缺失/解码失败时回退哔哔声。
export async function playVoice(url: string): Promise<void> {
  try {
    const ac = ctx ?? (ctx = new AudioContext())
    if (ac.state === 'suspended') await ac.resume()
    let buf = voiceBufferCache.get(url)
    if (!buf) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`语音加载失败 ${res.status}`)
      const arr = await res.arrayBuffer()
      buf = await ac.decodeAudioData(arr)
      voiceBufferCache.set(url, buf)
    }
    const src = ac.createBufferSource()
    src.buffer = buf
    src.connect(ac.destination)
    // 保持引用直到播放结束，防 GC 提前截断播报
    src.onended = () => activeSources.delete(src)
    activeSources.add(src)
    src.start()
  } catch {
    // 语音不可用时回退哔哔声，确保老板端至少有声
    await playBeep()
  }
}
