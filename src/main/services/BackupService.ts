import cron, { type ScheduledTask } from 'node-cron'
import * as tar from 'tar'
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import { createCipheriv, scryptSync, randomBytes } from 'node:crypto'
import { createLogger } from '../utils/logger'
import { broadcast } from '../utils/common'
import { workspaceLayout } from '../paths'
import { IPC, type BackupRecord, type BackupProgress, type S3Config } from '@shared/types'
import type { AppDatabase } from '../database'
import type { NotificationService } from './NotificationService'

const log = createLogger('backup')

export class BackupService {
  private cronJob: ScheduledTask | null = null

  constructor(
    private db: AppDatabase,
    private notifications: NotificationService
  ) {}

  public startScheduler(): void {
    const settings = this.db.getFullSettings()
    if (!settings.backup.enabled) return

    const cronExpr = settings.backup.cron || '0 3 * * *'
    if (!cron.validate(cronExpr)) {
      log.warn(`Expressão cron inválida: ${cronExpr}`)
      return
    }

    log.info(`Iniciando agendador de backups automáticos: ${cronExpr}`)
    this.cronJob = cron.schedule(cronExpr, () => {
      log.info('Disparando rotina de backup agendada...')
      this.runBackup().catch((err) => log.error('Falha no backup agendado', err))
    })
  }

  public stopScheduler(): void {
    if (this.cronJob) {
      this.cronJob.stop()
      this.cronJob = null
    }
  }

  public async runBackup(): Promise<BackupRecord> {
    const startTime = Date.now()
    log.info('Iniciando rotina de backup...')
    this.emitProgress('snapshot', 'Iniciando captura de dados e bancos de dados...')

    const settings = this.db.getFullSettings()
    const layout = workspaceLayout(settings.workspaceRoot)
    const backupDir = settings.backup.localDir || join(settings.workspaceRoot, 'backups')
    mkdirSync(backupDir, { recursive: true })

    const dateStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const rawArchive = join(backupDir, `snapshot_${dateStamp}.tar.gz`)
    const finalEncryptedFile = join(backupDir, `backup_${dateStamp}.hsenc`)

    let uploaded = false
    let remoteKey: string | null = null
    let error: string | null = null

    try {
      // 1. Identifica diretórios para incluir no backup
      const targets: string[] = []
      // Banco SQLite interno do app
      const dbFile = (this.db as any).db?.name
      if (dbFile && existsSync(dbFile)) {
        targets.push(dbFile)
      }

      // Pastas de dados cadastradas nos projetos
      const projects = this.db.listProjects()
      for (const p of projects) {
        for (const dp of p.dataPaths || []) {
          const fullPath = join(p.workdir, dp)
          if (existsSync(fullPath)) targets.push(fullPath)
        }
      }

      // Se nenhum dado específico de projeto foi adicionado, inclui a pasta apps inteira
      if (targets.length === 0 && existsSync(layout.apps)) {
        targets.push(layout.apps)
      }

      this.emitProgress('compress', `Compactando ${targets.length} alvos em arquivo tar.gz...`)

      // 2. Compactação tar.gz
      await tar.create(
        {
          gzip: true,
          file: rawArchive,
          cwd: settings.workspaceRoot
        },
        targets.map((t) => (t.startsWith(settings.workspaceRoot) ? t.slice(settings.workspaceRoot.length + 1) : basename(t)))
      )

      // 3. Criptografia AES-256
      this.emitProgress('encrypt', 'Criptografando arquivo de backup...')
      const userPass = this.db.getSecret('backup_passphrase') || 'HomeServer-Default-Key-2026'
      await this.encryptFile(rawArchive, finalEncryptedFile, userPass)
      unlinkSync(rawArchive) // Remove o tar.gz não-criptografado

      const stats = statSync(finalEncryptedFile)
      const sizeBytes = stats.size

      // 4. Rotação Local (mantém os últimos N)
      this.emitProgress('rotate', `Aplicando política de retenção local (máximo ${settings.backup.keepLocal} cópias)...`)
      this.rotateBackups(backupDir, settings.backup.keepLocal || 7)

      // 5. Upload S3 / Cloudflare R2 se configurado
      if (settings.backup.s3.enabled && settings.backup.s3.bucket && settings.backup.s3.endpoint) {
        this.emitProgress('upload', 'Enviando backup criptografado para Bucket S3 / Cloudflare R2...')
        const s3Secret = this.db.getSecret('s3_secret')
        if (s3Secret) {
          const client = new S3Client({
            region: settings.backup.s3.region || 'auto',
            endpoint: settings.backup.s3.endpoint,
            credentials: {
              accessKeyId: settings.backup.s3.accessKeyId,
              secretAccessKey: s3Secret
            }
          })

          const prefix = settings.backup.s3.prefix || 'homeserver-backups'
          remoteKey = `${prefix}/${basename(finalEncryptedFile)}`

          const fileStream = readFileSync(finalEncryptedFile)
          await client.send(
            new PutObjectCommand({
              Bucket: settings.backup.s3.bucket,
              Key: remoteKey,
              Body: fileStream,
              ContentType: 'application/octet-stream'
            })
          )

          uploaded = true
          log.info(`Backup enviado com sucesso para ${settings.backup.s3.bucket}/${remoteKey}`)
        }
      }

      this.emitProgress('done', 'Backup concluído com sucesso!')

      const durationMs = Date.now() - startTime
      const record = this.db.insertBackup({
        ts: startTime,
        file: finalEncryptedFile,
        sizeBytes,
        status: 'ok',
        uploaded,
        remoteKey,
        error: null,
        durationMs
      })

      await this.notifications.notify({
        severity: 'success',
        category: 'backup',
        title: 'Backup Concluído com Sucesso',
        message: `Arquivo ${basename(finalEncryptedFile)} (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB) gerado e protegido.${uploaded ? ' Sincronizado com Cloudflare R2 / S3.' : ''}`,
        extraFacts: {
          Tamanho: `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`,
          Destino: uploaded ? 'Local + Nuvem S3' : 'Apenas Local',
          Duração: `${Math.round(durationMs / 1000)}s`
        }
      })

      return record
    } catch (err) {
      error = (err as Error).message
      log.error('Erro durante rotina de backup', err)
      this.emitProgress('error', `Falha no backup: ${error}`)

      const durationMs = Date.now() - startTime
      const record = this.db.insertBackup({
        ts: startTime,
        file: finalEncryptedFile,
        sizeBytes: 0,
        status: 'failed',
        uploaded: false,
        remoteKey: null,
        error,
        durationMs
      })

      await this.notifications.notify({
        severity: 'critical',
        category: 'backup',
        title: 'Falha no Backup Automático',
        message: `A rotina de backup falhou: ${error}`,
        extraFacts: { Erro: error }
      })

      return record
    }
  }

  public async testS3(config: S3Config & { secretAccessKey: string }): Promise<void> {
    const client = new S3Client({
      region: config.region || 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })

    await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
  }

  private rotateBackups(dir: string, maxFiles: number): void {
    try {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.hsenc'))
        .map((f) => {
          const full = join(dir, f)
          return { full, time: statSync(full).mtimeMs }
        })
        .sort((a, b) => b.time - a.time)

      if (files.length > maxFiles) {
        const toDelete = files.slice(maxFiles)
        for (const file of toDelete) {
          log.info(`Removendo backup antigo por política de retenção: ${file.full}`)
          unlinkSync(file.full)
        }
      }
    } catch (err) {
      log.warn('Erro ao rotacionar backups antigos', err)
    }
  }

  private async encryptFile(inputPath: string, outputPath: string, secret: string): Promise<void> {
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = scryptSync(secret, salt, 32)
    const cipher = createCipheriv('aes-256-gcm', key, iv)

    const inputData = readFileSync(inputPath)
    const encrypted = Buffer.concat([cipher.update(inputData), cipher.final()])
    const tag = cipher.getAuthTag()

    // Formato: [SALT (16 bytes)] [IV (12 bytes)] [TAG (16 bytes)] [CIPHERTEXT]
    const finalBuffer = Buffer.concat([salt, iv, tag, encrypted])
    writeFileSync(outputPath, finalBuffer)
  }

  private emitProgress(phase: BackupProgress['phase'], message: string): void {
    broadcast(IPC.backupOnProgress, { phase, message })
  }
}
