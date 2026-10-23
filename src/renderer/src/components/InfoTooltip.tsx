import React, { useState, useRef, useEffect } from 'react'
import { HelpCircle, Lightbulb } from 'lucide-react'

export interface InfoTooltipProps {
  title?: string
  text?: string
  description?: string
  recommendation?: string
  className?: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  title,
  text,
  description,
  recommendation,
  className = '',
  position = 'top'
}) => {
  const content = description || text || ''
  const [visible, setVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setVisible(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const positionClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2'
  }

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center align-middle ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setVisible(!visible)
        }}
        className="text-neutral-500 hover:text-emerald-400 p-0.5 rounded transition-colors focus:outline-none"
        aria-label="Mais informações"
      >
        <HelpCircle size={13} />
      </button>

      {visible && (
        <div
          role="tooltip"
          className={`absolute z-50 w-72 p-3 rounded-xl bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 shadow-2xl text-left pointer-events-auto transition-all animate-in fade-in zoom-in-95 duration-150 ${positionClasses[position]}`}
          onClick={(e) => e.stopPropagation()}
        >
          {title && (
            <h4 className="text-xs font-bold text-white mb-1 tracking-tight flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {title}
            </h4>
          )}
          <p className="text-[11px] leading-relaxed text-neutral-300 font-normal">{content}</p>
          {recommendation && (
            <div className="mt-2 pt-2 border-t border-neutral-800 flex items-start gap-1.5 text-[10px] text-emerald-300 font-mono bg-emerald-950/40 -mx-1 px-2 py-1 rounded-md">
              <Lightbulb size={12} className="shrink-0 text-emerald-400 mt-0.5" />
              <span>
                <strong className="text-emerald-300">Dica:</strong> {recommendation}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
