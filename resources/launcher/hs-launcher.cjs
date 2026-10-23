#!/usr/bin/env node
/**
 * hs-launcher.cjs
 * ---------------------------------------------------------------------------
 * Wrapper de execução isolado para projetos gerenciados pelo HomeServer Orchestrator.
 * Pode ser executado pelo NSSM sob a conta restrita `.\AppServerRunner`.
 *
 * Argumentos suportados:
 *   --workdir <caminho>      Diretório de trabalho do projeto
 *   --env-file <caminho>     Arquivo de variáveis (.env ou JSON decifrado)
 *   --port <porta>           Porta injetada (define PORT=<porta>)
 *   --exec <comando...>      Comando a ser executado
 * ---------------------------------------------------------------------------
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
let workdir = process.cwd()
let envFile = null
let port = null
let execArgs = []

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--workdir' && i + 1 < args.length) {
    workdir = path.resolve(args[++i])
  } else if (arg === '--env-file' && i + 1 < args.length) {
    envFile = path.resolve(args[++i])
  } else if (arg === '--port' && i + 1 < args.length) {
    port = args[++i]
  } else if (arg === '--exec') {
    execArgs = args.slice(i + 1)
    break
  }
}

if (execArgs.length === 0) {
  console.error('[HS-Launcher] Erro: Nenhum comando especificado com --exec')
  process.exit(1)
}

const customEnv = { ...process.env }

if (port) {
  customEnv.PORT = String(port)
}

if (envFile && fs.existsSync(envFile)) {
  try {
    const raw = fs.readFileSync(envFile, 'utf8')
    if (raw.trim().startsWith('{')) {
      const parsed = JSON.parse(raw)
      Object.assign(customEnv, parsed)
    } else {
      const lines = raw.split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim()
          let val = trimmed.slice(eqIdx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          customEnv[key] = val
        }
      }
    }
  } catch (err) {
    console.warn('[HS-Launcher] Aviso ao carregar env-file:', err.message)
  }
}

const [cmd, ...cmdArgs] = execArgs
console.log(`[HS-Launcher] Iniciando processo em ${workdir}: ${cmd} ${cmdArgs.join(' ')}`)

const child = spawn(cmd, cmdArgs, {
  cwd: workdir,
  env: customEnv,
  stdio: 'inherit',
  shell: true
})

function shutdown(signal) {
  console.log(`[HS-Launcher] Recebido sinal ${signal}, encerrando filho...`)
  child.kill(signal)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

child.on('error', (err) => {
  console.error('[HS-Launcher] Erro ao disparar processo:', err.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  console.log(`[HS-Launcher] Processo finalizado com código ${code ?? 0} (sinal: ${signal ?? 'none'})`)
  process.exit(code ?? 0)
})
