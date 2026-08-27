'use server'

// 服务端二维码生成：店铺菜单页 URL → 二维码 PNG dataURL（供门头/桌号引导图下载打印）
import QRCode from 'qrcode'

export async function generateShopQr(text: string): Promise<string> {
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      margin: 1,
      width: 512,
      color: { dark: '#18181b', light: '#ffffff' },
    })
    return dataUrl
  } catch (e) {
    console.error('二维码生成失败:', e)
    throw new Error('二维码生成失败')
  }
}
