'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  deleteShop,
  renewSubscription,
  resetOwnerPassword,
  toggleFeatured,
  togglePlatformSuspended,
  toggleShopApproval,
  unlockUser,
} from '@/lib/admin-actions'
import { useToast, ToastView } from '../dashboard/use-toast'

// 店铺卡片操作按钮：停用/启用、推荐位、删除、重置密码、入驻审核、解锁老板账号（client 交互 + toast）
export function ShopListActions({
  shopId,
  slug,
  plan,
  suspended,
  featured,
  approved,
  ownerLocked,
  ownerId,
}: {
  shopId: string
  slug: string
  plan: string
  suspended: boolean
  featured: boolean
  approved: boolean
  ownerLocked: boolean
  ownerId?: string
}) {
  const t = useTranslations('admin')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()
  const [resetOpen, setResetOpen] = useState(false)
  const [newPwd, setNewPwd] = useState('')
  const [renewOpen, setRenewOpen] = useState(false)
  const [renewPlan, setRenewPlan] = useState(plan)
  const [months, setMonths] = useState('1')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  function run(fn: () => Promise<void>, okMsg?: string) {
    startTransition(async () => {
      try {
        await fn()
        if (okMsg) show(okMsg)
        router.refresh()
      } catch (e) {
        console.error('中台操作失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  function onDelete() {
    if (!window.confirm(t('confirmDelete'))) return
    run(() => deleteShop(shopId), t('toastDeleted'))
  }

  function onReset() {
    // 店主密码宽松策略 ≥8 位字母数字（8.2 决策），前端先拦，后端兜底校验
    if (!newPwd || newPwd.length < 8) {
      show(t('pwdTooShort'))
      return
    }
    run(() => resetOwnerPassword(shopId, newPwd), t('toastPwdReset'))
    setResetOpen(false)
    setNewPwd('')
  }

  // 入驻审核（2026-08-29）：通过直接生效；驳回须填原因（服务端强校验，前端 prompt 收集）
  function onReject() {
    const reason = window.prompt(t('rejectReasonHint') ?? '')
    if (reason === null) return // 用户取消
    if (!reason.trim()) {
      show(t('rejectReasonRequired'))
      return
    }
    run(() => toggleShopApproval(shopId, false, reason.trim()), t('toastRejected'))
  }

  function onRenew() {
    const m = Number(months)
    const amt = Number(amount)
    if (!Number.isInteger(m) || m <= 0) {
      show(t('months'))
      return
    }
    if (!Number.isFinite(amt) || amt < 0) {
      show(t('amount'))
      return
    }
    run(
      () => renewSubscription({ shopId, plan: renewPlan, months: m, amount: amt, note }),
      t('toastRenewed'),
    )
    setRenewOpen(false)
    setMonths('1')
    setAmount('')
    setNote('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/s/${slug}`}
        target="_blank"
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {t('viewMenu')}
      </Link>
      {/* 第 20 批 A4（8.1 决策）：admin 不能进店，移除「进入后台」入口 */}
      <button
        onClick={() =>
          run(
            () => togglePlatformSuspended(shopId),
            suspended ? t('toastUnsuspended') : t('toastSuspended'),
          )
        }
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {suspended ? t('unsuspend') : t('suspend')}
      </button>
      <button
        onClick={() =>
          run(
            () => toggleFeatured(shopId),
            featured ? t('toastUnfeatured') : t('toastFeatured'),
          )
        }
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-xs transition-colors disabled:opacity-60 ${
          featured
            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300'
            : 'border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'
        }`}
      >
        {featured ? t('unfeature') : t('feature')}
      </button>
      <button
        onClick={() => setResetOpen((v) => !v)}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {t('resetPwd')}
      </button>
      <button
        onClick={() => setRenewOpen((v) => !v)}
        disabled={pending}
        className="rounded-md bg-green-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-green-700 disabled:opacity-60"
      >
        {t('renew')}
      </button>
      {/* 入驻审核：待审店（approved=false）显示通过/驳回 */}
      {!approved && (
        <>
          <button
            onClick={() => run(() => toggleShopApproval(shopId, true), t('toastApproved'))}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {t('approveShop')}
          </button>
          <button
            onClick={onReject}
            disabled={pending}
            className="rounded-md border border-amber-400 px-3 py-1.5 text-xs text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-60 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20"
          >
            {t('rejectShop')}
          </button>
        </>
      )}
      {/* 登录失败锁定：老板账号锁定期内显示解锁（unlockUser 清零 failedAttempts + lockedUntil） */}
      {ownerLocked && ownerId && (
        <button
          onClick={() => run(() => unlockUser(ownerId), t('toastUnlocked'))}
          disabled={pending}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
        >
          {t('unlockAccount')}
        </button>
      )}
      <button
        onClick={onDelete}
        disabled={pending}
        className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
      >
        {t('delete')}
      </button>
      {resetOpen && (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder={t('newPwd')}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          />
          <button
            onClick={onReset}
            disabled={pending}
            className="rounded-md bg-green-600 px-2 py-1.5 text-xs text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {t('confirm')}
          </button>
        </div>
      )}
      {renewOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={renewPlan}
            onChange={(e) => setRenewPlan(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="TRIAL">{t('planTrial')}</option>
            <option value="BASIC">{t('planBasic')}</option>
            <option value="PRO">{t('planPro')}</option>
          </select>
          <input
            type="number"
            min={1}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            placeholder={t('months')}
            className="w-16 rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          />
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('amount')}
            className="w-24 rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('note')}
            className="w-24 rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          />
          <button
            onClick={onRenew}
            disabled={pending}
            className="rounded-md bg-green-600 px-2 py-1.5 text-xs text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {t('confirm')}
          </button>
        </div>
      )}
      <ToastView msg={msg} />
    </div>
  )
}
