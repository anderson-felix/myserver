#!/usr/bin/env node
/**
 * decrypt-backup.mjs
 * ---------------------------------------------------------------------------
 * Script CLI de recuperação de desastres (Zero-Dependency em Node.js).
 * Descriptografa arquivos .hsenc gerados pelo HomeServer Orchestrator.
 *
 * Uso:
 *   node scripts/decrypt-backup.mjs <arquivo.hsenc> [senha]
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createDecipheriv, scryptSync } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

const args = process.argv.slice(2)
if (args.length < 1) {
  console.log('Uso: node scripts/decrypt-backup.mjs <arquivo.hsenc> [senha]')
  process.exit(1)
}

const file = args[0]
const pass = args[1] || 'HomeServer-Default-Key-2026'

console.log(`Lendo arquivo criptografado: ${file}`)
const buffer = readFileSync(file)

if (buffer.length < 44) {
  console.error('Arquivo corrompido ou muito curto')
  process.exit(1)
}

const salt = buffer.subarray(0, 16)
const iv = buffer.subarray(16, 28)
const tag = buffer.subarray(28, 44)
const ciphertext = buffer.subarray(44)

try {
  const key = scryptSync(pass, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const outPath = join(dirname(file), basename(file).replace(/\.hsenc$/, '') + '.tar.gz')
  writeFileSync(outPath, decrypted)

  console.log(`✔ Sucesso! Arquivo descompactável gerado em: ${outPath}`)
  console.log(`Para extrair: tar -xzf "${outPath}"`)
} catch (err) {
  console.error('✖ Falha ao descriptografar:', err.message)
  console.error('Verifique se a senha informada está correta.')
  process.exit(1)
}
