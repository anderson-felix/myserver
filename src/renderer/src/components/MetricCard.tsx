import React from 'react'
import type { LucideIcon } from 'lucide-react'

export interface MetricCardProps {
  title: string
  value: string
  subvalue?: string
  icon: LucideIcon
  percent?: number
  tone?: 'emerald' | 'cyan' | 'amber' | 'rose' | 'neutral'
  badge?: string
}

export const MetricCard: React.FC<MetricCardProps> = React.memo(({
  title,
  value,
  subvalue,
  icon: Icon,
  percent,
  tone = 'emerald',
  badge
}) => {
  const toneClasses = {
    emerald: {
      bg: 'from-emerald-500/10 to-transparent',
      text: 'text-emerald-400',
      bar: 'bg-emerald-500',
      border: 'border-emerald-500/20'
    },
    cyan: {
      bg: 'from-cyan-500/10 to-transparent',
      text: 'text-cyan-400',
      bar: 'bg-cyan-500',
      border: 'border-cyan-500/20'
    },
    amber: {
      bg: 'from-amber-500/10 to-transparent',
      text: 'text-amber-400',
      bar: 'bg-amber-500',
      border: 'border-amber-500/20'
    },
    rose: {
      bg: 'from-rose-500/10 to-transparent',
      text: 'text-rose-400',
      bar: 'bg-rose-500',
      border: 'border-rose-500/20'
    },
    neutral: {
      bg: 'from-neutral-500/10 to-transparent',
      text: 'text-neutral-400',
      bar: 'bg-neutral-500',
      border: 'border-neutral-500/20'
    }
  }[tone]

  return (
    <div className="glass-panel glass-panel-hover rounded-xl p-4 flex flex-col justify-between relative overflow-hidden">
      <div className="flex items-center justify-between mb-3 z-10">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg bg-neutral-900/90 border border-neutral-800 ${toneClasses.text}`}>
            <Icon size={18} />
          </div>
          <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{title}</span>
        </div>
        {badge && (
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${toneClasses.border} ${toneClasses.text} bg-neutral-900/50`}>
            {badge}
          </span>
        )}
      </div>

      <div className="z-10">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-white font-mono">{value}</span>
          {subvalue && <span className="text-xs text-neutral-400">{subvalue}</span>}
        </div>

        {percent !== undefined && (
          <div className="mt-3">
            <div className="w-full bg-neutral-900 h-1.5 rounded-full overflow-hidden border border-neutral-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${toneClasses.bar}`}
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

MetricCard.displayName = 'MetricCard'
