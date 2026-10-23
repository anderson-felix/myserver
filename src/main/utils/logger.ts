import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

export type LogHook = (level: Level, scope: string, msg: string, extra?: unknown) => void
let logHook: LogHook | null = null

export function setLogHook(hook: LogHook | null): void {
  logHook = hook
}

let logFile: string | null = null
const MAX_BYTES = 5 * 1024 * 1024

export function initLogger(dir: string): void {
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'main.log')
}

function rotate(): void {
  if (!logFile || !existsSync(logFile)) return
  try {
    if (statSync(logFile).size > MAX_BYTES) renameSync(logFile, `${logFile}.1`)
  } catch {
    /* ignora */
  }
}

function write(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (logHook) {
    try {
      logHook(level, scope, msg, extra)
    } catch {
      /* ignore hook errors */
    }
  }
  const ts = new Date().toISOString()
  const suffix = extra instanceof Error ? ` ${extra.stack ?? extra.message}` : extra !== undefined ? ` ${safeJson(extra)}` : ''
  const line = `[${ts}] ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${suffix}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  if (logFile) {
    try {
      rotate()
      appendFileSync(logFile, line + '\n')
    } catch {
      /* ignora */
    }
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => write('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => write('error', scope, msg, extra)
  }
}

export type Logger = ReturnType<typeof createLogger>
