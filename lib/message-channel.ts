// M6b 消息渠道抽象：把「发凭证给客户」的分享动作做成深链（M6b 6.6）
// 凭证页/分享按钮只依赖 MESSAGE_CHANNELS 列表 + channelShareUrl；
// 新增渠道（line/telegram/短信）只需加一个 case，接口不动
export type MessageChannel = 'zalo' | 'whatsapp'

export const MESSAGE_CHANNELS: { id: MessageChannel; labelKey: string }[] = [
  { id: 'whatsapp', labelKey: 'shareWhatsapp' },
  { id: 'zalo', labelKey: 'shareZalo' },
]

// 分享文案 → 渠道深链（wa.me / zalo.me 通用 text 分享）
export function channelShareUrl(channel: MessageChannel, text: string): string {
  const enc = encodeURIComponent(text)
  switch (channel) {
    case 'whatsapp':
      return `https://wa.me/?text=${enc}`
    case 'zalo':
      return `https://zalo.me/?text=${enc}`
  }
}
