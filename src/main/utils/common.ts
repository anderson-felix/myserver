import { BrowserWindow } from 'electron'

/** Buffer circular de tamanho fixo (ex.: últimas 1.000 linhas de log). */
export class RingBuffer<T> {
  private items: T[] = []
  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity)
  }

  toArray(): T[] {
    return [...this.items]
  }

  clear(): void {
    this.items = []
  }

  get size(): number {
    return this.items.length
  }
}

/** Envia um evento para todas as janelas do Renderer. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * Agrupa eventos de alta frequência (logs) em lotes a cada `intervalMs`
 * para não saturar o IPC em hardware modesto.
 */
export class BatchedBroadcaster<T> {
  private queue: T[] = []
  private timer: NodeJS.Timeout | null = null
  constructor(
    private readonly channel: string,
    private readonly intervalMs = 80
  ) {}

  push(item: T): void {
    this.queue.push(item)
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.intervalMs)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.queue.length === 0) return
    const batch = this.queue
    this.queue = []
    broadcast(this.channel, batch)
  }
}

/** Divide um stream de chunks em linhas completas. */
export function createLineSplitter(onLine: (line: string) => void): { write: (chunk: Buffer | string) => void; end: () => void } {
  let pending = ''
  return {
    write(chunk) {
      pending += chunk.toString()
      const parts = pending.split(/\r?\n/)
      pending = parts.pop() ?? ''
      for (const p of parts) onLine(p)
      if (pending.length > 16_384) {
        onLine(pending)
        pending = ''
      }
    },
    end() {
      if (pending) onLine(pending)
      pending = ''
    }
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'app'
  )
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return ''
  if (value.length <= 16) return '••••••••'
  return `${value.slice(0, 24)}••••••${value.slice(-4)}`
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}
