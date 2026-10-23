import { app } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { BinaryName } from '@shared/types'

/** Raiz do app: em dev é a raiz do repositório; empacotado é o app.asar. */
export function appRoot(): string {
  return app.getAppPath()
}

/** Diretório dos binários portáteis (extraResources → resources/bin). */
export function binDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bin') : join(appRoot(), 'bin', 'win')
}

export function nodeDir(): string {
  return join(binDir(), 'node')
}

export function binaryPath(name: BinaryName): string {
  switch (name) {
    case 'node':
      return join(nodeDir(), 'node.exe')
    case 'caddy':
      return join(binDir(), 'caddy.exe')
    case 'cloudflared':
      return join(binDir(), 'cloudflared.exe')
    case 'nssm':
      return join(binDir(), 'nssm.exe')
  }
}

export function binaryPresent(name: BinaryName): boolean {
  return existsSync(binaryPath(name))
}

export function launcherPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'launcher', 'hs-launcher.cjs')
    : join(appRoot(), 'resources', 'launcher', 'hs-launcher.cjs')
}

export function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(appRoot(), 'resources', 'icon.png')
}

/** Layout do diretório de workspaces (padrão C:\HomeServerApps). */
export interface WorkspaceLayout {
  root: string
  apps: string
  runtime: string
  runtimeNode: string
  runtimeEnv: string
  caddy: string
  logs: string
}

export function workspaceLayout(root: string): WorkspaceLayout {
  const runtime = join(root, '.runtime')
  return {
    root,
    apps: join(root, 'apps'),
    runtime,
    runtimeNode: join(runtime, 'node'),
    runtimeEnv: join(runtime, 'env'),
    caddy: join(runtime, 'caddy'),
    logs: join(root, 'logs')
  }
}
