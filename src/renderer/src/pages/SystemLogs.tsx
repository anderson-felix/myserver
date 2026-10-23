import React, { useEffect, useState, useMemo } from 'react'
import {
  Terminal as TerminalIcon,
  Filter,
  Trash2,
  Download,
  RotateCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  BookOpen
} from 'lucide-react'
import { XtermViewer } from '../components/XtermViewer'
import { HelpDrawer } from '../components/HelpDrawer'
import { useToast } from '../components/Toast'
import type { SystemLogEntry, LogEvent } from '@shared/types'

const MODULE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todos os Módulos' },
  { value: 'watchdog', label: 'Watchdog (Saúde & Sensores)' },
  { value: 'caddy', label: 'Caddy (Reverse Proxy & SPA)' },
  { value: 'cloudflare', label: 'Cloudflared (Tunnels)' },
  { value: 'hardening', label: 'OS Hardening (Otimizador)' },
  { value: 'process', label: 'Process Manager (Runtimes)' },
  { value: 'ssh', label: 'Linux Nodes (SSH & Docker)' },
  { value: 'backup', label: 'Backup & Cloudflare R2' },
  { value: 'notifications', label: 'Notificações (Webhooks)' },
  { value: 'system', label: 'Sistema Central' }
]

const MODULE_COLORS: Record<string, string> = {
  watchdog: '\x1b[32m',
  caddy: '\x1b[36m',
  cloudflare: '\x1b[33m',
  hardening: '\x1b[35m',
  process: '\x1b[34m',
  ssh: '\x1b[92m',
  backup: '\x1b[96m',
  notifications: '\x1b[95m',
  system: '\x1b[90m'
}

export const SystemLogs: React.FC = () => {
  const [logs, setLogs] = useState<SystemLogEntry[]>([])
  const [selectedModule, setSelectedModule] = useState<string>('all')
  const [selectedLevel, setSelectedLevel] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const toast = useToast()

  const loadLogs = async () => {
    setLoading(true)
    try {
      const mod = selectedModule === 'all' ? undefined : selectedModule
      const data = await window.api.getSystemLogs({ module: mod, limit: 1000 })
      setLogs(data)
    } catch (err) {
      console.error('Falha ao ler logs do sistema:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()

    const unsub = window.api.onSystemLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry]
        if (next.length > 2000) {
          return next.slice(next.length - 2000)
        }
        return next
      })
    })

    return () => unsub()
  }, [selectedModule])

  const handleClear = async () => {
    const ok = await toast.confirm('Deseja limpar todos os logs do console do sistema?', {
      title: 'Limpar console',
      confirmLabel: 'Limpar logs',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.clearSystemLogs()
      setLogs([])
      toast.success('Console limpo')
    } catch (err) {
      toast.error('Erro ao limpar logs', (err as Error).message)
    }
  }

  const handleExport = () => {
    if (logs.length === 0) {
      toast.info('Nenhum log para exportar.')
      return
    }

    const lines = filteredLogs.map((l) => {
      const d = new Date(l.ts).toISOString()
      const meta = l.meta ? ` ${JSON.stringify(l.meta)}` : ''
      return `[${d}] [${l.level.toUpperCase()}] [${l.module}] ${l.message}${meta}`
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `myserver-system-logs-${new Date().toISOString().slice(0, 10)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (selectedModule !== 'all' && l.module !== selectedModule) return false
      if (selectedLevel !== 'all' && l.level !== selectedLevel) return false
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase()
        const text = `${l.message} ${l.module} ${l.level} ${l.meta ? JSON.stringify(l.meta) : ''}`.toLowerCase()
        if (!text.includes(term)) return false
      }
      return true
    })
  }, [logs, selectedModule, selectedLevel, searchTerm])

  // Converte SystemLogEntry para LogEvent com cores ANSI
  const xtermLogs: LogEvent[] = useMemo(() => {
    return filteredLogs.map((l) => {
      const modColor = MODULE_COLORS[l.module] || '\x1b[37m'
      const modTag = `${modColor}[${l.module.toUpperCase()}]\x1b[0m`
      let levelTag = '\x1b[32m[INFO]\x1b[0m'
      let stream: 'stdout' | 'stderr' | 'system' = 'stdout'

      if (l.level === 'error') {
        levelTag = '\x1b[31;1m[ERROR]\x1b[0m'
        stream = 'stderr'
      } else if (l.level === 'warn') {
        levelTag = '\x1b[33;1m[WARN]\x1b[0m'
      } else if (l.level === 'debug') {
        levelTag = '\x1b[90m[DEBUG]\x1b[0m'
      }

      const metaStr = l.meta && Object.keys(l.meta).length > 0
        ? ` \x1b[90m${JSON.stringify(l.meta)}\x1b[0m`
        : ''

      const formattedLine = `${levelTag} ${modTag} ${l.message}${metaStr}`

      return {
        projectId: l.module,
        stream,
        line: formattedLine,
        ts: l.ts
      }
    })
  }, [filteredLogs])

  // Contadores por nível
  const stats = useMemo(() => {
    let errCount = 0
    let warnCount = 0
    let infoCount = 0
    for (const l of logs) {
      if (l.level === 'error') errCount++
      else if (l.level === 'warn') warnCount++
      else infoCount++
    }
    return { errCount, warnCount, infoCount, total: logs.length }
  }, [logs])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <TerminalIcon size={22} className="text-emerald-400" />
            <span>Console do Sistema (Live Logs)</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Buffer circular das últimas 2.000 mensagens e eventos de todos os serviços centrais com streaming em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsHelpOpen(true)}
            className="px-3.5 py-1.5 rounded-xl bg-neutral-900 border border-emerald-500/30 hover:bg-neutral-800 text-emerald-300 text-xs font-medium flex items-center gap-1.5 transition-colors shadow-lg"
          >
            <BookOpen size={14} />
            <span>📖 Guia Rápido desta Tela</span>
          </button>
          <button
            onClick={loadLogs}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Recarregar"
          >
            <RotateCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Recarregar</span>
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-800/40 text-neutral-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
            title="Limpar todos os logs"
          >
            <Trash2 size={13} />
            <span>Limpar</span>
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-500/20"
          >
            <Download size={13} />
            <span>Exportar .log</span>
          </button>
        </div>
      </div>

      {/* Mini Estatísticas */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <Info size={14} className="text-cyan-400" />
            <span>Total em Memória</span>
          </div>
          <span className="font-mono text-sm font-bold text-white">{stats.total}</span>
        </div>

        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span>Info / Normal</span>
          </div>
          <span className="font-mono text-sm font-bold text-emerald-400">{stats.infoCount}</span>
        </div>

        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <AlertTriangle size={14} className="text-amber-400" />
            <span>Avisos (Warn)</span>
          </div>
          <span className="font-mono text-sm font-bold text-amber-400">{stats.warnCount}</span>
        </div>

        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <XCircle size={14} className="text-rose-400" />
            <span>Erros (Error)</span>
          </div>
          <span className="font-mono text-sm font-bold text-rose-400">{stats.errCount}</span>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="glass-panel p-3.5 rounded-2xl border border-neutral-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Módulo */}
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-neutral-400" />
            <select
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
            >
              {MODULE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Severidade */}
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">Todas as Severidades</option>
            <option value="info">Apenas Info</option>
            <option value="warn">Avisos (Warn)</option>
            <option value="error">Erros (Error)</option>
            <option value="debug">Debug</option>
          </select>

          {/* Busca textual */}
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="absolute left-3 top-2.5 text-neutral-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filtrar por mensagem ou JSON..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="text-[11px] font-mono text-neutral-400">
          Exibindo <span className="text-white font-bold">{filteredLogs.length}</span> de{' '}
          <span className="text-white font-bold">{logs.length}</span> eventos
        </div>
      </div>

      {/* Terminal Xterm de Alta Performance */}
      <div className="glass-panel p-3 rounded-2xl border border-neutral-800">
        <XtermViewer logs={xtermLogs} projectId={`system-${selectedModule}`} height="h-[520px]" />
      </div>

      {/* Slide-over Help Drawer */}
      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="Guia Rápido: Console e Logs do Sistema"
        description="Monitore a saída de diagnóstico unificada em tempo real de todos os subsistemas do MyServer Orchestrator."
        steps={[
          {
            title: '1. Buffer Circular em Memória (2.000 Eventos)',
            description: 'Os logs são mantidos em uma fila circular em memória RAM, sem causar I/O excessivo ou desgaste no seu disco SSD/HD.'
          },
          {
            title: '2. Níveis de Log e Cores ANSI',
            description: '• Verde [INFO]: Operações normais e requisições bem-sucedidas.\n• Amarelo [WARN]: Avisos de consumo alto ou contingências.\n• Vermelho [ERROR]: Falhas de conexão, falhas de spawn ou erros de runtime.\n• Cinza [DEBUG]: Detalhes técnicos e payloads de IPC.'
          },
          {
            title: '3. Filtragem por Módulo e Busca Instantânea',
            description: 'Selecione um subsistema específico (ex: watchdog, caddy, cloudflare, backup) no seletor acima ou digite palavras-chave no campo de busca para isolar erros rapidamente.'
          },
          {
            title: '4. Exportação para Arquivo .log',
            description: 'Clique no botão verde "Exportar .log" para baixar um snapshot textual completo dos logs filtrados para análise offline ou compartilhamento com seu time.'
          }
        ]}
        tips={[
          'Você pode pausar a rolagem simplesmente clicando ou selecionando texto dentro da janela do terminal Xterm.',
          'Clique em "Limpar" para zerar o buffer visual da sessão atual sem afetar a integridade do banco SQLite de histórico.'
        ]}
      />
    </div>
  )
}
