#!/usr/bin/env node
/**
 * fetch-binaries.mjs
 * ---------------------------------------------------------------------------
 * Baixa as versões oficiais dos binários portáteis embutidos no instalador
 * (extraResources → resources/bin):
 *
 *   bin/win/caddy.exe         Proxy reverso com API REST (127.0.0.1:2019)
 *   bin/win/cloudflared.exe   Cliente oficial Cloudflare Tunnel
 *   bin/win/nssm.exe          Non-Sucking Service Manager
 *   bin/win/node/node.exe     Runtime Node.js LTS isolado (+ npm/npx)
 *
 * Uso:  npm run fetch-binaries            (pula binários já presentes)
 *       npm run fetch-binaries -- --force (rebaixa tudo)
 *       npm run fetch-binaries -- caddy node
 * ---------------------------------------------------------------------------
 */
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm, readdir, rename, copyFile, writeFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'win')
const CACHE = join(ROOT, '.cache', 'downloads')
const ARCH = process.arch === 'arm64' ? 'arm64' : 'amd64'
const NODE_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const ONLY = args.filter((a) => !a.startsWith('--'))

const UA = { 'User-Agent': 'homeserver-orchestrator-fetch-binaries' }

function log(icon, msg) {
  process.stdout.write(`${icon}  ${msg}\n`)
}

async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true })
  const res = await fetch(url, { headers: UA, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ao baixar ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  let lastPct = -1
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    received += chunk.length
    if (total) {
      const pct = Math.floor((received / total) * 100)
      if (pct !== lastPct && pct % 10 === 0) {
        lastPct = pct
        process.stdout.write(`     ${pct}% (${(received / 1048576).toFixed(1)} MB)\r`)
      }
    }
  })
  await pipeline(body, createWriteStream(dest))
  process.stdout.write(' '.repeat(40) + '\r')
  return dest
}

/** Extrai .zip com o bsdtar nativo do Windows 10+ (sem dependências npm). */
function unzip(zipFile, outDir) {
  execFileSync('tar', ['-xf', zipFile, '-C', outDir], { stdio: 'inherit' })
}

async function githubLatest(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { ...UA, Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub API ${repo}: HTTP ${res.status}`)
  return res.json()
}

async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findFile(full, name)
      if (found) return found
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full
    }
  }
  return null
}

// ---------------------------------------------------------------------------
const tasks = {
  async caddy() {
    const dest = join(BIN, 'caddy.exe')
    if (existsSync(dest) && !FORCE) return log('✔', 'caddy.exe já presente')
    const rel = await githubLatest('caddyserver/caddy')
    const asset = rel.assets.find((a) => new RegExp(`_windows_${ARCH}\\.zip$`).test(a.name))
    if (!asset) throw new Error('Asset Windows do Caddy não encontrado')
    log('↓', `Caddy ${rel.tag_name} (${asset.name})`)
    const zip = await download(asset.browser_download_url, join(CACHE, asset.name))
    const tmp = join(CACHE, 'caddy-extract')
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    unzip(zip, tmp)
    await copyFile(join(tmp, 'caddy.exe'), dest)
    log('✔', `caddy.exe ${rel.tag_name}`)
  },

  async cloudflared() {
    const dest = join(BIN, 'cloudflared.exe')
    if (existsSync(dest) && !FORCE) return log('✔', 'cloudflared.exe já presente')
    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${ARCH}.exe`
    log('↓', `cloudflared (${url})`)
    await download(url, dest)
    log('✔', 'cloudflared.exe')
  },

  async nssm() {
    const dest = join(BIN, 'nssm.exe')
    if (existsSync(dest) && !FORCE) return log('✔', 'nssm.exe já presente')
    // 2.24-101 corrige o bug de serviços no Windows 10 Creators Update+.
    // nssm.cc fica fora do ar com frequência → espelhos do Internet Archive como fallback.
    const candidates = [
      'https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip',
      'https://web.archive.org/web/2024id_/https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip',
      'https://nssm.cc/release/nssm-2.24.zip',
      'https://web.archive.org/web/2024id_/https://nssm.cc/release/nssm-2.24.zip'
    ]
    const subdir = process.arch === 'arm64' || process.arch === 'x64' ? 'win64' : 'win32'
    let lastErr
    for (const url of candidates) {
      try {
        log('↓', `NSSM (${url})`)
        const zip = await download(url, join(CACHE, 'nssm.zip'))
        if ((await stat(zip)).size < 100_000) throw new Error('arquivo inválido')
        const tmp = join(CACHE, 'nssm-extract')
        await rm(tmp, { recursive: true, force: true })
        await mkdir(tmp, { recursive: true })
        unzip(zip, tmp)
        const root = (await readdir(tmp))[0]
        await copyFile(join(tmp, root, subdir, 'nssm.exe'), dest)
        return log('✔', `nssm.exe (${root})`)
      } catch (err) {
        lastErr = err
        log('⚠', `falhou: ${err.message}`)
      }
    }
    throw lastErr
  },

  async node() {
    const nodeDir = join(BIN, 'node')
    if (existsSync(join(nodeDir, 'node.exe')) && !FORCE) return log('✔', 'node/node.exe já presente')
    const res = await fetch('https://nodejs.org/dist/index.json', { headers: UA })
    const releases = await res.json()
    const lts = releases.find((r) => r.lts && r.files.includes(`win-${NODE_ARCH}-zip`))
    if (!lts) throw new Error('Nenhuma versão LTS encontrada')
    const name = `node-${lts.version}-win-${NODE_ARCH}`
    log('↓', `Node.js ${lts.version} LTS "${lts.lts}"`)
    const zip = await download(`https://nodejs.org/dist/${lts.version}/${name}.zip`, join(CACHE, `${name}.zip`))
    const tmp = join(CACHE, 'node-extract')
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    unzip(zip, tmp)
    await rm(nodeDir, { recursive: true, force: true })
    await rename(join(tmp, name), nodeDir)
    await writeFile(join(nodeDir, 'HOMESERVER_VERSION'), lts.version)
    const nodeExe = await findFile(nodeDir, 'node.exe')
    log('✔', `node ${lts.version} → ${nodeExe}`)
  }
}

async function main() {
  if (process.platform !== 'win32') {
    log('⚠', 'Este script baixa binários Windows; rode-o em uma máquina Windows 10+ (requer bsdtar nativo).')
  }
  await mkdir(BIN, { recursive: true })
  await mkdir(CACHE, { recursive: true })
  const names = ONLY.length ? ONLY : Object.keys(tasks)
  let failed = 0
  for (const name of names) {
    if (!tasks[name]) {
      log('✖', `binário desconhecido: ${name}`)
      failed++
      continue
    }
    try {
      await tasks[name]()
    } catch (err) {
      failed++
      log('✖', `${name}: ${err.message}`)
    }
  }
  log(failed ? '⚠' : '🎉', failed ? `${failed} binário(s) falharam` : `Binários prontos em ${BIN}`)
  process.exit(failed ? 1 : 0)
}

main()
