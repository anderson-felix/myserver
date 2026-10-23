import fs from 'node:fs'
import path from 'node:path'
import type { FolderInspection } from '@shared/types'

export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = content.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    let val = line.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) {
      result[key] = val
    }
  }
  return result
}

export async function inspectProjectFolder(folderPath: string): Promise<FolderInspection> {
  const baseName = path.basename(folderPath).replace(/[^a-zA-Z0-9_-]/g, '-') || 'meu-projeto'
  let inspection: FolderInspection = {
    name: baseName,
    stack: 'node',
    buildCommand: 'npm install',
    startCommand: 'npm start',
    outputDir: undefined,
    spaFallback: false,
    framework: 'generic',
    envKeys: [],
    envMap: {}
  }

  // 1. Inspeciona .env
  const envCandidates = ['.env', '.env.local', '.env.development', '.env.example']
  for (const envFile of envCandidates) {
    const fullEnvPath = path.join(folderPath, envFile)
    if (fs.existsSync(fullEnvPath)) {
      try {
        const envRaw = fs.readFileSync(fullEnvPath, 'utf-8')
        const parsed = parseEnvContent(envRaw)
        inspection.envMap = parsed
        inspection.envKeys = Object.keys(parsed)
        break
      } catch {
        /* ignore */
      }
    }
  }

  // 2. Inspeciona package.json
  const pkgPath = path.join(folderPath, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      if (pkg.name && typeof pkg.name === 'string') {
        inspection.name = pkg.name.replace(/[^a-zA-Z0-9_-]/g, '-')
      }

      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {})
      }

      const hasVite = 'vite' in allDeps
      const hasNext = 'next' in allDeps
      const hasReact = 'react' in allDeps
      const hasExpress = 'express' in allDeps || 'fastify' in allDeps || 'koa' in allDeps || '@nestjs/core' in allDeps

      if (hasVite) {
        inspection.stack = 'static'
        inspection.framework = 'vite'
        inspection.buildCommand = pkg.scripts?.build ? 'npm install && npm run build' : 'npm install && npx vite build'
        inspection.startCommand = ''
        inspection.outputDir = 'dist'
        inspection.spaFallback = true
      } else if (hasNext) {
        inspection.stack = 'node'
        inspection.framework = 'next'
        inspection.buildCommand = pkg.scripts?.build ? 'npm install && npm run build' : 'npm install && npx next build'
        inspection.startCommand = pkg.scripts?.start ? 'npm start' : 'npx next start'
      } else if (hasReact && !hasExpress) {
        // CRA ou outro bundler React estático
        inspection.stack = 'static'
        inspection.framework = 'react'
        inspection.buildCommand = pkg.scripts?.build ? 'npm install && npm run build' : 'npm install && npm run build'
        inspection.startCommand = ''
        inspection.outputDir = fs.existsSync(path.join(folderPath, 'dist')) ? 'dist' : 'build'
        inspection.spaFallback = true
      } else if (hasExpress) {
        inspection.stack = 'node'
        inspection.framework = 'express'
        inspection.buildCommand = pkg.scripts?.build ? 'npm install && npm run build' : 'npm install'
        inspection.startCommand = pkg.scripts?.start ? 'npm start' : (pkg.main ? `node ${pkg.main}` : 'node index.js')
      } else {
        inspection.stack = 'node'
        inspection.buildCommand = pkg.scripts?.build ? 'npm install && npm run build' : 'npm install'
        inspection.startCommand = pkg.scripts?.start ? 'npm start' : (pkg.main ? `node ${pkg.main}` : 'node index.js')
      }

      return inspection
    } catch {
      /* ignore JSON parse error */
    }
  }

  // 3. Inspeciona Python
  const hasRequirements = fs.existsSync(path.join(folderPath, 'requirements.txt'))
  const hasPyMain = fs.existsSync(path.join(folderPath, 'main.py')) || fs.existsSync(path.join(folderPath, 'app.py'))
  if (hasRequirements || hasPyMain) {
    inspection.stack = 'python'
    inspection.framework = 'fastapi'
    inspection.buildCommand = hasRequirements ? 'pip install -r requirements.txt' : ''
    inspection.startCommand = fs.existsSync(path.join(folderPath, 'main.py'))
      ? 'python -m uvicorn main:app --port 3001'
      : 'python app.py'
    return inspection
  }

  // 4. Inspeciona HTML estático puro
  if (fs.existsSync(path.join(folderPath, 'index.html'))) {
    inspection.stack = 'static'
    inspection.framework = 'html'
    inspection.buildCommand = ''
    inspection.startCommand = ''
    inspection.outputDir = '.'
    inspection.spaFallback = true
    return inspection
  }

  return inspection
}
