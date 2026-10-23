import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '../utils/logger'
import { encryptJson, decryptJson, encrypt, decrypt } from '../utils/crypto'
import type {
  Project,
  ProjectInput,
  AppSettings,
  SettingsUpdate,
  Incident,
  BackupRecord,
  LinuxNode,
  LinuxNodeInput
} from '@shared/types'

const log = createLogger('database')

export class AppDatabase {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    log.info(`Banco SQLite inicializado em: ${dbPath}`)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
  }

  public getRawDb(): Database.Database {
    return this.db
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        sourceType TEXT NOT NULL,
        source TEXT NOT NULL,
        branch TEXT,
        stack TEXT NOT NULL,
        buildCommand TEXT NOT NULL DEFAULT '',
        startCommand TEXT NOT NULL DEFAULT '',
        outputDir TEXT,
        maxMemoryMB INTEGER NOT NULL DEFAULT 500,
        healthcheckPath TEXT,
        port INTEGER,
        status TEXT NOT NULL DEFAULT 'stopped',
        statusMessage TEXT,
        pid INTEGER,
        memoryMB REAL,
        restarts INTEGER NOT NULL DEFAULT 0,
        workdir TEXT NOT NULL,
        domainsJson TEXT NOT NULL DEFAULT '[]',
        encryptedEnv TEXT,
        envKeysJson TEXT NOT NULL DEFAULT '[]',
        runtime TEXT NOT NULL DEFAULT 'child',
        autoStart INTEGER NOT NULL DEFAULT 1,
        dataPathsJson TEXT NOT NULL DEFAULT '[]',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        lastDeployAt INTEGER,
        startedAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        projectId TEXT,
        delivered TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_incidents_ts ON incidents(ts DESC);

      CREATE TABLE IF NOT EXISTS backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        file TEXT NOT NULL,
        sizeBytes INTEGER NOT NULL,
        status TEXT NOT NULL,
        uploaded INTEGER NOT NULL DEFAULT 0,
        remoteKey TEXT,
        error TEXT,
        durationMs INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS linux_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        authType TEXT NOT NULL,
        encryptedPassword TEXT,
        encryptedPrivateKey TEXT,
        encryptedPassphrase TEXT,
        encryptedSudoPassword TEXT,
        provisioned INTEGER NOT NULL DEFAULT 0,
        lastSeen INTEGER,
        createdAt INTEGER NOT NULL,
        deploymentsJson TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        module TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        metaJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_system_logs_ts ON system_logs(ts DESC);
    `)

    try {
      this.db.exec("ALTER TABLE projects ADD COLUMN spaFallback INTEGER NOT NULL DEFAULT 1")
    } catch {
      /* coluna já existe */
    }

    try {
      this.db.exec("ALTER TABLE projects ADD COLUMN apiProxyTarget TEXT")
    } catch {
      /* coluna já existe */
    }
  }

  // -------------------------------------------------------------------------
  // Configurações
  // -------------------------------------------------------------------------
  public getSetting<T>(key: string, defaultValue: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return defaultValue
    try {
      return JSON.parse(row.value) as T
    } catch {
      return row.value as unknown as T
    }
  }

  public setSetting(key: string, value: unknown): void {
    const str = typeof value === 'string' ? value : JSON.stringify(value)
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, str)
  }

  public getSecret(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`secret:${key}`) as { value: string } | undefined
    if (!row) return null
    try {
      return decrypt(row.value)
    } catch {
      return null
    }
  }

  public setSecret(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`secret:${key}`)
    } else {
      const enc = encrypt(value)
      this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`secret:${key}`, enc)
    }
  }

  public getFullSettings(): AppSettings {
    const discordWebhook = this.getSecret('discord_webhook')
    const teamsWebhook = this.getSecret('teams_webhook')
    const slackWebhook = this.getSecret('slack_webhook')
    const telegramBotToken = this.getSecret('telegram_bot_token')
    const backupPass = this.getSecret('backup_passphrase')
    const s3Secret = this.getSecret('s3_secret')

    const mask = (v: string | null) => (v ? `${v.slice(0, 16)}••••••${v.slice(-4)}` : '')

    return {
      workspaceRoot: this.getSetting('workspaceRoot', 'C:\\HomeServerApps'),
      caddyHttpPort: this.getSetting('caddyHttpPort', 80),
      autoLaunch: this.getSetting('autoLaunch', true),
      startMinimized: this.getSetting('startMinimized', false),
      serverLabel: this.getSetting('serverLabel', 'HomeServer-Node-01'),
      notifications: {
        desktop: this.getSetting('notifications_desktop', true),
        discordEnabled: this.getSetting('notifications_discord_enabled', true),
        discordWebhookSet: !!discordWebhook,
        discordWebhookMasked: mask(discordWebhook),
        teamsEnabled: this.getSetting('notifications_teams_enabled', true),
        teamsWebhookSet: !!teamsWebhook,
        teamsWebhookMasked: mask(teamsWebhook),
        slackEnabled: this.getSetting('notifications_slack_enabled', false),
        slackWebhookSet: !!slackWebhook,
        slackWebhookMasked: mask(slackWebhook),
        telegramEnabled: this.getSetting('notifications_telegram_enabled', false),
        telegramBotTokenSet: !!telegramBotToken,
        telegramBotTokenMasked: mask(telegramBotToken),
        telegramChatId: this.getSetting('notifications_telegram_chat_id', '')
      },
      watchdog: this.getSetting('watchdog_config', {
        enabled: true,
        intervalSec: 15,
        cpuTempThreshold: 85,
        ramThresholdPercent: 90,
        batteryCriticalPercent: 15,
        autoShutdown: true,
        healthFailThreshold: 3
      }),
      backup: {
        enabled: this.getSetting('backup_enabled', true),
        cron: this.getSetting('backup_cron', '0 3 * * *'),
        keepLocal: this.getSetting('backup_keepLocal', 7),
        localDir: this.getSetting('backup_localDir', 'C:\\HomeServerApps\\backups'),
        passphraseSet: !!backupPass,
        s3: {
          enabled: this.getSetting('s3_enabled', false),
          endpoint: this.getSetting('s3_endpoint', ''),
          region: this.getSetting('s3_region', 'auto'),
          bucket: this.getSetting('s3_bucket', ''),
          accessKeyId: this.getSetting('s3_accessKeyId', ''),
          prefix: this.getSetting('s3_prefix', 'homeserver-backups'),
          secretSet: !!s3Secret
        }
      },
      hardening: {
        lastRunAt: this.getSetting<number | null>('hardening_lastRunAt', null),
        runnerConfigured: this.getSetting('hardening_runnerConfigured', false)
      },
      tunnel: {
        namedConfiguredAt: this.getSetting<number | null>('tunnel_namedConfiguredAt', null)
      }
    }
  }

  public updateSettings(update: SettingsUpdate): void {
    if (update.workspaceRoot !== undefined) this.setSetting('workspaceRoot', update.workspaceRoot)
    if (update.caddyHttpPort !== undefined) this.setSetting('caddyHttpPort', update.caddyHttpPort)
    if (update.autoLaunch !== undefined) this.setSetting('autoLaunch', update.autoLaunch)
    if (update.startMinimized !== undefined) this.setSetting('startMinimized', update.startMinimized)
    if (update.serverLabel !== undefined) this.setSetting('serverLabel', update.serverLabel)

    if (update.notifications) {
      if (update.notifications.desktop !== undefined) this.setSetting('notifications_desktop', update.notifications.desktop)
      if (update.notifications.discordEnabled !== undefined) this.setSetting('notifications_discord_enabled', update.notifications.discordEnabled)
      if (update.notifications.teamsEnabled !== undefined) this.setSetting('notifications_teams_enabled', update.notifications.teamsEnabled)
      if (update.notifications.slackEnabled !== undefined) this.setSetting('notifications_slack_enabled', update.notifications.slackEnabled)
      if (update.notifications.telegramEnabled !== undefined) this.setSetting('notifications_telegram_enabled', update.notifications.telegramEnabled)
      if (update.notifications.telegramChatId !== undefined) this.setSetting('notifications_telegram_chat_id', update.notifications.telegramChatId)

      if (update.notifications.discordWebhook !== undefined) {
        this.setSecret('discord_webhook', update.notifications.discordWebhook)
      }
      if (update.notifications.teamsWebhook !== undefined) {
        this.setSecret('teams_webhook', update.notifications.teamsWebhook)
      }
      if (update.notifications.slackWebhook !== undefined) {
        this.setSecret('slack_webhook', update.notifications.slackWebhook)
      }
      if (update.notifications.telegramBotToken !== undefined) {
        this.setSecret('telegram_bot_token', update.notifications.telegramBotToken)
      }
    }

    if (update.watchdog) {
      const current = this.getSetting('watchdog_config', {})
      this.setSetting('watchdog_config', { ...current, ...update.watchdog })
    }

    if (update.backup) {
      if (update.backup.enabled !== undefined) this.setSetting('backup_enabled', update.backup.enabled)
      if (update.backup.cron !== undefined) this.setSetting('backup_cron', update.backup.cron)
      if (update.backup.keepLocal !== undefined) this.setSetting('backup_keepLocal', update.backup.keepLocal)
      if (update.backup.localDir !== undefined) this.setSetting('backup_localDir', update.backup.localDir)
      if (update.backup.passphrase !== undefined) {
        this.setSecret('backup_passphrase', update.backup.passphrase)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Projetos
  // -------------------------------------------------------------------------
  public listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY name ASC').all() as any[]
    return rows.map((r) => this.mapProject(r))
  }

  public getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any
    return row ? this.mapProject(row) : null
  }

  public getProjectBySlug(slug: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as any
    return row ? this.mapProject(row) : null
  }

  public insertProject(project: Project, env: Record<string, string>): void {
    const encEnv = encryptJson(env)
    const envKeys = Object.keys(env)
    this.db.prepare(`
      INSERT INTO projects (
        id, name, slug, sourceType, source, branch, stack, buildCommand, startCommand,
        outputDir, spaFallback, apiProxyTarget, maxMemoryMB, healthcheckPath, port, status, statusMessage, pid,
        memoryMB, restarts, workdir, domainsJson, encryptedEnv, envKeysJson, runtime,
        autoStart, dataPathsJson, createdAt, updatedAt, lastDeployAt, startedAt
      ) VALUES (
        @id, @name, @slug, @sourceType, @source, @branch, @stack, @buildCommand, @startCommand,
        @outputDir, @spaFallback, @apiProxyTarget, @maxMemoryMB, @healthcheckPath, @port, @status, @statusMessage, @pid,
        @memoryMB, @restarts, @workdir, @domainsJson, @encryptedEnv, @envKeysJson, @runtime,
        @autoStart, @dataPathsJson, @createdAt, @updatedAt, @lastDeployAt, @startedAt
      )
    `).run({
      ...project,
      spaFallback: project.spaFallback !== false ? 1 : 0,
      apiProxyTarget: project.apiProxyTarget ?? null,
      domainsJson: JSON.stringify(project.domains),
      encryptedEnv: encEnv,
      envKeysJson: JSON.stringify(envKeys),
      autoStart: project.autoStart ? 1 : 0,
      dataPathsJson: JSON.stringify(project.dataPaths)
    })
  }

  public updateProject(id: string, partial: Partial<ProjectInput> & Partial<Project>): void {
    const existing = this.getProject(id)
    if (!existing) return

    let encEnv = undefined
    let envKeysJson = undefined
    if (partial.env !== undefined) {
      encEnv = encryptJson(partial.env)
      envKeysJson = JSON.stringify(Object.keys(partial.env))
    }

    const fields: string[] = ['updatedAt = ?']
    const values: any[] = [Date.now()]

    const mapField = (col: string, val: any) => {
      fields.push(`${col} = ?`)
      values.push(val)
    }

    if (partial.name !== undefined) mapField('name', partial.name)
    if (partial.sourceType !== undefined) mapField('sourceType', partial.sourceType)
    if (partial.source !== undefined) mapField('source', partial.source)
    if (partial.branch !== undefined) mapField('branch', partial.branch)
    if (partial.stack !== undefined) mapField('stack', partial.stack)
    if (partial.buildCommand !== undefined) mapField('buildCommand', partial.buildCommand)
    if (partial.startCommand !== undefined) mapField('startCommand', partial.startCommand)
    if (partial.outputDir !== undefined) mapField('outputDir', partial.outputDir)
    if (partial.spaFallback !== undefined) mapField('spaFallback', partial.spaFallback ? 1 : 0)
    if (partial.apiProxyTarget !== undefined) mapField('apiProxyTarget', partial.apiProxyTarget || null)
    if (partial.maxMemoryMB !== undefined) mapField('maxMemoryMB', partial.maxMemoryMB)
    if (partial.healthcheckPath !== undefined) mapField('healthcheckPath', partial.healthcheckPath)
    if (partial.port !== undefined) mapField('port', partial.port)
    if (partial.status !== undefined) mapField('status', partial.status)
    if (partial.statusMessage !== undefined) mapField('statusMessage', partial.statusMessage)
    if (partial.pid !== undefined) mapField('pid', partial.pid)
    if (partial.memoryMB !== undefined) mapField('memoryMB', partial.memoryMB)
    if (partial.restarts !== undefined) mapField('restarts', partial.restarts)
    if (partial.domains !== undefined) mapField('domainsJson', JSON.stringify(partial.domains))
    if (partial.runtime !== undefined) mapField('runtime', partial.runtime)
    if (partial.autoStart !== undefined) mapField('autoStart', partial.autoStart ? 1 : 0)
    if (partial.dataPaths !== undefined) mapField('dataPathsJson', JSON.stringify(partial.dataPaths))
    if (partial.lastDeployAt !== undefined) mapField('lastDeployAt', partial.lastDeployAt)
    if (partial.startedAt !== undefined) mapField('startedAt', partial.startedAt)

    if (encEnv !== undefined && envKeysJson !== undefined) {
      fields.push('encryptedEnv = ?', 'envKeysJson = ?')
      values.push(encEnv, envKeysJson)
    }

    values.push(id)
    this.db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  public getProjectEnv(id: string): Record<string, string> {
    const row = this.db.prepare('SELECT encryptedEnv FROM projects WHERE id = ?').get(id) as { encryptedEnv: string } | undefined
    if (!row || !row.encryptedEnv) return {}
    return decryptJson<Record<string, string>>(row.encryptedEnv, {})
  }

  public deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  private mapProject(r: any): Project {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      sourceType: r.sourceType,
      source: r.source,
      branch: r.branch ?? undefined,
      stack: r.stack,
      buildCommand: r.buildCommand,
      startCommand: r.startCommand,
      outputDir: r.outputDir ?? undefined,
      spaFallback: r.spaFallback !== 0,
      apiProxyTarget: r.apiProxyTarget ?? undefined,
      maxMemoryMB: r.maxMemoryMB,
      healthcheckPath: r.healthcheckPath ?? undefined,
      port: r.port ?? null,
      status: r.status,
      statusMessage: r.statusMessage ?? null,
      pid: r.pid ?? null,
      memoryMB: r.memoryMB ?? null,
      restarts: r.restarts,
      workdir: r.workdir,
      domains: JSON.parse(r.domainsJson || '[]'),
      envKeys: JSON.parse(r.envKeysJson || '[]'),
      runtime: r.runtime,
      autoStart: r.autoStart === 1,
      dataPaths: JSON.parse(r.dataPathsJson || '[]'),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastDeployAt: r.lastDeployAt ?? null,
      startedAt: r.startedAt ?? null
    }
  }

  // -------------------------------------------------------------------------
  // Logs em Tempo Real do Sistema
  // -------------------------------------------------------------------------
  public insertSystemLog(entry: { ts: number; module: string; level: string; message: string; meta?: any }): void {
    try {
      this.db.prepare(`
        INSERT INTO system_logs (ts, module, level, message, metaJson)
        VALUES (@ts, @module, @level, @message, @metaJson)
      `).run({
        ts: entry.ts,
        module: entry.module,
        level: entry.level,
        message: entry.message,
        metaJson: entry.meta ? JSON.stringify(entry.meta) : null
      })
    } catch {
      /* ignore */
    }
  }

  public listSystemLogs(limit = 500, module?: string): Array<{
    id: number
    ts: number
    module: string
    level: 'info' | 'warn' | 'error' | 'debug'
    message: string
    meta?: Record<string, unknown>
  }> {
    try {
      let rows: any[]
      if (module && module !== 'all') {
        rows = this.db.prepare('SELECT * FROM system_logs WHERE module = ? ORDER BY ts DESC LIMIT ?').all(module, limit)
      } else {
        rows = this.db.prepare('SELECT * FROM system_logs ORDER BY ts DESC LIMIT ?').all(limit)
      }
      return rows.reverse().map((r) => ({
        id: r.id,
        ts: r.ts,
        module: r.module,
        level: r.level,
        message: r.message,
        meta: r.metaJson ? JSON.parse(r.metaJson) : undefined
      }))
    } catch {
      return []
    }
  }

  public clearSystemLogs(): void {
    try {
      this.db.prepare('DELETE FROM system_logs').run()
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------
  // Incidentes
  // -------------------------------------------------------------------------
  public insertIncident(incident: Omit<Incident, 'id'>): Incident {
    const info = this.db.prepare(`
      INSERT INTO incidents (ts, severity, category, title, message, projectId, delivered)
      VALUES (@ts, @severity, @category, @title, @message, @projectId, @delivered)
    `).run(incident)
    return { ...incident, id: Number(info.lastInsertRowid) }
  }

  public listIncidents(limit = 100): Incident[] {
    return this.db.prepare('SELECT * FROM incidents ORDER BY ts DESC LIMIT ?').all(limit) as Incident[]
  }

  public clearIncidents(): void {
    this.db.prepare('DELETE FROM incidents').run()
  }

  // -------------------------------------------------------------------------
  // Backups
  // -------------------------------------------------------------------------
  public insertBackup(record: Omit<BackupRecord, 'id'>): BackupRecord {
    const info = this.db.prepare(`
      INSERT INTO backups (ts, file, sizeBytes, status, uploaded, remoteKey, error, durationMs)
      VALUES (@ts, @file, @sizeBytes, @status, @uploaded, @remoteKey, @error, @durationMs)
    `).run({ ...record, uploaded: record.uploaded ? 1 : 0 })
    return { ...record, id: Number(info.lastInsertRowid) }
  }

  public listBackups(limit = 50): BackupRecord[] {
    const rows = this.db.prepare('SELECT * FROM backups ORDER BY ts DESC LIMIT ?').all(limit) as any[]
    return rows.map((r) => ({
      ...r,
      uploaded: r.uploaded === 1
    }))
  }

  // -------------------------------------------------------------------------
  // Linux Nodes (Modelo B)
  // -------------------------------------------------------------------------
  public listLinuxNodes(): LinuxNode[] {
    const rows = this.db.prepare('SELECT * FROM linux_nodes ORDER BY name ASC').all() as any[]
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      username: r.username,
      authType: r.authType,
      provisioned: r.provisioned === 1,
      lastSeen: r.lastSeen ?? null,
      createdAt: r.createdAt,
      deployments: JSON.parse(r.deploymentsJson || '[]')
    }))
  }

  public getLinuxNodeAuth(id: string): (LinuxNodeInput & { id: string }) | null {
    const r = this.db.prepare('SELECT * FROM linux_nodes WHERE id = ?').get(id) as any
    if (!r) return null
    return {
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      username: r.username,
      authType: r.authType,
      password: r.encryptedPassword ? decrypt(r.encryptedPassword) : undefined,
      privateKey: r.encryptedPrivateKey ? decrypt(r.encryptedPrivateKey) : undefined,
      passphrase: r.encryptedPassphrase ? decrypt(r.encryptedPassphrase) : undefined,
      sudoPassword: r.encryptedSudoPassword ? decrypt(r.encryptedSudoPassword) : undefined
    }
  }

  public insertLinuxNode(node: LinuxNode, auth: LinuxNodeInput): void {
    this.db.prepare(`
      INSERT INTO linux_nodes (
        id, name, host, port, username, authType,
        encryptedPassword, encryptedPrivateKey, encryptedPassphrase, encryptedSudoPassword,
        provisioned, lastSeen, createdAt, deploymentsJson
      ) VALUES (
        @id, @name, @host, @port, @username, @authType,
        @encryptedPassword, @encryptedPrivateKey, @encryptedPassphrase, @encryptedSudoPassword,
        @provisioned, @lastSeen, @createdAt, @deploymentsJson
      )
    `).run({
      id: node.id,
      name: node.name,
      host: node.host,
      port: node.port,
      username: node.username,
      authType: node.authType,
      encryptedPassword: auth.password ? encrypt(auth.password) : null,
      encryptedPrivateKey: auth.privateKey ? encrypt(auth.privateKey) : null,
      encryptedPassphrase: auth.passphrase ? encrypt(auth.passphrase) : null,
      encryptedSudoPassword: auth.sudoPassword ? encrypt(auth.sudoPassword) : null,
      provisioned: node.provisioned ? 1 : 0,
      lastSeen: node.lastSeen,
      createdAt: node.createdAt,
      deploymentsJson: JSON.stringify(node.deployments)
    })
  }

  public updateLinuxNode(id: string, partial: Partial<LinuxNode>): void {
    const fields: string[] = []
    const values: any[] = []
    if (partial.name !== undefined) { fields.push('name = ?'); values.push(partial.name) }
    if (partial.provisioned !== undefined) { fields.push('provisioned = ?'); values.push(partial.provisioned ? 1 : 0) }
    if (partial.lastSeen !== undefined) { fields.push('lastSeen = ?'); values.push(partial.lastSeen) }
    if (partial.deployments !== undefined) { fields.push('deploymentsJson = ?'); values.push(JSON.stringify(partial.deployments)) }
    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE linux_nodes SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  public deleteLinuxNode(id: string): void {
    this.db.prepare('DELETE FROM linux_nodes WHERE id = ?').run(id)
  }

  public close(): void {
    try {
      this.db.close()
    } catch {
      /* ignore */
    }
  }
}
