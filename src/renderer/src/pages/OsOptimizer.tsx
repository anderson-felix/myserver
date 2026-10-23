import React, { useEffect, useState } from 'react'
import {
  ShieldCheck,
  Zap,
  Wifi,
  Flame,
  UserCheck,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
  Sliders,
  Laptop,
  BookOpen
} from 'lucide-react'
import { BiosChecklistModal } from '../components/BiosChecklistModal'
import { HelpDrawer } from '../components/HelpDrawer'
import { InfoTooltip } from '../components/InfoTooltip'
import type { HardeningOptions, HardeningReport, NetworkPreview } from '@shared/types'

export const OsOptimizer: React.FC = () => {
  const [networkPreview, setNetworkPreview] = useState<NetworkPreview | null>(null)
  const [isBiosModalOpen, setIsBiosModalOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<HardeningReport | null>(null)

  // Opções de Hardening
  const [options, setOptions] = useState<HardeningOptions>({
    power: true,
    staticIp: true,
    firewall: true,
    restrictedUser: true
  })

  const loadNetwork = async () => {
    try {
      const net = await window.api.previewNetwork()
      setNetworkPreview(net)
    } catch (err) {
      console.error('Falha ao carregar preview de rede:', err)
    }
  }

  useEffect(() => {
    loadNetwork()
  }, [])

  const handleRunHardening = async () => {
    if (!confirm('Deseja aplicar a otimização de servidor no Windows? Se o aplicativo não estiver com privilégios de Administrador, uma janela do UAC será solicitada.')) {
      return
    }

    setRunning(true)
    try {
      const res = await window.api.runHardening(options)
      setReport(res)
      loadNetwork()
    } catch (err) {
      alert(`Erro durante a otimização: ${(err as Error).message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Otimizador de Sistema & Blindagem</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            1-Click Tuning do Windows para transformar qualquer PC ou Notebook antigo em um servidor dedicado 24/7.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsHelpOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-emerald-300 font-medium text-xs flex items-center gap-2 border border-emerald-500/30 transition-colors shadow-lg"
          >
            <BookOpen size={14} />
            <span>📖 Guia Rápido desta Tela</span>
          </button>
          <button
            onClick={() => setIsBiosModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-amber-300 font-medium text-xs flex items-center gap-2 border border-amber-500/30 transition-colors shadow-lg"
          >
            <HelpCircle size={15} />
            <span>Checklist de BIOS (Power Loss)</span>
          </button>
        </div>
      </div>

      {/* Painel Principal de Otimização */}
      <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Sliders size={24} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Configurações de Otimização Automática</h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                Selecione as políticas de endurecimento do sistema operacional a serem aplicadas.
              </p>
            </div>
          </div>

          <button
            onClick={handleRunHardening}
            disabled={running}
            className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs flex items-center gap-2 transition-all shadow-xl shadow-emerald-500/25 disabled:opacity-50"
          >
            {running ? <RefreshCw className="animate-spin" size={16} /> : <Zap size={16} />}
            <span>{running ? 'Otimizando Servidor...' : '1-Click Otimizar Servidor'}</span>
          </button>
        </div>

        {/* Checkboxes das 4 frentes de hardening */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. Energia */}
          <label className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-start gap-3 cursor-pointer hover:border-emerald-500/40 transition-colors">
            <input
              type="checkbox"
              checked={options.power}
              onChange={(e) => setOptions({ ...options, power: e.target.checked })}
              className="mt-1 rounded bg-neutral-800 border-neutral-700 text-emerald-500 focus:ring-0"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-emerald-400" />
                <span className="text-xs font-bold text-white">Blindagem de Energia (Powercfg)</span>
                <InfoTooltip
                  title="Modo Tampa Fechada (LIDACTION 0)"
                  description="Impede o Windows de suspender, dormir ou hibernar quando a tampa do notebook for fechada. Permite usar qualquer notebook como servidor silencioso em gaveta ou estante."
                  recommendation="Mantenha ativo para notebooks funcionarem 24/7 sem interrupções."
                />
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Ativa Alto Desempenho, desativa suspensão na tomada, desliga tela em 5 min, nunca desliga discos e{' '}
                <strong className="text-neutral-200">ignora o fechamento da tampa do notebook</strong>.
              </p>
            </div>
          </label>

          {/* 2. Rede Estática */}
          <label className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-start gap-3 cursor-pointer hover:border-emerald-500/40 transition-colors">
            <input
              type="checkbox"
              checked={options.staticIp}
              onChange={(e) => setOptions({ ...options, staticIp: e.target.checked })}
              className="mt-1 rounded bg-neutral-800 border-neutral-700 text-emerald-500 focus:ring-0"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Wifi size={16} className="text-cyan-400" />
                <span className="text-xs font-bold text-white">IP Local Fixo & DNS Confiável</span>
                <InfoTooltip
                  title="IP Local Fixo & DNS 1.1.1.1"
                  description="Fixa o IP atual via netsh e define DNS primário 1.1.1.1 (Cloudflare) e 8.8.8.8 (Google) para evitar falhas de resolução."
                  recommendation="Garante que seu IP não mude se o roteador for reiniciado."
                />
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Fixa o IP atual da máquina na rede local via <code className="text-neutral-300">netsh</code> e configura
                DNS primário 1.1.1.1 (Cloudflare) e 8.8.8.8 (Google) para evitar perdas de resolução.
              </p>
              {options.staticIp && (
                <div className="pt-2 mt-2 border-t border-neutral-800/80">
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-cyan-300" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={!!options.dnsOnly}
                      onChange={(e) => setOptions({ ...options, dnsOnly: e.target.checked })}
                      className="rounded bg-neutral-800 border-neutral-700 text-cyan-500 focus:ring-0"
                    />
                    <span>Manter IP dinâmico (DHCP) e aplicar apenas os servidores DNS (Recomendado para Wi-Fi)</span>
                    <InfoTooltip
                      title="DHCP vs IP Estático"
                      description="Mantém o IP dinâmico gerenciado pelo roteador mas aplica servidores DNS confiáveis. Recomendado para conexões Wi-Fi para evitar conflitos de IP."
                    />
                  </label>
                </div>
              )}
            </div>
          </label>

          {/* 3. Firewall */}
          <label className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-start gap-3 cursor-pointer hover:border-emerald-500/40 transition-colors">
            <input
              type="checkbox"
              checked={options.firewall}
              onChange={(e) => setOptions({ ...options, firewall: e.target.checked })}
              className="mt-1 rounded bg-neutral-800 border-neutral-700 text-emerald-500 focus:ring-0"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Flame size={16} className="text-amber-400" />
                <span className="text-xs font-bold text-white">Regras de Firewall (TCP 80 & 443)</span>
                <InfoTooltip
                  title="Regras do Windows Firewall"
                  description="Libera portas 80 (HTTP) e 443 (HTTPS) para que dispositivos na sua rede Wi-Fi consigam acessar os sites locais hospedados no Caddy."
                />
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Cria regra de entrada no Windows Defender Firewall permitindo tráfego HTTP (80) e HTTPS (443) para o
                Proxy Caddy atender conexões da rede local.
              </p>
            </div>
          </label>

          {/* 4. Isolamento */}
          <label className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-start gap-3 cursor-pointer hover:border-emerald-500/40 transition-colors">
            <input
              type="checkbox"
              checked={options.restrictedUser}
              onChange={(e) => setOptions({ ...options, restrictedUser: e.target.checked })}
              className="mt-1 rounded bg-neutral-800 border-neutral-700 text-emerald-500 focus:ring-0"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <UserCheck size={16} className="text-indigo-400" />
                <span className="text-xs font-bold text-white">Isolamento de Privilégios (AppServerRunner)</span>
                <InfoTooltip
                  title="Isolamento de Segurança via SID (AppServerRunner)"
                  description="Cria uma conta de usuário do Windows sem direitos administrativos (Princípio do Menor Privilégio). Suas APIs rodam restritas, impedindo códigos externos ou pacotes de comprometer seu sistema operacional."
                  recommendation="Segurança de nível empresarial para seu servidor Windows."
                />
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Cria conta de usuário local restrita com senha aleatória forte e concede permissão via{' '}
                <code className="text-neutral-300">icacls</code> exclusivamente na pasta dos apps (isolando seu Windows de invasões).
              </p>
            </div>
          </label>
        </div>

        {/* Preview de Rede Atual */}
        {networkPreview && (
          <div className="p-4 rounded-xl bg-neutral-900/80 border border-neutral-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Laptop size={18} className="text-cyan-400" />
              <div>
                <span className="text-neutral-400 block">Interface Detectada:</span>
                <span className="font-bold text-white font-mono">{networkPreview.iface} ({networkPreview.type})</span>
              </div>
            </div>
            <div className="flex items-center gap-6 font-mono text-neutral-300">
              <div>
                <span className="text-neutral-500 block text-[10px]">IP ATUAL</span>
                <span>{networkPreview.ip}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">MÁSCARA</span>
                <span>{networkPreview.mask}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">GATEWAY</span>
                <span>{networkPreview.gateway}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">DHCP</span>
                <span className={networkPreview.dhcp ? 'text-amber-400' : 'text-emerald-400'}>
                  {networkPreview.dhcp ? 'Dinâmico' : 'Estático'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Relatório de Execução */}
      {report && (
        <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={20} className="text-emerald-400" />
              <h3 className="text-base font-bold text-white">Relatório da Última Otimização</h3>
            </div>
            <span className="text-xs text-neutral-400 font-mono">
              Finalizado em: {new Date(report.finishedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="space-y-3">
            {report.steps.map((step, idx) => (
              <div key={idx} className="p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {step.status === 'ok' ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : step.status === 'failed' ? (
                      <XCircle size={16} className="text-rose-400" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-neutral-600 block" />
                    )}
                    <span className="text-xs font-semibold text-white">{step.label}</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      step.status === 'ok'
                        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                        : step.status === 'failed'
                        ? 'bg-rose-950/60 text-rose-300 border-rose-500/30'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                    }`}
                  >
                    {step.status.toUpperCase()}
                  </span>
                </div>

                {step.output && (
                  <pre className="p-2.5 rounded-lg bg-black/60 border border-neutral-800 font-mono text-[11px] text-neutral-300 whitespace-pre-wrap">
                    {step.output}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal Checklist BIOS */}
      <BiosChecklistModal isOpen={isBiosModalOpen} onClose={() => setIsBiosModalOpen(false)} />

      {/* Slide-over Help Drawer */}
      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="Guia Rápido: Otimizador & Blindagem do Windows"
        description="Transforme qualquer computador pessoal ou notebook antigo em um servidor de produção 24/7 estável, silencioso e seguro com 1 clique."
        steps={[
          {
            title: '1. Blindagem de Energia (Powercfg)',
            description: 'Define plano de Alto Desempenho, impede suspensão do sistema quando conectado na tomada e ativa LIDACTION 0 para você poder fechar a tampa do notebook sem desligar a máquina.'
          },
          {
            title: '2. IP Fixo e DNS 1.1.1.1',
            description: 'Fixa o IPv4 local via netsh para evitar que rotas quebrem ao reiniciar o roteador. Aplica DNS primário 1.1.1.1 (Cloudflare) e secundário 8.8.8.8 (Google) para resolução ultrarrápida.'
          },
          {
            title: '3. Regras de Entrada no Windows Firewall',
            description: 'Abre tráfego de entrada para portas 80 (HTTP) e 443 (HTTPS), permitindo que qualquer smartphone ou PC na mesma rede Wi-Fi acesse suas páginas e APIs locais.'
          },
          {
            title: '4. Isolamento de Privilégios (AppServerRunner)',
            description: 'Cria uma conta de usuário restrita com SID exclusivo para executar os processos Node.js e Python, isolando o sistema operacional Windows de eventuais pacotes maliciosos.'
          },
          {
            title: '5. Checklist de BIOS (Power Loss Recovery)',
            description: 'Clique no botão amarelo acima para ver o passo a passo de como configurar a BIOS do seu computador para ligar sozinho assim que a energia da tomada for restabelecida.'
          }
        ]}
        tips={[
          'Notebooks velhos com tela quebrada são excelentes servidores caseiros: consomem menos de 15W e a bateria atua como um no-break em quedas de luz!',
          'Se você estiver conectado via Wi-Fi, marque "Manter IP dinâmico (DHCP)" para evitar conflitos de IP na rede doméstica.'
        ]}
        externalLinks={[
          {
            label: 'Guia Microsoft Powercfg',
            url: 'https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options'
          }
        ]}
      />
    </div>
  )
}
