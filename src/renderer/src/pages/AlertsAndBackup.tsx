import React, { useEffect, useState } from 'react'
import {
  Bell,
  HardDriveDownload,
  Cloud,
  RotateCw,
  Send,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Search,
  Bot,
  BookOpen,
  HelpCircle,
  Zap
} from 'lucide-react'
import { Badge } from '../components/Badge'
import { HelpDrawer } from '../components/HelpDrawer'
import { InfoTooltip } from '../components/InfoTooltip'
import type { AppSettings, BackupRecord, BackupProgress, S3Config, NotificationChannel, ChannelTestResult } from '@shared/types'

type HelpTopic = 'overview' | 'discord' | 'teams' | 'slack' | 'telegram' | 'r2'

export const AlertsAndBackup: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [backups, setBackups] = useState<BackupRecord[]>([])

  // Help Drawer
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [activeHelpTopic, setActiveHelpTopic] = useState<HelpTopic>('overview')

  const getHelpContent = (topic: HelpTopic) => {
    switch (topic) {
      case 'discord':
        return {
          title: 'Como configurar Webhook no Discord',
          description: 'Receba alertas instantâneos no seu Discord com Embeds visuais coloridos (verde = ok, amarelo = aviso, vermelho = crítico) em menos de 1 minuto.',
          steps: [
            {
              title: '1. Abra as Configurações do seu Servidor',
              description: 'No Discord, clique na setinha ao lado do nome do servidor no canto superior esquerdo e selecione "Configurações do Servidor" (Server Settings).'
            },
            {
              title: '2. Acesse Integrações e Webhooks',
              description: 'No menu lateral esquerdo, clique em "Integrações" (Integrations) e depois no painel "Webhooks".'
            },
            {
              title: '3. Crie um Novo Webhook',
              description: 'Clique em "Novo Webhook" (New Webhook). Nomeie como "MyServer Orchestrator" e escolha o canal de texto desejado (ex: #servidor-alertas).'
            },
            {
              title: '4. Copie a URL do Webhook e Cole Aqui',
              description: 'Clique no botão azul "Copiar URL do Webhook" (Copy Webhook URL). Cole no campo correspondente no MyServer e clique em "Testar Canal".'
            }
          ],
          tips: [
            'Webhooks do Discord são 100% gratuitos e não requerem criação de bot nem autorização OAuth.',
            'O MyServer formata o resumo de incidentes com CPU, memória e detalhes do processo afetado.'
          ],
          externalLinks: [
            {
              label: 'Documentação Oficial: Webhooks do Discord',
              url: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks'
            }
          ]
        }
      case 'teams':
        return {
          title: 'Como configurar Webhook no Microsoft Teams',
          description: 'Envie notificações empresariais em formato nativo AdaptiveCard diretamente para o canal da sua equipe no Teams.',
          steps: [
            {
              title: '1. Acesse o Canal no Teams',
              description: 'Abra o Microsoft Teams e localize o canal onde você deseja receber os avisos do servidor.'
            },
            {
              title: '2. Abra os Workflows / Conectores do Canal',
              description: 'Clique nos três pontos (...) ao lado do nome do canal e selecione "Workflows" (Fluxos de Trabalho) ou "Conectores" (Connectors).'
            },
            {
              title: '3. Adicione o Webhook de Entrada',
              description: 'Pesquise pelo modelo "Post to a channel when a webhook request is received" ou "Incoming Webhook" e avance.'
            },
            {
              title: '4. Copie a URL gerada e salve no MyServer',
              description: 'Copie a URL exclusiva fornecida (geralmente começa com https://<tenant>.webhook.office.com/...) e cole no MyServer.'
            }
          ],
          tips: [
            'O MyServer envia AdaptiveCards estruturados com tags de criticidade e botões de ação rápida.',
            'Caso sua organização restrinja conectores, solicite liberação para o administrador do Microsoft 365.'
          ],
          externalLinks: [
            {
              label: 'Guia Oficial Microsoft Teams Webhooks',
              url: 'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook'
            }
          ]
        }
      case 'slack':
        return {
          title: 'Como configurar Webhook no Slack',
          description: 'Integre alertas ao Slack em 1 minuto com formatação rica via Slack Block Kit e entrega em tempo real.',
          steps: [
            {
              title: '1. Abra o Portal de Apps do Slack',
              description: 'Clique no botão abaixo para abrir a página oficial api.slack.com/apps no seu navegador padrão.'
            },
            {
              title: '2. Crie um Novo App',
              description: 'Clique em "Create New App", escolha "From scratch", dê o nome "MyServer Alerts" e selecione seu Workspace.'
            },
            {
              title: '3. Ative Incoming Webhooks',
              description: 'No menu lateral esquerdo, clique em "Incoming Webhooks" e ative a chave "Activate Incoming Webhooks" para On.'
            },
            {
              title: '4. Adicione o Webhook ao Canal',
              description: 'Clique em "Add New Webhook to Workspace" no final da página, selecione o canal do Slack e autorize.'
            },
            {
              title: '5. Copie a URL do Webhook e Cole Aqui',
              description: 'Copie a URL gerada (começa com https://hooks.slack.com/services/...) e cole no campo do MyServer.'
            }
          ],
          tips: [
            'Você pode criar um canal privado (#infra-alerta) no Slack para que apenas administradores recebam as notificações.'
          ],
          externalLinks: [
            {
              label: 'Abrir Painel de Apps do Slack (api.slack.com)',
              url: 'https://api.slack.com/apps'
            }
          ]
        }
      case 'telegram':
        return {
          title: 'Como configurar Bot no Telegram (30 segundos)',
          description: 'A forma mais ágil de receber alertas no celular: crie seu bot pelo @BotFather e use nossa detecção automática em 1 clique.',
          steps: [
            {
              title: '1. Abra o @BotFather no Telegram',
              description: 'Clique no botão abaixo para abrir o @BotFather no Telegram. Envie o comando: /newbot'
            },
            {
              title: '2. Defina o Nome e Username do Bot',
              description: 'Escolha um nome amigável (ex: "Meu Servidor") e um username único terminado em bot (ex: "meu_homelab_alert_bot").'
            },
            {
              title: '3. Copie o Bot Token e cole no MyServer',
              description: 'O BotFather fornecerá um token como 123456789:ABCDefGhIJKlmNo.... Copie e cole no campo "Bot Token" no MyServer.'
            },
            {
              title: '4. Abra o link do seu novo bot e aperte Começar (/start)',
              description: 'Clique no link t.me/seu_bot e aperte "Começar" (ou digite /start). Isso autoriza o bot a enviar mensagens para você.'
            },
            {
              title: '5. Clique em "🔍 Detectar Auto" no MyServer',
              description: 'Clique no botão azul "🔍 Detectar Auto" no MyServer: nosso sistema consultará a API do Telegram e preencherá seu Chat ID automaticamente!'
            }
          ],
          tips: [
            'Você também pode adicionar o bot a um Grupo de administradores no Telegram: envie uma mensagem no grupo e clique em Detectar Auto.',
            'O Telegram funciona perfeitamente mesmo com o celular em modo economia de bateria.'
          ],
          externalLinks: [
            {
              label: 'Abrir @BotFather no Telegram',
              url: 'https://t.me/BotFather'
            }
          ]
        }
      case 'r2':
        return {
          title: 'Backup Criptografado & Cloudflare R2 (10 GB Grátis)',
          description: 'Armazene backups diários com criptografia militar AES-256 no armazenamento de objetos da Cloudflare com 10 GB gratuitos para sempre e taxa zero de tráfego.',
          steps: [
            {
              title: '1. Acesse o Painel Cloudflare R2',
              description: 'Acesse dash.cloudflare.com, faça login e clique em "R2 Object Storage" no menu lateral.'
            },
            {
              title: '2. Crie um Bucket Gratuito',
              description: 'Clique em "Create bucket", dê o nome (ex: "meu-servidor-backups") e confirme. A Cloudflare concede 10 GB gratuitos todos os meses.'
            },
            {
              title: '3. Gere as Chaves de Acesso S3',
              description: 'Na barra lateral direita do R2, clique em "Manage R2 API Tokens" ➔ "Create API Token". Escolha permissão "Object Read & Write" e crie o token.'
            },
            {
              title: '4. Copie as Credenciais para o MyServer',
              description: 'Copie o Endpoint S3 (https://<account_id>.r2.cloudflarestorage.com), o Access Key ID e a Secret Access Key para os campos do MyServer.'
            },
            {
              title: '5. Defina sua Senha de Criptografia AES-256',
              description: 'Digite uma senha forte no campo "Senha de Criptografia do Backup". Todos os bancos SQLite e configs serão criptografados antes de sair da sua máquina.'
            },
            {
              title: '6. Como Restaurar um Backup?',
              description: 'Para restaurar um backup em qualquer máquina Windows ou Linux, use o script oficial fornecido no repositório:'
            }
          ],
          codeSnippet: 'node scripts/decrypt-backup.mjs backup-2026-10-20.tar.gz.enc "SuaSenhaAqui"',
          tips: [
            'A retenção automática do MyServer remove backups com mais de 7 dias para nunca ultrapassar o limite gratuito.',
            'Backups automáticos acontecem pontualmente às 03:00 da madrugada.'
          ],
          externalLinks: [
            {
              label: 'Abrir Painel Cloudflare R2',
              url: 'https://dash.cloudflare.com/?to=/:account/r2/overview'
            }
          ]
        }
      default:
        return {
          title: 'Guia Rápido: Alertas & Backup Criptografado',
          description: 'O MyServer Orchestrator mantém você informado de qualquer anomalia de hardware e garante que você nunca perca dados.',
          steps: [
            {
              title: '1. Canais de Alerta Gratuitos',
              description: 'Conecte Discord, Teams, Slack ou Telegram para receber alertas instantâneos de sobrecarga e incidentes.'
            },
            {
              title: '2. Watchdog Térmico e de Bateria',
              description: 'Monitora temperatura e descarga da bateria para evitar superaquecimento ou corrupção por falta repentina de energia.'
            },
            {
              title: '3. Backup Criptografado Local e Nuvem',
              description: 'Compacta e criptografa seus dados com AES-256 localmente e permite sincronização automática para o Cloudflare R2.'
            }
          ],
          tips: [
            'Você pode testar cada canal de notificação com 1 clique antes de salvar as configurações.',
            'A senha do backup nunca é enviada para a nuvem; ela fica guardada com segurança no cofre local.'
          ]
        }
    }
  }

  // 4 Canais de Alerta
  const [discordWebhook, setDiscordWebhook] = useState('')
  const [discordEnabled, setDiscordEnabled] = useState(true)

  const [teamsWebhook, setTeamsWebhook] = useState('')
  const [teamsEnabled, setTeamsEnabled] = useState(true)

  const [slackWebhook, setSlackWebhook] = useState('')
  const [slackEnabled, setSlackEnabled] = useState(true)

  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  const [telegramEnabled, setTelegramEnabled] = useState(true)

  const [channelTestStatus, setChannelTestStatus] = useState<Record<string, ChannelTestResult | null>>({})
  const [testingChannel, setTestingChannel] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const [detectingTelegram, setDetectingTelegram] = useState(false)
  const [savingWebhooks, setSavingWebhooks] = useState(false)
  const [simulatingPowerOutage, setSimulatingPowerOutage] = useState(false)

  // Watchdog Thresholds
  const [cpuTempThreshold, setCpuTempThreshold] = useState(85)
  const [ramThresholdPercent, setRamThresholdPercent] = useState(90)
  const [batteryCriticalPercent, setBatteryCriticalPercent] = useState(15)

  // Backup & S3
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [s3Endpoint, setS3Endpoint] = useState('')
  const [s3Region, setS3Region] = useState('auto')
  const [s3Bucket, setS3Bucket] = useState('')
  const [s3AccessKeyId, setS3AccessKeyId] = useState('')
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState('')
  const [s3Prefix, setS3Prefix] = useState('homeserver-backups')
  const [s3Enabled, setS3Enabled] = useState(false)

  const [runningBackup, setRunningBackup] = useState(false)
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null)
  const [testingS3, setTestingS3] = useState(false)

  const loadData = async () => {
    try {
      const [s, b] = await Promise.all([window.api.getSettings(), window.api.listBackups()])
      setSettings(s)
      setBackups(b)

      setDiscordEnabled(s.notifications.discordEnabled ?? true)
      setTeamsEnabled(s.notifications.teamsEnabled ?? true)
      setSlackEnabled(s.notifications.slackEnabled ?? true)
      setTelegramEnabled(s.notifications.telegramEnabled ?? true)

      setDiscordWebhook(s.notifications.discordWebhook || '')
      setTeamsWebhook(s.notifications.teamsWebhook || '')
      setSlackWebhook(s.notifications.slackWebhook || '')
      setTelegramBotToken(s.notifications.telegramBotToken || '')
      setTelegramChatId(s.notifications.telegramChatId || '')

      setCpuTempThreshold(s.watchdog.cpuTempThreshold)
      setRamThresholdPercent(s.watchdog.ramThresholdPercent)
      setBatteryCriticalPercent(s.watchdog.batteryCriticalPercent)

      setS3Endpoint(s.backup.s3.endpoint)
      setS3Region(s.backup.s3.region)
      setS3Bucket(s.backup.s3.bucket)
      setS3AccessKeyId(s.backup.s3.accessKeyId)
      setS3Prefix(s.backup.s3.prefix)
      setS3Enabled(s.backup.s3.enabled)
    } catch (err) {
      console.error('Falha ao carregar configurações de alertas e backup:', err)
    }
  }

  const persistCurrentNotifications = async (overrides?: Partial<AppSettings['notifications']>) => {
    try {
      await window.api.updateSettings({
        notifications: {
          desktop: settings?.notifications.desktop ?? true,
          discordEnabled: overrides?.discordEnabled ?? discordEnabled,
          teamsEnabled: overrides?.teamsEnabled ?? teamsEnabled,
          slackEnabled: overrides?.slackEnabled ?? slackEnabled,
          telegramEnabled: overrides?.telegramEnabled ?? telegramEnabled,
          discordWebhook: overrides?.discordWebhook !== undefined ? overrides.discordWebhook : (discordWebhook.trim() || null),
          teamsWebhook: overrides?.teamsWebhook !== undefined ? overrides.teamsWebhook : (teamsWebhook.trim() || null),
          slackWebhook: overrides?.slackWebhook !== undefined ? overrides.slackWebhook : (slackWebhook.trim() || null),
          telegramBotToken: overrides?.telegramBotToken !== undefined ? overrides.telegramBotToken : (telegramBotToken.trim() || null),
          telegramChatId: overrides?.telegramChatId !== undefined ? overrides.telegramChatId : telegramChatId.trim()
        }
      })
    } catch (err) {
      console.error('Falha no auto-save de notificações:', err)
    }
  }

  useEffect(() => {
    loadData()

    const unsubProgress = window.api.onBackupProgress((prog) => {
      setBackupProgress(prog)
      if (prog.phase === 'done' || prog.phase === 'error') {
        setTimeout(() => setBackupProgress(null), 5000)
        loadData()
      }
    })

    return () => unsubProgress()
  }, [])

  const handleSaveWebhooks = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingWebhooks(true)
    try {
      const updatePayload: any = {
        notifications: {
          desktop: settings?.notifications.desktop ?? true,
          discordEnabled,
          teamsEnabled,
          slackEnabled,
          telegramEnabled,
          discordWebhook: discordWebhook.trim() || null,
          teamsWebhook: teamsWebhook.trim() || null,
          slackWebhook: slackWebhook.trim() || null,
          telegramBotToken: telegramBotToken.trim() || null,
          telegramChatId: telegramChatId.trim()
        },
        watchdog: {
          cpuTempThreshold: Number(cpuTempThreshold),
          ramThresholdPercent: Number(ramThresholdPercent),
          batteryCriticalPercent: Number(batteryCriticalPercent)
        }
      }

      await window.api.updateSettings(updatePayload)
      alert('Configurações de alerta salvas com sucesso!')
      await loadData()
    } catch (err) {
      alert(`Erro ao salvar: ${(err as Error).message}`)
    } finally {
      setSavingWebhooks(false)
    }
  }

  const handleTestChannel = async (channel: NotificationChannel) => {
    setTestingChannel(channel)
    try {
      // Salva os dados atuais preenchidos na tela antes do teste
      await persistCurrentNotifications()
      const res = await window.api.testNotificationChannel(channel)
      setChannelTestStatus((prev) => ({ ...prev, [channel]: res }))
      if (res.ok) {
        if (channel === 'discord') setDiscordEnabled(true)
        if (channel === 'teams') setTeamsEnabled(true)
        if (channel === 'slack') setSlackEnabled(true)
        if (channel === 'telegram') setTelegramEnabled(true)
        await loadData()
      }
    } catch (err) {
      setChannelTestStatus((prev) => ({
        ...prev,
        [channel]: { configured: true, ok: false, error: (err as Error).message }
      }))
    } finally {
      setTestingChannel(null)
    }
  }

  const handleTestAllChannels = async () => {
    setTestingAll(true)
    try {
      await persistCurrentNotifications()
      const res = await window.api.testAllNotificationChannels()
      setChannelTestStatus(res as unknown as Record<string, ChannelTestResult | null>)
      let anySuccess = false
      if (res.discord?.ok) {
        setDiscordEnabled(true)
        anySuccess = true
      }
      if (res.teams?.ok) {
        setTeamsEnabled(true)
        anySuccess = true
      }
      if (res.slack?.ok) {
        setSlackEnabled(true)
        anySuccess = true
      }
      if (res.telegram?.ok) {
        setTelegramEnabled(true)
        anySuccess = true
      }
      if (anySuccess) {
        await loadData()
      }
    } catch (err) {
      alert(`Falha no teste geral: ${(err as Error).message}`)
    } finally {
      setTestingAll(false)
    }
  }

  const handleDetectTelegramChat = async () => {
    setDetectingTelegram(true)
    try {
      const res = await window.api.detectTelegramChat(telegramBotToken.trim() || undefined)
      setTelegramChatId(res.chatId)
      setTelegramEnabled(true)
      alert(`Chat ID detectado com sucesso!\nID: ${res.chatId}\nUsuário: ${res.firstName || ''} (@${res.username || 'sem_username'})\n\nO bot foi vinculado e o canal Telegram foi ativado com sucesso!`)
      await loadData()
    } catch (err) {
      alert(`Não foi possível detectar o Chat ID:\n${(err as Error).message}\n\nDica: Abra seu bot no Telegram e envie uma mensagem (ou comando /start) primeiro!`)
    } finally {
      setDetectingTelegram(false)
    }
  }

  const handleSimulatePowerOutage = async () => {
    setSimulatingPowerOutage(true)
    try {
      await persistCurrentNotifications()
      await window.api.simulatePowerOutage()
      alert('Simulação de queda de energia disparada com sucesso!\nO alerta de ativação do No-Break Nativo foi emitido para todos os seus canais configurados.')
    } catch (err) {
      alert(`Falha ao simular queda de energia: ${(err as Error).message}`)
    } finally {
      setSimulatingPowerOutage(false)
    }
  }


  const handleSaveS3 = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const cfg: S3Config = {
        enabled: s3Enabled,
        endpoint: s3Endpoint.trim(),
        region: s3Region.trim() || 'auto',
        bucket: s3Bucket.trim(),
        accessKeyId: s3AccessKeyId.trim(),
        prefix: s3Prefix.trim() || 'homeserver-backups',
        secretAccessKey: s3SecretAccessKey.trim() || undefined
      }

      await window.api.configureS3(cfg)
      if (backupPassphrase.trim()) {
        await window.api.updateSettings({
          backup: { passphrase: backupPassphrase.trim() }
        })
        setBackupPassphrase('')
      }
      setS3SecretAccessKey('')
      alert('Configurações de backup e nuvem S3 salvas!')
      loadData()
    } catch (err) {
      alert(`Erro ao salvar configurações de S3: ${(err as Error).message}`)
    }
  }

  const handleTestS3 = async () => {
    if (!s3SecretAccessKey.trim() && !settings?.backup.s3.secretSet) {
      alert('Informe a Secret Access Key para realizar o teste de conexão.')
      return
    }
    setTestingS3(true)
    try {
      await window.api.testS3({
        enabled: true,
        endpoint: s3Endpoint.trim(),
        region: s3Region.trim() || 'auto',
        bucket: s3Bucket.trim(),
        accessKeyId: s3AccessKeyId.trim(),
        prefix: s3Prefix.trim(),
        secretAccessKey: s3SecretAccessKey.trim()
      })
      alert('Conexão ao Bucket S3 / Cloudflare R2 validada com sucesso!')
    } catch (err) {
      alert(`Falha no teste S3: ${(err as Error).message}`)
    } finally {
      setTestingS3(false)
    }
  }

  const handleRunBackupNow = async () => {
    setRunningBackup(true)
    try {
      await window.api.runBackupNow()
      loadData()
    } catch (err) {
      alert(`Erro durante backup: ${(err as Error).message}`)
    } finally {
      setRunningBackup(false)
    }
  }

  const currentHelp = getHelpContent(activeHelpTopic)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Alertas & Backup Criptografado</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Integração com Discord Webhooks, Microsoft Teams, Slack, Telegram e sincronização diária para Cloudflare R2.
          </p>
        </div>
        <button
          onClick={() => {
            setActiveHelpTopic('overview')
            setIsHelpOpen(true)
          }}
          className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-indigo-300 font-medium text-xs flex items-center gap-2 border border-indigo-500/30 transition-colors shadow-lg"
        >
          <BookOpen size={14} />
          <span>📖 Guia Rápido desta Tela</span>
        </button>
      </div>

      {/* Seção 1: Webhooks e Bots de Alerta (Discord, Teams, Slack, Telegram) */}
      <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-indigo-400">
              <Bell size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Canais de Notificação & Incidentes em Tempo Real</h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                4 Canais Gratuitos: Discord, Microsoft Teams, Slack e Telegram. Receba avisos instantâneos de CPU, bateria e auto-recuperação.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleSimulatePowerOutage}
              disabled={simulatingPowerOutage}
              className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-amber-600/20 disabled:opacity-50"
              title="Simula a perda instantânea de energia elétrica para testar a notificação do No-Break nos seus canais"
            >
              <Zap size={14} />
              <span>{simulatingPowerOutage ? 'Simulando...' : 'Simular Queda de Energia (Teste No-Break)'}</span>
            </button>

            <button
              type="button"
              onClick={handleTestAllChannels}
              disabled={testingAll}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50"
            >
              <Send size={14} />
              <span>{testingAll ? 'Testando Canais...' : 'Testar Todos os Canais Ativos'}</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSaveWebhooks} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Discord */}
            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-indigo-400" />
                  <span className="text-xs font-bold text-white">Discord (Incoming Webhook)</span>
                  <InfoTooltip
                    title="Incoming Webhook do Discord"
                    description="Permite que o MyServer publique notificações visuais em um canal de texto sem precisar hospedar um bot dedicado."
                    recommendation="Crie um canal como #servidor-alertas e gere o webhook nas configurações do servidor."
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveHelpTopic('discord')
                      setIsHelpOpen(true)
                    }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                  >
                    <HelpCircle size={12} />
                    <span>Como configurar?</span>
                  </button>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-400">
                    <input
                      type="checkbox"
                      checked={discordEnabled}
                      onChange={(e) => {
                        const val = e.target.checked
                        setDiscordEnabled(val)
                        persistCurrentNotifications({ discordEnabled: val })
                      }}
                      className="rounded bg-neutral-900 border-neutral-700 text-indigo-500 focus:ring-0"
                    />
                    <span>Ativo</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">
                  Webhook URL{' '}
                  {settings?.notifications.discordWebhookSet && (
                    <span className="text-emerald-400 font-mono">({settings.notifications.discordWebhookMasked})</span>
                  )}
                </label>
                <input
                  type="url"
                  value={discordWebhook}
                  onChange={(e) => setDiscordWebhook(e.target.value)}
                  onBlur={() => persistCurrentNotifications()}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex-1 mr-2 truncate">
                  {channelTestStatus.discord && (
                    channelTestStatus.discord.ok ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-500/40">
                        <CheckCircle2 size={11} /> {channelTestStatus.discord.status || 200} OK ({channelTestStatus.discord.latencyMs}ms)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950/80 text-rose-400 border border-rose-500/40 truncate" title={channelTestStatus.discord.error}>
                        <XCircle size={11} /> {channelTestStatus.discord.error || 'Erro'}
                      </span>
                    )
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleTestChannel('discord')}
                  disabled={testingChannel === 'discord'}
                  className="px-3 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  {testingChannel === 'discord' ? 'Testando...' : 'Testar Canal'}
                </button>
              </div>
            </div>

            {/* 2. Microsoft Teams */}
            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-blue-400" />
                  <span className="text-xs font-bold text-white">Microsoft Teams (AdaptiveCard)</span>
                  <InfoTooltip
                    title="AdaptiveCards no Microsoft Teams"
                    description="Envia cartões executivos ricos com métricas formatadas e links rápidos para um canal do Teams via conector de fluxo."
                    recommendation="Use o modelo de fluxo 'Post to a channel when a webhook request is received' do Teams."
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveHelpTopic('teams')
                      setIsHelpOpen(true)
                    }}
                    className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <HelpCircle size={12} />
                    <span>Como configurar?</span>
                  </button>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-400">
                    <input
                      type="checkbox"
                      checked={teamsEnabled}
                      onChange={(e) => {
                        const val = e.target.checked
                        setTeamsEnabled(val)
                        persistCurrentNotifications({ teamsEnabled: val })
                      }}
                      className="rounded bg-neutral-900 border-neutral-700 text-blue-500 focus:ring-0"
                    />
                    <span>Ativo</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">
                  Webhook URL (Workflows / Connectors){' '}
                  {settings?.notifications.teamsWebhookSet && (
                    <span className="text-emerald-400 font-mono">({settings.notifications.teamsWebhookMasked})</span>
                  )}
                </label>
                <input
                  type="url"
                  value={teamsWebhook}
                  onChange={(e) => setTeamsWebhook(e.target.value)}
                  onBlur={() => persistCurrentNotifications()}
                  placeholder="https://<tenant>.webhook.office.com/..."
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-white text-xs font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex-1 mr-2 truncate">
                  {channelTestStatus.teams && (
                    channelTestStatus.teams.ok ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-500/40">
                        <CheckCircle2 size={11} /> {channelTestStatus.teams.status || 200} OK ({channelTestStatus.teams.latencyMs}ms)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950/80 text-rose-400 border border-rose-500/40 truncate" title={channelTestStatus.teams.error}>
                        <XCircle size={11} /> {channelTestStatus.teams.error || 'Erro'}
                      </span>
                    )
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleTestChannel('teams')}
                  disabled={testingChannel === 'teams'}
                  className="px-3 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  {testingChannel === 'teams' ? 'Testando...' : 'Testar Canal'}
                </button>
              </div>
            </div>

            {/* 3. Slack */}
            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-amber-400" />
                  <span className="text-xs font-bold text-white">Slack (Block Kit Webhook)</span>
                  <InfoTooltip
                    title="Incoming Webhook do Slack"
                    description="Permite enviar alertas estilizados com o Slack Block Kit para canais públicos ou privados do seu workspace."
                    recommendation="Crie um app em api.slack.com e ative a funcionalidade Incoming Webhooks."
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveHelpTopic('slack')
                      setIsHelpOpen(true)
                    }}
                    className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                  >
                    <HelpCircle size={12} />
                    <span>Como configurar?</span>
                  </button>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-400">
                    <input
                      type="checkbox"
                      checked={slackEnabled}
                      onChange={(e) => {
                        const val = e.target.checked
                        setSlackEnabled(val)
                        persistCurrentNotifications({ slackEnabled: val })
                      }}
                      className="rounded bg-neutral-900 border-neutral-700 text-amber-500 focus:ring-0"
                    />
                    <span>Ativo</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">
                  Slack Webhook URL{' '}
                  {settings?.notifications.slackWebhookSet && (
                    <span className="text-emerald-400 font-mono">({settings.notifications.slackWebhookMasked})</span>
                  )}
                </label>
                <input
                  type="url"
                  value={slackWebhook}
                  onChange={(e) => setSlackWebhook(e.target.value)}
                  onBlur={() => persistCurrentNotifications()}
                  placeholder="https://hooks.slack.com/services/T.../B.../..."
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-white text-xs font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex-1 mr-2 truncate">
                  {channelTestStatus.slack && (
                    channelTestStatus.slack.ok ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-500/40">
                        <CheckCircle2 size={11} /> {channelTestStatus.slack.status || 200} OK ({channelTestStatus.slack.latencyMs}ms)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950/80 text-rose-400 border border-rose-500/40 truncate" title={channelTestStatus.slack.error}>
                        <XCircle size={11} /> {channelTestStatus.slack.error || 'Erro'}
                      </span>
                    )
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleTestChannel('slack')}
                  disabled={testingChannel === 'slack'}
                  className="px-3 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  {testingChannel === 'slack' ? 'Testando...' : 'Testar Canal'}
                </button>
              </div>
            </div>

            {/* 4. Telegram */}
            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot size={16} className="text-sky-400" />
                  <span className="text-xs font-bold text-white">Telegram (Telegram Bot API)</span>
                  <InfoTooltip
                    title="Bot do Telegram"
                    description="O canal mais ágil e direto para alertas no smartphone ou desktop, com suporte a mensagens em grupos e detecção de chat em 1 clique."
                    recommendation="Crie o bot com o @BotFather, envie /start e use o botão 'Detectar Auto'."
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveHelpTopic('telegram')
                      setIsHelpOpen(true)
                    }}
                    className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors"
                  >
                    <HelpCircle size={12} />
                    <span>Como configurar?</span>
                  </button>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-400">
                    <input
                      type="checkbox"
                      checked={telegramEnabled}
                      onChange={(e) => {
                        const val = e.target.checked
                        setTelegramEnabled(val)
                        persistCurrentNotifications({ telegramEnabled: val })
                      }}
                      className="rounded bg-neutral-900 border-neutral-700 text-sky-500 focus:ring-0"
                    />
                    <span>Ativo</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">
                  Bot Token (gerado no @BotFather){' '}
                  {settings?.notifications.telegramBotTokenSet && (
                    <span className="text-emerald-400 font-mono">({settings.notifications.telegramBotTokenMasked})</span>
                  )}
                </label>
                <input
                  type="password"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  onBlur={() => persistCurrentNotifications()}
                  placeholder={settings?.notifications.telegramBotTokenSet ? '•••••••• (Manter atual)' : '123456789:ABCDefGhIJKlmNo...'}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-white text-xs font-mono focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">Telegram Chat ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    onBlur={() => persistCurrentNotifications()}
                    placeholder="ex: 123456789 ou -100123456"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-white text-xs font-mono focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleDetectTelegramChat}
                    disabled={detectingTelegram}
                    title="Lê a última mensagem /start do bot e preenche o Chat ID sozinho"
                    className="px-2.5 py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-500/30 text-[11px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <Search size={13} />
                    <span>{detectingTelegram ? 'Detectando...' : 'Detectar Auto'}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex-1 mr-2 truncate">
                  {channelTestStatus.telegram && (
                    channelTestStatus.telegram.ok ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-500/40">
                        <CheckCircle2 size={11} /> {channelTestStatus.telegram.status || 200} OK ({channelTestStatus.telegram.latencyMs}ms)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950/80 text-rose-400 border border-rose-500/40 truncate" title={channelTestStatus.telegram.error}>
                        <XCircle size={11} /> {channelTestStatus.telegram.error || 'Erro'}
                      </span>
                    )
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleTestChannel('telegram')}
                  disabled={testingChannel === 'telegram'}
                  className="px-3 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  {testingChannel === 'telegram' ? 'Testando...' : 'Testar Canal'}
                </button>
              </div>
            </div>
          </div>

          {/* Limiares do Watchdog */}
          <div className="pt-3 border-t border-neutral-800/80">
            <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider block mb-3">
              Gatilhos de Alerta do Watchdog
            </span>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs text-neutral-300">Temperatura Máx CPU (°C)</label>
                  <InfoTooltip
                    title="Limiar Térmico de Alerta"
                    description="Temperatura em °C a partir da qual o MyServer dispara avisos nos seus canais para evitar thermal throttling."
                    recommendation="85°C é o padrão seguro para desktops e notebooks."
                  />
                </div>
                <input
                  type="number"
                  value={cpuTempThreshold}
                  onChange={(e) => setCpuTempThreshold(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs text-neutral-300">Pressão de RAM Global (%)</label>
                  <InfoTooltip
                    title="Pressão de Memória RAM"
                    description="Porcentagem de RAM ocupada que gera aviso preventivo de sobrecarga e risco de travamento."
                    recommendation="90% ajuda a antecipar memory leaks em Node.js ou Python."
                  />
                </div>
                <input
                  type="number"
                  value={ramThresholdPercent}
                  onChange={(e) => setRamThresholdPercent(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs text-neutral-300">Bateria Crítica p/ Shutdown (%)</label>
                  <InfoTooltip
                    title="Watchdog de Bateria (Modo Notebook / UPS)"
                    description="Se a energia da tomada cair e a bateria atingir este percentual, o MyServer inicia um shutdown seguro para proteger bancos de dados SQLite."
                    recommendation="15% a 20% garante encerramento gracioso sem perda de dados."
                  />
                </div>
                <input
                  type="number"
                  value={batteryCriticalPercent}
                  onChange={(e) => setBatteryCriticalPercent(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingWebhooks}
              className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs transition-colors disabled:opacity-50"
            >
              {savingWebhooks ? 'Salvando...' : 'Salvar Configurações de Alerta'}
            </button>
          </div>
        </form>
      </div>

      {/* Seção 2: Backup Criptografado & Nuvem S3 (Cloudflare R2) */}
      <div className="glass-panel rounded-2xl p-6 border border-neutral-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-cyan-400">
              <Cloud size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Backups Automáticos & Cloudflare R2 (S3)</h3>
                <button
                  type="button"
                  onClick={() => {
                    setActiveHelpTopic('r2')
                    setIsHelpOpen(true)
                  }}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors ml-2"
                >
                  <HelpCircle size={12} />
                  <span>Como configurar Cloudflare R2 (10 GB Grátis)?</span>
                </button>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Compactação diária às 03:00, criptografia AES-256 e sincronização gratuita para armazenamento de objetos.
              </p>
            </div>
          </div>

          <button
            onClick={handleRunBackupNow}
            disabled={runningBackup}
            className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-semibold text-xs flex items-center gap-2 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
          >
            {runningBackup ? <RotateCw className="animate-spin" size={15} /> : <HardDriveDownload size={15} />}
            <span>{runningBackup ? 'Criando Backup...' : 'Fazer Backup Agora'}</span>
          </button>
        </div>

        {/* Barra de Progresso de Backup */}
        {backupProgress && (
          <div className="p-4 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 text-xs flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-3">
              <RotateCw className="animate-spin text-cyan-400" size={18} />
              <span>{backupProgress.message}</span>
            </div>
            <span className="font-mono uppercase font-bold text-[10px] text-cyan-300">
              Fase: {backupProgress.phase}
            </span>
          </div>
        )}

        <form onSubmit={handleSaveS3} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">
                  Senha de Criptografia do Backup (AES-256)
                </label>
                <InfoTooltip
                  title="Chave de Criptografia AES-256"
                  description="Chave secreta usada para criptografar todo o conteúdo do backup antes de salvar no disco ou sincronizar para o bucket."
                  recommendation="Utilize uma chave forte e guarde-a com segurança. Sem ela, o arquivo não pode ser descriptografado."
                />
              </div>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={backupPassphrase}
                  onChange={(e) => setBackupPassphrase(e.target.value)}
                  placeholder={settings?.backup.passphraseSet ? '•••••••• (Definida)' : 'Digite uma chave segura'}
                  className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-2.5 text-neutral-400 hover:text-white"
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">S3 Endpoint URL (Cloudflare R2)</label>
                <InfoTooltip
                  title="Endpoint S3 / Cloudflare R2"
                  description="Endereço da API S3 do seu provedor de armazenamento em nuvem."
                  recommendation="Na Cloudflare, tem o formato https://<account_id>.r2.cloudflarestorage.com"
                />
              </div>
              <input
                type="text"
                value={s3Endpoint}
                onChange={(e) => setS3Endpoint(e.target.value)}
                placeholder="https://<account-id>.r2.cloudflarestorage.com"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Bucket Name</label>
                <InfoTooltip
                  title="Nome do Bucket R2"
                  description="Nome do repositório de arquivos criado no painel da Cloudflare R2."
                  recommendation="Exemplo: 'meu-servidor-backups'."
                />
              </div>
              <input
                type="text"
                value={s3Bucket}
                onChange={(e) => setS3Bucket(e.target.value)}
                placeholder="meu-homeserver-backups"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">Access Key ID</label>
                <InfoTooltip
                  title="Access Key ID"
                  description="Chave de identificação da API do Cloudflare R2 gerada em Manage R2 API Tokens."
                />
              </div>
              <input
                type="text"
                value={s3AccessKeyId}
                onChange={(e) => setS3AccessKeyId(e.target.value)}
                placeholder="Chave de Acesso S3"
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-semibold text-neutral-300">
                  Secret Access Key{' '}
                  {settings?.backup.s3.secretSet && <span className="text-emerald-400">(Definida)</span>}
                </label>
                <InfoTooltip
                  title="Secret Access Key"
                  description="Segredo da API S3 fornecido na criação do token R2."
                />
              </div>
              <input
                type="password"
                value={s3SecretAccessKey}
                onChange={(e) => setS3SecretAccessKey(e.target.value)}
                placeholder={settings?.backup.s3.secretSet ? '•••••••• (Manter atual)' : 'Segredo S3'}
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="s3enable"
                checked={s3Enabled}
                onChange={(e) => setS3Enabled(e.target.checked)}
                className="rounded bg-neutral-900 border-neutral-800 text-emerald-500 focus:ring-0"
              />
              <label htmlFor="s3enable" className="text-xs text-neutral-300">
                Habilitar sincronização automática para a nuvem S3 pós-backup
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestS3}
                disabled={testingS3 || !s3Bucket.trim()}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs transition-colors disabled:opacity-50"
              >
                {testingS3 ? 'Testando...' : 'Testar Conexão S3'}
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-semibold text-xs transition-colors"
              >
                Salvar Configurações S3
              </button>
            </div>
          </div>
        </form>

        {/* Histórico de Backups */}
        <div className="pt-4 border-t border-neutral-800/80">
          <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider block mb-3">
            Histórico Local de Backups Criptografados ({backups.length})
          </span>

          {backups.length === 0 ? (
            <div className="p-6 text-center text-xs text-neutral-500">
              Nenhum backup realizado ainda. Clique em "Fazer Backup Agora" acima.
            </div>
          ) : (
            <div className="divide-y divide-neutral-800/60 rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
              {backups.map((b) => (
                <div key={b.id} className="p-3.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <Badge status={b.status} size="sm" />
                    <div>
                      <span className="font-mono font-semibold text-white block">{b.file.split(/[\\/]/).pop()}</span>
                      <span className="text-[11px] text-neutral-500">
                        {new Date(b.ts).toLocaleString()} · Duração: {Math.round(b.durationMs / 1000)}s
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="font-mono text-cyan-400">{(b.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                        b.uploaded
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                          : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                      }`}
                    >
                      {b.uploaded ? 'Sincronizado Nuvem' : 'Apenas Local'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Slide-over Help Drawer */}
      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title={currentHelp.title}
        description={currentHelp.description}
        steps={currentHelp.steps}
        codeSnippet={currentHelp.codeSnippet}
        tips={currentHelp.tips}
        externalLinks={currentHelp.externalLinks}
      />
    </div>
  )
}
