import { safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from './logger'

const log = createLogger('crypto')
let masterKey: Buffer | null = null

interface KeyFile {
  v: 1
  protected: boolean
  data: string
}

/**
 * Inicializa a chave-mestra AES-256 do app.
 * A chave é aleatória (32 bytes) e fica protegida pelo DPAPI do Windows via
 * `safeStorage` — só pode ser lida pela mesma conta de usuário nesta máquina.
 */
export function initCrypto(keyFile: string): void {
  mkdirSync(dirname(keyFile), { recursive: true })
  const canProtect = safeStorage.isEncryptionAvailable()

  if (existsSync(keyFile)) {
    const parsed = JSON.parse(readFileSync(keyFile, 'utf8')) as KeyFile
    const hex = parsed.protected
      ? safeStorage.decryptString(Buffer.from(parsed.data, 'base64'))
      : Buffer.from(parsed.data, 'base64').toString('utf8')
    masterKey = Buffer.from(hex, 'hex')
    if (!parsed.protected && canProtect) persist(keyFile, hex, true)
    return
  }

  const hex = randomBytes(32).toString('hex')
  persist(keyFile, hex, canProtect)
  masterKey = Buffer.from(hex, 'hex')
  if (!canProtect) log.warn('safeStorage indisponível: chave-mestra salva sem proteção DPAPI')
}

function persist(keyFile: string, hex: string, protect: boolean): void {
  const data = protect ? safeStorage.encryptString(hex).toString('base64') : Buffer.from(hex, 'utf8').toString('base64')
  const content: KeyFile = { v: 1, protected: protect, data }
  writeFileSync(keyFile, JSON.stringify(content), { mode: 0o600 })
}

function key(): Buffer {
  if (!masterKey) throw new Error('Crypto não inicializado')
  return masterKey
}

/** AES-256-GCM → `gcm1:<iv>:<tag>:<ciphertext>` (base64). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `gcm1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export function decrypt(payload: string): string {
  const [ver, ivB64, tagB64, ctB64] = payload.split(':')
  if (ver !== 'gcm1') throw new Error('Formato criptografado desconhecido')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value))
}

export function decryptJson<T>(payload: string | null | undefined, fallback: T): T {
  if (!payload) return fallback
  try {
    return JSON.parse(decrypt(payload)) as T
  } catch (err) {
    log.error('Falha ao descriptografar payload', err)
    return fallback
  }
}

/** Senha forte para a conta restrita (garante maiúscula, minúscula, dígito e símbolo). */
export function generateStrongPassword(length = 28): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#%+-=@_~']
  const all = sets.join('')
  const bytes = randomBytes(length * 2)
  const chars: string[] = sets.map((s, i) => s[bytes[i] % s.length])
  for (let i = chars.length; i < length; i++) chars.push(all[bytes[i] % all.length])
  // Fisher-Yates com bytes aleatórios
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[length + i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
