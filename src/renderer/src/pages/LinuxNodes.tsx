import React, { useEffect, useState } from 'react'
import {
  Server,
  Terminal,
  Plus,
  Play,
  Square,
  RotateCw,
  Trash2,
  RefreshCw,
  Box,
  Zap,
  FileText,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink
} from 'lucide-react'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { XtermViewer } from '../components/XtermViewer'
import { HelpDrawer } from '../components/HelpDrawer'
import { InfoTooltip } from '../components/InfoTooltip'
import type {
  LinuxNode,
  LinuxNodeInput,
  LinuxTelemetry,
  LinuxProvisionOptions,
  Project,
  LogEvent
} from '@shared/types'

export const LinuxNodes: React.FC = () => {
  const [nodes, setNodes] = useState<LinuxNode[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  // Help & Guia
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isGuideExpanded, setIsGuideExpanded] = useState(true)
  const [copiedCommand, setCopiedCommand] = useState(false)

  // Nó ativo selecionado para inspeção
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<LinuxTelemetry | null>(null)
  const [loadingTelemetry, setLoadingTelemetry] = useState(false)
  const [logs, setLogs] = useState<Array<{ stream: string; line: string; ts: number }>>([])

  // Modal Novo Nó
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(22)
  const [username, setUsername] = useState('ubuntu')
  const [authType, setAuthType] = useState<'password' | 'key'>('password')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [sudoPassword, setSudoPassword] = useState('')
  const [savingNode, setSavingNode] = useState(false)

  // Modal Provisionamento
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [provisionOpts, setProvisionOpts] = useState<LinuxProvisionOptions>({
    power: true,
    docker: true,
    caddy: true,
    cloudflared: true,
    firewall: true,
    allowHttpFromLan: true
  })

  // Modal Deploy Container
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [deploying, setDeploying] = useState(false)

  const loadData = async () => {
    try {
      const [nList, pList] = await Promise.all([window.api.listLinuxNodes(), window.api.listProjects()])
      setNodes(nList)
      setProjects(pList)
      if (pList.length > 0 && !selectedProjectId) {
        setSelectedProjectId(pList[0].id)
      }
      if (nList.length > 0 && !activeNodeId) {
        setActiveNodeId(nList[0].id)
      }
    } catch (err) {
      console.error('Erro ao listar nós Linux:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    const unsubLogs = window.api.onLinuxLog((event) => {
      setLogs((prev) => [...prev, event].slice(-600))
    })

    return () => unsubLogs()
  }, [])

  const handleConnect = async (nodeId: string) => {
    setActiveNodeId(nodeId)
    setLoadingTelemetry(true)
    try {
      const t = await window.api.connectLinuxNode(nodeId)
      setTelemetry(t)
    } catch (err) {
      alert(`Falha ao conectar via SSH: ${(err as Error).message}`)
      setTelemetry(null)
    } finally {
      setLoadingTelemetry(false)
    }
  }

  const handleAddNode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !host.trim()) return

    setSavingNode(true)
    try {
      const input: LinuxNodeInput = {
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authType,
        password: password.trim() || undefined,
        privateKey: privateKey.trim() || undefined,
        sudoPassword: sudoPassword.trim() || undefined
      }

      const created = await window.api.addLinuxNode(input)
      setIsAddModalOpen(false)
      setName('')
      setHost('')
      setPassword('')
      setPrivateKey('')
      await loadData()
      handleConnect(created.id)
    } catch (err) {
      alert(`Erro ao adicionar nó: ${(err as Error).message}`)
    } finally {
      setSavingNode(false)
    }
  }

  const handleDeleteNode = async (id: string, nodeName: string) => {
    if (!confirm(`Remover nó remoto '${nodeName}'?`)) return
    try {
      await window.api.removeLinuxNode(id)
      if (activeNodeId === id) {
        setActiveNodeId(null)
        setTelemetry(null)
      }
      loadData()
    } catch (err) {
      alert(`Erro ao remover nó: ${(err as Error).message}`)
    }
  }

  const handleProvision = async () => {
    if (!activeNodeId) return
    setProvisioning(true)
    try {
      await window.api.provisionLinuxNode(activeNodeId, provisionOpts)
      setIsProvisionModalOpen(false)
      alert('Servidor Linux provisionado com sucesso!')
      handleConnect(activeNodeId)
      loadData()
    } catch (err) {
      alert(`Erro durante o provisionamento: ${(err as Error).message}`)
    } finally {
      setProvisioning(false)
    }
  }

  const [viewingContainer, setViewingContainer] = useState<{ id: string; name: string; logs: LogEvent[] } | null>(null)
  const [containerActionLoading, setContainerActionLoading] = useState<string | null>(null)

  const handleContainerAction = async (action: 'start' | 'stop' | 'restart', containerId: string) => {
    if (!activeNodeId) return
    setContainerActionLoading(`${action}-${containerId}`)
    try {
      if (action === 'start') await window.api.startLinuxContainer(activeNodeId, containerId)
      else if (action === 'stop') await window.api.stopLinuxContainer(activeNodeId, containerId)
      else if (action === 'restart') await window.api.restartLinuxContainer(activeNodeId, containerId)
      await handleConnect(activeNodeId)
    } catch (err) {
      alert(`Erro na ação do container: ${(err as Error).message}`)
    } finally {
      setContainerActionLoading(null)
    }
  }

  const handleViewContainerLogs = async (containerId: string, name: string) => {
    if (!activeNodeId) return
    try {
      const rawLogs = await window.api.getLinuxContainerLogs(activeNodeId, containerId, 250)
      const parsedLogs: LogEvent[] = rawLogs
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((line, idx) => ({
          projectId: containerId,
          stream: line.toLowerCase().includes('err') ? 'stderr' : 'stdout',
          line,
          ts: Date.now() + idx
        }))
      setViewingContainer({ id: containerId, name, logs: parsedLogs })
    } catch (err) {
      alert(`Falha ao ler logs do container: ${(err as Error).message}`)
    }
  }

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeNodeId || !selectedProjectId) return
    setDeploying(true)
    try {
      await window.api.deployLinuxContainer(activeNodeId, selectedProjectId)
      setIsDeployModalOpen(false)
      alert('Container implantado no servidor Linux remoto!')
      handleConnect(activeNodeId)
      loadData()
    } catch (err) {
      alert(`Erro no deploy remoto: ${(err as Error).message}`)
    } finally {
      setDeploying(false)
    }
  }

  const activeNode = nodes.find((n) => n.id === activeNodeId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Servidores Linux Remotos (Modelo B)</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Provisione e orquestre PCs antigos rodando Ubuntu Server ou Debian sem interface gráfica (~200MB de RAM base) via SSH.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsHelpOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-emerald-300 font-medium text-xs flex items-center gap-2 border border-emerald-500/30 transition-colors shadow-lg"
          >
            <BookOpen size={15} />
            <span>📖 Guia Rápido desta Tela</span>
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
          >
            <Plus size={16} />
            <span>Conectar Novo Nó Linux</span>
          </button>
        </div>
      </div>

      {/* Mini-Doc / Guia Colapsável de Preparação Linux */}
      <div className="glass-panel rounded-2xl border border-neutral-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsGuideExpanded(!isGuideExpanded)}
          className="w-full px-6 py-4 bg-neutral-900/40 hover:bg-neutral-900/60 flex items-center justify-between text-left transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-white flex items-center gap-2">
              <span>📋</span> Como preparar seu PC antigo com Linux em 3 passos rápidos
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
              ~200 MB RAM Base
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <span>{isGuideExpanded ? 'Recolher guia' : 'Expandir guia'}</span>
            {isGuideExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {isGuideExpanded && (
          <div className="p-6 pt-2 border-t border-neutral-800/80 space-y-5 bg-black/20">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Passo 1 */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center font-mono">1</span>
                  <h4 className="text-xs font-bold text-white">Qual sistema instalar?</h4>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Recomendamos <strong className="text-neutral-200">Ubuntu Server 24.04 LTS</strong> ou <strong className="text-neutral-200">Debian Netinst</strong>. Instale sem interface gráfica (GUI). O sistema consumirá apenas ~200 MB de RAM, deixando toda a memória livre para seus containers e APIs.
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => window.api.openExternal('https://ubuntu.com/download/server')}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                  >
                    <ExternalLink size={11} /> Ubuntu Server
                  </button>
                  <span className="text-neutral-600">·</span>
                  <button
                    type="button"
                    onClick={() => window.api.openExternal('https://www.debian.org/distrib/netinst')}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                  >
                    <ExternalLink size={11} /> Debian Netinst
                  </button>
                </div>
              </div>

              {/* Passo 2 */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center font-mono">2</span>
                  <h4 className="text-xs font-bold text-white">Ativar SSH & Descobrir IP</h4>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Na tela preta do Linux recém-instalado, digite o único comando abaixo para ligar o servidor SSH e descobrir o IP da sua rede local:
                </p>
                <div className="p-2.5 rounded-lg bg-black/80 border border-neutral-800 flex items-center justify-between gap-2">
                  <code className="text-[10px] font-mono text-emerald-300 truncate">
                    sudo apt update && sudo apt install -y openssh-server && ip -4 addr show | grep inet
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('sudo apt update && sudo apt install -y openssh-server && ip -4 addr show | grep inet')
                      setCopiedCommand(true)
                      setTimeout(() => setCopiedCommand(false), 2000)
                    }}
                    className="p-1 rounded text-neutral-400 hover:text-white transition-colors shrink-0"
                    title="Copiar comando"
                  >
                    {copiedCommand ? <span className="text-emerald-400 text-[10px] font-bold">Copiado! ✓</span> : <Copy size={13} />}
                  </button>
                </div>
              </div>

              {/* Passo 3 */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center font-mono">3</span>
                  <h4 className="text-xs font-bold text-white">Provisionamento 1-Clique</h4>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Cadastre o IP e clique em <strong className="text-neutral-200">Provisionar</strong>. O MyServer fará tudo sozinho:
                </p>
                <ul className="text-[11px] text-neutral-400 space-y-1 list-disc list-inside">
                  <li>Desativa suspensão ao fechar tampa do notebook</li>
                  <li>Instala Docker Engine oficial e Caddy Reverse Proxy</li>
                  <li>Instala Cloudflared e blinda firewall com <code className="text-neutral-300">ufw</code></li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Lista de Nós */}
      {loading ? (
        <div className="p-8 text-center text-xs text-neutral-500">Carregando nós cadastrados...</div>
      ) : nodes.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center flex flex-col items-center justify-center">
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 text-neutral-500 mb-4">
            <Server size={32} />
          </div>
          <h3 className="text-base font-semibold text-white">Nenhum servidor Linux cadastrado</h3>
          <p className="text-xs text-neutral-400 max-w-md mt-1 mb-6">
            Tem um PC antigo sobrando? Instale Ubuntu Server ou Debian e use o HomeServer como painel central para preparar e implantar seus containers.
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs flex items-center gap-2 transition-colors border border-neutral-700"
          >
            <Plus size={16} />
            <span>Cadastrar Servidor Linux</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {nodes.map((n) => (
            <div
              key={n.id}
              onClick={() => handleConnect(n.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeNodeId === n.id
                  ? 'bg-neutral-900 border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                  : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-white text-sm font-mono">{n.name}</span>
                <Badge
                  status={n.provisioned ? 'running' : 'idle'}
                  label={n.provisioned ? 'Provisionado' : 'Não Provisionado'}
                  size="sm"
                />
              </div>

              <div className="text-xs text-neutral-400 font-mono space-y-0.5">
                <p>
                  Host: <span className="text-neutral-200">{n.host}:{n.port}</span>
                </p>
                <p>
                  Usuário: <span className="text-neutral-200">{n.username}</span>
                </p>
                <p className="text-[11px] text-neutral-500">
                  {n.deployments.length} container(s) implantado(s)
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-neutral-800/80 flex items-center justify-between text-[11px]">
                <span className="text-emerald-400 flex items-center gap-1">
                  <Play size={11} /> Conectar
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteNode(n.id, n.name)
                  }}
                  className="text-neutral-500 hover:text-rose-400 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Painel do Nó Selecionado */}
      {activeNode && (
        <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-emerald-400">
                <Server size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white font-mono">{activeNode.name}</h3>
                  <span className="text-xs font-mono text-neutral-400">({activeNode.host})</span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Autenticação via {activeNode.authType === 'password' ? 'Senha' : 'Chave Privada'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleConnect(activeNode.id)}
                disabled={loadingTelemetry}
                className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs flex items-center gap-1.5 transition-colors border border-neutral-700 disabled:opacity-50"
              >
                <RefreshCw className={loadingTelemetry ? 'animate-spin' : ''} size={13} />
                <span>Atualizar</span>
              </button>
              <button
                onClick={() => setIsDeployModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-bold text-xs flex items-center gap-1.5 transition-colors"
              >
                <Box size={14} />
                <span>Deploy Container</span>
              </button>
              <button
                onClick={() => setIsProvisionModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs flex items-center gap-1.5 transition-colors"
              >
                <Zap size={14} />
                <span>1-Click Provisionar</span>
              </button>
            </div>
          </div>

          {/* Telemetria do Linux Remoto */}
          {telemetry ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-neutral-900/80 border border-neutral-800">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block">Sistema Operacional</span>
                  <span className="text-sm font-semibold text-white block mt-0.5">{telemetry.os}</span>
                  <span className="text-[11px] font-mono text-neutral-500">{telemetry.kernel}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-neutral-900/80 border border-neutral-800">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block">Carga CPU (1/5/15 min)</span>
                  <span className="text-sm font-mono font-semibold text-emerald-400 block mt-0.5">
                    {telemetry.load.join(' ')}
                  </span>
                  <span className="text-[11px] text-neutral-400">{telemetry.cpus} núcleos</span>
                </div>
                <div className="p-3.5 rounded-xl bg-neutral-900/80 border border-neutral-800">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block">Memória RAM</span>
                  <span className="text-sm font-mono font-semibold text-cyan-400 block mt-0.5">
                    {(telemetry.memUsed / (1024 ** 2)).toFixed(0)} MB
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    de {(telemetry.memTotal / (1024 ** 2)).toFixed(0)} MB
                  </span>
                </div>
                <div className="p-3.5 rounded-xl bg-neutral-900/80 border border-neutral-800">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block">Disco (Raiz /)</span>
                  <span className="text-sm font-mono font-semibold text-white block mt-0.5">
                    {(telemetry.diskUsed / (1024 ** 3)).toFixed(1)} GB
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    de {(telemetry.diskTotal / (1024 ** 3)).toFixed(1)} GB
                  </span>
                </div>
              </div>

              {/* Status dos Pacotes do Servidor */}
              <div className="p-4 rounded-xl bg-neutral-900/50 border border-neutral-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-6">
                  <span className="text-neutral-400 font-semibold">Serviços Base:</span>
                  <span className={telemetry.docker ? 'text-emerald-400 font-mono' : 'text-neutral-500 font-mono'}>
                    ● Docker Engine {telemetry.docker ? 'OK' : 'Ausente'}
                  </span>
                  <span className={telemetry.caddy ? 'text-emerald-400 font-mono' : 'text-neutral-500 font-mono'}>
                    ● Caddy Proxy {telemetry.caddy ? 'OK' : 'Ausente'}
                  </span>
                  <span className={telemetry.cloudflared ? 'text-emerald-400 font-mono' : 'text-neutral-500 font-mono'}>
                    ● Cloudflared {telemetry.cloudflared ? 'OK' : 'Ausente'}
                  </span>
                </div>
                {telemetry.temperatureC && (
                  <span className="text-xs font-mono text-amber-400">
                    Temp: {telemetry.temperatureC}°C
                  </span>
                )}
              </div>

              {/* Lista de Containers Docker Ativos */}
              <div>
                <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider block mb-2">
                  Containers Docker em Execução ({telemetry.containers.length})
                </span>
                {telemetry.containers.length === 0 ? (
                  <div className="p-4 rounded-xl bg-neutral-900/30 border border-neutral-800 text-center text-xs text-neutral-500">
                    Nenhum container Docker ativo no servidor Linux.
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
                    {telemetry.containers.map((c) => (
                      <div key={c.id} className="p-3 flex items-center justify-between text-xs font-mono">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white block">{c.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400">
                              {c.id}
                            </span>
                          </div>
                          <span className="text-[11px] text-neutral-500">{c.image}</span>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <span
                              className={
                                c.status.toLowerCase().includes('up')
                                  ? 'text-emerald-400 block font-semibold'
                                  : 'text-neutral-400 block'
                              }
                            >
                              {c.status}
                            </span>
                            <span className="text-[11px] text-neutral-400">{c.ports || 'Sem mapeamento'}</span>
                          </div>

                          <div className="flex items-center gap-1 pl-3 border-l border-neutral-800">
                            <button
                              type="button"
                              onClick={() => handleContainerAction('start', c.id)}
                              disabled={containerActionLoading === `start-${c.id}`}
                              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-emerald-950 hover:text-emerald-400 text-neutral-300 transition-colors disabled:opacity-50"
                              title="Iniciar Container"
                            >
                              <Play size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleContainerAction('stop', c.id)}
                              disabled={containerActionLoading === `stop-${c.id}`}
                              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-rose-950 hover:text-rose-400 text-neutral-300 transition-colors disabled:opacity-50"
                              title="Parar Container"
                            >
                              <Square size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleContainerAction('restart', c.id)}
                              disabled={containerActionLoading === `restart-${c.id}`}
                              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-cyan-950 hover:text-cyan-400 text-neutral-300 transition-colors disabled:opacity-50"
                              title="Reiniciar Container"
                            >
                              <RotateCw size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleViewContainerLogs(c.id, c.name)}
                              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-indigo-950 hover:text-indigo-400 text-neutral-300 transition-colors"
                              title="Ver Logs do Container"
                            >
                              <FileText size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-neutral-500">
              Clique em "Atualizar" para conectar via SSH e ler a telemetria do Linux.
            </div>
          )}

          {/* Terminal de Saída da Sessão SSH em Tempo Real */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Terminal size={14} className="text-emerald-400" />
              Sessão SSH em Tempo Real (Live Xterm)
            </span>
            <XtermViewer
              logs={logs.map((l) => ({
                projectId: activeNodeId || 'linux',
                stream: l.stream === 'stderr' ? 'stderr' : l.stream === 'system' ? 'system' : 'stdout',
                line: l.line,
                ts: l.ts
              }))}
              height="h-60"
            />
          </div>
        </div>
      )}

      {/* Modal Adicionar Nó */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Cadastrar Servidor Linux Headless (Modelo B)"
        subtitle="Conecte um PC antigo rodando Ubuntu Server ou Debian via rede local."
      >
        <form onSubmit={handleAddNode} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-neutral-300 block mb-1">Nome de Identificação</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Servidor-Debian-Notebook"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Porta SSH</label>
                <InfoTooltip
                  title="Porta do Serviço OpenSSH"
                  description="Porta de escuta do daemon SSH no Linux. O padrão da indústria é a porta 22."
                />
              </div>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Host / IP na Rede Local</label>
                <InfoTooltip
                  title="Endereço IPv4 do Linux"
                  description="O endereço IP atribuído pelo roteador ao seu PC antigo (ex: 192.168.1.150). Você descobre rodando 'ip addr' no terminal do Linux."
                  recommendation="Fixe o IP nas configurações DHCP do seu roteador para evitar que ele mude ao reiniciar."
                />
              </div>
              <input
                type="text"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.150"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Usuário SSH</label>
                <InfoTooltip
                  title="Usuário do Sistema Linux"
                  description="O login de usuário criado durante a instalação do Ubuntu ou Debian (ex: 'ubuntu', 'debian' ou 'root')."
                />
              </div>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root ou ubuntu"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1">Tipo de Autenticação</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuthType('password')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${
                  authType === 'password'
                    ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800'
                }`}
              >
                Senha
              </button>
              <button
                type="button"
                onClick={() => setAuthType('key')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${
                  authType === 'key'
                    ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800'
                }`}
              >
                Chave SSH Privada
              </button>
            </div>
          </div>

          {authType === 'password' ? (
            <div>
              <label className="text-xs font-semibold text-neutral-300 block mb-1">Senha SSH</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-neutral-300 block mb-1">Chave Privada (RSA / Ed25519)</label>
              <textarea
                rows={3}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <div className="flex items-center gap-1 mb-1">
              <label className="text-xs font-semibold text-neutral-300">
                Senha de Sudo (opcional se root)
              </label>
              <InfoTooltip
                title="Privilégios de Administrador (Sudo)"
                description="Necessária para que o Provisionamento 1-Clique instale Docker Engine, Caddy e configure o firewall UFW automaticamente via APT."
              />
            </div>
            <input
              type="password"
              value={sudoPassword}
              onChange={(e) => setSudoPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingNode}
              className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs transition-colors disabled:opacity-50"
            >
              {savingNode ? 'Salvando...' : 'Cadastrar e Conectar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 1-Click Provisionar */}
      <Modal
        isOpen={isProvisionModalOpen}
        onClose={() => setIsProvisionModalOpen(false)}
        title="1-Click Provisionar Servidor Linux"
        subtitle={`Prepara o host '${activeNode?.name}' com pacotes de servidor e bloqueio de suspensão.`}
      >
        <div className="space-y-4">
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={provisionOpts.power}
                onChange={(e) => setProvisionOpts({ ...provisionOpts, power: e.target.checked })}
                className="rounded bg-neutral-900 border-neutral-800 text-emerald-500"
              />
              <span>Ignorar fechamento da tampa do notebook (HandleLidSwitch=ignore)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={provisionOpts.docker}
                onChange={(e) => setProvisionOpts({ ...provisionOpts, docker: e.target.checked })}
                className="rounded bg-neutral-900 border-neutral-800 text-emerald-500"
              />
              <span>Instalar Docker Engine nativo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={provisionOpts.caddy}
                onChange={(e) => setProvisionOpts({ ...provisionOpts, caddy: e.target.checked })}
                className="rounded bg-neutral-900 border-neutral-800 text-emerald-500"
              />
              <span>Instalar Proxy Reverso Caddy</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={provisionOpts.cloudflared}
                onChange={(e) => setProvisionOpts({ ...provisionOpts, cloudflared: e.target.checked })}
                className="rounded bg-neutral-900 border-neutral-800 text-emerald-500"
              />
              <span>Instalar Cloudflared (Cloudflare Tunnel)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={provisionOpts.firewall}
                onChange={(e) => setProvisionOpts({ ...provisionOpts, firewall: e.target.checked })}
                className="rounded bg-neutral-900 border-neutral-800 text-emerald-500"
              />
              <span>Ativar Firewall UFW (libera SSH e tráfego LAN)</span>
            </label>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              onClick={() => setIsProvisionModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleProvision}
              disabled={provisioning}
              className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs transition-colors disabled:opacity-50"
            >
              {provisioning ? 'Executando Scripts...' : 'Iniciar Provisionamento'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Deploy Container */}
      <Modal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
        title="Implantar Container no Servidor Linux"
        subtitle={`Escolha uma das suas APIs para rodar como container no host ${activeNode?.name}.`}
      >
        <form onSubmit={handleDeploy} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1">Selecionar Projeto</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.stack})
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsDeployModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={deploying}
              className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-bold text-xs transition-colors disabled:opacity-50"
            >
              {deploying ? 'Implantando...' : 'Criar e Subir Container'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Logs do Container Remoto */}
      <Modal
        isOpen={Boolean(viewingContainer)}
        onClose={() => setViewingContainer(null)}
        title={`Logs do Container: ${viewingContainer?.name || ''}`}
        subtitle={`Últimas linhas de saída do container (${viewingContainer?.id?.slice(0, 12)}).`}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Container ID: <code className="text-emerald-400 font-mono">{viewingContainer?.id}</code></span>
            <button
              onClick={() => viewingContainer && handleViewContainerLogs(viewingContainer.id, viewingContainer.name)}
              className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs transition-colors"
            >
              Recarregar Logs
            </button>
          </div>
          <XtermViewer
            logs={viewingContainer?.logs || []}
            height="h-80"
          />
        </div>
      </Modal>

      {/* Slide-over Help Drawer */}
      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="Guia Rápido: Servidores Linux Remotos (Modelo B)"
        description="Transforme qualquer PC ou notebook antigo com Ubuntu Server ou Debian em um nó de processamento Docker gerenciado centralmente pelo MyServer via SSH."
        steps={[
          {
            title: '1. Instalação Recomendada do Sistema Operacional',
            description: 'Instale o Ubuntu Server 24.04 LTS ou Debian Netinst sem ambiente gráfico (GUI). Isso reduz o consumo de RAM em repouso para míseros ~200 MB, garantindo estabilidade máxima e evitando travamentos.'
          },
          {
            title: '2. Ativação do OpenSSH e Descoberta de IP',
            description: 'Na tela do seu PC com Linux recém-instalado, faça login e digite o comando abaixo para instalar o servidor SSH e exibir seu endereço IPv4 local (ex: 192.168.1.100):'
          },
          {
            title: '3. Provisionamento em 1-Clique do MyServer',
            description: 'Clique em "Conectar Novo Nó Linux" e insira o IP. Em seguida, clique em "Provisionar Nó". O MyServer executará automaticamente: desativação do modo de suspensão da tampa do notebook via systemd-logind, instalação oficial do Docker Engine e Caddy, e regras do firewall UFW.'
          },
          {
            title: '4. Deploy e Gerenciamento de Containers',
            description: 'Implate APIs Node/Python ou bancos de dados diretamente no nó Linux com monitoramento de CPU, memória, temperatura e logs ao vivo em tempo real.'
          }
        ]}
        codeSnippet="sudo apt update && sudo apt install -y openssh-server && ip -4 addr show | grep inet"
        tips={[
          'Notebooks velhos com tela trincada são excelentes servidores de baixo consumo: a bateria atua como um no-break nativo contra quedas de energia!',
          'Se você marcar "Desativar suspensão ao fechar tampa", você pode fechar a tampa do notebook e guardá-lo em uma prateleira ligado 24/7.'
        ]}
        externalLinks={[
          {
            label: 'Download Ubuntu Server LTS',
            url: 'https://ubuntu.com/download/server'
          },
          {
            label: 'Download Debian Minimal (Netinst)',
            url: 'https://www.debian.org/distrib/netinst'
          },
          {
            label: 'Documentação Oficial Docker Engine',
            url: 'https://docs.docker.com/engine/install/'
          }
        ]}
      />
    </div>
  )
}
