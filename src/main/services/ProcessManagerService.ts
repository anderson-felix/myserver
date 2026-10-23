import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import treeKill from 'tree-kill'
import getPort, { portNumbers } from 'get-port'
import { createLogger } from '../utils/logger'
import { RingBuffer, BatchedBroadcaster, createLineSplitter, slugify, broadcast } from '../utils/common'
import { binaryPath, binaryPresent, launcherPath, workspaceLayout, nodeDir } from '../paths'
import { runPrivileged, psQuote } from '../utils/shell'
import { IPC, type Project, type ProjectInput, type LogEvent, type ProjectStatus } from '@shared/types'
import type { AppDatabase } from '../database'
import type { NotificationService } from './NotificationService'
import type { CaddyProxyService } from './CaddyProxyService'

const log = createLogger('process-manager')

interface RunningChild {
  process: ChildProcess
  pid: number
  startedAt: number
}

export class ProcessManagerService {
  private logBuffers: Map<string, RingBuffer<LogEvent>> = new Map()
  private runningChildren: Map<string, RunningChild> = new Map()
  private logBroadcaster: BatchedBroadcaster<LogEvent>
  private caddyProxy: CaddyProxyService | null = null

  constructor(
    private db: AppDatabase,
    private notifications: NotificationService
  ) {
    this.logBroadcaster = new BatchedBroadcaster<LogEvent>(IPC.projectsOnLog, 60)
  }

  public setCaddyProxy(caddy: CaddyProxyService): void {
    this.caddyProxy = caddy
  }

  public getLogBuffer(projectId: string): RingBuffer<LogEvent> {
    let buf = this.logBuffers.get(projectId)
    if (!buf) {
      buf = new RingBuffer<LogEvent>(1000)
      this.logBuffers.set(projectId, buf)
    }
    return buf
  }

  public appendLog(projectId: string, stream: LogEvent['stream'], line: string): void {
    const event: LogEvent = { projectId, stream, line, ts: Date.now() }
    this.getLogBuffer(projectId).push(event)
    this.logBroadcaster.push(event)
  }

  public getLogs(projectId: string): LogEvent[] {
    return this.getLogBuffer(projectId).toArray()
  }

  public async autoStartProjects(): Promise<void> {
    const projects = this.db.listProjects()
    for (const p of projects) {
      if (p.autoStart) {
        log.info(`Auto-iniciando projeto: ${p.name}`)
        this.start(p.id).catch((err) => log.error(`Falha ao auto-iniciar ${p.name}`, err))
      }
    }
  }

  public async create(input: ProjectInput): Promise<Project> {
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const slug = slugify(input.name)
    const settings = this.db.getFullSettings()
    const layout = workspaceLayout(settings.workspaceRoot)
    const workdir = input.sourceType === 'local' && existsSync(input.source)
      ? input.source
      : join(layout.apps, slug)

    mkdirSync(workdir, { recursive: true })

    const project: Project = {
      ...input,
      id,
      slug,
      port: null,
      status: 'idle',
      statusMessage: 'Criado com sucesso',
      pid: null,
      memoryMB: null,
      restarts: 0,
      workdir,
      envKeys: Object.keys(input.env || {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastDeployAt: null,
      startedAt: null
    }

    this.db.insertProject(project, input.env || {})
    this.appendLog(id, 'system', `Projeto '${input.name}' registrado. Diretório: ${workdir}`)

    if (input.sourceType === 'git') {
      this.deployGit(id).catch((err) => log.error(`Erro ao clonar Git de ${input.name}`, err))
    }

    return project
  }

  public async update(id: string, partial: Partial<ProjectInput>): Promise<Project> {
    this.db.updateProject(id, partial)
    const updated = this.db.getProject(id)
    if (!updated) throw new Error('Projeto não encontrado')

    // Se houve mudança de domínios ou portas, sincroniza proxy
    if (this.caddyProxy && (partial.domains !== undefined || partial.outputDir !== undefined)) {
      this.caddyProxy.syncRoutes().catch(() => undefined)
    }

    return updated
  }

  public async delete(id: string): Promise<void> {
    await this.stop(id)
    this.db.deleteProject(id)
    this.logBuffers.delete(id)
    if (this.caddyProxy) {
      await this.caddyProxy.syncRoutes().catch(() => undefined)
    }
  }

  public async start(id: string): Promise<Project> {
    const project = this.db.getProject(id)
    if (!project) throw new Error('Projeto não encontrado')

    if (project.status === 'running') return project

    this.setStatus(id, 'starting', 'Alocando porta e iniciando processo...')
    this.appendLog(id, 'system', `=== Iniciando aplicação [${project.name}] ===`)

    try {
      // 1. Aloca porta livre se não tiver ou se for static
      let port = project.port
      if (project.stack !== 'static') {
        if (!port || !(await this.isPortAvailable(port))) {
          port = await getPort({ port: portNumbers(3001, 3999) })
          this.db.updateProject(id, { port })
          this.appendLog(id, 'system', `Porta interna alocada: ${port}`)
        }
      }

      // 2. Se for stack estática (HTML/SPA)
      if (project.stack === 'static') {
        if (project.buildCommand && project.buildCommand.trim()) {
          const outPath = project.outputDir ? join(project.workdir, project.outputDir) : project.workdir
          if (!existsSync(outPath) || project.lastDeployAt === null) {
            this.appendLog(id, 'system', `Executando build estático inicial (${project.buildCommand})...`)
            await this.runBuild(id, project.buildCommand, project.workdir)
            this.db.updateProject(id, { lastDeployAt: Date.now() })
          }
        }
        this.setStatus(id, 'running', 'Servindo arquivos estáticos via Caddy Proxy')
        this.appendLog(id, 'system', 'Aplicação estática pronta. Gerenciada diretamente pelo Caddy Proxy.')
        if (this.caddyProxy) await this.caddyProxy.syncRoutes()
        return this.db.getProject(id)!
      }

      // 3. Execução como Serviço Windows (NSSM) ou Subprocesso
      if (project.runtime === 'service' && binaryPresent('nssm')) {
        await this.startAsWindowsService(project, port!)
      } else {
        await this.startAsChildProcess(project, port!)
      }

      // Sincroniza rotas no proxy Caddy
      if (this.caddyProxy) {
        await this.caddyProxy.syncRoutes().catch((err) => log.warn('Erro ao sincronizar rotas Caddy pós-start', err))
      }

      return this.db.getProject(id)!
    } catch (err) {
      const msg = (err as Error).message
      this.setStatus(id, 'error', `Falha ao iniciar: ${msg}`)
      this.appendLog(id, 'stderr', `ERRO: ${msg}`)
      throw err
    }
  }

  public async stop(id: string): Promise<Project> {
    const project = this.db.getProject(id)
    if (!project) throw new Error('Projeto não encontrado')

    this.setStatus(id, 'stopping', 'Encerrando processo...')
    this.appendLog(id, 'system', `=== Parando aplicação [${project.name}] ===`)

    try {
      if (project.runtime === 'service' && binaryPresent('nssm')) {
        await this.stopWindowsService(project)
      } else {
        await this.stopChildProcess(id)
      }

      this.setStatus(id, 'stopped', 'Parado manualmente')
      this.db.updateProject(id, { pid: null, memoryMB: null })
      this.appendLog(id, 'system', 'Aplicação encerrada.')

      if (this.caddyProxy) {
        await this.caddyProxy.syncRoutes().catch(() => undefined)
      }

      return this.db.getProject(id)!
    } catch (err) {
      const msg = (err as Error).message
      this.setStatus(id, 'error', `Falha ao parar: ${msg}`)
      throw err
    }
  }

  public async restart(id: string, reason?: string): Promise<Project> {
    this.appendLog(id, 'system', `Reiniciando aplicação... ${reason ? `Motivo: ${reason}` : ''}`)
    const p = this.db.getProject(id)
    if (p) this.db.updateProject(id, { restarts: p.restarts + 1 })
    await this.stop(id).catch(() => undefined)
    return this.start(id)
  }

  public async redeploy(id: string): Promise<Project> {
    const project = this.db.getProject(id)
    if (!project) throw new Error('Projeto não encontrado')

    this.setStatus(id, 'deploying', 'Atualizando código-fonte e executando build...')
    this.appendLog(id, 'system', '=== Iniciando Redeploy ===')

    try {
      // 1. Atualiza Git se aplicável
      if (project.sourceType === 'git') {
        await this.deployGit(id)
      }

      // 2. Executa Build Command se existir
      if (project.buildCommand.trim()) {
        await this.runBuild(id, project.buildCommand, project.workdir)
      }

      // 3. Reinicia processo
      await this.restart(id, 'Redeploy concluído')
      this.db.updateProject(id, { lastDeployAt: Date.now() })
      return this.db.getProject(id)!
    } catch (err) {
      const msg = (err as Error).message
      this.setStatus(id, 'error', `Falha no redeploy: ${msg}`)
      this.appendLog(id, 'stderr', `ERRO NO REDEPLOY: ${msg}`)
      throw err
    }
  }

  public async stopAll(timeoutMs = 8_000): Promise<void> {
    log.info('Parando todos os projetos gerenciados...')
    const running = this.db.listProjects().filter((p) => p.status === 'running')
    await Promise.all(
      running.map((p) =>
        this.stop(p.id).catch((err) => log.error(`Erro ao parar ${p.name} no stopAll`, err))
      )
    )
  }

  // -------------------------------------------------------------------------
  // Internos de Execução
  // -------------------------------------------------------------------------

  private injectNodeToEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env = { ...baseEnv }
    const nodeDirectory = nodeDir()
    if (existsSync(nodeDirectory)) {
      const origPath = env.PATH || env.Path || process.env.PATH || process.env.Path || ''
      env.PATH = `${nodeDirectory};${origPath}`
      env.Path = `${nodeDirectory};${origPath}`
    }
    return env
  }

  private async startAsChildProcess(project: Project, port: number): Promise<void> {
    const envVars = this.db.getProjectEnv(project.id)
    const mergedEnv = this.injectNodeToEnv({
      ...process.env,
      ...envVars,
      PORT: String(port)
    })

    let cmd = project.startCommand.trim()
    if (!cmd) {
      if (project.stack === 'node') cmd = 'node index.js'
      else if (project.stack === 'python') cmd = 'python main.py'
      else cmd = 'npm start'
    }

    // Se usar binário node embutido e o comando começa com 'node '
    const nodeExe = binaryPath('node')
    if (binaryPresent('node') && cmd.startsWith('node ')) {
      cmd = `"${nodeExe}" ${cmd.slice(5)}`
    }

    this.appendLog(project.id, 'system', `Comando de inicialização: ${cmd}`)

    const child = spawn(cmd, {
      cwd: project.workdir,
      env: mergedEnv,
      shell: true,
      windowsHide: true
    })

    if (!child.pid) throw new Error('Falha ao obter PID do processo disparado')

    const runningItem: RunningChild = {
      process: child,
      pid: child.pid,
      startedAt: Date.now()
    }

    this.runningChildren.set(project.id, runningItem)
    this.setStatus(project.id, 'running', `Rodando na porta ${port} (PID ${child.pid})`, child.pid)

    const stdoutSplitter = createLineSplitter((line) => this.appendLog(project.id, 'stdout', line))
    const stderrSplitter = createLineSplitter((line) => this.appendLog(project.id, 'stderr', line))

    child.stdout?.on('data', (d) => stdoutSplitter.write(d))
    child.stderr?.on('data', (d) => stderrSplitter.write(d))

    child.on('error', (err) => {
      this.appendLog(project.id, 'stderr', `Erro de processo: ${err.message}`)
      this.setStatus(project.id, 'crashed', `Erro de processo: ${err.message}`)
    })

    child.on('close', (code, signal) => {
      stdoutSplitter.end()
      stderrSplitter.end()
      this.runningChildren.delete(project.id)

      const curr = this.db.getProject(project.id)
      if (curr && curr.status === 'running') {
        const msg = `Processo finalizou inesperadamente com código ${code ?? 0} (sinal: ${signal ?? 'none'})`
        this.setStatus(project.id, 'crashed', msg)
        this.appendLog(project.id, 'system', msg)

        // Alerta de crash
        this.notifications.notify({
          severity: 'critical',
          category: 'project',
          title: `Aplicação Caiu: ${project.name}`,
          message: msg,
          projectId: project.id,
          extraFacts: { Projeto: project.name, Porta: `${port}`, 'Exit Code': `${code ?? 0}` }
        })
      }
    })
  }

  private async stopChildProcess(projectId: string): Promise<void> {
    const item = this.runningChildren.get(projectId)
    if (!item) return

    return new Promise<void>((resolve) => {
      treeKill(item.pid, 'SIGTERM', (err) => {
        if (err) {
          log.warn(`treeKill SIGTERM falhou para PID ${item.pid}, tentando SIGKILL`, err)
          treeKill(item.pid, 'SIGKILL', () => resolve())
        } else {
          resolve()
        }
      })
    })
  }

  private async startAsWindowsService(project: Project, port: number): Promise<void> {
    const nssm = binaryPath('nssm')
    const serviceName = `HS_${project.slug}`
    const settings = this.db.getFullSettings()
    const layout = workspaceLayout(settings.workspaceRoot)

    // Cria arquivo seguro de variáveis de ambiente decifradas para o launcher
    const envVars = this.db.getProjectEnv(project.id)
    const envFilePath = join(layout.runtimeEnv, `${project.slug}.json`)
    mkdirSync(layout.runtimeEnv, { recursive: true })
    writeFileSync(envFilePath, JSON.stringify(envVars), { mode: 0o600 })

    const nodeExe = binaryPresent('node') ? binaryPath('node') : 'node.exe'
    const launcher = launcherPath()

    const script = `
      $nssm = ${psQuote(nssm)}
      $svc = ${psQuote(serviceName)}
      $node = ${psQuote(nodeExe)}
      $launcher = ${psQuote(launcher)}
      $workdir = ${psQuote(project.workdir)}
      $envFile = ${psQuote(envFilePath)}
      $port = "${port}"
      $cmd = ${psQuote(project.startCommand)}

      # Instala ou reconfigura o serviço via NSSM
      & $nssm stop $svc 2>&1 | Out-Null
      & $nssm install $svc $node "$launcher" --workdir "$workdir" --env-file "$envFile" --port $port --exec $cmd
      & $nssm set $svc AppDirectory $workdir
      & $nssm set $svc DisplayName "HomeServer App: ${project.name}"
      & $nssm set $svc Description "Servico gerenciado pelo HomeServer Orchestrator"
      & $nssm set $svc Start SERVICE_AUTO_START
      
      # Inicia o serviço
      & $nssm start $svc
    `

    const res = await runPrivileged(script)
    if (res.exitCode !== 0) throw new Error(`Falha ao instalar serviço NSSM: ${res.error}`)

    this.setStatus(project.id, 'running', `Rodando como Serviço Windows '${serviceName}' na porta ${port}`)
    this.appendLog(project.id, 'system', `Serviço Windows '${serviceName}' ativo via NSSM.`)
  }

  private async stopWindowsService(project: Project): Promise<void> {
    const nssm = binaryPath('nssm')
    const serviceName = `HS_${project.slug}`
    const script = `
      $nssm = ${psQuote(nssm)}
      $svc = ${psQuote(serviceName)}
      & $nssm stop $svc 2>&1 | Out-Null
    `
    await runPrivileged(script)
  }

  private async deployGit(id: string): Promise<void> {
    const project = this.db.getProject(id)
    if (!project) return

    this.setStatus(id, 'building', 'Sincronizando repositório Git...')
    this.appendLog(id, 'system', `Clonando/Atualizando Git: ${project.source}`)

    const git = simpleGit()
    if (!existsSync(join(project.workdir, '.git'))) {
      await git.clone(project.source, project.workdir, project.branch ? ['-b', project.branch] : [])
      this.appendLog(id, 'system', 'Clone do repositório concluído.')
    } else {
      const repo = simpleGit(project.workdir)
      if (project.branch) await repo.checkout(project.branch)
      await repo.pull()
      this.appendLog(id, 'system', 'Git pull executado com sucesso.')
    }
  }

  private async runBuild(id: string, buildCommand: string, workdir: string): Promise<void> {
    this.setStatus(id, 'building', `Executando build: ${buildCommand}`)
    this.appendLog(id, 'system', `--- Executando comando de build: ${buildCommand} ---`)

    const envVars = this.db.getProjectEnv(id)
    const buildEnv = this.injectNodeToEnv({
      ...process.env,
      ...envVars
    })

    return new Promise<void>((resolve, reject) => {
      const child = spawn(buildCommand, {
        cwd: workdir,
        shell: true,
        env: buildEnv
      })

      const stdoutSplitter = createLineSplitter((line) => this.appendLog(id, 'stdout', line))
      const stderrSplitter = createLineSplitter((line) => this.appendLog(id, 'stderr', line))

      child.stdout?.on('data', (d) => stdoutSplitter.write(d))
      child.stderr?.on('data', (d) => stderrSplitter.write(d))

      child.on('close', (code) => {
        stdoutSplitter.end()
        stderrSplitter.end()
        if (code === 0) {
          this.appendLog(id, 'system', 'Build concluído com sucesso.')
          resolve()
        } else {
          reject(new Error(`Comando de build falhou com código ${code}`))
        }
      })

      child.on('error', (err) => reject(err))
    })
  }

  private setStatus(id: string, status: ProjectStatus, message: string, pid?: number | null): void {
    const update: Partial<Project> = { status, statusMessage: message }
    if (pid !== undefined) update.pid = pid
    if (status === 'running') update.startedAt = Date.now()
    this.db.updateProject(id, update)
    broadcast(IPC.projectsOnStatus, { id, status, message })
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      const p = await getPort({ port })
      return p === port
    } catch {
      return false
    }
  }
}
