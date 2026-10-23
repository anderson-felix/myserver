import React from 'react'

export interface BadgeProps {
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'deploying' | 'building' | 'crashed' | 'error' | 'idle' | 'online' | string
  label?: string
  size?: 'sm' | 'md'
}

export const Badge: React.FC<BadgeProps> = ({ status, label, size = 'md' }) => {
  const norm = status.toLowerCase()

  let color = 'bg-neutral-800 text-neutral-300 border-neutral-700'
  let dotColor = 'bg-neutral-400'
  let pulse = false

  switch (norm) {
    case 'running':
    case 'online':
    case 'ok':
    case 'success':
      color = 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
      dotColor = 'bg-emerald-400'
      pulse = true
      break
    case 'starting':
    case 'stopping':
    case 'deploying':
    case 'building':
      color = 'bg-cyan-950/60 text-cyan-300 border-cyan-500/30'
      dotColor = 'bg-cyan-400'
      pulse = true
      break
    case 'crashed':
    case 'error':
    case 'failed':
      color = 'bg-rose-950/60 text-rose-300 border-rose-500/30'
      dotColor = 'bg-rose-400'
      pulse = true
      break
    case 'stopped':
    case 'idle':
    default:
      color = 'bg-neutral-800/80 text-neutral-400 border-neutral-700'
      dotColor = 'bg-neutral-500'
      break
  }

  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium border ${color} ${padding}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${pulse ? 'animate-pulse' : ''}`} />
      <span>{label || status.toUpperCase()}</span>
    </span>
  )
}
