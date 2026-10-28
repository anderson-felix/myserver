import React, { useEffect, useState } from 'react'
import {
  Plus,
  Play,
  Square,
  RotateCw,
  GitPullRequest,
  Terminal as TerminalIcon,
  Trash2,
  Globe,
  FolderOpen,
  GitBranch,
  Radio,
  BookOpen,
  Zap,
  Sparkles,
  Copy,
  Check,
  FileCode,
  Search,
  Edit2
} from 'lucide-react'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { XtermViewer } from '../components/XtermViewer'
import { HelpDrawer } from '../components/HelpDrawer'
import { InfoTooltip } from '../components/InfoTooltip'
import { useToast } from '../components/Toast'
import type { Project, ProjectInput, LogEvent, DomainRecord } from '@shared/types'

export const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([])
  const [domains, setDomains] = useState<DomainRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [activeLogProjectId, setActiveLogProjectId] = useState<string | null>(null)
  const [projectLogs, setProjectLogs] = useState<LogEvent[]>([])
  const [copiedUrlProjId, setCopiedUrlProjId] = useState<string | null>(null)
  const toast = useToast()

  // Formulário de Criação
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState<'local' | 'git'>('local')
  const [source, setSource] = useState('')
  const [branch, setBranch] = useState('main')
  const [stack, setStack] = useState<'node' | 'python' | 'static'>('node')
  const [buildCommand, setBuildCommand] = useState('')
  const [startCommand, setStartCommand] = useState('')
  const [outputDir, setOutputDir] = useState('dist')
  const [spaFallback, setSpaFallback] = useState(true)
  const [apiProxyTarget, setApiProxyTarget] = useState('')
  const [customProxyMode, setCustomProxyMode] = useState(false)
  const [maxMemoryMB, setMaxMemoryMB] = useState(500)
  const [healthcheckPath, setHealthcheckPath] = useState('/health')
  const [domainsInput, setDomainsInput] = useState('')
  const [envInput, setEnvInput] = useState('NODE_ENV=production')
  const [runtime, setRuntime] = useState<'child' | 'service'>('child')
  const [autoStart, setAutoStart] = useState(true)
  const [dataPathsInput, setDataPathsInput] = useState('data, database.sqlite')
  const [submitting, setSubmitting] = useState(false)

  // Auto-Detecção
  const [isDetectingFolder, setIsDetectingFolder] = useState(false)
  const [detectedBadge, setDetectedBadge] = useState<string | null>(null)

  const applyPreset = (preset: 'node' | 'vite' | 'python' | 'html') => {
    if (preset === 'node') {
      setStack('node')
      setBuildCommand('npm install')
      setStartCommand('npm start')
      setHealthcheckPath('/health')
      setSpaFallback(false)
      setDetectedBadge('Preset: API Node.js (Express / Fastify / Nest)')
    } else if (preset === 'vite') {
      setStack('static')
      setBuildCommand('npm install && npm run build')
      setStartCommand('')
      setOutputDir('dist')
      setSpaFallback(true)
      setDetectedBadge('Preset: Front-end React / Vite (SPA Routing Ativo)')
    } else if (preset === 'python') {
      setStack('python')
      setBuildCommand('pip install -r requirements.txt')
      setStartCommand('python -m uvicorn main:app --port 3001')
      setHealthcheckPath('/health')
      setSpaFallback(false)
      setDetectedBadge('Preset: API Python (FastAPI / Uvicorn)')
    } else if (preset === 'html') {
      setStack('static')
      setBuildCommand('')
      setStartCommand('')
      setOutputDir('.')
      setSpaFallback(true)
      setDetectedBadge('Preset: Site HTML / Landing Page Estática')
    }
  }

  const handleInspectFolder = async (folderPath: string) => {
    setIsDetectingFolder(true)
    try {
      const insp = await window.api.inspectFolder(folderPath)
      if (insp) {
        if (!name || name === 'meu-projeto') setName(insp.name)
        setStack(insp.stack)
        setBuildCommand(insp.buildCommand)
        setStartCommand(insp.startCommand)
        if (insp.outputDir) setOutputDir(insp.outputDir)
        if (insp.spaFallback !== undefined) setSpaFallback(insp.spaFallback)
        if (insp.envKeys.length > 0) {
          const lines = Object.entries(insp.envMap).map(([k, v]) => `${k}=${v}`).join('\n')
          setEnvInput(lines)
        }
        setDetectedBadge(`Auto-detectado: Framework ${insp.framework?.toUpperCase()} (${insp.stack.toUpperCase()})`)
      }
    } catch (err) {
      console.warn('Erro ao inspecionar pasta:', err)
    } finally {
      setIsDetectingFolder(false)
    }
  }

  const loadProjects = async () => {
    try {
      const [list, doms] = await Promise.all([
        window.api.listProjects(),
        window.api.listDomains()
      ])
      setProjects(list)
      setDomains(doms)
    } catch (err) {
      console.error('Erro ao listar projetos ou domínios:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
    const interval = setInterval(loadProjects, 4000)

    const unsubStatus = window.api.onProjectStatus(() => {
      loadProjects()
    })

    const unsubLogs = window.api.onProjectLogs((batch) => {
      setProjectLogs((prev) => {
        const relevant = batch.filter((e) => !activeLogProjectId || e.projectId === activeLogProjectId)
        if (relevant.length === 0) return prev
        return [...prev, ...relevant].slice(-1000)
      })
    })

    return () => {
      clearInterval(interval)
      unsubStatus()
      unsubLogs()
    }
  }, [activeLogProjectId])

  const openTerminal = async (projId: string) => {
    setActiveLogProjectId(projId)
    try {
      const logs = await window.api.getProjectLogs(projId)
      setProjectLogs(logs)
    } catch {
      setProjectLogs([])
    }
  }

  const handlePickFolder = async () => {
    const selected = await window.api.pickFolder()
    if (selected) {
      setSource(selected)
      handleInspectFolder(selected)
    }
  }

  const openCreateModal = () => {
    setEditingProjectId(null)
    resetForm()
    setIsCreateModalOpen(true)
  }

  const openEditModal = async (p: Project) => {
    setEditingProjectId(p.id)
    setName(p.name)
    setSourceType(p.sourceType)
    setSource(p.source)
    setBranch(p.branch || 'main')
    setStack(p.stack)
    setBuildCommand(p.buildCommand || '')
    setStartCommand(p.startCommand || '')
    setOutputDir(p.outputDir || 'dist')
    setSpaFallback(p.spaFallback !== false)
    setApiProxyTarget(p.apiProxyTarget || '')
    setCustomProxyMode(!!p.apiProxyTarget)
    setMaxMemoryMB(p.maxMemoryMB || 500)
    setHealthcheckPath(p.healthcheckPath || '/health')
    setDomainsInput((p.domains || []).join(', '))
    setRuntime(p.runtime)
    setAutoStart(p.autoStart)
    setDataPathsInput((p.dataPaths || []).join(', '))
    setDetectedBadge(null)

    try {
      const env = await window.api.getProjectEnv(p.id)
      const lines = Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n')
      setEnvInput(lines || 'NODE_ENV=production')
    } catch {
      setEnvInput('NODE_ENV=production')
    }

    setIsCreateModalOpen(true)
  }

  const handleAddDomainPill = (host: string) => {
    const current = domainsInput
      .split(/[,\s]+/)
      .map((d) => d.trim())
      .filter(Boolean)
    if (!current.includes(host)) {
      setDomainsInput([...current, host].join(', '))
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !source.trim()) return

    setSubmitting(true)
    try {
      // Parse de variáveis .env
      const env: Record<string, string> = {}
      for (const line of envInput.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx > 0) {
          env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
        }
      }

      // Parse de domínios
      const domains = domainsInput
        .split(/[,\s]+/)
        .map((d) => d.trim())
        .filter(Boolean)

      // Parse de data paths
      const dataPaths = dataPathsInput
        .split(/[,\s]+/)
        .map((d) => d.trim())
        .filter(Boolean)

      const input: ProjectInput = {
        name,
        sourceType,
        source,
        branch: sourceType === 'git' ? branch : undefined,
        stack,
        buildCommand,
        startCommand,
        outputDir: stack === 'static' ? outputDir : undefined,
        spaFallback: stack === 'static' ? spaFallback : undefined,
        apiProxyTarget: stack === 'static' && apiProxyTarget.trim() ? apiProxyTarget.trim() : undefined,
        maxMemoryMB: Number(maxMemoryMB) || 500,
        healthcheckPath: healthcheckPath.trim() || undefined,
        domains,
        env,
        runtime,
        autoStart,
        dataPaths
      }

      if (editingProjectId) {
        await window.api.updateProject(editingProjectId, input)
        toast.success('Projeto atualizado!', `Configurações de '${name}' salvas com sucesso.`)
      } else {
        const created = await window.api.createProject(input)
        toast.success('Projeto criado com sucesso!', `'${name}' está pronto para ser executado.`)
        openTerminal(created.id)
      }

      setIsCreateModalOpen(false)
      resetForm()
      await loadProjects()
    } catch (err) {
      toast.error('Erro ao salvar projeto', (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setName('')
    setSource('')
    setBranch('main')
    setBuildCommand('')
    setStartCommand('')
    setOutputDir('dist')
    setSpaFallback(true)
    setApiProxyTarget('')
    setDomainsInput('')
    setEnvInput('NODE_ENV=production')
    setDetectedBadge(null)
  }

  const handleStart = async (id: string) => {
    try {
      await window.api.startProject(id)
      openTerminal(id)
      loadProjects()
      toast.success('Projeto iniciado')
    } catch (err) {
      toast.error('Falha ao iniciar', (err as Error).message)
    }
  }

  const handleStop = async (id: string) => {
    try {
      await window.api.stopProject(id)
      loadProjects()
      toast.info('Projeto parado')
    } catch (err) {
      toast.error('Falha ao parar', (err as Error).message)
    }
  }

  const handleRestart = async (id: string) => {
    try {
      await window.api.restartProject(id)
      openTerminal(id)
      loadProjects()
      toast.success('Projeto reiniciado')
    } catch (err) {
      toast.error('Falha ao reiniciar', (err as Error).message)
    }
  }

  const handleRedeploy = async (id: string) => {
    try {
      openTerminal(id)
      await window.api.redeployProject(id)
      loadProjects()
      toast.success('Redeploy executado')
    } catch (err) {
      toast.error('Falha no redeploy', (err as Error).message)
    }
  }

  const handleDelete = async (id: string, projName: string) => {
    const ok = await toast.confirm(`Deseja realmente remover o projeto '${projName}'?`, {
      title: 'Remover Projeto',
      confirmLabel: 'Remover',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.deleteProject(id)
      if (activeLogProjectId === id) setActiveLogProjectId(null)
      loadProjects()
      toast.success('Projeto removido')
    } catch (err) {
      toast.error('Erro ao remover', (err as Error).message)
    }
  }

  const handleQuickTunnel = async (project: Project) => {
    try {
      const port = project.port || 80
      await window.api.startQuickTunnel(port, project.id, `Túnel para ${project.name}`)
      toast.success('Quick Tunnel solicitado', 'Verifique o link gerado e o QR Code na aba Roteamento.')
    } catch (err) {
      toast.error('Falha ao gerar túnel', (err as Error).message)
    }
  }

  const activeProject = projects.find((p) => p.id === activeLogProjectId)

  return (
    <div className="space-y-6">
      {/* Header com botão de criar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Aplicações Hospedadas</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Mini-Vercel local para gerenciar APIs Node.js, microsserviços Python e páginas estáticas com zero custo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsGuideOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 hover:border-neutral-700 font-medium text-xs flex items-center gap-2 transition-all"
          >
            <BookOpen size={15} className="text-emerald-400" />
            <span>📖 Guia Rápido de Deploy</span>
          </button>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
          >
            <Plus size={16} />
            <span>Novo Projeto</span>
          </button>
        </div>
      </div>

      {/* Lista de Projetos */}
      {loading ? (
        <div className="p-12 text-center text-xs text-neutral-500">Carregando projetos...</div>
      ) : projects.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center flex flex-col items-center justify-center">
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 text-neutral-500 mb-4">
            <Radio size={32} />
          </div>
          <h3 className="text-base font-semibold text-white">Nenhum projeto cadastrado</h3>
          <p className="text-xs text-neutral-400 max-w-md mt-1 mb-6">
            Conecte uma pasta local ou repositório Git para iniciar sua primeira API com alocação automática de porta e monitoramento de saúde.
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs flex items-center gap-2 transition-colors border border-neutral-700"
          >
            <Plus size={16} />
            <span>Cadastrar Projeto</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="glass-panel glass-panel-hover rounded-xl p-5 border border-neutral-800">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-white font-mono">{p.name}</h3>
                    <Badge status={p.status} />
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400">
                      {p.stack.toUpperCase()}
                    </span>
                    {p.runtime === 'service' && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-500/30 text-indigo-300">
                        NSSM Service
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-neutral-400">
                    <span className="font-mono">
                      Porta:{' '}
                      <strong className="text-emerald-400">{p.port ? `:${p.port}` : 'Não alocada'}</strong>
                    </span>
                    {p.port && (
                      <button
                        onClick={async () => {
                          const url = `http://127.0.0.1:${p.port}`
                          await navigator.clipboard.writeText(url)
                          setCopiedUrlProjId(p.id)
                          setTimeout(() => setCopiedUrlProjId(null), 2000)
                        }}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white transition-colors text-[11px] font-mono"
                        title="Copiar URL local de acesso"
                      >
                        {copiedUrlProjId === p.id ? (
                          <>
                            <Check size={11} className="text-emerald-400" />
                            <span className="text-emerald-400 font-semibold">Copiado! ✓</span>
                          </>
                        ) : (
                          <>
                            <Copy size={11} className="text-neutral-500" />
                            <span>http://127.0.0.1:{p.port}</span>
                          </>
                        )}
                      </button>
                    )}
                    {p.pid && (
                      <span className="font-mono">
                        PID: <strong className="text-cyan-400">{p.pid}</strong>
                      </span>
                    )}
                    {p.memoryMB !== null && (
                      <span className="font-mono">
                        RAM: <strong className="text-amber-400">{p.memoryMB} MB</strong> / {p.maxMemoryMB} MB
                      </span>
                    )}
                    {p.restarts > 0 && (
                      <span className="font-mono text-rose-400">
                        {p.restarts} reinício(s)
                      </span>
                    )}
                  </div>
                </div>

                {/* Ações */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {p.status === 'running' ? (
                    <button
                      onClick={() => handleStop(p.id)}
                      className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-rose-400 hover:text-rose-300 border border-neutral-800 transition-colors"
                      title="Parar aplicação"
                    >
                      <Square size={15} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStart(p.id)}
                      className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-colors"
                      title="Iniciar aplicação"
                    >
                      <Play size={15} />
                    </button>
                  )}

                  <button
                    onClick={() => handleRestart(p.id)}
                    className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 transition-colors"
                    title="Reiniciar processo"
                  >
                    <RotateCw size={15} />
                  </button>

                  <button
                    onClick={() => handleRedeploy(p.id)}
                    className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-cyan-400 hover:text-cyan-300 border border-neutral-800 transition-colors"
                    title="Redeploy (Git pull + Build + Start)"
                  >
                    <GitPullRequest size={15} />
                  </button>

                  <button
                    onClick={() => openTerminal(p.id)}
                    className={`p-2 rounded-lg border transition-colors ${
                      activeLogProjectId === p.id
                        ? 'bg-neutral-800 text-emerald-400 border-emerald-500/40'
                        : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border-neutral-800'
                    }`}
                    title="Ver Terminal de Logs"
                  >
                    <TerminalIcon size={15} />
                  </button>

                  <button
                    onClick={() => handleQuickTunnel(p)}
                    className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-indigo-400 hover:text-indigo-300 border border-neutral-800 transition-colors"
                    title="Gerar Link Público Instantâneo (Cloudflare Quick Tunnel)"
                  >
                    <Globe size={15} />
                  </button>

                  <button
                    onClick={() => openEditModal(p)}
                    className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-emerald-400 border border-neutral-800 transition-colors"
                    title="Editar configurações do projeto"
                  >
                    <Edit2 size={15} />
                  </button>

                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-500 hover:text-rose-400 border border-neutral-800 transition-colors"
                    title="Remover projeto"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Sub-barra de detalhes */}
              <div className="mt-4 pt-3 border-t border-neutral-800/80 flex items-center justify-between text-[11px] text-neutral-400">
                <div className="flex items-center gap-4">
                  <span className="truncate max-w-md font-mono" title={p.source}>
                    Origem: <span className="text-neutral-300">{p.source}</span>
                  </span>
                  {p.domains && p.domains.length > 0 && (
                    <span className="font-mono text-emerald-400">
                      Domínios: {p.domains.join(', ')}
                    </span>
                  )}
                </div>
                {p.statusMessage && (
                  <span className="text-neutral-500 italic max-w-xs truncate">{p.statusMessage}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Terminal de Logs ao Vivo (XtermViewer) */}
      {activeLogProjectId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TerminalIcon size={16} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">
                Terminal de Logs: <span className="font-mono text-emerald-300">{activeProject?.name}</span>
              </h3>
            </div>
            <button
              onClick={() => setActiveLogProjectId(null)}
              className="text-xs text-neutral-400 hover:text-white transition-colors"
            >
              Fechar Terminal
            </button>
          </div>
          <XtermViewer logs={projectLogs} projectId={activeLogProjectId} height="h-80" />
        </div>
      )}

      {/* Modal de Criação / Edição de Projeto */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={editingProjectId ? 'Editar Configurações do Projeto' : 'Cadastrar Novo Projeto (Mini-Vercel)'}
        subtitle={
          editingProjectId
            ? 'Atualize portas, domínios vinculados, comandos ou variáveis de ambiente da aplicação.'
            : 'Configure a origem, stack, variáveis de ambiente e regras de auto-recuperação da API.'
        }
        maxWidth="2xl"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {/* Pílulas de Presets em 1-Clique */}
          <div className="space-y-1.5 pb-2 border-b border-neutral-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Modelos Rápidos (Presets em 1-Clique)
              </span>
              <span className="text-[11px] text-neutral-500">Preenche comandos e configurações ideais</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => applyPreset('node')}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  stack === 'node'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40 shadow-sm'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                <Zap size={13} className="text-emerald-400" />
                <span>⚡ API Node.js</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('vite')}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  stack === 'static' && outputDir === 'dist'
                    ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/40 shadow-sm'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                <Sparkles size={13} className="text-cyan-400" />
                <span>⚛️ React / Vite (SPA)</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('python')}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  stack === 'python'
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/40 shadow-sm'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                <span>🐍 API Python</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('html')}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  stack === 'static' && outputDir !== 'dist'
                    ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/40 shadow-sm'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                <FileCode size={13} className="text-indigo-400" />
                <span>📄 Site Estático</span>
              </button>
            </div>
          </div>

          {/* Banner de Auto-Detecção / Spinner */}
          {isDetectingFolder && (
            <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex items-center gap-2 text-cyan-300 text-xs animate-pulse">
              <Search size={14} className="animate-spin text-cyan-400" />
              <span>Inspecionando arquivos do projeto e detectando configurações ideais...</span>
            </div>
          )}
          {!isDetectingFolder && detectedBadge && (
            <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-emerald-400 shrink-0" />
                <span className="font-medium">{detectedBadge}</span>
              </div>
              <button
                type="button"
                onClick={() => setDetectedBadge(null)}
                className="text-neutral-400 hover:text-white text-[11px] underline ml-2"
              >
                Dispensar
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Nome do Projeto</label>
                <InfoTooltip
                  title="Identificador Único"
                  description="Nome interno do serviço no MyServer. Utilizado em logs, rotas de proxy reverso e certificados Caddy."
                  recommendation="Use letras minúsculas e hífens, sem espaços ou caracteres especiais (ex: backend-api, painel-admin)."
                />
              </div>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: minha-api-backend"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Stack de Execução</label>
                <InfoTooltip
                  title="Ambiente de Execução"
                  description="Define como o processo será iniciado e gerenciado pelo sistema."
                  recommendation="Node.js para APIs Javascript/Typescript com runtime embutido; Estático para SPA React/Vite/HTML; Python para scripts e FastAPI."
                />
              </div>
              <select
                value={stack}
                onChange={(e) => setStack(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
              >
                <option value="node">Node.js (LTS Isolado Embutido)</option>
                <option value="python">Python</option>
                <option value="static">Estático (HTML / React Build via Caddy)</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-semibold text-neutral-300">Tipo de Origem</label>
              <InfoTooltip
                title="Origem do Código-Fonte"
                description="Escolha entre uma pasta local no seu computador ou um repositório Git remoto (com suporte a git pull automático no redeploy)."
                recommendation="Para desenvolvimento ágil no mesmo PC, escolha Pasta Local. Para CI/CD de repositórios, escolha Git."
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSourceType('local')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 ${
                  sourceType === 'local'
                    ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800'
                }`}
              >
                <FolderOpen size={14} />
                <span>Pasta Local</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceType('git')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 ${
                  sourceType === 'git'
                    ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800'
                }`}
              >
                <GitBranch size={14} />
                <span>Repositório Git</span>
              </button>
            </div>
          </div>

          {sourceType === 'local' ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-semibold text-neutral-300">Caminho da Pasta no Computador</label>
                  <InfoTooltip
                    title="Seletor com Auto-Detecção"
                    description="Selecione a pasta raiz do seu projeto. O MyServer detectará automaticamente package.json, requirements.txt, .env e frameworks como Vite ou Next."
                    recommendation="Clique no botão 'Escolher Pasta...' para navegar visualmente e evitar erros de digitação."
                  />
                </div>
                {source && (
                  <button
                    type="button"
                    onClick={() => handleInspectFolder(source)}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                    title="Re-executar inspeção de arquivos nesta pasta"
                  >
                    <Search size={12} />
                    <span>Re-inspecionar</span>
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  onBlur={() => {
                    if (source.trim() && !detectedBadge) {
                      handleInspectFolder(source.trim())
                    }
                  }}
                  placeholder="C:\MeusProjetos\api"
                  className="flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs flex items-center gap-1.5 transition-colors border border-neutral-700 shrink-0"
                >
                  <FolderOpen size={14} className="text-emerald-400" />
                  <span>Escolher Pasta...</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-semibold text-neutral-300">URL do Repositório Git</label>
                  <InfoTooltip
                    title="Repositório Remoto"
                    description="URL pública ou com token de autenticação HTTPS do GitHub, GitLab ou Bitbucket."
                    recommendation="Use formato HTTPS (ex: https://github.com/usuario/meu-projeto.git)."
                  />
                </div>
                <input
                  type="text"
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="https://github.com/usuario/repo.git"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-neutral-300 block mb-1">Branch</label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Comando de Build</label>
                <InfoTooltip
                  title="Etapa de Compilação"
                  description="Comando executado uma única vez antes de iniciar o projeto para instalar dependências e gerar bundles."
                  recommendation="Node: npm install || React/Vite: npm install && npm run build || Python: pip install -r requirements.txt."
                />
              </div>
              <input
                type="text"
                value={buildCommand}
                onChange={(e) => setBuildCommand(e.target.value)}
                placeholder="npm install && npm run build"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Comando de Start</label>
                <InfoTooltip
                  title="Comando de Execução Principal"
                  description="Comando de longa duração monitorado 24/7. Se o processo travar, o MyServer o reinicia automaticamente."
                  recommendation="Node: npm start ou node server.js || Python: uvicorn main:app --port 3001 || Estático: deixe vazio (Caddy gerencia)."
                />
              </div>
              <input
                type="text"
                value={startCommand}
                onChange={(e) => setStartCommand(e.target.value)}
                placeholder={stack === 'static' ? 'Não aplicável (Caddy file_server)' : 'npm start ou node dist/server.js'}
                disabled={stack === 'static'}
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Limite RAM (MB)</label>
                <InfoTooltip
                  title="Proteção contra Vazamento de Memória"
                  description="Se o processo ultrapassar este consumo de memória RAM por mais de 3 verificações, será reiniciado de forma limpa."
                  recommendation="500 MB para APIs Node normais; 200 MB para microsserviços leves; 1024 MB para apps com processamento de imagem/IA."
                />
              </div>
              <input
                type="number"
                value={maxMemoryMB}
                onChange={(e) => setMaxMemoryMB(Number(e.target.value))}
                placeholder="500"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Rota Healthcheck</label>
                <InfoTooltip
                  title="Verificação de Saúde HTTP"
                  description="Endpoint GET consultado periodicamente para validar que a API está respondendo com HTTP 200 OK."
                  recommendation="/health ou /api/health. Se a API travar em loop infinito, o MyServer detecta e reinicia."
                />
              </div>
              <input
                type="text"
                value={healthcheckPath}
                onChange={(e) => setHealthcheckPath(e.target.value)}
                placeholder="/health"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Modo de Execução</label>
                <InfoTooltip
                  title="Subprocesso vs Serviço Windows"
                  description="Subprocesso local roda junto com o MyServer; Serviço Windows (NSSM) continua rodando mesmo se o usuário fizer logoff."
                  recommendation="Para a maioria das aplicações em desktop/notebook, use Subprocesso Local."
                />
              </div>
              <select
                value={runtime}
                onChange={(e) => setRuntime(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
              >
                <option value="child">Subprocesso Local</option>
                <option value="service">Serviço Windows (NSSM)</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-semibold text-neutral-300">Domínios Customizados (Caddy Proxy)</label>
              <InfoTooltip
                title="Roteamento Caddy por Domínio"
                description="Domínios locais ou públicos que apontam para esta aplicação. O Caddy gera SSL automático se o domínio for público."
                recommendation="Ex: api.meusite.com.br, app.localhost. Deixe vazio para usar apenas porta interna."
              />
            </div>
            <input
              type="text"
              value={domainsInput}
              onChange={(e) => setDomainsInput(e.target.value)}
              placeholder="api.meudominio.com, app.localhost"
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
            />
            {/* Pílulas de domínios rápidos cadastrados na Central de Domínios */}
            {domains && domains.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-neutral-500 font-medium">Atalhos da Central de Domínios:</span>
                {domains.map((d) => {
                  const suggestions = [
                    d.domain,
                    `api.${d.domain}`,
                    `app.${d.domain}`,
                    ...(d.subdomains?.map((s) => s.fullHostname) || [])
                  ]
                  const unique = Array.from(new Set(suggestions))
                  return (
                    <div key={d.id} className="contents">
                      {unique.map((sug) => (
                        <button
                          key={sug}
                          type="button"
                          onClick={() => handleAddDomainPill(sug)}
                          className="px-2 py-0.5 rounded-md bg-neutral-900 hover:bg-emerald-950/60 border border-neutral-800 hover:border-emerald-500/40 text-[11px] font-mono text-neutral-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
                          title={`Adicionar ${sug} aos domínios do projeto`}
                        >
                          <span className="text-emerald-500 font-bold">+</span>
                          <span>{sug}</span>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {stack === 'static' && (
            <div className="space-y-3 p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-semibold text-neutral-300">
                    Pasta de Saída dos Arquivos Estáticos (Build Output)
                  </label>
                  <InfoTooltip
                    title="Diretório de Distribuição"
                    description="Subpasta onde ficam os arquivos HTML, JS e CSS compilados após o comando de build."
                    recommendation="Para Vite e React modernos, use 'dist'. Para Create React App clássico, use 'build'. Para HTML puro, use '.'."
                  />
                </div>
                <input
                  type="text"
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.target.value)}
                  placeholder="dist ou build"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-semibold text-neutral-300">
                      Vincular Backend API / Proxy <code className="text-emerald-400">/api/*</code> (Opcional)
                    </label>
                    <InfoTooltip
                      title="Eliminação 100% de Erros de CORS"
                      description="O Caddy intercepta qualquer chamada feita pelo Front-end para /api/* no mesmo domínio/porta e a repassa para a porta interna da sua API."
                      recommendation="Selecione sua API cadastrada no dropdown para que o Front-end faça fetch('/api/...') direto, sem precisar configurar headers CORS."
                    />
                  </div>
                  {projects.filter((p) => (p.stack === 'node' || p.stack === 'python') && p.port).length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCustomProxyMode(!customProxyMode)}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 underline"
                    >
                      {customProxyMode ? 'Usar seletor de API' : 'Digitar IP/porta manualmente'}
                    </button>
                  )}
                </div>

                {!customProxyMode && projects.filter((p) => (p.stack === 'node' || p.stack === 'python') && p.port).length > 0 ? (
                  <select
                    value={apiProxyTarget}
                    onChange={(e) => setApiProxyTarget(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">Nenhum proxy (Front-end independente)</option>
                    {projects
                      .filter((p) => (p.stack === 'node' || p.stack === 'python') && p.port)
                      .map((api) => (
                        <option key={api.id} value={`127.0.0.1:${api.port}`}>
                          Redirecionar chamadas /api/* para: {api.name} (Porta {api.port} - {api.stack.toUpperCase()})
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={apiProxyTarget}
                    onChange={(e) => setApiProxyTarget(e.target.value)}
                    placeholder="ex: 127.0.0.1:3001 ou http://localhost:3001"
                    className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                )}
                <p className="text-[11px] text-neutral-400 mt-1">
                  Requisições do front-end para <code className="text-neutral-300">/api/*</code> serão redirecionadas diretamente para a porta interna da sua API no Caddy, eliminando erros de CORS.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="spaFallback"
                  checked={spaFallback}
                  onChange={(e) => setSpaFallback(e.target.checked)}
                  className="rounded bg-neutral-900 border-neutral-800 text-emerald-500 focus:ring-0"
                />
                <label htmlFor="spaFallback" className="text-xs text-neutral-300 cursor-pointer">
                  Habilitar <strong>SPA Routing Fallback</strong> (entrega <code className="text-emerald-400">/index.html</code> em rotas do React/Vue/Vite sem erro 404)
                </label>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-semibold text-neutral-300">
                Diretórios / Arquivos para Backup Automático (separados por vírgula)
              </label>
              <InfoTooltip
                title="Itens Incluídos no Backup"
                description="Pastas ou arquivos dentro do projeto que guardam dados persistentes e devem ser incluídos nos backups diários criptografados."
                recommendation="Ex: data, database.sqlite, uploads, .env. Arquivos de dependência (node_modules) são ignorados automaticamente."
              />
            </div>
            <input
              type="text"
              value={dataPathsInput}
              onChange={(e) => setDataPathsInput(e.target.value)}
              placeholder="data, database.sqlite, uploads"
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Variáveis de Ambiente (.env criptografadas em AES-256)
                </label>
                <InfoTooltip
                  title="Segurança de Segredos"
                  description="Chaves e valores de banco de dados, JWT ou API keys são criptografados com chave local do Windows e injetados de forma segura nas variáveis do processo."
                  recommendation="Cole o conteúdo completo do seu arquivo .env ou clique em carregar diretamente da pasta do projeto."
                />
              </div>
              {sourceType === 'local' && source && (
                <button
                  type="button"
                  onClick={() => handleInspectFolder(source)}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
                  title="Lê o arquivo .env ou .env.production da pasta selecionada"
                >
                  <FileCode size={12} />
                  <span>Carregar .env da pasta</span>
                </button>
              )}
            </div>
            <textarea
              rows={3}
              value={envInput}
              onChange={(e) => setEnvInput(e.target.value)}
              placeholder="KEY=VALUE&#10;DATABASE_URL=file:./prod.db"
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autostart"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
              className="rounded bg-neutral-900 border-neutral-800 text-emerald-500 focus:ring-0"
            />
            <label htmlFor="autostart" className="text-xs text-neutral-300">
              Iniciar automaticamente no boot do servidor
            </label>
          </div>

          <div className="pt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs transition-colors disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : editingProjectId ? 'Salvar Alterações' : 'Salvar e Fazer Deploy'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Gaveta de Ajuda / Mini-Documentação In-App */}
      <HelpDrawer
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        title="Guia Rápido: Publicando Aplicações no MyServer"
        badge="Mini-Vercel Local"
        subtitle="Como hospedar APIs Node.js/Python e Front-ends React/Vite com zero atrito e alocação automática de porta"
        sections={[
          {
            title: '1. Escolha a Pasta e deixe a Auto-Detecção Trabalhar',
            steps: [
              'Clique no botão "Escolher Pasta..." ao criar um novo projeto.',
              'O MyServer analisa automaticamente package.json, requirements.txt ou vite.config.*.',
              'O nome do projeto, comandos de build e start ideais são preenchidos sem você precisar digitar nada.'
            ],
            tip: 'Você também pode clicar nos botões de Presets no topo do modal (ex: ⚡ API Node.js ou ⚛️ React/Vite) para preenchimento imediato.'
          },
          {
            title: '2. Stacks Suportadas e Isolamento',
            steps: [
              'Node.js: Executa com runtime Node.js isolado embutido no MyServer. Não requer Node instalado globalmente na máquina.',
              'Front-end Estático (React / Vite / Vue / Next Export / HTML): O Caddy serve os arquivos compilados (pasta dist) com suporte a SPA Fallback.',
              'Python: Executa seu servidor FastAPI/Flask (ex: uvicorn main:app --port $PORT) com alocação automática de porta.'
            ]
          },
          {
            title: '3. Como Conectar Front-end à API sem Erro de CORS',
            steps: [
              'Ao cadastrar um Front-end Estático, ative a opção "Vincular Backend API / Proxy /api/*".',
              'Selecione sua API cadastrada no MyServer no dropdown.',
              'O Caddy encaminhará todas as chamadas /api/* do front-end diretamente para o backend na mesma porta ou domínio, eliminando 100% dos erros de CORS!'
            ],
            tip: 'No código do seu React/Vue, faça simplesmente fetch("/api/usuarios") sem precisar colocar http://localhost:3001 na URL!'
          },
          {
            title: '4. Expor sua Aplicação na Internet',
            steps: [
              'Após iniciar o projeto, clique no ícone de Globo no card.',
              'Um Cloudflare Quick Tunnel seguro será criado instantaneamente.',
              'Acesse a aba "Rede & Tunnels" para copiar o link público (https://*.trycloudflare.com) ou escanear o QR Code no seu celular.'
            ]
          }
        ]}
        externalLinks={[
          { label: 'Guia de Deploy Vite', url: 'https://vite.dev/guide/static-deploy.html' },
          { label: 'Documentação Oficial do Caddy', url: 'https://caddyserver.com/docs/' },
          { label: 'FastAPI Deployment Guide', url: 'https://fastapi.tiangolo.com/deployment/' }
        ]}
      />
    </div>
  )
}
