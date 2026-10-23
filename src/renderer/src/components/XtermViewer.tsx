import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Trash2, ArrowDown, Copy, Check } from 'lucide-react'
import type { LogEvent } from '@shared/types'

export interface XtermViewerProps {
  logs: LogEvent[]
  projectId?: string
  height?: string
}

export const XtermViewer: React.FC<XtermViewerProps> = ({ logs, projectId, height = 'h-72' }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const renderedCountRef = useRef(0)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: false,
      fontSize: 12,
      fontFamily: 'JetBrains Mono Variable, Consolas, monospace',
      theme: {
        background: '#090d16',
        foreground: '#cbd5e1',
        cursor: '#10b981',
        black: '#0f172a',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#f8fafc',
        brightBlack: '#64748b'
      },
      convertEol: true,
      scrollback: 1500,
      disableStdin: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon
    renderedCountRef.current = 0

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        /* ignore */
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [projectId])

  // Escreve novos logs no terminal
  useEffect(() => {
    const term = termRef.current
    if (!term) return

    // Se a lista foi reiniciada
    if (logs.length < renderedCountRef.current) {
      term.clear()
      renderedCountRef.current = 0
    }

    const newLogs = logs.slice(renderedCountRef.current)
    if (newLogs.length === 0) return

    for (const log of newLogs) {
      const timeStr = `\x1b[90m${new Date(log.ts).toLocaleTimeString()}\x1b[0m`
      let streamPrefix = ''

      if (log.stream === 'stderr') {
        streamPrefix = `\x1b[31;1m[ERR]\x1b[0m \x1b[31m${log.line}\x1b[0m`
      } else if (log.stream === 'system') {
        streamPrefix = `\x1b[36;1m[SYS]\x1b[0m \x1b[36m${log.line}\x1b[0m`
      } else {
        streamPrefix = `\x1b[32m[OUT]\x1b[0m ${log.line}`
      }

      term.writeln(`${timeStr} ${streamPrefix}`)
    }

    renderedCountRef.current = logs.length

    if (autoScroll) {
      term.scrollToBottom()
    }
  }, [logs, autoScroll])

  const handleClear = () => {
    termRef.current?.clear()
    renderedCountRef.current = logs.length
  }

  const handleCopy = () => {
    const fullText = logs.map((l) => `[${new Date(l.ts).toLocaleTimeString()}] [${l.stream.toUpperCase()}] ${l.line}`).join('\n')
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col rounded-xl overflow-hidden border border-neutral-800 bg-[#090d16] shadow-xl">
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900/90 border-b border-neutral-800 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-[11px] font-mono text-neutral-400 font-semibold ml-2">Terminal Logs</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400">
            {logs.length} linhas
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              autoScroll ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30' : 'text-neutral-400 hover:text-white'
            }`}
            title="Auto-rolar para novas mensagens"
          >
            <ArrowDown size={12} />
            <span>Auto-Scroll</span>
          </button>

          <button
            onClick={handleCopy}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title="Copiar todos os logs"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>

          <button
            onClick={handleClear}
            className="p-1 rounded text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 transition-colors"
            title="Limpar terminal"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div ref={containerRef} className={`w-full ${height} p-2`} />
    </div>
  )
}
