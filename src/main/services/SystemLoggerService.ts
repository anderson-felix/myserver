import { RingBuffer, broadcast } from '../utils/common'
import { IPC, type SystemLogEntry, type SystemLogModule } from '@shared/types'
import type { AppDatabase } from '../database'

export class SystemLoggerService {
  private buffer: RingBuffer<SystemLogEntry>
  private static instance: SystemLoggerService | null = null

  constructor(private db?: AppDatabase) {
    this.buffer = new RingBuffer<SystemLogEntry>(2000)
    SystemLoggerService.instance = this

    // Carrega os logs mais recentes do SQLite se o DB estiver presente
    if (this.db) {
      const recent = this.db.listSystemLogs(2000)
      for (const entry of recent) {
        this.buffer.push(entry)
      }
    }
  }

  public static getInstance(): SystemLoggerService | null {
    return SystemLoggerService.instance
  }

  public setDb(db: AppDatabase): void {
    this.db = db
    if (this.buffer.size === 0) {
      const recent = this.db.listSystemLogs(2000)
      for (const entry of recent) {
        this.buffer.push(entry)
      }
    }
  }

  public log(
    module: SystemLogModule | string,
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    meta?: Record<string, unknown>
  ): SystemLogEntry {
    const entry: SystemLogEntry = {
      ts: Date.now(),
      module,
      level,
      message,
      meta
    }

    // 1. Armazena no buffer circular em memória (2000 linhas)
    this.buffer.push(entry)

    // 2. Persiste no SQLite
    if (this.db) {
      this.db.insertSystemLog(entry)
    }

    // 3. Emite em tempo real via IPC para o Renderer
    broadcast(IPC.systemOnLog, entry)

    return entry
  }

  public getLogs(filter?: { module?: string; level?: string; limit?: number }): SystemLogEntry[] {
    let logs = this.buffer.toArray()
    if (filter?.module && filter.module !== 'all') {
      logs = logs.filter((l) => l.module.toLowerCase() === filter.module!.toLowerCase())
    }
    if (filter?.level && filter.level !== 'all') {
      logs = logs.filter((l) => l.level.toLowerCase() === filter.level!.toLowerCase())
    }
    if (filter?.limit && filter.limit > 0) {
      logs = logs.slice(-filter.limit)
    }
    return logs
  }

  public clear(): void {
    this.buffer.clear()
    if (this.db) {
      this.db.clearSystemLogs()
    }
  }

  public exportAsText(): string {
    return this.buffer
      .toArray()
      .map((entry) => {
        const time = new Date(entry.ts).toISOString()
        const metaStr = entry.meta ? ` | meta: ${JSON.stringify(entry.meta)}` : ''
        return `[${time}] [${entry.level.toUpperCase().padEnd(5)}] [${entry.module.toUpperCase()}] ${entry.message}${metaStr}`
      })
      .join('\n')
  }
}
