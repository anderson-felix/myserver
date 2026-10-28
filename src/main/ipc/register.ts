import { ipcMain, shell, dialog, app } from 'electron'
import { IPC, type IpcResult, type SystemInfo } from '@shared/types'
import { binaryPath, binaryPresent } from '../paths'
import { isAdmin } from '../utils/shell'
import { createLogger } from '../utils/logger'
import type { AppDatabase } from '../database'
import type { NotificationService } from '../services/NotificationService'
import type { WatchdogService } from '../services/WatchdogService'
import type { OsHardeningService } from '../services/OsHardeningService'
import type { ProcessManagerService } from '../services/ProcessManagerService'
import type { CaddyProxyService } from '../services/CaddyProxyService'
import type { CloudflareService } from '../services/CloudflareService'
import type { BackupService } from '../services/BackupService'
import type { LinuxSshService } from '../services/LinuxSshService'
import type { SystemLoggerService } from '../services/SystemLoggerService'
import type { DomainService } from '../services/DomainService'
import { inspectProjectFolder } from '../utils/folderInspector'

const log = createLogger('ipc')

export interface AppServices {
  db: AppDatabase
  notifications: NotificationService
  watchdog: WatchdogService
  osHardening: OsHardeningService
  processManager: ProcessManagerService
  caddyProxy: CaddyProxyService
  cloudflare: CloudflareService
  backup: BackupService
  linuxSsh: LinuxSshService
  systemLogger: SystemLoggerService
  domains: DomainService
}

function handle<T, R>(channel: string, fn: (args: T) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_event, args: T): Promise<IpcResult<R>> => {
    try {
      const data = await fn(args)
      return { ok: true, data }
    } catch (err) {
      log.error(`Erro no canal IPC '${channel}':`, err)
      return { ok: false, error: (err as Error).message || String(err) }
    }
  })
}

export function registerIpcHandlers(services: AppServices): void {
  const { db, notifications, watchdog, osHardening, processManager, caddyProxy, cloudflare, backup, linuxSsh, systemLogger, domains } = services

  // -------------------------------------------------------------------------
  // Sistema / Informações / Hardening / Live Logs
  // -------------------------------------------------------------------------
  handle(IPC.systemGetTelemetry, async () => {
    return watchdog.getTelemetry()
  })

  handle(IPC.systemGetLogs, async (filter?: any) => {
    return systemLogger.getLogs(filter)
  })

  handle(IPC.systemClearLogs, async () => {
    return systemLogger.clear()
  })

  let cachedBinaries: SystemInfo['binaries'] | null = null
  let cachedIsAdmin: boolean | null = null

  handle(IPC.systemGetInfo, async (): Promise<SystemInfo> => {
    if (cachedIsAdmin === null) {
      cachedIsAdmin = await isAdmin()
    }
    if (!cachedBinaries) {
      cachedBinaries = {
        node: { path: binaryPath('node'), present: binaryPresent('node') },
        caddy: { path: binaryPath('caddy'), present: binaryPresent('caddy') },
        cloudflared: { path: binaryPath('cloudflared'), present: binaryPresent('cloudflared') },
        nssm: { path: binaryPath('nssm'), present: binaryPresent('nssm') }
      }
    }
    const settings = db.getFullSettings()
    return {
      isAdmin: cachedIsAdmin,
      platform: process.platform,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      isPackaged: app.isPackaged,
      workspaceRoot: settings.workspaceRoot,
      userDataDir: app.getPath('userData'),
      binaries: cachedBinaries,
      runnerConfigured: settings.hardening.runnerConfigured
    }
  })

  handle(IPC.systemPreviewNetwork, async () => {
    return osHardening.previewNetwork()
  })

  handle(IPC.systemRunHardening, async (options: any) => {
    return osHardening.runHardening(options)
  })

  handle(IPC.systemOpenPath, async (targetPath: string) => {
    return shell.openPath(targetPath)
  })

  handle(IPC.systemOpenExternal, async (url: string) => {
    return shell.openExternal(url)
  })

  handle(IPC.systemPickFolder, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // -------------------------------------------------------------------------
  // Projetos ("Mini-Vercel")
  // -------------------------------------------------------------------------
  handle(IPC.projectsList, () => {
    return db.listProjects()
  })

  handle(IPC.projectsCreate, async (input: any) => {
    const created = await processManager.create(input)
    await domains.syncFromProject(created.id)
    return db.getProject(created.id) ?? created
  })

  handle(IPC.projectsUpdate, async ({ id, data }: { id: string; data: any }) => {
    const updated = await processManager.update(id, data)
    await domains.syncFromProject(id)
    return db.getProject(id) ?? updated
  })

  handle(IPC.projectsStart, async (id: string) => {
    return processManager.start(id)
  })

  handle(IPC.projectsStop, async (id: string) => {
    return processManager.stop(id)
  })

  handle(IPC.projectsRestart, async (id: string) => {
    return processManager.restart(id, 'Reiniciado pelo usuário')
  })

  handle(IPC.projectsRedeploy, async (id: string) => {
    return processManager.redeploy(id)
  })

  handle(IPC.projectsDelete, async (id: string) => {
    await processManager.delete(id)
    await domains.unlinkProject(id)
  })

  handle(IPC.projectsInspectFolder, async (folderPath: string) => {
    return inspectProjectFolder(folderPath)
  })

  handle(IPC.projectsGetLogs, (id: string) => {
    return processManager.getLogs(id)
  })

  handle(IPC.projectsGetEnv, (id: string) => {
    return db.getProjectEnv(id)
  })

  // -------------------------------------------------------------------------
  // Cloudflare Tunnels
  // -------------------------------------------------------------------------
  handle(IPC.tunnelStatus, async () => {
    return cloudflare.getStatus()
  })

  handle(IPC.tunnelStartQuick, async ({ target, projectId, label }: any) => {
    return cloudflare.startQuickTunnel(target, projectId, label)
  })

  handle(IPC.tunnelStopQuick, async (id: string) => {
    return cloudflare.stopQuickTunnel(id)
  })

  handle(IPC.tunnelConfigureNamed, async (token: string) => {
    return cloudflare.configureNamedTunnel(token)
  })

  handle(IPC.tunnelUninstallNamed, async () => {
    return cloudflare.uninstallNamedTunnel()
  })

  // -------------------------------------------------------------------------
  // Central de Domínios Próprios
  // -------------------------------------------------------------------------
  handle(IPC.domainsList, async () => {
    return domains.list()
  })

  handle(IPC.domainsSave, async (input: any) => {
    return domains.save(input)
  })

  handle(IPC.domainsDelete, async (id: string) => {
    return domains.delete(id)
  })

  handle(IPC.domainsVerifyDns, async (id: string) => {
    return domains.verifyDomainDns(id)
  })

  handle(IPC.domainsApplyHosts, async (id: string) => {
    return domains.applyHostsFile(id)
  })

  handle(IPC.domainsNetworkEndpoints, async (force?: boolean) => {
    return domains.getNetworkEndpoints(Boolean(force))
  })

  handle(IPC.domainsCloudflareAutoDns, async ({ domainId, apiToken }: { domainId: string; apiToken?: string }) => {
    return domains.autoConfigureCloudflareDns(domainId, apiToken)
  })

  // -------------------------------------------------------------------------
  // Caddy Proxy
  // -------------------------------------------------------------------------
  handle(IPC.proxyStatus, async () => {
    return caddyProxy.getStatus()
  })

  handle(IPC.proxySyncRoutes, async () => {
    return caddyProxy.syncRoutes()
  })

  handle(IPC.proxyStart, async () => {
    return caddyProxy.start()
  })

  handle(IPC.proxyStop, async () => {
    return caddyProxy.stop()
  })

  handle(IPC.proxyInstallService, async () => {
    return caddyProxy.installService()
  })

  handle(IPC.proxyGetLogs, () => {
    return caddyProxy.getLogs()
  })

  // -------------------------------------------------------------------------
  // Notificações / Incidentes (4 canais: Discord, Teams, Slack, Telegram)
  // -------------------------------------------------------------------------
  handle(IPC.notificationsTestWebhook, async () => {
    return notifications.testWebhooks()
  })

  handle(IPC.notificationsTestAll, async () => {
    return notifications.testWebhooks()
  })

  handle(IPC.notificationsTestChannel, async (channel: any) => {
    return notifications.testChannel(channel)
  })

  handle(IPC.notificationsDetectTelegramChat, async (botToken?: string) => {
    return notifications.detectTelegramChat(botToken)
  })

  handle(IPC.watchdogSimulatePowerOutage, async () => {
    await watchdog.handlePowerEvent(false, true)
    return { success: true }
  })

  handle(IPC.incidentsList, (limit?: number) => {
    return db.listIncidents(limit || 100)
  })

  handle(IPC.incidentsClear, () => {
    return db.clearIncidents()
  })

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------
  handle(IPC.backupList, () => {
    return db.listBackups()
  })

  handle(IPC.backupRunNow, async () => {
    return backup.runBackup()
  })

  handle(IPC.backupConfigureS3, async (s3Config: any) => {
    db.setSetting('s3_enabled', s3Config.enabled)
    db.setSetting('s3_endpoint', s3Config.endpoint)
    db.setSetting('s3_region', s3Config.region)
    db.setSetting('s3_bucket', s3Config.bucket)
    db.setSetting('s3_accessKeyId', s3Config.accessKeyId)
    db.setSetting('s3_prefix', s3Config.prefix)
    if (s3Config.secretAccessKey !== undefined) {
      db.setSecret('s3_secret', s3Config.secretAccessKey)
    }
  })

  handle(IPC.backupTestS3, async (s3Config: any) => {
    return backup.testS3(s3Config)
  })

  handle(IPC.backupDecrypt, async ({ backupId, passphrase, targetDir }: { backupId: number; passphrase?: string; targetDir?: string }) => {
    return backup.restoreBackup(backupId, passphrase, targetDir)
  })

  // -------------------------------------------------------------------------
  // Configurações
  // -------------------------------------------------------------------------
  handle(IPC.settingsGet, () => {
    return db.getFullSettings()
  })

  handle(IPC.settingsUpdate, (update: any) => {
    db.updateSettings(update)
    return db.getFullSettings()
  })

  // -------------------------------------------------------------------------
  // Linux Remoto (Modelo B)
  // -------------------------------------------------------------------------
  handle(IPC.linuxNodeList, () => {
    return db.listLinuxNodes()
  })

  handle(IPC.linuxNodeAdd, async (input: any) => {
    const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const node = {
      id,
      name: input.name,
      host: input.host,
      port: input.port || 22,
      username: input.username,
      authType: input.authType,
      provisioned: false,
      lastSeen: null,
      createdAt: Date.now(),
      deployments: []
    }
    db.insertLinuxNode(node, input)
    return node
  })

  handle(IPC.linuxNodeRemove, (id: string) => {
    return db.deleteLinuxNode(id)
  })

  handle(IPC.linuxNodeConnect, async (id: string) => {
    return linuxSsh.connectAndTest(id)
  })

  handle(IPC.linuxNodeProvision, async ({ id, options }: any) => {
    return linuxSsh.provision(id, options)
  })

  handle(IPC.linuxNodeDeploy, async ({ nodeId, projectId }: any) => {
    return linuxSsh.deployContainer(nodeId, projectId)
  })

  handle(IPC.linuxNodeRemoveDeployment, async ({ nodeId, projectId }: any) => {
    return linuxSsh.removeDeployment(nodeId, projectId)
  })

  handle(IPC.linuxNodeContainerStart, async ({ nodeId, containerId }: any) => {
    return linuxSsh.startContainer(nodeId, containerId)
  })

  handle(IPC.linuxNodeContainerStop, async ({ nodeId, containerId }: any) => {
    return linuxSsh.stopContainer(nodeId, containerId)
  })

  handle(IPC.linuxNodeContainerRestart, async ({ nodeId, containerId }: any) => {
    return linuxSsh.restartContainer(nodeId, containerId)
  })

  handle(IPC.linuxNodeContainerLogs, async ({ nodeId, containerId, tail }: any) => {
    return linuxSsh.getContainerLogs(nodeId, containerId, tail)
  })
}
