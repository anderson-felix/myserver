import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import AutoLaunch from 'auto-launch'
import { initLogger, createLogger, setLogHook } from './utils/logger'
import { initCrypto } from './utils/crypto'
import { iconPath, workspaceLayout } from './paths'
import { AppDatabase } from './database'
import { NotificationService } from './services/NotificationService'
import { WatchdogService } from './services/WatchdogService'
import { OsHardeningService } from './services/OsHardeningService'
import { ProcessManagerService } from './services/ProcessManagerService'
import { CaddyProxyService } from './services/CaddyProxyService'
import { CloudflareService } from './services/CloudflareService'
import { BackupService } from './services/BackupService'
import { LinuxSshService } from './services/LinuxSshService'
import { SystemLoggerService } from './services/SystemLoggerService'
import { DomainService } from './services/DomainService'
import { registerIpcHandlers } from './ipc/register'

const log = createLogger('main')

// Evita múltiplas instâncias concorrentes
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// Referência aos serviços para encerramento gracioso
let dbInstance: AppDatabase | null = null
let watchdogInstance: WatchdogService | null = null
let backupInstance: BackupService | null = null
let processManagerInstance: ProcessManagerService | null = null
let caddyProxyInstance: CaddyProxyService | null = null
let notificationsInstance: NotificationService | null = null

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'MyServer Orchestrator',
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => {
    const settings = dbInstance?.getFullSettings()
    if (!settings?.startMinimized) {
      win.show()
    }
  })

  // Previne fechar o app por engano no 'X' — minimiza para a bandeja do sistema
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  // Links externos abrem no navegador padrão do sistema
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Carrega renderer (Vite dev server ou index.html empacotado)
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function createTray(win: BrowserWindow): Tray {
  const icon = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 })
  const newTray = new Tray(icon)
  newTray.setToolTip('MyServer Orchestrator - Servidor Ativo')

  const updateMenu = () => {
    const projects = dbInstance?.listProjects() || []
    const running = projects.filter((p) => p.status === 'running').length

    const contextMenu = Menu.buildFromTemplate([
      { label: `MyServer · ${running} apps ativas`, enabled: false },
      { type: 'separator' },
      {
        label: 'Abrir Painel de Controle',
        click: () => {
          win.show()
          win.focus()
        }
      },
      {
        label: 'Disparar Backup Agora',
        click: () => {
          backupInstance?.runBackup().catch((err) => log.error('Falha no backup via Tray', err))
        }
      },
      { type: 'separator' },
      {
        label: 'Encerrar Servidor',
        click: async () => {
          isQuitting = true
          await cleanupAndExit()
        }
      }
    ])
    newTray.setContextMenu(contextMenu)
  }

  updateMenu()
  newTray.on('double-click', () => {
    win.show()
    win.focus()
  })

  return newTray
}

async function cleanupAndExit(): Promise<void> {
  log.info('Iniciando encerramento gracioso do HomeServer...')
  try {
    watchdogInstance?.stop()
    backupInstance?.stopScheduler()
    notificationsInstance?.stopTelegramBotPoller()
    if (tray) {
      tray.destroy()
      tray = null
    }
    if (processManagerInstance) {
      await processManagerInstance.stopAll(6_000)
    }
    await caddyProxyInstance?.stop()
    dbInstance?.close()
  } catch (err) {
    log.error('Erro durante o encerramento', err)
  }
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  initLogger(join(userData, 'logs'))
  initCrypto(join(userData, 'master.key'))

  log.info('Inicializando HomeServer Orchestrator...')
  const db = new AppDatabase(join(userData, 'homeserver.db'))
  dbInstance = db

  const settings = db.getFullSettings()
  const layout = workspaceLayout(settings.workspaceRoot)
  log.info(`Workspace configurado em: ${layout.root}`)

  // Auto-Launch (inicia com o Windows minimizado se configurado)
  try {
    const autoLauncher = new AutoLaunch({
      name: 'HomeServer Orchestrator',
      path: app.getPath('exe'),
      isHidden: true
    })
    const isAutoLaunchEnabled = await autoLauncher.isEnabled()
    if (settings.autoLaunch && !isAutoLaunchEnabled) {
      await autoLauncher.enable()
    } else if (!settings.autoLaunch && isAutoLaunchEnabled) {
      await autoLauncher.disable()
    }
  } catch (err) {
    log.warn('Falha ao configurar Auto-Launch', err)
  }

  // Instancia serviços
  const systemLogger = new SystemLoggerService(db)
  setLogHook((level, scope, msg, extra) => {
    const meta =
      extra instanceof Error
        ? { error: extra.message, stack: extra.stack }
        : typeof extra === 'object' && extra
        ? (extra as Record<string, unknown>)
        : undefined
    systemLogger.log(scope, level, msg, meta)
  })

  const notifications = new NotificationService(db)
  notificationsInstance = notifications
  notifications.startTelegramBotPoller()

  const watchdog = new WatchdogService(db, notifications)
  const osHardening = new OsHardeningService(db, notifications)
  const processManager = new ProcessManagerService(db, notifications)
  const caddyProxy = new CaddyProxyService(db, notifications)
  const cloudflare = new CloudflareService(db, notifications)
  const domains = new DomainService(db)
  domains.setCaddyProxy(caddyProxy)
  const backup = new BackupService(db, notifications)
  const linuxSsh = new LinuxSshService(db, notifications)

  // Vincula dependências cruzadas
  watchdog.setProcessManager(processManager)
  processManager.setCaddyProxy(caddyProxy)

  watchdogInstance = watchdog
  backupInstance = backup
  processManagerInstance = processManager
  caddyProxyInstance = caddyProxy

  // Registra IPC
  registerIpcHandlers({
    db,
    notifications,
    watchdog,
    osHardening,
    processManager,
    caddyProxy,
    cloudflare,
    backup,
    linuxSsh,
    systemLogger,
    domains
  })

  // Inicia janela e bandeja
  mainWindow = await createWindow()
  tray = createTray(mainWindow)

  // Inicia serviços em background
  watchdog.start()
  backup.startScheduler()

  // Inicia Caddy Proxy e auto-start de projetos
  caddyProxy.start().catch((err) => log.warn('Aviso ao iniciar Caddy Proxy automático:', err.message))
  processManager.autoStartProjects().catch((err) => log.error('Falha no auto-start dos projetos', err))
})

app.on('before-quit', async (e) => {
  if (!isQuitting) {
    e.preventDefault()
    isQuitting = true
    await cleanupAndExit()
  }
})

app.on('window-all-closed', () => {
  // Mantém rodando em background no Windows até o usuário encerrar explicitamente pelo tray
})
