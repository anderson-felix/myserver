import React, { useEffect, useState } from 'react'
import { X, BookOpen, ExternalLink, Copy, Check, Lightbulb } from 'lucide-react'

export interface HelpSection {
  title: string
  steps?: string[]
  code?: string
  tip?: string
  link?: { label: string; url: string }
}

export interface HelpStep {
  title: string
  description: string
}

export interface HelpDrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  badge?: string
  subtitle?: string
  description?: string
  sections?: HelpSection[]
  steps?: Array<HelpStep | string>
  codeSnippet?: string
  tips?: string[]
  externalLinks?: Array<{ label: string; url: string }>
}

export const HelpDrawer: React.FC<HelpDrawerProps> = ({
  isOpen,
  onClose,
  title,
  badge = 'Guia Rápido',
  subtitle,
  description,
  sections,
  steps,
  codeSnippet,
  tips,
  externalLinks
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [copiedSnippet, setCopiedSnippet] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleCopyCode = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedIndex(idx)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch {
      /* ignore */
    }
  }

  const handleOpenLink = (url: string) => {
    if (window.api?.openExternal) {
      window.api.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-neutral-950/70 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-lg bg-neutral-900 border-l border-neutral-800 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="p-6 border-b border-neutral-800 bg-neutral-950/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <BookOpen size={11} />
                  {badge}
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <h3 className="text-lg font-bold text-white mt-2 tracking-tight">{title}</h3>
            {(subtitle || description) && (
              <p className="text-xs text-neutral-400 mt-1 leading-relaxed">{subtitle || description}</p>
            )}
          </div>

          {/* Conteúdo com Scroll */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Seções estruturadas (Modo A) */}
            {sections && sections.length > 0 && sections.map((sec, idx) => (
              <div
                key={idx}
                className="p-4 rounded-2xl bg-neutral-950/60 border border-neutral-800/80 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-mono flex items-center justify-center font-bold">
                      {idx + 1}
                    </span>
                    <span>{sec.title}</span>
                  </h4>

                  {sec.link && (
                    <button
                      type="button"
                      onClick={() => handleOpenLink(sec.link!.url)}
                      className="text-[11px] font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors hover:underline"
                    >
                      <span>{sec.link.label}</span>
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>

                {/* Passos numerados */}
                {sec.steps && sec.steps.length > 0 && (
                  <ul className="space-y-2 text-xs text-neutral-300 pl-2">
                    {sec.steps.map((st, stepIdx) => (
                      <li key={stepIdx} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-emerald-500 font-bold">•</span>
                        <span>{st}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Bloco de Código com Botão Copiar */}
                {sec.code && (
                  <div className="relative group rounded-xl bg-neutral-950 border border-neutral-800 overflow-hidden">
                    <pre className="p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                      {sec.code}
                    </pre>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(sec.code!, idx)}
                      className="absolute right-2 top-2 px-2 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 text-[10px] font-mono flex items-center gap-1 transition-colors border border-neutral-700/50 shadow-sm"
                      title="Copiar código"
                    >
                      {copiedIndex === idx ? (
                        <>
                          <Check size={11} className="text-emerald-400" />
                          <span className="text-emerald-400 font-semibold">Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={11} />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Dica de Especialista */}
                {sec.tip && (
                  <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-emerald-200 text-xs flex items-start gap-2">
                    <Lightbulb size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{sec.tip}</span>
                  </div>
                )}
              </div>
            ))}

            {/* Passos Sequenciais (Modo B) */}
            {steps && steps.length > 0 && (
              <div className="space-y-3">
                {steps.map((st, idx) => {
                  const stepTitle = typeof st === 'string' ? `Passo ${idx + 1}` : st.title
                  const stepDesc = typeof st === 'string' ? st : st.description

                  return (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl bg-neutral-950/60 border border-neutral-800/80 space-y-1.5"
                    >
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono flex items-center justify-center font-bold shrink-0">
                          {idx + 1}
                        </span>
                        <span>{stepTitle}</span>
                      </h4>
                      <p className="text-xs text-neutral-300 leading-relaxed pl-7 whitespace-pre-line">
                        {stepDesc}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Bloco de Código Avulso */}
            {codeSnippet && (
              <div className="relative group rounded-xl bg-neutral-950 border border-neutral-800 overflow-hidden">
                <pre className="p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {codeSnippet}
                </pre>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(codeSnippet)
                    setCopiedSnippet(true)
                    setTimeout(() => setCopiedSnippet(false), 2000)
                  }}
                  className="absolute right-2 top-2 px-2 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 text-[10px] font-mono flex items-center gap-1 transition-colors border border-neutral-700/50 shadow-sm"
                  title="Copiar comando"
                >
                  {copiedSnippet ? (
                    <>
                      <Check size={11} className="text-emerald-400" />
                      <span className="text-emerald-400 font-semibold">Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Dicas */}
            {tips && tips.length > 0 && (
              <div className="space-y-2">
                {tips.map((t, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-emerald-200 text-xs flex items-start gap-2">
                    <Lightbulb size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{t}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Links Externos */}
            {externalLinks && externalLinks.length > 0 && (
              <div className="p-4 rounded-xl bg-neutral-950/40 border border-neutral-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 block">
                  Links Oficiais & Portais
                </span>
                <div className="flex flex-wrap gap-2">
                  {externalLinks.map((lk, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleOpenLink(lk.url)}
                      className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-cyan-300 text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <span>{lk.label}</span>
                      <ExternalLink size={12} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer do Drawer */}
          <div className="p-4 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-between text-xs">
            <span className="text-neutral-500 text-[11px]">Dúvidas ou customizações avançadas?</span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs transition-colors"
            >
              Entendi, fechar guia
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
