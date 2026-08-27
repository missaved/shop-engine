'use client'

// 全局音频解锁：挂在根布局，任意页面的用户手势（点/触/按键）都触发解锁全局 AudioContext。
// 这样老板在登录页点「登录」按钮的手势就能解锁，进入 dashboard 后提示音可直接发声。
// 不用 { once: true } 而是持续监听——resume 幂等、开销极小，且能覆盖「首次 resume 被拒」的
// 边缘情况：之后任何一次交互都会再试一次解锁。
import { useEffect } from 'react'
import { unlockAudio } from '@/lib/audio'

export function AudioUnlocker() {
  useEffect(() => {
    const unlock = () => unlockAudio()
    document.addEventListener('pointerdown', unlock)
    document.addEventListener('touchstart', unlock)
    document.addEventListener('keydown', unlock)
    return () => {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [])
  return null
}
