import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

/**
 * Sistema global de Toasts + Diálogo de Confirmação in-app.
 *
 * Substitui window.alert()/window.confirm(), que no Electron/Windows congelam a janela
 * e causam o bug de perda de foco nos inputs do Chromium.
 */

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  durationMs: number
}

interface ConfirmOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  message: string
  resolve: (value: boolean) => void
}

export interface ToastApi {
  success: (title: string, description?: string, durationMs?: number) => void
  error: (title: string, description?: string, durationMs?: number) => void
  warning: (title: string, description?: string, durationMs?: number) => void
  info: (title: string, description?: string, durationMs?: number) => void
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>
}

const ToastContext = createContext<ToastApi | null>(null)

const KIND_STYLES: Record<ToastKind, { icon: React.ElementType; ring: string; iconColor: string; bar: string }> = {
  success: { icon: CheckCircle2, ring: 'border-emerald-500/40', iconColor: 'text-emerald-400', bar: 'bg-emerald-500' },
  error: { icon: XCircle, ring: 'border-rose-500/40', iconColor: 'text-rose-400', bar: 'bg-rose-500' },
  warning: { icon: AlertTriangle, ring: 'border-amber-500/40', iconColor: 'text-amber-400', bar: 'bg-amber-500' },
  info: { icon: Info, ring: 'border-cyan-500/40', iconColor: 'text-cyan-400', bar: 'bg-cyan-500' }
}

const ToastCard: React.FC<{ item: ToastItem; onClose: (id: number) => void }> = ({ item, onClose }) => {
  const [leaving, setLeaving] = useState(false)
  const style = KIND_STYLES[item.kind]
  const Icon = style.icon

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), item.durationMs - 250)
    const t2 = setTimeout(() => onClose(item.id), item.durationMs)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [item.id, item.durationMs, onClose])

  return (
    <div
      role="status"
      className={`toast-card pointer-events-auto relative w-[360px] overflow-hidden rounded-xl border ${style.ring} bg-[#121826] shadow-2xl shadow-black/50 ${
        leaving ? 'toast-leave' : 'toast-enter'
      }`}
    >
      <div className="flex items-start gap-3 p-3.5 pr-9">
        <Icon size={18} className={`${style.iconColor} mt-0.5 shrink-0`} />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white leading-snug break-words">{item.title}</p>
          {item.description && (
            <p className="mt-0.5 text-xs text-neutral-400 leading-relaxed break-words whitespace-pre-line">{item.description}</p>
          )}
        </div>
      </div>
      <button
        onClick={() => onClose(item.id)}
        className="absolute right-2 top-2 rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-white transition-colors"
        aria-label="Fechar notificação"
      >
        <X size={14} />
      </button>
      <div className="absolute bottom-0 left-0 h-0.5 w-full bg-neutral-800">
        <div className={`h-full ${style.bar} toast-progress`} style={{ animationDuration: `${item.durationMs}ms` }} />
      </div>
    </div>
  )
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const idRef = useRef(0)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, title: string, description?: string, durationMs = 4000) => {
    const id = ++idRef.current
    setToasts((prev) => [...prev.slice(-4), { id, kind, title, description, durationMs }])
  }, [])

  const confirm = useCallback((message: string, options?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ message, resolve, ...options })
    })
  }, [])

  const closeConfirm = useCallback(
    (value: boolean) => {
      setConfirmState((curr) => {
        curr?.resolve(value)
        return null
      })
    },
    []
  )

  useEffect(() => {
    if (!confirmState) return
    confirmBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConfirm(false)
      if (e.key === 'Enter') closeConfirm(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmState, closeConfirm])

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, d, ms) => push('success', t, d, ms),
      error: (t, d, ms) => push('error', t, d, ms ?? 6000),
      warning: (t, d, ms) => push('warning', t, d, ms ?? 5000),
      info: (t, d, ms) => push('info', t, d, ms),
      confirm
    }),
    [push, confirm]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Pilha de toasts (canto superior direito) */}
      <div className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col gap-2.5" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onClose={remove} />
        ))}
      </div>

      {/* Diálogo de confirmação in-app */}
      {confirmState && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4" onClick={() => closeConfirm(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            className="toast-enter w-full max-w-md rounded-2xl border border-neutral-800 bg-[#121826] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`rounded-xl border p-2 ${
                  confirmState.danger
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                }`}
              >
                <AlertTriangle size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white">{confirmState.title || 'Confirmar ação'}</h3>
                <p className="mt-1 text-xs leading-relaxed text-neutral-400 whitespace-pre-line">{confirmState.message}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => closeConfirm(false)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                {confirmState.cancelLabel || 'Cancelar'}
              </button>
              <button
                ref={confirmBtnRef}
                onClick={() => closeConfirm(true)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-bold text-white transition-colors ${
                  confirmState.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {confirmState.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>')
  return ctx
}
