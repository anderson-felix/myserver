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
  ShieldCheck
} from 'lucide-react'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { HelpDrawer } from '../components/HelpDrawer'
import { InfoTooltip } from '../components/InfoTooltip'
import type { ProxyStatus, TunnelStatus, QuickTunnel, Project } from '@shared/types'

export const Networking: React.FC = () => {
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null)
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [isHelpOpen, setIsHelpOpen] = useState(false)

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

  const loadData = async () => {
    try {
      const [px, tun, prjs] = await Promise.all([
        window.api.getProxyStatus(),
        window.api.getTunnelStatus(),
        window.api.listProjects()
      ])
      setProxyStatus(px)
      setTunnelStatus(tun)
      setProjects(prjs)
      if (prjs.length > 0 && !selectedProjectId) {
        setSelectedProjectId(prjs[0].id)
      }
    } catch (err) {
      console.error('Falha ao carregar status de rede:', err)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 4000)

    const unsubTunnel = window.api.onTunnelUpdate(() => {
      loadData()
    })

    return () => {
      clearInterval(interval)
      unsubTunnel()
    }
  }, [])

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
      alert(`Falha ao disparar Quick Tunnel: ${(err as Error).message}`)
    } finally {
      setStartingQuick(false)
    }
  }

  const handleStopQuick = async (id: string) => {
    try {
      await window.api.stopQuickTunnel(id)
      loadData()
    } catch (err) {
      alert(`Falha ao parar túnel: ${(err as Error).message}`)
    }
  }

  const handleConfigureNamed = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!namedToken.trim()) return
    setConfiguringNamed(true)
    try {
      await window.api.configureNamedTunnel(namedToken)
      setNamedToken('')
      alert('Serviço Cloudflared permanente instalado com sucesso!')
      loadData()
    } catch (err) {
      alert(`Erro ao configurar Named Tunnel: ${(err as Error).message}`)
    } finally {
      setConfiguringNamed(false)
    }
  }

  const handleUninstallNamed = async () => {
    if (!confirm('Deseja desinstalar o serviço permanente do Cloudflare?')) return
    try {
      await window.api.uninstallNamedTunnel()
      loadData()
    } catch (err) {
      alert(`Erro ao desinstalar: ${(err as Error).message}`)
    }
  }

  const handleSyncProxy = async () => {
    try {
      await window.api.syncProxyRoutes()
      loadData()
    } catch (err) {
      alert(`Falha ao sincronizar: ${(err as Error).message}`)
    }
  }

  const copyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Roteamento & Exposição na Internet</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Controle do Proxy Reverso Caddy e Túneis Cloudflare para vencer o CGNAT sem precisar abrir portas no roteador.
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
            <strong>Ideal para:</strong> Testar agora no celular ou enviar link para um cliente aprovar.
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
                onClick={() => window.api.installProxyService().then(() => alert('Serviço Caddy instalado!'))}
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

      {/* Seção 2: Cloudflare Quick Tunnels (Zero-Config) */}
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

        {/* Lista de Quick Tunnels Ativos */}
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
                        onClick={() => copyUrl(t.id, t.url!)}
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

      {/* Seção 3: Cloudflare Named Tunnel (Produção 24/7) */}
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

        <form onSubmit={handleConfigureNamed} className="space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-semibold text-neutral-300">
                Token do Cloudflare Zero Trust Connector
              </label>
              <InfoTooltip
                title="Token do Conector Cloudflared"
                description="Token alfanumérico longo gerado pelo painel Zero Trust (Networks > Tunnels). Ele identifica seu túnel de forma segura sem requerer login."
              />
            </div>
            <input
              type="password"
              value={namedToken}
              onChange={(e) => setNamedToken(e.target.value)}
              placeholder="Cole o token eyJh... gerado no painel da Cloudflare"
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
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
              className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
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
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
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
        title="Guia de Roteamento, Proxy & Túneis Cloudflare"
        description="Aprenda a publicar seus serviços e Front-ends na internet com segurança, vencendo bloqueios de CGNAT e roteadores domésticos sem abrir portas."
        steps={[
          {
            title: '1. Proxy Reverso Caddy Local',
            description: 'O Caddy centraliza as conexões da porta 80 e despacha requisições para cada API e Front-end cadastrado. Ele também gerencia cabeçalhos de segurança (X-Content-Type-Options, Frame-Options) e limite de corpo de requisições.'
          },
          {
            title: '2. Quick Tunnel (*.trycloudflare.com) em 1 Clique',
            description: 'Gera uma URL pública temporária e um QR Code para acesso no celular em 2 segundos. Ideal para mostrar seu progresso para um colega ou cliente sem precisar configurar DNS.'
          },
          {
            title: '3. Named Tunnel em 4 Cliques (Produção 24/7 com Domínio Próprio)',
            description: '1. Acesse one.dash.cloudflare.com > Networks > Tunnels > Create a tunnel.\n2. Escolha "Cloudflared" e dê um nome.\n3. Em "Install connector", selecione Windows e copie apenas o Token longo (eyJh...).\n4. Cole o token no campo do MyServer e clique em "Instalar e Iniciar Serviço".'
          },
          {
            title: '4. Conectando Subdomínios (Public Hostnames)',
            description: 'No painel da Cloudflare, na aba "Public Hostname" do seu túnel, adicione subdomínios como api.seusite.com apontando para http://localhost:3001. A Cloudflare cuida do certificado SSL e proteção DDoS.'
          }
        ]}
        tips={[
          'O Cloudflare Tunnel é 100% gratuito e não exige que você contrate IP fixo com sua provedora de internet.',
          'Nenhuma porta precisa ser aberta no roteador (port forwarding): o túnel cria uma conexão outbound persistente e segura.'
        ]}
        externalLinks={[
          {
            label: 'Painel Cloudflare Zero Trust (one.dash.cloudflare.com)',
            url: 'https://one.dash.cloudflare.com'
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
