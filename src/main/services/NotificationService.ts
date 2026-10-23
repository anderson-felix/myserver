import { Notification as ElectronNotification } from 'electron'
import { createLogger } from '../utils/logger'
import { broadcast } from '../utils/common'
import {
  IPC,
  type Incident,
  type Severity,
  type WebhookTestResult,
  type NotificationChannel,
  type ChannelTestResult
} from '@shared/types'
import type { AppDatabase } from '../database'

const log = createLogger('notifications')

const DISCORD_COLORS: Record<Severity, number> = {
  info: 3447003, // Blue
  success: 3066993, // Green
  warning: 16753920, // Orange
  critical: 15158332 // Red
}

const SEVERITY_EMOJIS: Record<Severity, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  critical: '🚨'
}

export class NotificationService {
  private telegramPollTimer: NodeJS.Timeout | null = null
  private telegramPolling = false
  private lastTelegramUpdateId = 0

  constructor(private db: AppDatabase) {}

  private recordTestIncident(channel: NotificationChannel, latencyMs: number): void {
    const incident = this.db.insertIncident({
      ts: Date.now(),
      severity: 'success',
      category: 'test',
      title: `Canal ${channel.toUpperCase()} Validado e Ativado`,
      message: `Teste de notificação para o canal ${channel} concluído com sucesso (${latencyMs}ms). O canal foi ativado automaticamente no MyServer.`,
      projectId: null,
      delivered: channel
    })
    broadcast(IPC.incidentsOnNew, incident)
  }

  public startTelegramBotPoller(): void {
    if (this.telegramPollTimer) return
    log.info('Iniciando Telegram Bot Poller em background (intervalo 5s)...')

    setTimeout(() => {
      this.pollTelegramUpdates().catch((err) => log.debug('Erro no primeiro poll do Telegram', err))
    }, 2000)

    this.telegramPollTimer = setInterval(() => {
      this.pollTelegramUpdates().catch((err) => log.debug('Erro no poll do Telegram', err))
    }, 5000)
  }

  public stopTelegramBotPoller(): void {
    if (this.telegramPollTimer) {
      clearInterval(this.telegramPollTimer)
      this.telegramPollTimer = null
      log.info('Telegram Bot Poller finalizado.')
    }
  }

  private async pollTelegramUpdates(): Promise<void> {
    if (this.telegramPolling) return
    const token = this.db.getSecret('telegram_bot_token')
    if (!token || !token.trim()) return

    this.telegramPolling = true
    try {
      const offset = this.lastTelegramUpdateId > 0 ? this.lastTelegramUpdateId + 1 : 0
      const url = `https://api.telegram.org/bot${token.trim()}/getUpdates?offset=${offset}&timeout=0`

      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 4500)
      const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer))

      if (!res.ok) return
      const data = (await res.json()) as any
      if (!data.ok || !Array.isArray(data.result) || data.result.length === 0) return

      for (const u of data.result) {
        if (u.update_id) {
          this.lastTelegramUpdateId = Math.max(this.lastTelegramUpdateId, u.update_id)
        }
        const msg = u.message || u.edited_message || u.channel_post
        if (!msg || !msg.chat || !msg.chat.id) continue

        const text = typeof msg.text === 'string' ? msg.text.trim().toLowerCase() : ''
        if (text.startsWith('/start') || text.startsWith('/status')) {
          const chatId = String(msg.chat.id)
          const firstName = msg.from?.first_name || msg.chat?.title || 'Usuário'
          const username = msg.from?.username || msg.chat?.username

          const currentChatId = this.db.getSetting('notifications_telegram_chat_id', '')
          if (!currentChatId || currentChatId !== chatId) {
            this.db.setSetting('notifications_telegram_chat_id', chatId)
            this.db.setSetting('notifications_telegram_enabled', true)
            log.info(`Telegram Poller: Chat ID auto-detectado via ${text}: ${chatId} (${firstName})`)
          } else {
            this.db.setSetting('notifications_telegram_enabled', true)
          }

          const settings = this.db.getFullSettings()
          await this.sendTelegram(token.trim(), chatId, {
            title: 'Bot do MyServer Orchestrator Online!',
            message: `Olá, ${firstName}! O bot do MyServer Orchestrator está ativo e vinculado a este chat. Todas as notificações e alertas de hardware estão ativados.`,
            severity: 'success',
            serverLabel: settings.serverLabel,
            extraFacts: {
              'Chat ID': chatId,
              'Usuário': `@${username || 'sem_username'}`,
              'Servidor': settings.serverLabel,
              'Comando': text,
              'Status': 'Online e Monitorando'
            }
          }).catch((err) => log.error('Falha ao responder /start no Telegram:', err))
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        log.debug('Falha no poller do Telegram:', err.message)
      }
    } finally {
      this.telegramPolling = false
    }
  }

  public async notify(params: {
    severity: Severity
    category: Incident['category']
    title: string
    message: string
    projectId?: string | null
    extraFacts?: Record<string, string>
  }): Promise<Incident> {
    const ts = Date.now()
    log.info(`[${params.severity.toUpperCase()}] ${params.title}: ${params.message}`)

    const settings = this.db.getFullSettings()

    // 1. Desktop Notification
    if (settings.notifications.desktop && ElectronNotification.isSupported()) {
      try {
        const notif = new ElectronNotification({
          title: `[MyServer] ${params.title}`,
          body: params.message,
          silent: params.severity === 'info'
        })
        notif.show()
      } catch (err) {
        log.warn('Falha ao disparar notificação desktop', err)
      }
    }

    const deliveredChannels: string[] = []

    // 2. Discord Webhook
    if (settings.notifications.discordEnabled) {
      const discordUrl = this.db.getSecret('discord_webhook')
      if (discordUrl) {
        try {
          await this.sendDiscord(discordUrl, {
            title: params.title,
            message: params.message,
            severity: params.severity,
            serverLabel: settings.serverLabel,
            extraFacts: params.extraFacts
          })
          deliveredChannels.push('discord')
        } catch (err) {
          log.error('Erro ao enviar webhook Discord', err)
        }
      }
    }

    // 3. Microsoft Teams Webhook
    if (settings.notifications.teamsEnabled) {
      const teamsUrl = this.db.getSecret('teams_webhook')
      if (teamsUrl) {
        try {
          await this.sendTeams(teamsUrl, {
            title: params.title,
            message: params.message,
            severity: params.severity,
            serverLabel: settings.serverLabel,
            extraFacts: params.extraFacts
          })
          deliveredChannels.push('teams')
        } catch (err) {
          log.error('Erro ao enviar webhook MS Teams', err)
        }
      }
    }

    // 4. Slack Webhook (Block Kit)
    if (settings.notifications.slackEnabled) {
      const slackUrl = this.db.getSecret('slack_webhook')
      if (slackUrl) {
        try {
          await this.sendSlack(slackUrl, {
            title: params.title,
            message: params.message,
            severity: params.severity,
            serverLabel: settings.serverLabel,
            extraFacts: params.extraFacts
          })
          deliveredChannels.push('slack')
        } catch (err) {
          log.error('Erro ao enviar webhook Slack', err)
        }
      }
    }

    // 5. Telegram Bot API
    if (settings.notifications.telegramEnabled) {
      const botToken = this.db.getSecret('telegram_bot_token')
      const chatId = settings.notifications.telegramChatId
      if (botToken && chatId) {
        try {
          await this.sendTelegram(botToken, chatId, {
            title: params.title,
            message: params.message,
            severity: params.severity,
            serverLabel: settings.serverLabel,
            extraFacts: params.extraFacts
          })
          deliveredChannels.push('telegram')
        } catch (err) {
          log.error('Erro ao enviar mensagem Telegram', err)
        }
      }
    }

    // Grava no banco e transmite via IPC
    const incident = this.db.insertIncident({
      ts,
      severity: params.severity,
      category: params.category,
      title: params.title,
      message: params.message,
      projectId: params.projectId ?? null,
      delivered: deliveredChannels.length ? deliveredChannels.join(', ') : null
    })

    broadcast(IPC.incidentsOnNew, incident)
    return incident
  }

  // -------------------------------------------------------------------------
  // Testes de Conexão
  // -------------------------------------------------------------------------

  public async testChannel(channel: NotificationChannel): Promise<ChannelTestResult> {
    const settings = this.db.getFullSettings()
    log.info(`Testando canal individual: ${channel}`)
    const startTime = Date.now()

    try {
      if (channel === 'discord') {
        const url = this.db.getSecret('discord_webhook')
        if (!url) return { configured: false, ok: false, error: 'URL do Discord Webhook não informada' }
        await this.sendDiscord(url, {
          title: 'Teste de Notificação Discord',
          message: 'O canal de alertas do MyServer Orchestrator foi validado com sucesso!',
          severity: 'success',
          serverLabel: settings.serverLabel,
          extraFacts: { Teste: 'OK', Canal: 'Discord Webhook' }
        })
        const latencyMs = Date.now() - startTime
        this.db.setSetting('notifications_discord_enabled', true)
        this.recordTestIncident('discord', latencyMs)
        return { configured: true, ok: true, status: 200, latencyMs }
      }

      if (channel === 'teams') {
        const url = this.db.getSecret('teams_webhook')
        if (!url) return { configured: false, ok: false, error: 'URL do Microsoft Teams Webhook não informada' }
        await this.sendTeams(url, {
          title: 'Teste de Notificação MS Teams',
          message: 'O canal Adaptive Cards do MyServer Orchestrator foi validado com sucesso!',
          severity: 'success',
          serverLabel: settings.serverLabel,
          extraFacts: { Teste: 'OK', Canal: 'MS Teams AdaptiveCard' }
        })
        const latencyMs = Date.now() - startTime
        this.db.setSetting('notifications_teams_enabled', true)
        this.recordTestIncident('teams', latencyMs)
        return { configured: true, ok: true, status: 200, latencyMs }
      }

      if (channel === 'slack') {
        const url = this.db.getSecret('slack_webhook')
        if (!url) return { configured: false, ok: false, error: 'URL do Slack Webhook não informada' }
        await this.sendSlack(url, {
          title: 'Teste de Notificação Slack',
          message: 'O conector Slack Block Kit do MyServer Orchestrator foi validado com sucesso!',
          severity: 'success',
          serverLabel: settings.serverLabel,
          extraFacts: { Teste: 'OK', Canal: 'Slack Block Kit' }
        })
        const latencyMs = Date.now() - startTime
        this.db.setSetting('notifications_slack_enabled', true)
        this.recordTestIncident('slack', latencyMs)
        return { configured: true, ok: true, status: 200, latencyMs }
      }

      if (channel === 'telegram') {
        const botToken = this.db.getSecret('telegram_bot_token')
        const chatId = settings.notifications.telegramChatId
        if (!botToken || !chatId) {
          return {
            configured: false,
            ok: false,
            error: !botToken ? 'Bot Token do Telegram ausente' : 'Chat ID do Telegram ausente'
          }
        }
        await this.sendTelegram(botToken, chatId, {
          title: 'Teste de Notificação Telegram',
          message: 'O bot do Telegram do MyServer Orchestrator foi validado com sucesso!',
          severity: 'success',
          serverLabel: settings.serverLabel,
          extraFacts: { Teste: 'OK', Canal: 'Telegram Bot API' }
        })
        const latencyMs = Date.now() - startTime
        this.db.setSetting('notifications_telegram_enabled', true)
        this.recordTestIncident('telegram', latencyMs)
        return { configured: true, ok: true, status: 200, latencyMs }
      }

      throw new Error(`Canal desconhecido: ${channel}`)
    } catch (err) {
      log.error(`Falha no teste do canal ${channel}:`, err)
      return { configured: true, ok: false, error: (err as Error).message }
    }
  }

  public async testWebhooks(): Promise<WebhookTestResult> {
    const [discord, teams, slack, telegram] = await Promise.all([
      this.testChannel('discord'),
      this.testChannel('teams'),
      this.testChannel('slack'),
      this.testChannel('telegram')
    ])

    await this.notify({
      severity: 'info',
      category: 'test',
      title: 'Disparo de Teste de Canais de Alerta',
      message: `Discord: ${discord.ok ? 'OK' : discord.configured ? 'Falhou' : 'Desativado'} | Teams: ${teams.ok ? 'OK' : teams.configured ? 'Falhou' : 'Desativado'} | Slack: ${slack.ok ? 'OK' : slack.configured ? 'Falhou' : 'Desativado'} | Telegram: ${telegram.ok ? 'OK' : telegram.configured ? 'Falhou' : 'Desativado'}`
    })

    return { discord, teams, slack, telegram }
  }

  public async detectTelegramChat(botTokenInput?: string): Promise<{ chatId: string; username?: string; firstName?: string }> {
    let token = botTokenInput ? botTokenInput.trim() : ''
    if (token) {
      this.db.setSecret('telegram_bot_token', token)
    } else {
      token = this.db.getSecret('telegram_bot_token') || ''
    }
    if (!token) throw new Error('Informe o Bot Token do Telegram antes de detectar o Chat ID')

    log.info('Consultando Telegram getUpdates para auto-detecção de Chat ID...')
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Telegram API HTTP ${res.status}: ${errText}`)
    }

    const data = (await res.json()) as any
    if (!data.ok || !Array.isArray(data.result) || data.result.length === 0) {
      throw new Error(
        'Nenhuma mensagem recebida ainda no bot. Abra seu Telegram, procure pelo bot (@SeuBot) e envie /start antes de tentar detectar o Chat ID.'
      )
    }

    // Pega a mensagem mais recente
    const updates = data.result
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i]
      const msg = u.message || u.edited_message || u.channel_post
      if (msg && msg.chat && msg.chat.id) {
        const chatId = String(msg.chat.id)
        const username = msg.from?.username || msg.chat.username
        const firstName = msg.from?.first_name || msg.chat.title || 'Usuário Telegram'
        log.info(`Chat ID do Telegram detectado com sucesso: ${chatId} (${firstName})`)

        this.db.setSetting('notifications_telegram_chat_id', chatId)
        this.db.setSetting('notifications_telegram_enabled', true)

        const settings = this.db.getFullSettings()
        try {
          await this.sendTelegram(token, chatId, {
            title: 'Bot Vinculado com Sucesso!',
            message: `O bot do MyServer Orchestrator foi vinculado a este chat e ativado com sucesso!`,
            severity: 'success',
            serverLabel: settings.serverLabel,
            extraFacts: {
              'Chat ID': chatId,
              'Usuário': firstName || username || 'Telegram User',
              'Status': 'Notificações Ativas'
            }
          })
        } catch (sendErr) {
          log.warn('Aviso ao enviar confirmação no Telegram pós-detecção:', sendErr)
        }

        return { chatId, username, firstName }
      }
    }

    throw new Error('Nenhuma mensagem com chat.id válido encontrada no histórico recente do bot.')
  }

  // -------------------------------------------------------------------------
  // Métodos de Envio Formatados
  // -------------------------------------------------------------------------

  public async sendDiscord(
    webhookUrl: string,
    data: {
      title: string
      message: string
      severity: Severity
      serverLabel: string
      extraFacts?: Record<string, string>
    }
  ): Promise<void> {
    const fields = Object.entries(data.extraFacts || {}).map(([name, value]) => ({
      name,
      value: String(value),
      inline: true
    }))

    const payload = {
      username: 'MyServer Orchestrator',
      avatar_url: 'https://raw.githubusercontent.com/caddyserver/caddy/master/assets/icon.png',
      embeds: [
        {
          title: `${SEVERITY_EMOJIS[data.severity]} ${data.title}`,
          description: data.message,
          color: DISCORD_COLORS[data.severity] ?? DISCORD_COLORS.info,
          fields: [
            { name: 'Host / Servidor', value: data.serverLabel, inline: true },
            { name: 'Severidade', value: data.severity.toUpperCase(), inline: true },
            ...fields
          ],
          footer: { text: 'MyServer Watchdog · Local-First Orchestrator' },
          timestamp: new Date().toISOString()
        }
      ]
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Discord Webhook HTTP ${res.status}: ${errText}`)
    }
  }

  public async sendTeams(
    webhookUrl: string,
    data: {
      title: string
      message: string
      severity: Severity
      serverLabel: string
      extraFacts?: Record<string, string>
    }
  ): Promise<void> {
    const facts = [
      { title: 'Servidor:', value: data.serverLabel },
      { title: 'Severidade:', value: data.severity.toUpperCase() },
      ...Object.entries(data.extraFacts || {}).map(([k, v]) => ({ title: `${k}:`, value: String(v) }))
    ]

    const colorMap: Record<Severity, string> = {
      info: 'accent',
      success: 'good',
      warning: 'warning',
      critical: 'attention'
    }

    const payload = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                size: 'Large',
                weight: 'Bolder',
                text: `${SEVERITY_EMOJIS[data.severity]} ${data.title}`,
                color: colorMap[data.severity]
              },
              {
                type: 'TextBlock',
                text: data.message,
                wrap: true
              },
              {
                type: 'FactSet',
                facts
              }
            ]
          }
        }
      ]
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`MS Teams Webhook HTTP ${res.status}: ${errText}`)
    }
  }

  public async sendSlack(
    webhookUrl: string,
    data: {
      title: string
      message: string
      severity: Severity
      serverLabel: string
      extraFacts?: Record<string, string>
    }
  ): Promise<void> {
    const factFields = Object.entries(data.extraFacts || {}).map(([k, v]) => ({
      type: 'mrkdwn',
      text: `*${k}:*\n${v}`
    }))

    const payload = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${SEVERITY_EMOJIS[data.severity]} ${data.title}`,
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: data.message
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Servidor:*\n\`${data.serverLabel}\``
            },
            {
              type: 'mrkdwn',
              text: `*Severidade:*\n\`${data.severity.toUpperCase()}\``
            },
            ...factFields
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `*MyServer Orchestrator* • <!date^${Math.floor(Date.now() / 1000)}^{date_num} {time_secs}|${new Date().toLocaleString()}>`
            }
          ]
        }
      ]
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Slack Webhook HTTP ${res.status}: ${errText}`)
    }
  }

  public async sendTelegram(
    botToken: string,
    chatId: string,
    data: {
      title: string
      message: string
      severity: Severity
      serverLabel: string
      extraFacts?: Record<string, string>
    }
  ): Promise<void> {
    const emoji = SEVERITY_EMOJIS[data.severity]
    const escapeHtml = (str: string) =>
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    let text = `${emoji} <b>[${data.severity.toUpperCase()}] ${escapeHtml(data.title)}</b>\n\n`
    text += `${escapeHtml(data.message)}\n\n`
    text += `<b>Servidor:</b> <code>${escapeHtml(data.serverLabel)}</code>\n`

    if (data.extraFacts && Object.keys(data.extraFacts).length > 0) {
      text += `<b>Telemetria / Detalhes:</b>\n`
      for (const [k, v] of Object.entries(data.extraFacts)) {
        text += `• <b>${escapeHtml(k)}:</b> <code>${escapeHtml(String(v))}</code>\n`
      }
    }

    text += `\n<i>MyServer Orchestrator • ${new Date().toLocaleString()}</i>`

    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Telegram API HTTP ${res.status}: ${errText}`)
    }
  }
}
