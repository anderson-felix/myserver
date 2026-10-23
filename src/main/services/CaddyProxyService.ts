import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import treeKill from 'tree-kill'
import { createLogger } from '../utils/logger'
import { binaryPath, binaryPresent, workspaceLayout } from '../paths'
import { runPrivileged, psQuote } from '../utils/shell'
import { sleep, RingBuffer, createLineSplitter } from '../utils/common'
import type { ProxyStatus, ProxyRoute, Project } from '@shared/types'
import type { AppDatabase } from '../database'
import type { NotificationService } from './NotificationService'

const log = createLogger('caddy-proxy')

export class CaddyProxyService {
  private child: ChildProcess | null = null
  private running = false
  private logs: RingBuffer<string> = new RingBuffer(500)
  private lastSyncAt: number | null = null
  private lastError: string | null = null
  private cachedAdminReachable: { value: boolean; ts: number } | null = null

  constructor(
    private db: AppDatabase,
    private notifications: NotificationService
  ) {}

  public getLogs(): string[] {
    return this.logs.toArray()
  }

  public async start(): Promise<void> {
    this.cachedAdminReachable = null
    if (!binaryPresent('caddy')) {
      throw new Error('Binário caddy.exe não encontrado em bin/win')
    }

    if (await this.isAdminReachable(true)) {
      log.info('Caddy já está rodando com API REST acessível em 127.0.0.1:2019')
      this.running = true
      await this.syncRoutes()
      return
    }

    log.info('Iniciando caddy.exe como processo filho...')
    const caddyExe = binaryPath('caddy')
    const settings = this.db.getFullSettings()
    const layout = workspaceLayout(settings.workspaceRoot)
    mkdirSync(layout.caddy, { recursive: true })

    // Cria configuração inicial com API admin habilitada na porta 2019
    const initialConfig = {
      admin: {
        listen: '127.0.0.1:2019',
        origins: ['127.0.0.1:2019', 'localhost:2019', '']
      },
      apps: {
        http: {
          http_port: settings.caddyHttpPort || 80,
          servers: {
            srv0: {
              listen: [`:${settings.caddyHttpPort || 80}`],
              routes: []
            }
          }
        }
      }
    }

    const configFile = join(layout.caddy, 'caddy_initial.json')
    writeFileSync(configFile, JSON.stringify(initialConfig, null, 2))

    this.child = spawn(caddyExe, ['run', '--config', configFile], {
      cwd: layout.caddy,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const splitter = createLineSplitter((line) => {
      this.logs.push(line)
      log.debug(`[Caddy] ${line}`)
    })

    this.child.stdout?.on('data', (d) => splitter.write(d))
    this.child.stderr?.on('data', (d) => splitter.write(d))

    this.child.on('exit', (code) => {
      splitter.end()
      this.running = false
      this.child = null
      log.warn(`Processo do Caddy encerrou com código ${code}`)
    })

    // Aguarda até 5 segundos para a API REST responder
    for (let i = 0; i < 10; i++) {
      await sleep(500)
      if (await this.isAdminReachable()) {
        this.running = true
        log.info('Caddy REST API online em http://127.0.0.1:2019')
        await this.syncRoutes()
        return
      }
    }

    throw new Error('Timeout ao aguardar API REST do Caddy em 127.0.0.1:2019')
  }

  public async stop(): Promise<void> {
    this.cachedAdminReachable = null
    if (this.child && this.child.pid) {
      const pid = this.child.pid
      await new Promise<void>((resolve) => {
        treeKill(pid, 'SIGTERM', () => resolve())
      })
      this.child = null
    }
    this.running = false
  }

  public async isAdminReachable(forceFresh = false): Promise<boolean> {
    const now = Date.now()
    if (!forceFresh && this.cachedAdminReachable && now - this.cachedAdminReachable.ts < 10_000) {
      return this.cachedAdminReachable.value
    }
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1_500)
      const res = await fetch('http://127.0.0.1:2019/config/', {
        signal: ctrl.signal,
        headers: {
          Host: '127.0.0.1:2019',
          Origin: 'http://127.0.0.1:2019'
        }
      })
      clearTimeout(t)
      const ok = res.ok || res.status === 200
      this.cachedAdminReachable = { value: ok, ts: now }
      return ok
    } catch {
      this.cachedAdminReachable = { value: false, ts: now }
      return false
    }
  }

  public async getStatus(): Promise<ProxyStatus> {
    const adminOk = await this.isAdminReachable()
    const settings = this.db.getFullSettings()
    const routes = this.buildActiveRoutesList()

    return {
      running: adminOk || this.running,
      adminReachable: adminOk,
      managedBy: this.child ? 'child' : adminOk ? 'service' : 'none',
      serviceInstalled: false,
      httpPort: settings.caddyHttpPort || 80,
      binaryPresent: binaryPresent('caddy'),
      routes,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    }
  }

  public async syncRoutes(): Promise<void> {
    this.cachedAdminReachable = null
    if (!binaryPresent('caddy')) return

    const adminOk = await this.isAdminReachable(true)
    if (!adminOk) {
      try {
        await this.start()
      } catch (err) {
        this.lastError = `Caddy offline: ${(err as Error).message}`
        return
      }
    }

    const settings = this.db.getFullSettings()
    const projects = this.db.listProjects().filter((p) => p.status === 'running')
    const caddyRoutes = this.generateCaddyRoutes(projects)
    const mainPort = settings.caddyHttpPort || 80

    const servers: Record<string, any> = {
      srv0: {
        listen: [`:${mainPort}`],
        routes: caddyRoutes
      }
    }

    // Servidores dedicados por projeto estático: escutam em :porta SEM restrição de Host,
    // aceitando 127.0.0.1, IP da LAN e *.trycloudflare.com (Quick Tunnel) sem 404.
    for (const p of projects) {
      if (p.stack === 'static' && p.port && p.port !== mainPort) {
        servers[`srv_proj_${p.id}`] = {
          listen: [`:${p.port}`],
          routes: this.buildStaticRoutes(p, null),
          automatic_https: { disable: true }
        }
      }
    }

    const caddyConfig = {
      admin: {
        listen: '127.0.0.1:2019',
        origins: ['127.0.0.1:2019', 'localhost:2019', '']
      },
      apps: {
        http: {
          http_port: mainPort,
          servers
        }
      }
    }

    try {
      const res = await fetch('http://127.0.0.1:2019/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: '127.0.0.1:2019',
          Origin: 'http://127.0.0.1:2019'
        },
        body: JSON.stringify(caddyConfig)
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Caddy API erro HTTP ${res.status}: ${text}`)
      }

      this.lastSyncAt = Date.now()
      this.lastError = null
      log.info(`Rotas do Caddy sincronizadas com sucesso (${projects.length} projetos ativos)`)
    } catch (err) {
      this.lastError = (err as Error).message
      log.error('Falha ao sincronizar rotas no Caddy', err)
    }
  }

  private resolveApiProxyDial(target: string, allProjects: Project[]): string | null {
    const trimmed = target.trim()
    if (!trimmed) return null

    // 1. Número puro de porta: "3001"
    if (/^\d+$/.test(trimmed)) {
      return `127.0.0.1:${trimmed}`
    }

    // 2. ID ou Slug de outro projeto
    const matched = allProjects.find(
      (p) => p.id === trimmed || p.slug === trimmed || p.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (matched && matched.port) {
      return `127.0.0.1:${matched.port}`
    }

    // 3. URL completa ou host:port (ex: http://localhost:3001 ou localhost:3001)
    try {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`)
      const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname
      const port = url.port || (url.protocol === 'https:' ? '443' : '80')
      return `${host}:${port}`
    } catch {
      return null
    }
  }

  private securityMiddleware() {
    // Headers de segurança padrão
    return {
      handler: 'headers',
      response: {
        set: {
          'X-Content-Type-Options': ['nosniff'],
          'X-Frame-Options': ['DENY'],
          'Referrer-Policy': ['strict-origin-when-cross-origin'],
          'X-Powered-By': ['HomeServer-Orchestrator']
        }
      }
    }
  }

  private requestBodyLimitMiddleware() {
    // Limite de tamanho do corpo (10MB)
    return {
      handler: 'request_body',
      max_size: 10485760 // 10 MB
    }
  }

  /**
   * Gera as rotas de um projeto estático: proxy /api/* (opcional) + file_server com SPA fallback.
   * `hosts = null` gera rotas sem matcher de Host (usado nos servidores dedicados por porta).
   */
  private buildStaticRoutes(p: Project, hosts: string[] | null, allProjects?: Project[]): any[] {
    const routes: any[] = []
    const all = allProjects ?? this.db.listProjects()
    const rootPath = p.outputDir ? join(p.workdir, p.outputDir) : p.workdir
    const hostMatch = hosts ? { host: hosts } : {}

    // 1. Se houver Backend API vinculado, adiciona proxy de rota /api/* ANTES do fallback estático
    if (p.apiProxyTarget) {
      const apiDial = this.resolveApiProxyDial(p.apiProxyTarget, all)
      if (apiDial) {
        routes.push({
          match: [{ ...hostMatch, path: ['/api/*', '/api'] }],
          handle: [
            this.securityMiddleware(),
            this.requestBodyLimitMiddleware(),
            {
              handler: 'reverse_proxy',
              upstreams: [{ dial: apiDial }]
            }
          ],
          terminal: true
        })
      }
    }

    // 2. Manipulador de arquivos estáticos com suporte nativo a SPA (try_files fallback index.html)
    const subroutes: any[] = [
      {
        handle: [
          {
            handler: 'vars',
            root: rootPath.replace(/\\/g, '/')
          }
        ]
      }
    ]

    if (p.spaFallback !== false) {
      // Fallback para Single Page Application (React Router / Vite / Next estático)
      subroutes.push({
        handle: [
          {
            handler: 'rewrite',
            uri: '{http.matchers.file.relative}'
          }
        ],
        match: [
          {
            file: {
              try_files: ['{http.request.uri.path}', '/index.html']
            }
          }
        ]
      })
    }

    subroutes.push({
      handle: [
        {
          handler: 'file_server',
          hide: ['.git']
        }
      ]
    })

    const mainRoute: any = {
      handle: [
        this.securityMiddleware(),
        this.requestBodyLimitMiddleware(),
        {
          handler: 'subroute',
          routes: subroutes
        }
      ],
      terminal: true
    }
    if (hosts) mainRoute.match = [{ host: hosts }]
    routes.push(mainRoute)

    return routes
  }

  private generateCaddyRoutes(projects: Project[]): any[] {
    const routes: any[] = []
    const allProjects = this.db.listProjects()

    for (const p of projects) {
      const matchHosts = p.domains && p.domains.length > 0 ? p.domains : [`${p.slug}.localhost`, `localhost`]

      if (p.stack === 'static') {
        routes.push(...this.buildStaticRoutes(p, matchHosts, allProjects))
      } else if (p.port) {
        // Proxy reverso HTTP para portas internas (3001..3999)
        routes.push({
          match: [{ host: matchHosts }],
          handle: [
            this.securityMiddleware(),
            this.requestBodyLimitMiddleware(),
            {
              handler: 'reverse_proxy',
              upstreams: [{ dial: `127.0.0.1:${p.port}` }]
            }
          ],
          terminal: true
        })
      }
    }

    return routes
  }

  private buildActiveRoutesList(): ProxyRoute[] {
    const projects = this.db.listProjects().filter((p) => p.status === 'running')
    return projects.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      hosts: p.domains.length > 0 ? p.domains : [`${p.slug}.localhost`],
      upstream:
        p.stack === 'static'
          ? `static:${p.outputDir || 'root'}${p.port ? ` @ :${p.port}` : ''}${p.apiProxyTarget ? ` (Proxy /api/* -> ${p.apiProxyTarget})` : ''}`
          : `127.0.0.1:${p.port}`,
      kind: p.stack === 'static' ? 'file_server' : 'reverse_proxy'
    }))
  }

  public async installService(): Promise<void> {
    if (!binaryPresent('nssm') || !binaryPresent('caddy')) {
      throw new Error('nssm.exe ou caddy.exe indisponíveis')
    }

    const nssm = binaryPath('nssm')
    const caddy = binaryPath('caddy')
    const settings = this.db.getFullSettings()
    const layout = workspaceLayout(settings.workspaceRoot)
    const svcName = 'HomeServer_Caddy'

    const script = `
      $nssm = ${psQuote(nssm)}
      $caddy = ${psQuote(caddy)}
      $svc = ${psQuote(svcName)}
      $workdir = ${psQuote(layout.caddy)}
      $cfg = Join-Path $workdir "caddy_initial.json"

      & $nssm stop $svc 2>&1 | Out-Null
      & $nssm install $svc $caddy run --config $cfg
      & $nssm set $svc AppDirectory $workdir
      & $nssm set $svc DisplayName "HomeServer Caddy Reverse Proxy"
      & $nssm set $svc Description "Proxy Reverso dinâmico com API REST na porta 2019"
      & $nssm set $svc Start SERVICE_AUTO_START
      & $nssm start $svc
    `

    const res = await runPrivileged(script)
    if (res.exitCode !== 0) throw new Error(`Falha ao instalar serviço Caddy: ${res.error}`)
    log.info('Serviço Windows do Caddy instalado com sucesso.')
    await this.notifications.notify({
      severity: 'success',
      category: 'system',
      title: 'Serviço Caddy Instalado',
      message: 'O Proxy Reverso Caddy foi configurado como serviço do Windows via NSSM.'
    })
  }
}
