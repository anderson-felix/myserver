/**
 * Contrato tipado compartilhado entre Main Process, Preload e Renderer.
 * Toda comunicação IPC passa pelos canais definidos em `IPC` abaixo.
 */

// ---------------------------------------------------------------------------
// Canais IPC
// ---------------------------------------------------------------------------
export const IPC = {
  // Sistema / Telemetria / Hardening / Live Logs
  systemGetTelemetry: 'system:get-telemetry',
  systemRunHardening: 'system:run-hardening',
  systemPreviewNetwork: 'system:preview-network',
  systemGetInfo: 'system:get-info',
  systemOpenPath: 'system:open-path',
  systemOpenExternal: 'system:open-external',
  systemPickFolder: 'system:pick-folder',
  systemGetLogs: 'system:get-logs',
  systemClearLogs: 'system:clear-logs',
  systemOnLog: 'system:on-log',

  // Projetos ("Mini-Vercel")
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsStart: 'projects:start',
  projectsStop: 'projects:stop',
  projectsRestart: 'projects:restart',
  projectsRedeploy: 'projects:redeploy',
  projectsDelete: 'projects:delete',
  projectsInspectFolder: 'projects:inspect-folder',
  projectsGetLogs: 'projects:get-logs',
  projectsGetEnv: 'projects:get-env',
  projectsOnLog: 'projects:on-log',
  projectsOnStatus: 'projects:on-status',

  // Cloudflare Tunnel
  tunnelStartQuick: 'tunnel:start-quick',
  tunnelStopQuick: 'tunnel:stop-quick',
  tunnelConfigureNamed: 'tunnel:configure-named',
  tunnelUninstallNamed: 'tunnel:uninstall-named',
  tunnelStatus: 'tunnel:status',
  tunnelOnUpdate: 'tunnel:on-update',

  // Proxy Caddy
  proxySyncRoutes: 'proxy:sync-routes',
  proxyStatus: 'proxy:status',
  proxyStart: 'proxy:start',
  proxyStop: 'proxy:stop',
  proxyInstallService: 'proxy:install-service',
  proxyGetLogs: 'proxy:get-logs',

  // Notificações / Incidentes (4 canais: Discord, Teams, Slack, Telegram)
  notificationsTestWebhook: 'notifications:test-webhook',
  notificationsTestChannel: 'notifications:test-channel',
  notificationsTestAll: 'notifications:test-all',
  notificationsDetectTelegramChat: 'notifications:detect-telegram-chat',
  incidentsList: 'incidents:list',
  incidentsClear: 'incidents:clear',
  incidentsOnNew: 'incidents:on-new',
  watchdogSimulatePowerOutage: 'watchdog:simulate-power-outage',

  // Backup
  backupRunNow: 'backup:run-now',
  backupConfigureS3: 'backup:configure-s3',
  backupTestS3: 'backup:test-s3',
  backupList: 'backup:list',
  backupDecrypt: 'backup:decrypt',
  backupOnProgress: 'backup:on-progress',

  // Configurações
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsOnUpdated: 'settings:on-updated',

  // Linux remoto (Modelo B)
  linuxNodeList: 'linux-node:list',
  linuxNodeAdd: 'linux-node:add',
  linuxNodeRemove: 'linux-node:remove',
  linuxNodeConnect: 'linux-node:connect',
  linuxNodeProvision: 'linux-node:provision',
  linuxNodeDeploy: 'linux-node:deploy',
  linuxNodeRemoveDeployment: 'linux-node:remove-deployment',
  linuxNodeExec: 'linux-node:exec',
  linuxNodeOnLog: 'linux-node:on-log',
  linuxNodeContainerStart: 'linux-node:container-start',
  linuxNodeContainerStop: 'linux-node:container-stop',
  linuxNodeContainerRestart: 'linux-node:container-restart',
  linuxNodeContainerLogs: 'linux-node:container-logs'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Envelope padrão de resposta: erros do Main viram `{ ok:false, error }` no Renderer. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Telemetria
// ---------------------------------------------------------------------------
export type Severity = 'info' | 'success' | 'warning' | 'critical'

export interface BatteryInfo {
  hasBattery: boolean
  percent: number
  isCharging: boolean
  acConnected: boolean
  timeRemaining: number | null
  cycleCount: number | null
  healthPercent: number | null
}

export interface DiskInfo {
  fs: string
  mount: string
  type: string
  size: number
  used: number
  percent: number
}

export interface NetworkInfo {
  iface: string
  ip4: string
  mac: string
  type: string
  speedMbps: number | null
  gateway: string
  rxSec: number
  txSec: number
}

export interface Telemetry {
  timestamp: number
  host: {
    hostname: string
    distro: string
    release: string
    arch: string
    uptimeSec: number
    isAdmin: boolean
  }
  cpu: {
    model: string
    cores: number
    physicalCores: number
    loadPercent: number
    perCore: number[]
    speedGhz: number
    temperature: number | null
  }
  memory: {
    total: number
    used: number
    available: number
    percent: number
    swapTotal: number
    swapUsed: number
  }
  disks: DiskInfo[]
  network: NetworkInfo | null
  battery: BatteryInfo
}

export interface SystemInfo {
  isAdmin: boolean
  platform: NodeJS.Platform | string
  appVersion: string
  electronVersion: string
  isPackaged: boolean
  workspaceRoot: string
  userDataDir: string
  binaries: Record<BinaryName, { path: string; present: boolean }>
  runnerConfigured: boolean
}

export type BinaryName = 'node' | 'caddy' | 'cloudflared' | 'nssm'

// ---------------------------------------------------------------------------
// Hardening (Módulo 1)
// ---------------------------------------------------------------------------
export interface HardeningOptions {
  power: boolean
  staticIp: boolean
  dnsOnly?: boolean
  firewall: boolean
  restrictedUser: boolean
}

export interface NetworkPreview {
  iface: string
  ip: string
  mask: string
  gateway: string
  dhcp: boolean | null
  type: string
  dns: string[]
}

export type HardeningStepStatus = 'ok' | 'failed' | 'skipped'

export interface HardeningStep {
  id: keyof HardeningOptions | 'workspace'
  label: string
  status: HardeningStepStatus
  output: string
}

export interface HardeningReport {
  startedAt: number
  finishedAt: number
  elevated: boolean
  steps: HardeningStep[]
}

// ---------------------------------------------------------------------------
// Projetos (Módulo 2)
// ---------------------------------------------------------------------------
export type ProjectStack = 'node' | 'python' | 'static'
export type ProjectSourceType = 'git' | 'local'
/** child = subprocesso do Electron (dev/teste) · service = Serviço Windows via NSSM sob .\AppServerRunner */
export type ProjectRuntime = 'child' | 'service'
export type ProjectStatus =
  | 'idle'
  | 'deploying'
  | 'building'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'error'

export interface ProjectInput {
  name: string
  sourceType: ProjectSourceType
  source: string
  branch?: string
  stack: ProjectStack
  buildCommand: string
  startCommand: string
  outputDir?: string
  spaFallback?: boolean
  apiProxyTarget?: string
  maxMemoryMB: number
  healthcheckPath?: string
  domains: string[]
  env: Record<string, string>
  runtime: ProjectRuntime
  autoStart: boolean
  dataPaths: string[]
  /** Porta fixa opcional (null/undefined = alocação automática 3001..3999) */
  port?: number | null
}

export interface FolderInspection {
  name: string
  stack: ProjectStack
  buildCommand: string
  startCommand: string
  outputDir?: string
  spaFallback?: boolean
  framework?: 'vite' | 'next' | 'react' | 'express' | 'fastapi' | 'flask' | 'html' | 'generic'
  envKeys: string[]
  envMap: Record<string, string>
}

export interface Project extends Omit<ProjectInput, 'env'> {
  id: string
  slug: string
  port: number | null
  status: ProjectStatus
  statusMessage: string | null
  pid: number | null
  memoryMB: number | null
  restarts: number
  workdir: string
  envKeys: string[]
  createdAt: number
  updatedAt: number
  lastDeployAt: number | null
  startedAt: number | null
}

export interface LogEvent {
  projectId: string
  stream: 'stdout' | 'stderr' | 'system'
  line: string
  ts: number
}

export type SystemLogModule =
  | 'watchdog'
  | 'caddy'
  | 'cloudflare'
  | 'hardening'
  | 'process'
  | 'ssh'
  | 'backup'
  | 'notifications'
  | 'system'

export interface SystemLogEntry {
  id?: number
  ts: number
  module: SystemLogModule | string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  meta?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Proxy (Módulo 3)
// ---------------------------------------------------------------------------
export interface ProxyRoute {
  projectId: string
  projectName: string
  hosts: string[]
  upstream: string
  kind: 'reverse_proxy' | 'file_server'
}

export interface ProxyStatus {
  running: boolean
  adminReachable: boolean
  managedBy: 'child' | 'service' | 'none'
  serviceInstalled: boolean
  httpPort: number
  binaryPresent: boolean
  routes: ProxyRoute[]
  lastSyncAt: number | null
  lastError: string | null
}

// ---------------------------------------------------------------------------
// Cloudflare (Módulo 4)
// ---------------------------------------------------------------------------
export interface QuickTunnel {
  id: string
  projectId: string | null
  label: string
  target: string
  url: string | null
  qrDataUrl: string | null
  status: 'starting' | 'online' | 'stopped' | 'error'
  error: string | null
  startedAt: number
}

export interface NamedTunnelStatus {
  installed: boolean
  state: string | null
  configuredAt: number | null
}

export interface TunnelStatus {
  binaryPresent: boolean
  quick: QuickTunnel[]
  named: NamedTunnelStatus
}

// ---------------------------------------------------------------------------
// Notificações / Incidentes (Módulos 5 & 6)
// ---------------------------------------------------------------------------
export interface Incident {
  id: number
  ts: number
  severity: Severity
  category: 'power' | 'thermal' | 'memory' | 'healing' | 'backup' | 'system' | 'test' | 'project'
  title: string
  message: string
  projectId: string | null
  delivered: string | null
}

export type NotificationChannel = 'discord' | 'teams' | 'slack' | 'telegram'

export interface ChannelTestResult {
  configured: boolean
  ok: boolean
  status?: number
  error?: string
  latencyMs?: number
}

export interface WebhookTestResult {
  discord: ChannelTestResult
  teams: ChannelTestResult
  slack: ChannelTestResult
  telegram: ChannelTestResult
}

// ---------------------------------------------------------------------------
// Backup (Módulo 7)
// ---------------------------------------------------------------------------
export interface S3Config {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  prefix: string
  /** Somente escrita: undefined = manter · null = apagar · string = definir */
  secretAccessKey?: string | null
}

export interface BackupRecord {
  id: number
  ts: number
  file: string
  sizeBytes: number
  status: 'ok' | 'failed'
  uploaded: boolean
  remoteKey: string | null
  error: string | null
  durationMs: number
}

export interface BackupProgress {
  phase: 'snapshot' | 'compress' | 'encrypt' | 'rotate' | 'upload' | 'done' | 'error'
  message: string
}

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------
export interface AppSettings {
  workspaceRoot: string
  caddyHttpPort: number
  autoLaunch: boolean
  startMinimized: boolean
  serverLabel: string
  notifications: {
    desktop: boolean
    discordEnabled: boolean
    discordWebhookSet: boolean
    discordWebhookMasked: string
    discordWebhook: string
    teamsEnabled: boolean
    teamsWebhookSet: boolean
    teamsWebhookMasked: string
    teamsWebhook: string
    slackEnabled: boolean
    slackWebhookSet: boolean
    slackWebhookMasked: string
    slackWebhook: string
    telegramEnabled: boolean
    telegramBotTokenSet: boolean
    telegramBotTokenMasked: string
    telegramBotToken: string
    telegramChatId: string
  }
  watchdog: {
    enabled: boolean
    intervalSec: number
    cpuTempThreshold: number
    ramThresholdPercent: number
    batteryCriticalPercent: number
    autoShutdown: boolean
    healthFailThreshold: number
  }
  backup: {
    enabled: boolean
    cron: string
    keepLocal: number
    localDir: string
    passphraseSet: boolean
    s3: Omit<S3Config, 'secretAccessKey'> & { secretSet: boolean }
  }
  hardening: {
    lastRunAt: number | null
    runnerConfigured: boolean
  }
  tunnel: {
    namedConfiguredAt: number | null
  }
}

export interface SettingsUpdate {
  workspaceRoot?: string
  caddyHttpPort?: number
  autoLaunch?: boolean
  startMinimized?: boolean
  serverLabel?: string
  notifications?: {
    desktop?: boolean
    discordEnabled?: boolean
    discordWebhook?: string | null
    teamsEnabled?: boolean
    teamsWebhook?: string | null
    slackEnabled?: boolean
    slackWebhook?: string | null
    telegramEnabled?: boolean
    telegramBotToken?: string | null
    telegramChatId?: string | null
  }
  watchdog?: Partial<AppSettings['watchdog']>
  backup?: {
    enabled?: boolean
    cron?: string
    keepLocal?: number
    localDir?: string
    passphrase?: string | null
  }
}

// ---------------------------------------------------------------------------
// Linux remoto (Módulo 8)
// ---------------------------------------------------------------------------
export interface LinuxNodeInput {
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  password?: string
  privateKey?: string
  passphrase?: string
  /** senha de sudo (quando autenticação por chave e o usuário não for root) */
  sudoPassword?: string
}

export interface LinuxDeployment {
  projectId: string
  projectName: string
  port: number
  hosts: string[]
  deployedAt: number
}

export interface LinuxNode {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  provisioned: boolean
  lastSeen: number | null
  createdAt: number
  deployments: LinuxDeployment[]
}

export interface LinuxContainer {
  id: string
  name: string
  image: string
  status: string
  ports: string
}

export interface LinuxTelemetry {
  hostname: string
  os: string
  kernel: string
  uptimeSec: number
  cpus: number
  load: [number, number, number]
  memTotal: number
  memUsed: number
  diskTotal: number
  diskUsed: number
  batteryPercent: number | null
  acOnline: boolean | null
  temperatureC: number | null
  docker: boolean
  caddy: boolean
  cloudflared: boolean
  ufw: string | null
  containers: LinuxContainer[]
}

export interface LinuxProvisionOptions {
  power: boolean
  docker: boolean
  caddy: boolean
  cloudflared: boolean
  firewall: boolean
  allowHttpFromLan: boolean
}

export interface LinuxLogEvent {
  nodeId: string
  line: string
  stream: 'stdout' | 'stderr' | 'system'
  ts: number
}
