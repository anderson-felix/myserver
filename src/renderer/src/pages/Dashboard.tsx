import React, { useEffect, useState } from 'react'
import {
  Cpu,
  Thermometer,
  HardDrive,
  Activity,
  Battery,
  BatteryCharging,
  Wifi,
  Server,
  ShieldCheck,
  RefreshCw,
  Rocket,
  CheckCircle2,
  Circle,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { MetricCard } from '../components/MetricCard'
import { Badge } from '../components/Badge'
import { HelpDrawer } from '../components/HelpDrawer'
import { InfoTooltip } from '../components/InfoTooltip'
import type { Telemetry, Project, ProxyStatus, TunnelStatus, Incident, AppSettings, SystemInfo } from '@shared/types'

interface DashboardProps {
  onNavigate?: (tab: 'dashboard' | 'projects' | 'networking' | 'optimizer' | 'alerts' | 'linux' | 'logs') => void
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null)
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [isJourneyCollapsed, setIsJourneyCollapsed] = useState(false)

  const loadStaticAndInitial = async () => {
    try {
      const [s, info, inc] = await Promise.all([
        window.api.getSettings(),
        window.api.getInfo(),
        window.api.listIncidents(10)
      ])
      setSettings(s)
      setSysInfo(info)
      setIncidents(inc)
    } catch (err) {
      console.error('Falha ao carregar dados estáticos iniciais:', err)
    }
  }

  const pollDynamic = async () => {
    try {
      const [t, p, px, tun] = await Promise.all([
        window.api.getTelemetry(),
        window.api.listProjects(),
        window.api.getProxyStatus(),
        window.api.getTunnelStatus()
      ])
      setTelemetry(t)
      setProjects(p)
      setProxyStatus(px)
      setTunnelStatus(tun)
    } catch (err) {
      console.error('Falha ao carregar telemetria dinâmica:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    let timerId: ReturnType<typeof setTimeout> | null = null

    loadStaticAndInitial()

    const runPoll = async () => {
      if (!active) return

      if (!document.hidden) {
        await pollDynamic()
      }

      if (active) {
        timerId = setTimeout(runPoll, 5000)
      }
    }

    runPoll()

    const handleVisibilityChange = () => {
      if (!document.hidden && active) {
        pollDynamic()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const unsubIncidents = window.api.onNewIncident((newInc) => {
      setIncidents((prev) => [newInc, ...prev.slice(0, 9)])
    })

    return () => {
      active = false
      if (timerId) clearTimeout(timerId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      unsubIncidents()
    }
  }, [])

  if (loading && !telemetry) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="animate-spin text-emerald-400" size={32} />
          <span className="text-xs text-neutral-400">Coletando telemetria em tempo real...</span>
        </div>
      </div>
    )
  }

  const runningProjects = projects.filter((p) => p.status === 'running')
  const totalRamGb = telemetry ? (telemetry.memory.total / (1024 ** 3)).toFixed(1) : '0'
  const usedRamGb = telemetry ? (telemetry.memory.used / (1024 ** 3)).toFixed(1) : '0'
  const primaryDisk = telemetry?.disks[0]
  const cpuTemp = telemetry?.cpu.temperature

  // UPS / Battery formatting
  const batt = telemetry?.battery
  const isUpsActive = batt?.hasBattery
  const battTone = !batt?.acConnected ? 'amber' : batt?.percent && batt.percent <= 20 ? 'rose' : 'emerald'

  // Avaliação dos 5 Passos da Jornada Quick-Start
  const step1Hardening = Boolean(sysInfo?.runnerConfigured || settings?.hardening.lastRunAt)
  const step2Alerts = Boolean(
    settings?.notifications.discordWebhookSet ||
    settings?.notifications.teamsWebhookSet ||
    settings?.notifications.slackWebhookSet ||
    settings?.notifications.telegramBotTokenSet
  )
  const step3Projects = projects.length > 0
  const step4Tunnel = Boolean(
    tunnelStatus?.quick.some((q) => q.status === 'online') || tunnelStatus?.named.installed
  )
  const step5Backup = Boolean(settings?.backup.passphraseSet || settings?.backup.s3.enabled)

  const steps = [
    {
      id: 1,
      title: '1. Blindar Sistema Operacional (1-Clique)',
      description: 'Otimiza energia, desativa suspensão ao fechar a tampa e cria isolamento de segurança.',
      completed: step1Hardening,
      actionLabel: 'Ir para Otimizador',
      targetTab: 'optimizer' as const
    },
    {
      id: 2,
      title: '2. Conectar um Canal de Alerta Gratuito',
      description: 'Receba avisos instantâneos de CPU, bateria, energia e auto-healing (Discord/Teams/Slack/Telegram).',
      completed: step2Alerts,
      actionLabel: 'Configurar Alertas',
      targetTab: 'alerts' as const
    },
    {
      id: 3,
      title: '3. Publicar sua Primeira API ou Front-end',
      description: 'Hospede APIs Node/Python ou Front-end React/Vite com proxy reverso e SPA routing no Caddy.',
      completed: step3Projects,
      actionLabel: 'Criar Projeto',
      targetTab: 'projects' as const
    },
    {
      id: 4,
      title: '4. Expor na Internet sem Abrir Portas no Roteador',
      description: 'Gere uma URL HTTPS pública via Cloudflare Tunnel furando CGNAT sem tocar no modem.',
      completed: step4Tunnel,
      actionLabel: 'Configurar Tunnels',
      targetTab: 'networking' as const
    },
    {
      id: 5,
      title: '5. Ativar Backup Criptografado Automático',
      description: 'Garanta sincronização diária e criptografia AES-256 para nuvem S3 / Cloudflare R2.',
      completed: step5Backup,
      actionLabel: 'Configurar Backup',
      targetTab: 'alerts' as const
    }
  ]

  const completedCount = steps.filter((s) => s.completed).length
  const progressPercent = Math.round((completedCount / steps.length) * 100)

  return (
    <div className="space-y-6">
      {/* Header com Botão Guia Rápido */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Painel de Monitoramento</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Telemetria em tempo real de hardware, no-break integrado, proxy Caddy e túneis de rede.
          </p>
        </div>

        <button
          onClick={() => setIsGuideOpen(true)}
          className="px-3.5 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
        >
          <BookOpen size={14} className="text-emerald-400" />
          <span>Guia Rápido desta Tela</span>
        </button>
      </div>

      {/* Card: Jornada de Configuração do seu Servidor (Quick-Start) */}
      <div className="glass-panel rounded-2xl p-5 border border-emerald-500/20 bg-gradient-to-br from-emerald-950/20 via-neutral-900/60 to-neutral-950/80 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-md shadow-emerald-500/10">
              <Rocket size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Jornada de Configuração do seu Servidor (Quick-Start)</h3>
                <InfoTooltip
                  title="Checklist de Produção"
                  description="Acompanha em tempo real o nível de prontidão da sua infraestrutura para receber tráfego com segurança e estabilidade."
                  recommendation="Conclua os 5 passos para garantir alta disponibilidade, alertas em caso de queda e backups seguros."
                />
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {completedCount} de {steps.length} concluídos ({progressPercent}%)
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Siga os 5 passos essenciais para transformar sua máquina em um servidor de produção blindado.
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsJourneyCollapsed(!isJourneyCollapsed)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title={isJourneyCollapsed ? 'Expandir' : 'Recolher'}
          >
            {isJourneyCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>

        {/* Barra de Progresso */}
        <div className="w-full bg-neutral-950 rounded-full h-2 overflow-hidden border border-neutral-800/80">
          <div
            className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-2 rounded-full transition-all duration-500 shadow-sm shadow-emerald-500/40"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Lista dos 5 Passos */}
        {!isJourneyCollapsed && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
            {steps.map((st) => (
              <div
                key={st.id}
                className={`p-3 rounded-xl border flex flex-col justify-between transition-all ${
                  st.completed
                    ? 'bg-neutral-900/50 border-emerald-500/30 text-neutral-300'
                    : 'bg-neutral-950/60 border-neutral-800/80 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-400">
                      Passo {st.id}
                    </span>
                    {st.completed ? (
                      <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 font-bold">
                        <CheckCircle2 size={12} /> Feito
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400/80">
                        <Circle size={10} /> Pendente
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-white mb-1 leading-snug">{st.title.replace(/^\d+\.\s*/, '')}</h4>
                  <p className="text-[11px] text-neutral-400 leading-relaxed line-clamp-3">{st.description}</p>
                </div>

                <div className="pt-3 mt-2 border-t border-neutral-800/60">
                  <button
                    type="button"
                    onClick={() => onNavigate && onNavigate(st.targetTab)}
                    className={`w-full py-1.5 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
                      st.completed
                        ? 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold'
                    }`}
                  >
                    <span>{st.actionLabel}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Banner: UPS Warning if on battery */}
      {isUpsActive && !batt.acConnected && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <Battery className="text-amber-400 shrink-0" size={24} />
            <div>
              <p className="text-sm font-bold text-amber-300">Modo No-Break Ativo (Queda de Energia!)</p>
              <p className="text-xs text-amber-400/90 mt-0.5">
                O servidor está operando na bateria interna ({batt.percent}% restantes). Desligamento automático de proteção configurado para ≤ 15%.
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-xs font-mono font-bold text-amber-300">
            {batt.timeRemaining ? `~${batt.timeRemaining} min restantes` : 'Na bateria'}
          </span>
        </div>
      )}

      {/* Grid de Métricas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <MetricCard
          title="Processador (CPU)"
          value={`${telemetry?.cpu.loadPercent ?? 0}%`}
          subvalue={telemetry?.cpu.model ? `${telemetry.cpu.cores} núcleos` : undefined}
          icon={Cpu}
          percent={telemetry?.cpu.loadPercent}
          tone={
            (telemetry?.cpu.loadPercent ?? 0) > 85
              ? 'rose'
              : (telemetry?.cpu.loadPercent ?? 0) > 60
              ? 'amber'
              : 'emerald'
          }
          badge={`${telemetry?.cpu.speedGhz.toFixed(1)} GHz`}
        />

        {/* RAM */}
        <MetricCard
          title="Memória RAM"
          value={`${telemetry?.memory.percent ?? 0}%`}
          subvalue={`${usedRamGb} / ${totalRamGb} GB`}
          icon={Activity}
          percent={telemetry?.memory.percent}
          tone={
            (telemetry?.memory.percent ?? 0) > 90
              ? 'rose'
              : (telemetry?.memory.percent ?? 0) > 75
              ? 'amber'
              : 'cyan'
          }
          badge="DDR"
        />

        {/* Temperatura */}
        <MetricCard
          title="Temperatura CPU"
          value={cpuTemp ? `${cpuTemp}°C` : 'Sensor N/D na BIOS'}
          subvalue={cpuTemp ? (cpuTemp > 80 ? 'Alerta Térmico' : 'Temperatura Operacional') : 'Sem leitura ACPI térmica'}
          icon={Thermometer}
          percent={cpuTemp ? Math.min(100, (cpuTemp / 95) * 100) : 0}
          tone={!cpuTemp ? 'neutral' : cpuTemp >= 85 ? 'rose' : cpuTemp >= 70 ? 'amber' : 'emerald'}
          badge={cpuTemp ? (cpuTemp >= 85 ? 'Crítico' : 'Normal') : 'BIOS N/D'}
        />

        {/* Bateria / No-Break */}
        <MetricCard
          title={isUpsActive ? 'No-Break / Bateria' : 'Alimentação'}
          value={isUpsActive ? `${batt?.percent}%` : 'Rede Elétrica'}
          subvalue={
            isUpsActive
              ? batt?.isCharging
                ? 'Carregando na tomada'
                : batt?.acConnected
                ? 'Tomada conectada'
                : 'Operando na bateria'
              : 'Desktop (Sem bateria)'
          }
          icon={batt?.isCharging ? BatteryCharging : Battery}
          percent={isUpsActive ? batt?.percent : 100}
          tone={battTone}
          badge={isUpsActive ? (batt?.acConnected ? 'AC Online' : 'Na Bateria') : 'Tomada'}
        />
      </div>

      {/* Linha Secundária: Disco & Rede & Status de Orquestração */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Armazenamento */}
        <div className="glass-panel rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-cyan-400">
                <HardDrive size={18} />
              </div>
              <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Armazenamento</span>
            </div>
            {primaryDisk && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400">
                {primaryDisk.mount}
              </span>
            )}
          </div>

          {primaryDisk ? (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold font-mono text-white">
                  {(primaryDisk.used / (1024 ** 3)).toFixed(1)} GB
                </span>
                <span className="text-xs text-neutral-400">
                  de {(primaryDisk.size / (1024 ** 3)).toFixed(1)} GB ({primaryDisk.percent}%)
                </span>
              </div>
              <div className="mt-2 w-full bg-neutral-900 h-1.5 rounded-full overflow-hidden border border-neutral-800">
                <div
                  className="h-full bg-cyan-500 rounded-full"
                  style={{ width: `${primaryDisk.percent}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">Disco principal não identificado.</p>
          )}
        </div>

        {/* Rede Local */}
        <div className="glass-panel rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-emerald-400">
                <Wifi size={18} />
              </div>
              <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Rede Local (LAN)</span>
            </div>
            {telemetry?.network && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-800 text-emerald-400">
                {telemetry.network.iface}
              </span>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold font-mono text-white">
                {telemetry?.network?.ip4 || '127.0.0.1'}
              </span>
              <span className="text-xs text-neutral-400">
                Gateway: {telemetry?.network?.gateway || 'N/A'}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-400 font-mono">
              <span>↓ {((telemetry?.network?.rxSec ?? 0) / 1024).toFixed(1)} KB/s</span>
              <span>↑ {((telemetry?.network?.txSec ?? 0) / 1024).toFixed(1)} KB/s</span>
            </div>
          </div>
        </div>

        {/* Status de Orquestração */}
        <div className="glass-panel rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-indigo-400">
                <Server size={18} />
              </div>
              <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Orquestrador</span>
            </div>
            <Badge status={runningProjects.length > 0 ? 'running' : 'idle'} label={`${runningProjects.length} ativas`} />
          </div>

          <div className="space-y-1.5 text-xs text-neutral-300">
            <div className="flex items-center justify-between">
              <span className="text-neutral-400">Caddy Proxy:</span>
              <span className="font-mono text-emerald-400">
                {proxyStatus?.running ? `Online (Porta ${proxyStatus.httpPort})` : 'Offline'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-400">Cloudflare Tunnel:</span>
              <span className="font-mono text-cyan-400">
                {tunnelStatus?.named.installed
                  ? 'Named Tunnel Ativo'
                  : tunnelStatus?.quick.length
                  ? `${tunnelStatus.quick.length} Quick Tunnel(s)`
                  : 'Desativado'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Histórico Recente de Incidentes e Eventos */}
      <div className="glass-panel rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Eventos do Watchdog & Notificações Recentes</h3>
          </div>
          <button
            onClick={() => window.api.clearIncidents().then(() => setIncidents([]))}
            className="text-xs text-neutral-400 hover:text-white transition-colors"
          >
            Limpar Histórico
          </button>
        </div>

        {incidents.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-500">
            Nenhum incidente registrado até o momento. Todos os sistemas operando normalmente.
          </div>
        ) : (
          <div className="divide-y divide-neutral-800/60">
            {incidents.map((inc) => (
              <div key={inc.id} className="py-2.5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <Badge status={inc.severity} label={inc.severity.toUpperCase()} size="sm" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">{inc.title}</p>
                    <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">{inc.message}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[11px] font-mono text-neutral-500 block">
                    {new Date(inc.ts).toLocaleTimeString()}
                  </span>
                  {inc.delivered && (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      via {inc.delivered}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gaveta de Mini-Documentação: Guia do Dashboard */}
      <HelpDrawer
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        title="Guia do Servidor & Telemetria"
        badge="Dashboard"
        subtitle="Entenda como funcionam os sensores de telemetria, o modo no-break e o auto-healing."
        sections={[
          {
            title: 'Jornada de Configuração do Servidor',
            steps: [
              'O card de Quick-Start no topo do painel acompanha seu progresso em tempo real.',
              'Os 5 pilares cobrem: Blindagem do Windows, Alertas, Criação de Projetos, Cloudflare Tunnel e Backup AES-256.',
              'Clique no botão de qualquer passo pendente para navegar diretamente à tela correspondente.'
            ],
            tip: 'Após concluir os 5 passos, seu servidor estará em padrão de produção corporativa sem gastar R$ 1,00 em cloud.'
          },
          {
            title: 'Modo No-Break Integrado (Laptop UPS)',
            steps: [
              'Se o servidor estiver rodando em um notebook antigo, a bateria interna atua como um no-break profissional.',
              'Ao detectar corte de energia da tomada (AC Offline), o sistema entra no Modo No-Break e dispara um alerta de incidente.',
              'Caso a bateria chegue ao limiar crítico (padrão ≤ 15%), o MyServer realiza um desligamento seguro automático para evitar corrupção de dados.'
            ],
            tip: 'Notebooks antigos com tela trincada ou teclado quebrado são ideais para servidores caseiros pois já vêm com no-break de fábrica.'
          },
          {
            title: 'Auto-Healing & Watchdog',
            steps: [
              'O Watchdog checa a cada poucos segundos o status de vida (heartbeat) de cada aplicação cadastrada.',
              'Se uma API travar (memory leak ou unhandled rejection), o processo é finalizado e reiniciado em milissegundos.',
              'Todos os disparos de auto-recuperação são registrados no histórico abaixo e enviados aos seus canais de webhook.'
            ]
          }
        ]}
      />
    </div>
  )
}
