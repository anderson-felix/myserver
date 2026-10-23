import { spawn, type ChildProcess } from 'node:child_process'
import QRCode from 'qrcode'
import treeKill from 'tree-kill'
import { createLogger } from '../utils/logger'
import { binaryPath, binaryPresent } from '../paths'
import { runPrivileged, getServicesStatus, psQuote } from '../utils/shell'
import { broadcast, createLineSplitter } from '../utils/common'
import { IPC, type QuickTunnel, type TunnelStatus } from '@shared/types'
import type { AppDatabase } from '../database'
import type { NotificationService } from './NotificationService'

const log = createLogger('cloudflare')

const QUICK_TUNNEL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/

export class CloudflareService {
  private activeTunnels: Map<string, { child: ChildProcess; tunnel: QuickTunnel }> = new Map()
  private cachedNamedSvc: { installed: boolean; state: string | null; ts: number } | null = null

  constructor(
    private db: AppDatabase,
    private notifications: NotificationService
  ) {}

  public async getStatus(): Promise<TunnelStatus> {
    const isPresent = binaryPresent('cloudflared')
    const quick = Array.from(this.activeTunnels.values()).map((v) => v.tunnel)

    // Cacheia verificação de serviço do Windows por 60 segundos para evitar spawn de powershell.exe
    const now = Date.now()
    let namedSvcState: { installed: boolean; state: string | null }
    if (this.cachedNamedSvc && now - this.cachedNamedSvc.ts < 60_000) {
      namedSvcState = this.cachedNamedSvc
    } else {
      const svcStatus = await getServicesStatus(['Cloudflared'])
      const namedSvc = svcStatus['Cloudflared']
      namedSvcState = {
        installed: !!namedSvc,
        state: namedSvc ? namedSvc.state : null
      }
      this.cachedNamedSvc = { ...namedSvcState, ts: now }
    }

    const settings = this.db.getFullSettings()

    return {
      binaryPresent: isPresent,
      quick,
      named: {
        installed: namedSvcState.installed,
        state: namedSvcState.state,
        configuredAt: settings.tunnel.namedConfiguredAt
      }
    }
  }

  public async startQuickTunnel(targetUrlOrPort: string | number, projectId?: string, label?: string): Promise<QuickTunnel> {
    if (!binaryPresent('cloudflared')) {
      throw new Error('Binário cloudflared.exe não encontrado em bin/win')
    }

    const id = `tun_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const target = typeof targetUrlOrPort === 'number'
      ? `http://127.0.0.1:${targetUrlOrPort}`
      : targetUrlOrPort.startsWith('http') ? targetUrlOrPort : `http://127.0.0.1:${targetUrlOrPort}`

    const tunnelItem: QuickTunnel = {
      id,
      projectId: projectId ?? null,
      label: label ?? `Túnel para ${target}`,
      target,
      url: null,
      qrDataUrl: null,
      status: 'starting',
      error: null,
      startedAt: Date.now()
    }

    log.info(`Iniciando Quick Tunnel para ${target}...`)
    const exe = binaryPath('cloudflared')
    const child = spawn(exe, ['tunnel', '--url', target], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.activeTunnels.set(id, { child, tunnel: tunnelItem })
    broadcast(IPC.tunnelOnUpdate, this.activeTunnels.get(id)?.tunnel)

    const handleOutput = async (line: string) => {
      log.debug(`[cloudflared] ${line}`)
      if (!tunnelItem.url) {
        const match = line.match(QUICK_TUNNEL_REGEX)
        if (match) {
          const publicUrl = match[0]
          log.info(`Quick Tunnel ativo: ${publicUrl}`)
          tunnelItem.url = publicUrl
          tunnelItem.status = 'online'
          try {
            tunnelItem.qrDataUrl = await QRCode.toDataURL(publicUrl, { margin: 1, width: 256 })
          } catch (err) {
            log.warn('Falha ao gerar QR Code do túnel', err)
          }
          broadcast(IPC.tunnelOnUpdate, tunnelItem)
          this.notifications.notify({
            severity: 'success',
            category: 'system',
            title: 'Túnel Público Criado',
            message: `Link temporário ativo: ${publicUrl}`,
            projectId,
            extraFacts: { URL: publicUrl, Alvo: target }
          })
        }
      }
    }

    const splitterOut = createLineSplitter(handleOutput)
    const splitterErr = createLineSplitter(handleOutput)

    child.stdout?.on('data', (d) => splitterOut.write(d))
    child.stderr?.on('data', (d) => splitterErr.write(d))

    child.on('close', (code) => {
      splitterOut.end()
      splitterErr.end()
      log.info(`Quick Tunnel ${id} encerrado com código ${code}`)
      tunnelItem.status = 'stopped'
      this.activeTunnels.delete(id)
      broadcast(IPC.tunnelOnUpdate, tunnelItem)
    })

    child.on('error', (err) => {
      tunnelItem.status = 'error'
      tunnelItem.error = err.message
      broadcast(IPC.tunnelOnUpdate, tunnelItem)
    })

    return tunnelItem
  }

  public async stopQuickTunnel(id: string): Promise<void> {
    const item = this.activeTunnels.get(id)
    if (!item) return

    log.info(`Encerrando Quick Tunnel ${id}...`)
    if (item.child.pid) {
      await new Promise<void>((resolve) => {
        treeKill(item.child.pid!, 'SIGTERM', () => resolve())
      })
    }
    this.activeTunnels.delete(id)
  }

  public async configureNamedTunnel(token: string): Promise<void> {
    if (!binaryPresent('cloudflared')) {
      throw new Error('Binário cloudflared.exe não encontrado')
    }

    const trimmed = token.trim()
    if (!trimmed) throw new Error('Token do Cloudflare Tunnel não informado')

    log.info('Instalando Named Tunnel persistente do Cloudflare...')
    const exe = binaryPath('cloudflared')

    const script = `
      $exe = ${psQuote(exe)}
      $token = ${psQuote(trimmed)}

      # Para e desinstala serviço anterior se já existir
      & $exe service uninstall 2>&1 | Out-Null
      # Instala com o novo token
      & $exe service install $token
      # Inicia o serviço
      Start-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
      Write-Output "Serviço Cloudflared instalado e iniciado com sucesso."
    `

    const res = await runPrivileged(script)
    if (res.exitCode !== 0) {
      throw new Error(`Falha ao instalar serviço Cloudflare: ${res.error || res.output}`)
    }

    this.db.setSetting('tunnel_namedConfiguredAt', Date.now())
    this.cachedNamedSvc = null
    await this.notifications.notify({
      severity: 'success',
      category: 'system',
      title: 'Cloudflare Named Tunnel Ativo',
      message: 'O túnel permanente foi instalado como serviço do Windows. Tráfego externo roteado sem portas abertas.'
    })
  }

  public async uninstallNamedTunnel(): Promise<void> {
    if (!binaryPresent('cloudflared')) return
    const exe = binaryPath('cloudflared')
    const script = `
      $exe = ${psQuote(exe)}
      & $exe service uninstall 2>&1 | Out-Null
      Write-Output "Serviço Cloudflared desinstalado."
    `
    await runPrivileged(script)
    this.cachedNamedSvc = null
    this.db.setSetting('tunnel_namedConfiguredAt', null)
  }
}
