import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type IpcResult,
  type Telemetry,
  type SystemInfo,
  type NetworkPreview,
  type HardeningOptions,
  type HardeningReport,
  type Project,
  type ProjectInput,
  type FolderInspection,
  type LogEvent,
  type TunnelStatus,
  type QuickTunnel,
  type ProxyStatus,
  type WebhookTestResult,
  type Incident,
  type BackupRecord,
  type BackupProgress,
  type S3Config,
  type AppSettings,
  type SettingsUpdate,
  type LinuxNode,
  type LinuxNodeInput,
  type LinuxTelemetry,
  type LinuxProvisionOptions,
  type LinuxLogEvent,
  type SystemLogEntry,
  type NotificationChannel,
  type ChannelTestResult,
  type DomainRecord,
  type DomainInput,
  type DomainDnsVerification,
  type NetworkEndpoints,
  type HostsApplyResult,
  type CloudflareAutoDnsResult
} from '@shared/types'

async function invoke<T>(channel: string, args?: unknown): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, args)) as IpcResult<T>
  if (res && typeof res === 'object' && 'ok' in res) {
    if (res.ok) return res.data
    throw new Error(res.error || 'Erro na chamada IPC')
  }
  return res as T
}

function onEvent<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

export const api = {
  // Sistema / Telemetria
  getTelemetry: () => invoke<Telemetry>(IPC.systemGetTelemetry),
  getInfo: () => invoke<SystemInfo>(IPC.systemGetInfo),
  previewNetwork: () => invoke<NetworkPreview | null>(IPC.systemPreviewNetwork),
  runHardening: (options: HardeningOptions) => invoke<HardeningReport>(IPC.systemRunHardening, options),
  openPath: (p: string) => invoke<string>(IPC.systemOpenPath, p),
  openExternal: (url: string) => invoke<void>(IPC.systemOpenExternal, url),
  pickFolder: () => invoke<string | null>(IPC.systemPickFolder),

  // Projetos ("Mini-Vercel")
  listProjects: () => invoke<Project[]>(IPC.projectsList),
  createProject: (input: ProjectInput) => invoke<Project>(IPC.projectsCreate, input),
  updateProject: (id: string, data: Partial<ProjectInput>) => invoke<Project>(IPC.projectsUpdate, { id, data }),
  startProject: (id: string) => invoke<Project>(IPC.projectsStart, id),
  stopProject: (id: string) => invoke<Project>(IPC.projectsStop, id),
  restartProject: (id: string) => invoke<Project>(IPC.projectsRestart, id),
  redeployProject: (id: string) => invoke<Project>(IPC.projectsRedeploy, id),
  deleteProject: (id: string) => invoke<void>(IPC.projectsDelete, id),
  inspectFolder: (folderPath: string) => invoke<FolderInspection>(IPC.projectsInspectFolder, folderPath),
  getProjectLogs: (id: string) => invoke<LogEvent[]>(IPC.projectsGetLogs, id),
  getProjectEnv: (id: string) => invoke<Record<string, string>>(IPC.projectsGetEnv, id),

  onProjectLogs: (cb: (events: LogEvent[]) => void) => onEvent<LogEvent[]>(IPC.projectsOnLog, cb),
  onProjectStatus: (cb: (data: { id: string; status: string; message: string }) => void) =>
    onEvent<{ id: string; status: string; message: string }>(IPC.projectsOnStatus, cb),

  // Cloudflare Tunnels
  getTunnelStatus: () => invoke<TunnelStatus>(IPC.tunnelStatus),
  startQuickTunnel: (target: string | number, projectId?: string, label?: string) =>
    invoke<QuickTunnel>(IPC.tunnelStartQuick, { target, projectId, label }),
  stopQuickTunnel: (id: string) => invoke<void>(IPC.tunnelStopQuick, id),
  configureNamedTunnel: (token: string) => invoke<void>(IPC.tunnelConfigureNamed, token),
  uninstallNamedTunnel: () => invoke<void>(IPC.tunnelUninstallNamed),
  onTunnelUpdate: (cb: (tunnel: QuickTunnel) => void) => onEvent<QuickTunnel>(IPC.tunnelOnUpdate, cb),

  // Central de Domínios Próprios
  listDomains: () => invoke<DomainRecord[]>(IPC.domainsList),
  saveDomain: (input: DomainInput) => invoke<DomainRecord>(IPC.domainsSave, input),
  deleteDomain: (id: string) => invoke<void>(IPC.domainsDelete, id),
  verifyDomainDns: (id: string) => invoke<DomainDnsVerification>(IPC.domainsVerifyDns, id),
  applyDomainHosts: (id: string) => invoke<HostsApplyResult>(IPC.domainsApplyHosts, id),
  getNetworkEndpoints: (force?: boolean) => invoke<NetworkEndpoints>(IPC.domainsNetworkEndpoints, force),
  autoConfigureCloudflareDns: (domainId: string, apiToken?: string) =>
    invoke<CloudflareAutoDnsResult>(IPC.domainsCloudflareAutoDns, { domainId, apiToken }),

  // Caddy Proxy
  getProxyStatus: () => invoke<ProxyStatus>(IPC.proxyStatus),
  syncProxyRoutes: () => invoke<void>(IPC.proxySyncRoutes),
  startProxy: () => invoke<void>(IPC.proxyStart),
  stopProxy: () => invoke<void>(IPC.proxyStop),
  installProxyService: () => invoke<void>(IPC.proxyInstallService),
  getProxyLogs: () => invoke<string[]>(IPC.proxyGetLogs),

  // Notificações e Incidentes (4 canais: Discord, Teams, Slack, Telegram)
  testWebhooks: () => invoke<WebhookTestResult>(IPC.notificationsTestWebhook),
  testNotificationChannel: (channel: NotificationChannel) =>
    invoke<ChannelTestResult>(IPC.notificationsTestChannel, channel),
  testAllNotificationChannels: () => invoke<WebhookTestResult>(IPC.notificationsTestAll),
  detectTelegramChat: (botToken?: string) =>
    invoke<{ chatId: string; username?: string; firstName?: string }>(IPC.notificationsDetectTelegramChat, botToken),
  simulatePowerOutage: () => invoke<{ success: boolean }>(IPC.watchdogSimulatePowerOutage),
  listIncidents: (limit?: number) => invoke<Incident[]>(IPC.incidentsList, limit),
  clearIncidents: () => invoke<void>(IPC.incidentsClear),
  onNewIncident: (cb: (incident: Incident) => void) => onEvent<Incident>(IPC.incidentsOnNew, cb),

  // Console do Sistema / Live Logs
  getSystemLogs: (filter?: { module?: string; level?: string; limit?: number }) =>
    invoke<SystemLogEntry[]>(IPC.systemGetLogs, filter),
  clearSystemLogs: () => invoke<void>(IPC.systemClearLogs),
  onSystemLog: (cb: (entry: SystemLogEntry) => void) => onEvent<SystemLogEntry>(IPC.systemOnLog, cb),

  // Backup
  listBackups: () => invoke<BackupRecord[]>(IPC.backupList),
  runBackupNow: () => invoke<BackupRecord>(IPC.backupRunNow),
  configureS3: (config: S3Config) => invoke<void>(IPC.backupConfigureS3, config),
  testS3: (config: S3Config & { secretAccessKey: string }) => invoke<void>(IPC.backupTestS3, config),
  onBackupProgress: (cb: (progress: BackupProgress) => void) => onEvent<BackupProgress>(IPC.backupOnProgress, cb),
  restoreBackup: (backupId: number, passphrase?: string, targetDir?: string) =>
    invoke<{ restoredTo: string }>(IPC.backupDecrypt, { backupId, passphrase, targetDir }),

  // Configurações
  getSettings: () => invoke<AppSettings>(IPC.settingsGet),
  updateSettings: (update: SettingsUpdate) => invoke<AppSettings>(IPC.settingsUpdate, update),
  onSettingsUpdated: (cb: (settings: AppSettings) => void) => onEvent<AppSettings>(IPC.settingsOnUpdated, cb),

  // Linux Remoto (Modelo B)
  listLinuxNodes: () => invoke<LinuxNode[]>(IPC.linuxNodeList),
  addLinuxNode: (input: LinuxNodeInput) => invoke<LinuxNode>(IPC.linuxNodeAdd, input),
  removeLinuxNode: (id: string) => invoke<void>(IPC.linuxNodeRemove, id),
  connectLinuxNode: (id: string) => invoke<LinuxTelemetry>(IPC.linuxNodeConnect, id),
  provisionLinuxNode: (id: string, options: LinuxProvisionOptions) => invoke<void>(IPC.linuxNodeProvision, { id, options }),
  deployLinuxContainer: (nodeId: string, projectId: string) => invoke<void>(IPC.linuxNodeDeploy, { nodeId, projectId }),
  removeLinuxDeployment: (nodeId: string, projectId: string) => invoke<void>(IPC.linuxNodeRemoveDeployment, { nodeId, projectId }),
  startLinuxContainer: (nodeId: string, containerId: string) =>
    invoke<void>(IPC.linuxNodeContainerStart, { nodeId, containerId }),
  stopLinuxContainer: (nodeId: string, containerId: string) =>
    invoke<void>(IPC.linuxNodeContainerStop, { nodeId, containerId }),
  restartLinuxContainer: (nodeId: string, containerId: string) =>
    invoke<void>(IPC.linuxNodeContainerRestart, { nodeId, containerId }),
  getLinuxContainerLogs: (nodeId: string, containerId: string, tail?: number) =>
    invoke<string>(IPC.linuxNodeContainerLogs, { nodeId, containerId, tail }),
  onLinuxLog: (cb: (event: LinuxLogEvent) => void) => onEvent<LinuxLogEvent>(IPC.linuxNodeOnLog, cb)
}

contextBridge.exposeInMainWorld('api', api)
