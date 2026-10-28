import React, { useEffect, useState } from 'react'
import {
  Globe,
  Copy,
  Check,
  ExternalLink,
  Square,
  Plus,
  RefreshCw,
  QrCode,
  Key,
  Layers,
  ArrowRight,
  BookOpen,
  Sparkles,
  ShieldCheck,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  Network,
  Zap,
  Compass
} from 'lucide-react'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { HelpDrawer } from '../components/HelpDrawer'
import { InfoTooltip } from '../components/InfoTooltip'
import { useToast } from '../components/Toast'
import {
  REGISTRAR_META,
  CONNECTION_MODE_META,
  suggestRegistrar,
  suggestConnectionMode,
  normalizeHostname,
  isValidHostname
} from '@shared/domains'
import type {
  ProxyStatus,
  TunnelStatus,
  QuickTunnel,
  Project,
  DomainRecord,
  DomainInput,
  DomainRegistrar,
  DomainConnectionMode,
  DomainDnsVerification,
  NetworkEndpoints,
  CloudflareAutoDnsResult
} from '@shared/types'

export const Networking: React.FC = () => {
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null)
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [domains, setDomains] = useState<DomainRecord[]>([])
  const [endpoints, setEndpoints] = useState<NetworkEndpoints | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [loadingEndpoints, setLoadingEndpoints] = useState(false)
  const toast = useToast()

  // Quick Tunnel Modal
  const [isQuickModalOpen, setIsQuickModalOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [customPort, setCustomPort] = useState<number>(3001)
  const [startingQuick, setStartingQuick] = useState(false)
  const [activeQrModalTunnel, setActiveQrModalTunnel] = useState<QuickTunnel | null>(null)

  // Named Tunnel
  const [namedToken, setNamedToken] = useState('')
  const [configuringNamed, setConfiguringNamed] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Domínios - Modal de Criação / Edição
  const [isDomainModalOpen, setIsDomainModalOpen] = useState(false)
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null)
  const [formDomain, setFormDomain] = useState('')
  const [formRegistrar, setFormRegistrar] = useState<DomainRegistrar>('registrobr')
  const [formConnectionMode, setFormConnectionMode] = useState<DomainConnectionMode>('cloudflare_tunnel')
  const [formTargetProjectId, setFormTargetProjectId] = useState<string>('')
  const [formSubdomains, setFormSubdomains] = useState<
    Array<{ id?: string; subdomain: string; projectId: string | null; targetPort?: number | null }>
  >([])
  const [formNotes, setFormNotes] = useState('')
  const [savingDomain, setSavingDomain] = useState(false)

  // Domínios - Modal de Instruções DNS
  const [instructionsDomain, setInstructionsDomain] = useState<DomainRecord | null>(null)
  const [cfApiTokenInput, setCfApiTokenInput] = useState('')
  const [autoDnsLoading, setAutoDnsLoading] = useState(false)
  const [autoDnsResult, setAutoDnsResult] = useState<CloudflareAutoDnsResult | null>(null)

  // Domínios - Modal de Diagnóstico / Verificação
  const [verificationResult, setVerificationResult] = useState<DomainDnsVerification | null>(null)
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(null)

  const loadData = async (forceEndpoints = false) => {
    try {
      if (forceEndpoints) setLoadingEndpoints(true)
      const [px, tun, prjs, doms, net] = await Promise.all([
        window.api.getProxyStatus(),
        window.api.getTunnelStatus(),
        window.api.listProjects(),
        window.api.listDomains(),
        window.api.getNetworkEndpoints(forceEndpoints)
      ])
      setProxyStatus(px)
      setTunnelStatus(tun)
      setProjects(prjs)
      setDomains(doms)
      setEndpoints(net)

      if (prjs.length > 0 && !selectedProjectId) {
        setSelectedProjectId(prjs[0].id)
      }

      // Preenche o campo namedToken com o token salvo se o usuário ainda não estiver digitando
      if (tun.named.namedToken && !namedToken) {
        setNamedToken(tun.named.namedToken)
      }
    } catch (err) {
      console.error('Falha ao carregar status de rede:', err)
    } finally {
      if (forceEndpoints) setLoadingEndpoints(false)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(() => {
      if (!document.hidden) loadData()
    }, 4000)

    const unsubTunnel = window.api.onTunnelUpdate(() => {
      loadData()
    })

    return () => {
      clearInterval(interval)
      unsubTunnel()
    }
  }, [])

  const copyText = (id: string, text: string, successMsg?: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    if (successMsg) toast.info('Copiado', successMsg)
  }

  // Quick Tunnel
  const handleStartQuick = async (e: React.FormEvent) => {
    e.preventDefault()
    setStartingQuick(true)
    try {
      let targetPort = customPort
      let projName = ''
      if (selectedProjectId) {
        const found = projects.find((p) => p.id === selectedProjectId)
        if (found && found.port) {
          targetPort = found.port
          projName = found.name
        }
      }

      await window.api.startQuickTunnel(targetPort, selectedProjectId || undefined, projName ? `Túnel para ${projName}` : undefined)
      setIsQuickModalOpen(false)
      loadData()
    } catch (err) {
      toast.error('Falha ao disparar Quick Tunnel', (err as Error).message)
    } finally {
      setStartingQuick(false)
    }
  }

  const handleStopQuick = async (id: string) => {
    try {
      await window.api.stopQuickTunnel(id)
      loadData()
    } catch (err) {
      toast.error('Falha ao parar túnel', (err as Error).message)
    }
  }

  // Named Tunnel
  const handleConfigureNamed = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!namedToken.trim()) return
    setConfiguringNamed(true)
    try {
      await window.api.configureNamedTunnel(namedToken)
      toast.success('Túnel permanente ativo', 'Serviço Cloudflared instalado e sincronizado.')
      loadData()
    } catch (err) {
      toast.error('Erro ao configurar Named Tunnel', (err as Error).message)
    } finally {
      setConfiguringNamed(false)
    }
  }

  const handleUninstallNamed = async () => {
    const ok = await toast.confirm('Deseja desinstalar o serviço permanente do Cloudflare?', {
      title: 'Desinstalar Named Tunnel',
      confirmLabel: 'Desinstalar',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.uninstallNamedTunnel()
      toast.success('Serviço Cloudflared desinstalado')
      loadData()
    } catch (err) {
      toast.error('Erro ao desinstalar', (err as Error).message)
    }
  }

  const handleSyncProxy = async () => {
    try {
      await window.api.syncProxyRoutes()
      toast.success('Rotas do Caddy sincronizadas')
      loadData()
    } catch (err) {
      toast.error('Falha ao sincronizar', (err as Error).message)
    }
  }

  // =========================================================================
  // Handlers da Central de Domínios
  // =========================================================================
  const openCreateDomainModal = () => {
    setEditingDomainId(null)
    setFormDomain('')
    setFormRegistrar('registrobr')
    setFormConnectionMode('cloudflare_tunnel')
    setFormTargetProjectId(projects[0]?.id || '')
    setFormSubdomains([])
    setFormNotes('')
    setIsDomainModalOpen(true)
  }

  const openEditDomainModal = (d: DomainRecord) => {
    setEditingDomainId(d.id)
    setFormDomain(d.domain)
    setFormRegistrar(d.registrar)
    setFormConnectionMode(d.connectionMode)
    setFormTargetProjectId(d.targetProjectId || '')
    setFormSubdomains(
      d.subdomains.map((s) => ({
        id: s.id,
        subdomain: s.subdomain,
        projectId: s.projectId,
        targetPort: s.targetPort
      }))
    )
    setFormNotes(d.notes || '')
    setIsDomainModalOpen(true)
  }

  const handleDomainInputChange = (val: string) => {
    setFormDomain(val)
    if (!editingDomainId) {
      const clean = normalizeHostname(val)
      setFormRegistrar(suggestRegistrar(clean))
      setFormConnectionMode(suggestConnectionMode(clean))
    }
  }

  const handleAddSubdomainQuick = (sub: string) => {
    if (formSubdomains.some((s) => s.subdomain.toLowerCase() === sub.toLowerCase())) return
    setFormSubdomains([
      ...formSubdomains,
      {
        subdomain: sub,
        projectId: projects[0]?.id || null,
        targetPort: null
      }
    ])
  }

  const handleAddCustomSubdomain = () => {
    setFormSubdomains([
      ...formSubdomains,
      {
        subdomain: '',
        projectId: projects[0]?.id || null,
        targetPort: null
      }
    ])
  }

  const handleSaveDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanDomain = normalizeHostname(formDomain)
    if (!isValidHostname(cleanDomain)) {
      toast.error('Domínio inválido', 'Digite um domínio válido (ex: minhaempresa.com.br ou app.localhost).')
      return
    }

    setSavingDomain(true)
    try {
      const input: DomainInput = {
        id: editingDomainId || undefined,
        domain: cleanDomain,
        registrar: formRegistrar,
        connectionMode: formConnectionMode,
        targetProjectId: formTargetProjectId || null,
        subdomains: formSubdomains
          .filter((s) => s.subdomain.trim().length > 0)
          .map((s) => ({
            id: s.id,
            subdomain: s.subdomain.trim(),
            projectId: s.projectId || null,
            targetPort: s.targetPort || null
          })),
        notes: formNotes
      }

      await window.api.saveDomain(input)
      toast.success(editingDomainId ? 'Domínio atualizado!' : 'Domínio configurado com sucesso!')
      setIsDomainModalOpen(false)
      loadData()
    } catch (err) {
      toast.error('Falha ao salvar domínio', (err as Error).message)
    } finally {
      setSavingDomain(false)
    }
  }

  const handleDeleteDomain = async (id: string, name: string) => {
    const ok = await toast.confirm(`Deseja remover o domínio "${name}" da Central de Domínios?`, {
      title: 'Remover Domínio',
      confirmLabel: 'Remover',
      danger: true
    })
    if (!ok) return

    try {
      await window.api.deleteDomain(id)
      toast.success('Domínio removido')
      loadData()
    } catch (err) {
      toast.error('Falha ao remover', (err as Error).message)
    }
  }

  const handleVerifyDns = async (id: string) => {
    setVerifyingDomainId(id)
    try {
      const res = await window.api.verifyDomainDns(id)
      setVerificationResult(res)
      loadData()
    } catch (err) {
      toast.error('Erro na verificação de DNS', (err as Error).message)
    } finally {
      setVerifyingDomainId(null)
    }
  }

  const handleApplyHosts = async (id: string, domainName: string) => {
    try {
      await window.api.applyDomainHosts(id)
      toast.success('Ativado no Windows Hosts', `As entradas para ${domainName} foram gravadas no sistema.`)
      loadData()
    } catch (err) {
      toast.error('Falha ao atualizar hosts', (err as Error).message)
    }
  }

  const handleAutoConfigureCloudflare = async (domainId: string) => {
    setAutoDnsLoading(true)
    setAutoDnsResult(null)
    try {
      const res = await window.api.autoConfigureCloudflareDns(domainId, cfApiTokenInput.trim() || undefined)
      setAutoDnsResult(res)
      toast.success('Automação Cloudflare concluída', 'CNAMEs e ingress do túnel foram atualizados com sucesso.')
      loadData()
    } catch (err) {
      toast.error('Falha na automação Cloudflare', (err as Error).message)
    } finally {
      setAutoDnsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header da Tela */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Roteamento, Domínios & Exposição Web</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Gerencie seus domínios próprios (Registro.br, GoDaddy, Cloudflare, etc.), Proxy Reverso Caddy e Túneis Cloudflare.
          </p>
        </div>
        <button
          onClick={() => setIsHelpOpen(true)}
          className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-cyan-300 font-medium text-xs flex items-center gap-2 border border-cyan-500/30 transition-colors shadow-lg"
        >
          <BookOpen size={14} />
          <span>📖 Guia Rápido desta Tela</span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* SEÇÃO PRINCIPAL: CENTRAL DE DOMÍNIOS PRÓPRIOS */}
      {/* ===================================================================== */}
      <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-cyan-400">
              <Compass size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Meus Domínios Próprios</h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/60 text-cyan-300 border border-cyan-500/30">
                  Registro.br · GoDaddy · Cloudflare & Local
                </span>
                <InfoTooltip
                  title="Central de Domínios"
                  description="Cadastre domínios que você comprou em qualquer provedor. O MyServer gera as tabelas de DNS exatas para copiar e colar no painel dele, ou configura via Túnel Cloudflare sem abrir portas no roteador."
                />
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Vincule domínios e subdomínios (api., app.) diretamente aos seus projetos locais com HTTPS automático.
              </p>
            </div>
          </div>

          <button
            onClick={openCreateDomainModal}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-neutral-950 font-bold text-xs flex items-center gap-2 transition-all shadow-lg shadow-cyan-500/20"
          >
            <Plus size={16} />
            <span>+ Configurar Meu Domínio</span>
          </button>
        </div>

        {/* Barra de Diagnóstico de Rede / Endpoints */}
        <div className="p-3.5 rounded-xl bg-neutral-900/70 border border-neutral-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-cyan-400" />
              <span className="text-neutral-400">IP Público:</span>
              <span className="font-mono text-white font-semibold">{endpoints?.publicIp || 'Não detectado'}</span>
            </div>

            <div className="flex items-center gap-2">
              <Network size={14} className="text-indigo-400" />
              <span className="text-neutral-400">IP Local (LAN):</span>
              <span className="font-mono text-white font-semibold">{endpoints?.lanIp || '127.0.0.1'}</span>
            </div>

            <div className="flex items-center gap-2">
              <Server size={14} className="text-emerald-400" />
              <span className="text-neutral-400">Porta Caddy:</span>
              <span className="font-mono text-emerald-300 font-semibold">:{endpoints?.caddyHttpPort || 80}</span>
            </div>

            {endpoints?.tunnelCname && (
              <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-lg border border-neutral-800">
                <ShieldCheck size={13} className="text-cyan-400" />
                <span className="text-neutral-400 text-[11px]">CNAME Túnel:</span>
                <span className="font-mono text-[11px] text-cyan-300">{endpoints.tunnelCname}</span>
                <button
                  onClick={() => copyText('endpoints_cname', endpoints.tunnelCname!, 'CNAME do túnel copiado!')}
                  className="p-0.5 text-neutral-400 hover:text-white"
                  title="Copiar CNAME"
                >
                  {copiedId === 'endpoints_cname' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => loadData(true)}
            disabled={loadingEndpoints}
            className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loadingEndpoints ? 'animate-spin' : ''} />
            <span>Atualizar IP</span>
          </button>
        </div>

        {/* Lista de Domínios Cadastrados */}
        {domains.length === 0 ? (
          <div className="p-8 rounded-2xl bg-neutral-900/30 border border-neutral-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-950/40 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto">
              <Globe size={24} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Nenhum Domínio Próprio Cadastrado</h4>
              <p className="text-xs text-neutral-400 max-w-md mx-auto mt-1">
                Comprou um domínio no <strong>Registro.br</strong>, <strong>GoDaddy</strong> ou <strong>Cloudflare</strong>?
                Clique no botão acima para configurá-lo de forma guiada com passo a passo ilustrado e cópia de DNS em 1 clique!
              </p>
            </div>
            <button
              onClick={openCreateDomainModal}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-semibold text-xs inline-flex items-center gap-2 transition-all shadow-md"
            >
              <Plus size={15} />
              <span>Configurar Primeiro Domínio</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {domains.map((d) => {
              const regMeta = REGISTRAR_META[d.registrar]
              const modeMeta = CONNECTION_MODE_META[d.connectionMode]
              const targetProj = projects.find((p) => p.id === d.targetProjectId)

              return (
                <div
                  key={d.id}
                  className="p-5 rounded-2xl bg-neutral-900/80 border border-neutral-800 hover:border-neutral-700 transition-all space-y-4 shadow-xl"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="text-2xl p-2 rounded-xl bg-neutral-950 border border-neutral-800">{regMeta.emoji}</div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-bold text-white tracking-wide font-mono">{d.domain}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700">
                            {regMeta.label}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-950/60 text-indigo-300 border border-indigo-500/30">
                            {modeMeta.short}
                          </span>
                          {d.dnsVerified ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                              <CheckCircle2 size={11} /> DNS OK
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                              <AlertTriangle size={11} /> Aguardando DNS
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                              d.sslStatus === 'active'
                                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
                                : d.sslStatus === 'error'
                                ? 'bg-rose-950/40 text-rose-300 border-rose-500/30'
                                : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                            }`}
                          >
                            SSL: {d.sslStatus.toUpperCase()}
                          </span>
                        </div>
                        {d.notes && <p className="text-[11px] text-neutral-400 mt-1 italic">{d.notes}</p>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-end md:self-auto">
                      <button
                        onClick={() => openEditDomainModal(d)}
                        className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors"
                        title="Editar Domínio"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteDomain(d.id, d.domain)}
                        className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-rose-400 hover:text-rose-300 transition-colors"
                        title="Remover Domínio"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Rotas Vinculadas */}
                  <div className="p-3 rounded-xl bg-black/40 border border-neutral-800/80 space-y-2">
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                      Rotas Ativas no Proxy Caddy
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Raiz / @ */}
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs">
                        <span className="font-mono text-cyan-300 font-semibold">@ / www</span>
                        <ArrowRight size={12} className="text-neutral-500" />
                        {targetProj ? (
                          <span className="text-white font-medium flex items-center gap-1">
                            <span>{targetProj.name}</span>
                            <button
                              onClick={() => window.api.openExternal(`http://${d.domain}`)}
                              className="text-neutral-400 hover:text-cyan-300"
                              title="Abrir no navegador"
                            >
                              <ExternalLink size={11} />
                            </button>
                          </span>
                        ) : (
                          <span className="text-neutral-500 italic">Sem projeto vinculado</span>
                        )}
                      </div>

                      {/* Subdomínios */}
                      {d.subdomains.map((s) => {
                        const subProj = projects.find((p) => p.id === s.projectId)
                        return (
                          <div
                            key={s.id}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs"
                          >
                            <span className="font-mono text-indigo-300 font-semibold">{s.subdomain}</span>
                            <ArrowRight size={12} className="text-neutral-500" />
                            {subProj ? (
                              <span className="text-white font-medium flex items-center gap-1">
                                <span>{subProj.name}</span>
                                <button
                                  onClick={() => window.api.openExternal(`http://${s.fullHostname}`)}
                                  className="text-neutral-400 hover:text-cyan-300"
                                  title="Abrir no navegador"
                                >
                                  <ExternalLink size={11} />
                                </button>
                              </span>
                            ) : s.targetPort ? (
                              <span className="font-mono text-emerald-400 font-medium">:{s.targetPort}</span>
                            ) : (
                              <span className="text-neutral-500 italic">Sem destino</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Ações do Card */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-neutral-800/60">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setInstructionsDomain(d)
                          setAutoDnsResult(null)
                        }}
                        className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs flex items-center gap-1.5 border border-neutral-700 transition-colors"
                      >
                        <BookOpen size={13} className="text-cyan-400" />
                        <span>📋 Passo a Passo de Configuração</span>
                      </button>

                      <button
                        onClick={() => handleVerifyDns(d.id)}
                        disabled={verifyingDomainId === d.id}
                        className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs flex items-center gap-1.5 border border-neutral-700 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw size={13} className={verifyingDomainId === d.id ? 'animate-spin text-cyan-400' : ''} />
                        <span>🔍 Verificar DNS & HTTPS Agora</span>
                      </button>

                      {d.connectionMode === 'lan_only' && (
                        <button
                          onClick={() => handleApplyHosts(d.id, d.domain)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-950/50 hover:bg-emerald-900/50 text-emerald-300 text-xs flex items-center gap-1.5 border border-emerald-500/30 transition-colors"
                        >
                          <Zap size={13} />
                          <span>⚡ Ativar no Windows Hosts</span>
                        </button>
                      )}
                    </div>

                    {d.lastCheckedAt && (
                      <span className="text-[11px] text-neutral-500">
                        Última verificação: {new Date(d.lastCheckedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Comparativo Visual: Quick Tunnel vs Named Tunnel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-cyan-400" />
              <h4 className="text-xs font-bold text-cyan-200 uppercase tracking-wider">Quick Tunnel (*.trycloudflare.com)</h4>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-900/60 text-cyan-300 border border-cyan-400/30">
              Zero Config
            </span>
          </div>
          <p className="text-xs text-neutral-300 leading-relaxed">
            <strong>Ideal para:</strong> Testar agora no celular ou enviar link temporário para um cliente aprovar.
          </p>
          <ul className="text-[11px] text-neutral-400 space-y-1 list-disc list-inside">
            <li>Zero configuração: não precisa de conta Cloudflare nem domínio</li>
            <li>Certificado SSL/TLS automático instantâneo</li>
            <li>A URL muda temporariamente se o túnel ou servidor reiniciar</li>
          </ul>
        </div>

        <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-indigo-400" />
              <h4 className="text-xs font-bold text-indigo-200 uppercase tracking-wider">Named Tunnel (Cloudflare Zero Trust 24/7)</h4>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 border border-indigo-400/30">
              Produção Definitiva
            </span>
          </div>
          <p className="text-xs text-neutral-300 leading-relaxed">
            <strong>Ideal para:</strong> Produção definitiva com seu domínio próprio (<code className="text-indigo-300">api.suaempresa.com.br</code>).
          </p>
          <ul className="text-[11px] text-neutral-400 space-y-1 list-disc list-inside">
            <li>Fura bloqueios de operadora (CGNAT) sem abrir nenhuma porta no roteador</li>
            <li>Gere o Token gratuito em 4 cliques no painel Zero Trust</li>
            <li>Roda como serviço permanente em segundo plano</li>
          </ul>
        </div>
      </div>

      {/* Seção 1: Proxy Reverso Caddy */}
      <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-emerald-400">
              <Layers size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Proxy Reverso Dinâmico (Caddy)</h3>
                <InfoTooltip
                  title="Proxy Reverso Caddy"
                  description="Servidor HTTP/HTTPS em Go de ultra-alto desempenho. Despacha requisições automaticamente para as portas das suas APIs e entrega arquivos estáticos diretamente da memória."
                  recommendation="O Caddy gerencia compressão gzip/zstd e roteamento SPA sem recarregar o servidor."
                />
                <Badge
                  status={proxyStatus?.running ? 'running' : 'stopped'}
                  label={proxyStatus?.running ? `Online (Porta ${proxyStatus.httpPort})` : 'Offline'}
                />
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                API REST em <code className="text-neutral-300">127.0.0.1:2019</code> · Headers de Segurança & Proteção de Memória
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncProxy}
              className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs flex items-center gap-1.5 transition-colors border border-neutral-700"
            >
              <RefreshCw size={13} />
              <span>Sincronizar Rotas</span>
            </button>
            {!proxyStatus?.serviceInstalled && (
              <button
                onClick={() =>
                  window.api
                    .installProxyService()
                    .then(() => toast.success('Serviço Caddy instalado!'))
                    .catch((err) => toast.error('Falha ao instalar serviço Caddy', (err as Error).message))
                }
                className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-indigo-400 text-xs border border-indigo-500/30 transition-colors"
              >
                Instalar como Serviço Windows (NSSM)
              </button>
            )}
          </div>
        </div>

        {/* Tabela de Rotas Caddy */}
        <div className="rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900/50">
          <div className="px-4 py-2 bg-neutral-900/80 border-b border-neutral-800 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex justify-between">
            <span>Rotas Roteadas Dinamicamente ({proxyStatus?.routes.length || 0})</span>
            <span className="text-emerald-400 font-mono">max_body: 10MB · nosniff · DENY</span>
          </div>

          {!proxyStatus?.routes.length ? (
            <div className="p-6 text-center text-xs text-neutral-500">
              Nenhuma rota ativa. Inicie uma aplicação na aba 'Projetos' para registrar as rotas automaticamente.
            </div>
          ) : (
            <div className="divide-y divide-neutral-800/60">
              {proxyStatus.routes.map((r, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-white">{r.hosts.join(', ')}</span>
                    <ArrowRight size={14} className="text-neutral-500" />
                    <span className="font-mono text-cyan-400">{r.upstream}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400">
                      {r.kind === 'file_server' ? 'Arquivo Estático (Zero RAM)' : 'Reverse Proxy HTTP'}
                    </span>
                    <span className="text-neutral-400 text-xs">{r.projectName}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Seção 2: Cloudflare Quick Tunnels */}
      <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-cyan-400">
              <Globe size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Quick Tunnels (Links Públicos Temporários Gratuitos)</h3>
                <InfoTooltip
                  title="TryCloudflare Quick Tunnel"
                  description="Gera uma URL pública temporária (ex: https://abc-xyz.trycloudflare.com) com certificado SSL em 2 segundos."
                  recommendation="Ideal para testes no smartphone ou homologação de clientes sem precisar de domínio registrado."
                />
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Gere uma URL segura pública instantânea com certificado SSL sem precisar de conta ou login na Cloudflare.
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsQuickModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-semibold text-xs flex items-center gap-2 transition-all shadow-lg shadow-cyan-500/20"
          >
            <Plus size={16} />
            <span>Gerar Link Rápido</span>
          </button>
        </div>

        {/* Lista de Quick Tunnels */}
        {!tunnelStatus?.quick.length ? (
          <div className="p-6 rounded-xl bg-neutral-900/40 border border-neutral-800 text-center text-xs text-neutral-500">
            Nenhum Quick Tunnel ativo no momento. Clique no botão acima para expor uma porta ou projeto.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tunnelStatus.quick.map((t) => (
              <div key={t.id} className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">{t.label}</span>
                  <Badge status={t.status} size="sm" />
                </div>

                {t.url ? (
                  <div className="p-2.5 rounded-lg bg-black/60 border border-neutral-800 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-cyan-300 truncate">{t.url}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => copyText(t.id, t.url!, 'URL pública copiada!')}
                        className="p-1 rounded text-neutral-400 hover:text-white transition-colors"
                        title="Copiar URL"
                      >
                        {copiedId === t.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                      {t.qrDataUrl && (
                        <button
                          onClick={() => setActiveQrModalTunnel(t)}
                          className="p-1 rounded text-neutral-400 hover:text-white transition-colors"
                          title="Ver QR Code"
                        >
                          <QrCode size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => window.api.openExternal(t.url!)}
                        className="p-1 rounded text-neutral-400 hover:text-white transition-colors"
                        title="Abrir no Navegador"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-neutral-400 font-mono animate-pulse">
                    <RefreshCw size={12} className="animate-spin" />
                    <span>Aguardando URL do Cloudflare...</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 text-[11px] text-neutral-500">
                  <span>Alvo: {t.target}</span>
                  <button
                    onClick={() => handleStopQuick(t.id)}
                    className="text-rose-400 hover:text-rose-300 transition-colors font-medium flex items-center gap-1"
                  >
                    <Square size={12} />
                    <span>Encerrar</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Seção 3: Cloudflare Named Tunnel (Melhorada) */}
      <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-indigo-400">
              <Key size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Named Tunnel (Produção 24/7 com Domínio Próprio)</h3>
                <InfoTooltip
                  title="Cloudflare Named Tunnel"
                  description="Cria uma rota criptografada permanente entre o Cloudflare Edge e o seu servidor local para apontar domínios próprios (ex: api.suaempresa.com.br)."
                  recommendation="Elimina a necessidade de IP fixo da operadora ou abertura de portas 80/443 no roteador."
                />
                <Badge
                  status={tunnelStatus?.named.installed ? 'running' : 'stopped'}
                  label={tunnelStatus?.named.installed ? 'Serviço Ativo' : 'Não Instalado'}
                />
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Conecte seu domínio próprio diretamente à sua conta Cloudflare Zero Trust (gratuita).
              </p>
            </div>
          </div>

          {tunnelStatus?.named.installed && (
            <button
              onClick={handleUninstallNamed}
              className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-rose-400 text-xs border border-rose-500/30 transition-colors"
            >
              Desinstalar Serviço
            </button>
          )}
        </div>

        {/* Banner com Tunnel ID e CNAME extraído automaticamente do token */}
        {tunnelStatus?.named.tunnelId && (
          <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/40 via-cyan-950/20 to-neutral-900/60 border border-indigo-500/30 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-indigo-400" />
                <span className="font-semibold text-white">Túnel Permanente Conectado</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300">
                  ID: {tunnelStatus.named.tunnelId}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                Endereço CNAME oficial:{' '}
                <code className="text-cyan-300 font-mono font-semibold">{tunnelStatus.named.tunnelCname}</code>
              </p>
            </div>

            <button
              type="button"
              onClick={() => copyText('cname_button', tunnelStatus.named.tunnelCname!, 'CNAME do túnel copiado!')}
              className="px-3 py-1.5 rounded-xl bg-indigo-600/80 hover:bg-indigo-600 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shrink-0 self-start md:self-auto"
            >
              {copiedId === 'cname_button' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>Copiar CNAME</span>
            </button>
          </div>
        )}

        <form onSubmit={handleConfigureNamed} className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Token do Cloudflare Zero Trust Connector
                </label>
                <InfoTooltip
                  title="Token do Conector Cloudflared"
                  description="Token alfanumérico longo gerado pelo painel Zero Trust (Networks > Tunnels). Ele identifica seu túnel de forma segura sem requerer login."
                />
              </div>
              {tunnelStatus?.named.namedTokenSet && (
                <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                  <Check size={12} /> Token Salvo no Cofre
                </span>
              )}
            </div>
            <input
              type="password"
              value={namedToken}
              onChange={(e) => setNamedToken(e.target.value)}
              placeholder="Cole o token eyJh... gerado no painel da Cloudflare"
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={configuringNamed || !namedToken.trim()}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors disabled:opacity-50"
            >
              {configuringNamed ? 'Instalando Serviço...' : 'Instalar e Iniciar Serviço'}
            </button>
          </div>
        </form>
      </div>

      {/* ===================================================================== */}
      {/* MODAL 1: CONFIGURAR / EDITAR DOMÍNIO */}
      {/* ===================================================================== */}
      <Modal
        isOpen={isDomainModalOpen}
        onClose={() => setIsDomainModalOpen(false)}
        title={editingDomainId ? 'Editar Domínio Próprio' : 'Configurar Novo Domínio Próprio'}
        subtitle="Aponte qualquer domínio comprado no Registro.br, GoDaddy, etc. para seus projetos."
        maxWidth="xl"
      >
        <form onSubmit={handleSaveDomain} className="space-y-5">
          {/* Campo Domínio */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1">
              Nome do Domínio Raiz
            </label>
            <input
              type="text"
              value={formDomain}
              onChange={(e) => handleDomainInputChange(e.target.value)}
              placeholder="ex: minhaempresa.com.br ou painel.localhost"
              disabled={!!editingDomainId}
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none disabled:opacity-60"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Não inclua <code className="text-neutral-400">http://</code> nem barras. Exemplo: <code className="text-cyan-300">meusite.com.br</code>
            </p>
          </div>

          {/* Onde você comprou o domínio (Provedor / Registrar) */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
              Onde você comprou este domínio?
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(['registrobr', 'godaddy', 'cloudflare', 'hostinger', 'namecheap', 'other'] as DomainRegistrar[]).map(
                (reg) => {
                  const m = REGISTRAR_META[reg]
                  const selected = formRegistrar === reg
                  return (
                    <button
                      key={reg}
                      type="button"
                      onClick={() => setFormRegistrar(reg)}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all ${
                        selected
                          ? 'bg-cyan-950/40 border-cyan-500 text-white'
                          : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 text-neutral-300'
                      }`}
                    >
                      <span className="text-lg">{m.emoji}</span>
                      <span className="text-xs font-medium truncate">{m.label}</span>
                    </button>
                  )
                }
              )}
            </div>
          </div>

          {/* Modo de Conexão */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
              Como deseja conectar o domínio?
            </label>
            <div className="space-y-2">
              {/* Opção 1: Cloudflare Tunnel */}
              <label
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  formConnectionMode === 'cloudflare_tunnel'
                    ? 'bg-indigo-950/30 border-indigo-500/80 text-white'
                    : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 text-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  name="connMode"
                  value="cloudflare_tunnel"
                  checked={formConnectionMode === 'cloudflare_tunnel'}
                  onChange={() => setFormConnectionMode('cloudflare_tunnel')}
                  className="mt-1"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Túnel Cloudflare Zero Trust</span>
                    <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-indigo-900/60 text-indigo-300">
                      Recomendado
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    Sem abrir portas no roteador, fura CGNAT e com SSL automático gerenciado na borda da Cloudflare.
                  </p>
                </div>
              </label>

              {/* Opção 2: DNS Direto */}
              <label
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  formConnectionMode === 'direct_dns'
                    ? 'bg-cyan-950/30 border-cyan-500/80 text-white'
                    : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 text-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  name="connMode"
                  value="direct_dns"
                  checked={formConnectionMode === 'direct_dns'}
                  onChange={() => setFormConnectionMode('direct_dns')}
                  className="mt-1"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-white">DNS Direto para IP Público</span>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    Aponta o registro A para seu IP público ({endpoints?.publicIp || 'IP atual'}). Requer portas 80/443 liberadas no roteador.
                  </p>
                </div>
              </label>

              {/* Opção 3: Rede Local */}
              <label
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  formConnectionMode === 'lan_only'
                    ? 'bg-emerald-950/30 border-emerald-500/80 text-white'
                    : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 text-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  name="connMode"
                  value="lan_only"
                  checked={formConnectionMode === 'lan_only'}
                  onChange={() => setFormConnectionMode('lan_only')}
                  className="mt-1"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-white">Rede Local / Intranet (.localhost / .local)</span>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    Ideal para desenvolvimento e intranet. Funciona instantaneamente no Windows com 1 clique no arquivo hosts.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Vínculo do Domínio Principal (@ / www) */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-semibold text-neutral-300">
                Projeto no Domínio Principal (@ e www)
              </label>
              <InfoTooltip
                title="Domínio Raiz"
                description="O projeto selecionado responderá quando alguém acessar diretamente seudominio.com e www.seudominio.com."
              />
            </div>
            <select
              value={formTargetProjectId}
              onChange={(e) => setFormTargetProjectId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-cyan-500 focus:outline-none"
            >
              <option value="">Nenhum (usar apenas subdomínios)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.stack.toUpperCase()}{p.port ? ` :${p.port}` : ''})
                </option>
              ))}
            </select>
          </div>

          {/* Subdomínios Roteados */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Subdomínios Roteados (api, app, etc.)
                </label>
                <InfoTooltip
                  title="Subdomínios"
                  description="Crie rotas como api.seudominio.com para seu backend e app.seudominio.com para seu frontend."
                />
              </div>

              {/* Botões Rápidos */}
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-neutral-500">Sugestões:</span>
                {['api', 'app', 'painel', 'auth'].map((quick) => (
                  <button
                    key={quick}
                    type="button"
                    onClick={() => handleAddSubdomainQuick(quick)}
                    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-mono transition-colors"
                  >
                    +{quick}
                  </button>
                ))}
              </div>
            </div>

            {formSubdomains.length === 0 ? (
              <div className="p-3 rounded-xl bg-neutral-900/40 border border-neutral-800 text-center text-xs text-neutral-500">
                Nenhum subdomínio configurado ainda. Use as sugestões acima ou clique em "+ Adicionar Subdomínio".
              </div>
            ) : (
              <div className="space-y-2">
                {formSubdomains.map((sub, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center gap-2">
                    <div className="flex items-center gap-1 w-1/3">
                      <input
                        type="text"
                        value={sub.subdomain}
                        onChange={(e) => {
                          const updated = [...formSubdomains]
                          updated[idx].subdomain = e.target.value.toLowerCase().trim()
                          setFormSubdomains(updated)
                        }}
                        placeholder="api"
                        className="w-full px-2 py-1 rounded-lg bg-neutral-950 border border-neutral-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                      />
                      <span className="text-[11px] text-neutral-500 truncate">.{formDomain || 'dominio.com'}</span>
                    </div>

                    <ArrowRight size={14} className="text-neutral-500 shrink-0" />

                    <div className="flex-1">
                      <select
                        value={sub.projectId || ''}
                        onChange={(e) => {
                          const updated = [...formSubdomains]
                          updated[idx].projectId = e.target.value || null
                          setFormSubdomains(updated)
                        }}
                        className="w-full px-2 py-1 rounded-lg bg-neutral-950 border border-neutral-800 text-white text-xs focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="">Porta local fixa...</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.stack.toUpperCase()})
                          </option>
                        ))}
                      </select>
                    </div>

                    {!sub.projectId && (
                      <input
                        type="number"
                        value={sub.targetPort || ''}
                        onChange={(e) => {
                          const updated = [...formSubdomains]
                          updated[idx].targetPort = e.target.value ? Number(e.target.value) : null
                          setFormSubdomains(updated)
                        }}
                        placeholder="8080"
                        className="w-20 px-2 py-1 rounded-lg bg-neutral-950 border border-neutral-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                      />
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const updated = formSubdomains.filter((_, i) => i !== idx)
                        setFormSubdomains(updated)
                      }}
                      className="p-1 rounded text-neutral-500 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleAddCustomSubdomain}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 transition-colors"
            >
              <Plus size={13} />
              <span>+ Adicionar Subdomínio</span>
            </button>
          </div>

          {/* Notas */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1">Notas (Opcional)</label>
            <input
              type="text"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="ex: Domínio principal de produção para landing page e API"
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Botões do Modal */}
          <div className="pt-2 flex justify-end gap-2 border-t border-neutral-800">
            <button
              type="button"
              onClick={() => setIsDomainModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingDomain || !formDomain.trim()}
              className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-semibold text-xs transition-colors disabled:opacity-50"
            >
              {savingDomain ? 'Salvando...' : editingDomainId ? 'Atualizar Domínio' : 'Salvar e Ver Instruções'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 2: INSTRUÇÕES DNS & PASSO A PASSO (SOB MEDIDA) */}
      {/* ===================================================================== */}
      <Modal
        isOpen={!!instructionsDomain}
        onClose={() => setInstructionsDomain(null)}
        title={`Guia de Configuração no ${instructionsDomain ? REGISTRAR_META[instructionsDomain.registrar].label : 'Provedor'}`}
        subtitle={`Como apontar ${instructionsDomain?.domain || ''} de forma correta e definitiva.`}
        maxWidth="2xl"
      >
        {instructionsDomain?.instructions && (
          <div className="space-y-5">
            {/* Avisos */}
            {instructionsDomain.instructions.warnings.map((w, i) => (
              <div key={i} className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
                <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{w}</span>
              </div>
            ))}

            {/* Passo a Passo do Provedor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Passo a Passo no Painel do {instructionsDomain.instructions.registrarLabel}
                </h4>
                {instructionsDomain.instructions.panelUrl && (
                  <button
                    onClick={() => window.api.openExternal(instructionsDomain.instructions!.panelUrl!)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 transition-colors"
                  >
                    <span>Abrir Painel Oficial</span>
                    <ExternalLink size={12} />
                  </button>
                )}
              </div>

              <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2.5">
                {instructionsDomain.instructions.steps.map((st, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs text-neutral-300">
                    <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/30 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{st}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabela de Registros DNS para Copiar */}
            {instructionsDomain.instructions.records.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Tabela de Registros DNS para Adicionar
                  </h4>
                  <span className="text-[11px] text-neutral-400">Clique no ícone para copiar cada campo</span>
                </div>

                <div className="rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900/50">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-neutral-900/90 border-b border-neutral-800 text-[11px] font-semibold text-neutral-400">
                        <th className="p-3">Tipo</th>
                        <th className="p-3">Nome / Host</th>
                        <th className="p-3">Valor / Destino</th>
                        <th className="p-3">TTL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/60 font-mono">
                      {instructionsDomain.instructions.records.map((rec, i) => (
                        <tr key={i} className="hover:bg-neutral-800/30">
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 font-bold text-[11px] border border-cyan-500/20">
                              {rec.type}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 text-white">
                              <span>{rec.host}</span>
                              <button
                                onClick={() => copyText(`rec_host_${i}`, rec.host, 'Host copiado!')}
                                className="p-1 text-neutral-500 hover:text-white"
                                title="Copiar Host"
                              >
                                {copiedId === `rec_host_${i}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                              </button>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 text-cyan-300">
                              <span className="truncate max-w-xs">{rec.value}</span>
                              <button
                                onClick={() => copyText(`rec_val_${i}`, rec.value, 'Valor copiado!')}
                                className="p-1 text-neutral-500 hover:text-white"
                                title="Copiar Valor"
                              >
                                {copiedId === `rec_val_${i}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                              </button>
                            </div>
                          </td>
                          <td className="p-3 text-neutral-400">{rec.ttl}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Cloudflare Tunnel Public Hostnames (somente modo cloudflare_tunnel) */}
            {instructionsDomain.connectionMode === 'cloudflare_tunnel' && instructionsDomain.instructions.tunnelIngress.length > 0 && (
              <div className="space-y-3 p-4 rounded-xl bg-indigo-950/20 border border-indigo-500/30">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-indigo-400" />
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Configuração no Cloudflare Zero Trust (Public Hostnames)
                  </h4>
                </div>
                <p className="text-xs text-neutral-300">
                  No painel <code className="text-indigo-300">one.dash.cloudflare.com</code> → Networks → Tunnels → seu túnel → <strong>Public Hostname</strong>, aponte cada endereço abaixo para o Caddy local:
                </p>

                <div className="space-y-1.5">
                  {instructionsDomain.instructions.tunnelIngress.map((ing, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-black/60 border border-neutral-800 flex items-center justify-between text-xs font-mono">
                      <span className="text-cyan-300">{ing.hostname}</span>
                      <ArrowRight size={13} className="text-neutral-500" />
                      <span className="text-emerald-400">{ing.service}</span>
                      <span className="text-neutral-400 text-[11px]">({ing.projectName || 'Caddy Proxy'})</span>
                    </div>
                  ))}
                </div>

                {/* Automação 1-Clique Cloudflare API */}
                <div className="pt-3 border-t border-indigo-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Zap size={14} className="text-cyan-400" />
                      <span>Configurar DNS na Cloudflare em 1-Clique (Via API Token)</span>
                    </span>
                    <button
                      onClick={() => window.api.openExternal('https://dash.cloudflare.com/profile/api-tokens')}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                    >
                      <span>Criar Token</span>
                      <ExternalLink size={11} />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={cfApiTokenInput}
                      onChange={(e) => setCfApiTokenInput(e.target.value)}
                      placeholder="Token com permissões Zone:DNS:Edit e Tunnel:Edit"
                      className="flex-1 px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAutoConfigureCloudflare(instructionsDomain.id)}
                      disabled={autoDnsLoading}
                      className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <Zap size={13} />
                      <span>{autoDnsLoading ? 'Configurando...' : 'Executar 1-Clique'}</span>
                    </button>
                  </div>

                  {autoDnsResult && (
                    <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300 space-y-1">
                      <div className="font-semibold flex items-center gap-1">
                        <CheckCircle2 size={13} /> Registros Cloudflare Atualizados:
                      </div>
                      <div className="text-[11px] font-mono">
                        {autoDnsResult.records.map((r, idx) => (
                          <div key={idx}>
                            • {r.hostname}: <strong>{r.action.toUpperCase()}</strong> {r.error ? `(${r.error})` : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Linha Windows hosts (somente modo lan_only) */}
            {instructionsDomain.connectionMode === 'lan_only' && instructionsDomain.instructions.hostsLine && (
              <div className="space-y-3 p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Zap size={14} className="text-emerald-400" />
                    <span>Linha do Arquivo Windows Hosts</span>
                  </span>
                  <button
                    onClick={() => handleApplyHosts(instructionsDomain.id, instructionsDomain.domain)}
                    className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Zap size={13} />
                    <span>⚡ Ativar no Windows Hosts (1-Clique)</span>
                  </button>
                </div>
                <div className="p-2.5 rounded-lg bg-black/60 border border-neutral-800 flex items-center justify-between font-mono text-xs text-emerald-300">
                  <span>{instructionsDomain.instructions.hostsLine}</span>
                  <button
                    onClick={() => copyText('hosts_line', instructionsDomain.instructions!.hostsLine!, 'Linha do hosts copiada!')}
                    className="p-1 text-neutral-400 hover:text-white"
                  >
                    {copiedId === 'hosts_line' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 3: DIAGNÓSTICO E RESULTADO DE VERIFICAÇÃO DNS / HTTPS */}
      {/* ===================================================================== */}
      <Modal
        isOpen={!!verificationResult}
        onClose={() => setVerificationResult(null)}
        title="Diagnóstico de Resolução DNS & HTTPS"
        subtitle={verificationResult ? `Resultado da verificação em tempo real para ${verificationResult.domain}` : ''}
        maxWidth="xl"
      >
        {verificationResult && (
          <div className="space-y-4">
            {/* Mensagem principal de diagnóstico */}
            <div
              className={`p-4 rounded-xl border text-xs leading-relaxed flex items-start gap-3 ${
                verificationResult.dnsVerified && verificationResult.httpsReachable
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
              }`}
            >
              {verificationResult.dnsVerified && verificationResult.httpsReachable ? (
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              )}
              <div>
                <span className="font-semibold block mb-0.5">Status Geral:</span>
                <span>{verificationResult.diagnosticMessage}</span>
              </div>
            </div>

            {/* Etapas de Diagnóstico */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider block">
                Etapas de Verificação
              </span>
              <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
                {verificationResult.steps.map((st, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs">
                    {st.ok ? (
                      <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold text-white">{st.label}</span>
                      <p className="text-[11px] text-neutral-400 mt-0.5">{st.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detalhe de Cada Hostname */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider block">
                Hostnames Verificados
              </span>
              <div className="divide-y divide-neutral-800 rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900/50">
                {verificationResult.hosts.map((h, i) => (
                  <div key={i} className="p-3 text-xs flex items-center justify-between">
                    <div>
                      <span className="font-mono font-semibold text-white">{h.hostname}</span>
                      <div className="text-[11px] text-neutral-400 mt-0.5 font-mono">
                        A: {h.aRecords.join(', ') || 'Nenhum'} | CNAME: {h.cnameRecords.join(', ') || 'Nenhum'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                          h.pointsToExpected ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                        }`}
                      >
                        {h.pointsToExpected ? 'Apontamento OK' : 'DNS Incorreto'}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                          h.httpsReachable ? 'bg-emerald-950 text-emerald-300' : 'bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {h.httpsReachable ? `HTTPS :${h.httpStatus || 200}` : 'Sem HTTPS'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Criar Quick Tunnel */}
      <Modal
        isOpen={isQuickModalOpen}
        onClose={() => setIsQuickModalOpen(false)}
        title="Gerar Link Público Instantâneo"
        subtitle="Expõe uma aplicação ou porta local via Cloudflare Tunnel gratuito."
      >
        <form onSubmit={handleStartQuick} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1">Selecionar Projeto</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-cyan-500 focus:outline-none"
            >
              <option value="">Porta Customizada...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.port ? `(:${p.port})` : ''}
                </option>
              ))}
            </select>
          </div>

          {!selectedProjectId && (
            <div>
              <label className="text-xs font-semibold text-neutral-300 block mb-1">Número da Porta Local</label>
              <input
                type="number"
                value={customPort}
                onChange={(e) => setCustomPort(Number(e.target.value))}
                placeholder="3000"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsQuickModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={startingQuick}
              className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-semibold text-xs transition-colors disabled:opacity-50"
            >
              {startingQuick ? 'Gerando...' : 'Iniciar Túnel'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal QR Code */}
      <Modal
        isOpen={!!activeQrModalTunnel}
        onClose={() => setActiveQrModalTunnel(null)}
        title="QR Code do Link Público"
        subtitle={activeQrModalTunnel?.url || ''}
        maxWidth="sm"
      >
        <div className="flex flex-col items-center justify-center p-4 space-y-4">
          {activeQrModalTunnel?.qrDataUrl ? (
            <div className="p-3 bg-white rounded-2xl shadow-xl">
              <img src={activeQrModalTunnel.qrDataUrl} alt="QR Code" className="w-56 h-56" />
            </div>
          ) : null}
          <p className="text-center text-xs text-neutral-400">
            Aponte a câmera do celular para abrir diretamente no seu dispositivo sem estar na mesma rede Wi-Fi.
          </p>
        </div>
      </Modal>

      {/* Slide-over Help Drawer */}
      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="Guia de Roteamento, Proxy & Domínios Próprios"
        description="Aprenda a publicar seus serviços e Front-ends na internet com segurança, vencendo bloqueios de CGNAT e roteadores domésticos sem abrir portas."
        steps={[
          {
            title: '1. Meus Domínios Próprios (Registro.br, GoDaddy, etc.)',
            description: 'Cadastre qualquer domínio que você tenha comprado. O MyServer detecta o provedor e ensina os registros exatos (Tipo, Host e Destino) para colar no painel, suportando subdomínios como api. e app. para diferentes projetos.'
          },
          {
            title: '2. Proxy Reverso Caddy Local',
            description: 'O Caddy centraliza as conexões da porta 80 e despacha requisições para cada API e Front-end cadastrado. Ele também gerencia cabeçalhos de segurança (X-Content-Type-Options, Frame-Options) e limite de corpo de requisições sem causar loops de redirecionamento HTTP.'
          },
          {
            title: '3. Quick Tunnel (*.trycloudflare.com) em 1 Clique',
            description: 'Gera uma URL pública temporária e um QR Code para acesso no celular em 2 segundos. Ideal para mostrar seu progresso para um colega ou cliente sem precisar configurar DNS.'
          },
          {
            title: '4. Named Tunnel em 4 Cliques (Produção 24/7 com Domínio Próprio)',
            description: '1. Acesse one.dash.cloudflare.com > Networks > Tunnels > Create a tunnel.\n2. Escolha "Cloudflared" e dê um nome.\n3. Em "Install connector", selecione Windows e copie apenas o Token longo (eyJh...).\n4. Cole o token no campo do MyServer e clique em "Instalar e Iniciar Serviço". O ID do túnel e CNAME serão extraídos automaticamente.'
          }
        ]}
        tips={[
          'O Cloudflare Tunnel é 100% gratuito e não exige que você contrate IP fixo com sua provedora de internet.',
          'Nenhuma porta precisa ser aberta no roteador (port forwarding): o túnel cria uma conexão outbound persistente e segura.',
          'Para testes locais imediatos, escolha o modo "Rede Local / Intranet" (.localhost) e ative com 1 clique no arquivo hosts do Windows.'
        ]}
        externalLinks={[
          {
            label: 'Painel Cloudflare Zero Trust (one.dash.cloudflare.com)',
            url: 'https://one.dash.cloudflare.com'
          },
          {
            label: 'Painel Registro.br',
            url: 'https://registro.br/painel/'
          },
          {
            label: 'Painel GoDaddy',
            url: 'https://dcc.godaddy.com/'
          },
          {
            label: 'Documentação Oficial Caddy Web Server',
            url: 'https://caddyserver.com/docs/'
          }
        ]}
      />
    </div>
  )
}
