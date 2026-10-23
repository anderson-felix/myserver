import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { createLogger } from '../utils/logger'
import { broadcast } from '../utils/common'
import {
  IPC,
  type LinuxNodeInput,
  type LinuxTelemetry,
  type LinuxProvisionOptions,
  type LinuxLogEvent,
  type LinuxDeployment,
  type LinuxContainer
} from '@shared/types'
import type { AppDatabase } from '../database'
import type { NotificationService } from './NotificationService'

const log = createLogger('linux-ssh')

export class LinuxSshService {
  constructor(
    private db: AppDatabase,
    private notifications: NotificationService
  ) {}

  public async connectAndTest(nodeId: string): Promise<LinuxTelemetry> {
    const auth = this.db.getLinuxNodeAuth(nodeId)
    if (!auth) throw new Error('Nó Linux não encontrado')

    log.info(`Conectando via SSH ao nó ${auth.name} (${auth.host}:${auth.port})...`)
    const conn = await this.openSshConnection(auth)

    try {
      const telemetry = await this.collectLinuxTelemetry(conn)
      this.db.updateLinuxNode(nodeId, { lastSeen: Date.now() })
      return telemetry
    } finally {
      conn.end()
    }
  }

  public async provision(nodeId: string, options: LinuxProvisionOptions): Promise<void> {
    const auth = this.db.getLinuxNodeAuth(nodeId)
    if (!auth) throw new Error('Nó Linux não encontrado')

    log.info(`Iniciando provisionamento do nó ${auth.name}...`, options)
    this.emitLog(nodeId, 'system', `=== Iniciando Provisionamento Linux no host ${auth.host} ===`)

    const conn = await this.openSshConnection(auth)

    try {
      // 1. Otimização de Energia / Fechamento de Tampa (Lid Switch)
      if (options.power) {
        this.emitLog(nodeId, 'system', '[1/4] Configurando política de tampa e suspensão...')
        const powerCmd = `
          sed -i 's/#HandleLidSwitch=.*/HandleLidSwitch=ignore/g' /etc/systemd/logind.conf
          sed -i 's/HandleLidSwitch=.*/HandleLidSwitch=ignore/g' /etc/systemd/logind.conf
          systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
          systemctl restart systemd-logind 2>/dev/null || true
        `
        await this.execPrivileged(conn, nodeId, auth, powerCmd)
        this.emitLog(nodeId, 'system', '✔ Suspensão desativada com sucesso.')
      }

      // 2. Docker Engine
      if (options.docker) {
        this.emitLog(nodeId, 'system', '[2/4] Verificando e instalando Docker Engine...')
        const dockerCmd = `
          if ! command -v docker >/dev/null 2>&1; then
            apt-get update -y
            apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" ca-certificates curl gnupg
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes 2>/dev/null || true
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
            apt-get update -y
            apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            usermod -aG docker ${auth.username} 2>/dev/null || true
            systemctl enable docker
            systemctl start docker
          fi
          docker --version
        `
        await this.execPrivileged(conn, nodeId, auth, dockerCmd)
        this.emitLog(nodeId, 'system', '✔ Docker Engine pronto.')
      }

      // 3. Caddy e Cloudflared
      if (options.caddy || options.cloudflared) {
        this.emitLog(nodeId, 'system', '[3/4] Instalando utilitários de rede (Caddy / Cloudflared)...')
        let netCmd = `apt-get update -y\n`
        if (options.caddy) {
          netCmd += `
            if ! command -v caddy >/dev/null 2>&1; then
              apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" debian-keyring debian-archive-keyring apt-transport-https curl
              curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
              curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
              apt-get update -y
              apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" caddy
              systemctl enable caddy
              systemctl start caddy
            fi
            caddy version
          `
        }
        if (options.cloudflared) {
          netCmd += `
            if ! command -v cloudflared >/dev/null 2>&1; then
              curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /etc/apt/keyrings/cloudflare-main.gpg >/dev/null
              echo 'deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | tee /etc/apt/sources.list.d/cloudflared.list
              apt-get update -y
              apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" cloudflared
            fi
            cloudflared --version
          `
        }
        await this.execPrivileged(conn, nodeId, auth, netCmd)
        this.emitLog(nodeId, 'system', '✔ Caddy / Cloudflared instalados.')
      }

      // 4. Firewall UFW
      if (options.firewall) {
        this.emitLog(nodeId, 'system', '[4/4] Configurando firewall UFW...')
        const ufwCmd = `
          apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" ufw
          ufw default deny incoming
          ufw default allow outgoing
          ufw allow ${auth.port}/tcp comment 'SSH'
          ${options.allowHttpFromLan ? `ufw allow 80/tcp comment 'HTTP'\nufw allow 443/tcp comment 'HTTPS'` : ''}
          ufw --force enable
          ufw status verbose
        `
        await this.execPrivileged(conn, nodeId, auth, ufwCmd)
        this.emitLog(nodeId, 'system', '✔ Firewall UFW ativo.')
      }

      this.db.updateLinuxNode(nodeId, { provisioned: true, lastSeen: Date.now() })
      this.emitLog(nodeId, 'system', '🎉 Provisionamento do nó Linux concluído com sucesso!')

      await this.notifications.notify({
        severity: 'success',
        category: 'system',
        title: 'Servidor Linux Provisionado',
        message: `O nó '${auth.name}' (${auth.host}) foi preparado com Docker, Caddy e configurações anti-suspensão.`
      })
    } finally {
      conn.end()
    }
  }

  public async deployContainer(nodeId: string, projectId: string): Promise<void> {
    const auth = this.db.getLinuxNodeAuth(nodeId)
    if (!auth) throw new Error('Nó Linux não encontrado')

    const project = this.db.getProject(projectId)
    if (!project) throw new Error('Projeto não encontrado')

    this.emitLog(nodeId, 'system', `Iniciando deploy remoto do projeto ${project.name} (stack: ${project.stack})...`)
    const conn = await this.openSshConnection(auth)
    let localTmpDir: string | null = null

    try {
      const containerName = `hs-${project.slug}`
      const port = project.port || 3000

      // 1. Diretório absoluto no host remoto (evita ambiguidade de ~ sob sudo)
      const remoteHome = (await this.execPlain(conn, 'printf "%s" "$HOME"')).trim() || `/home/${auth.username}`
      const appDir = `${remoteHome}/hs-apps/${project.slug}`
      const srcDir = `${appDir}/src`
      await this.execPlain(conn, `mkdir -p ${shq(appDir)}`)

      const sftp = await this.getSftp(conn)

      // 2. Código-fonte: Git (clone/pull remoto) ou Pasta Local (tar.gz enviado via SFTP)
      let staticPrebuilt = false
      if (project.sourceType === 'git') {
        this.emitLog(nodeId, 'system', `[1/4] Sincronizando repositório Git ${project.source}...`)
        await this.execPlain(
          conn,
          `mkdir -p ${shq(srcDir)} && cd ${shq(srcDir)} && if [ -d .git ]; then git pull; else git clone ${project.branch ? `-b ${shq(project.branch)} ` : ''}${shq(project.source)} .; fi`
        )
      } else {
        if (!existsSync(project.workdir)) throw new Error(`Pasta local não encontrada: ${project.workdir}`)
        localTmpDir = mkdtempSync(join(tmpdir(), 'hs-deploy-'))
        const bundlePath = join(localTmpDir, 'bundle.tar.gz')

        // Static já compilado localmente → envia somente a pasta de build (leve)
        const localOut = project.outputDir ? join(project.workdir, project.outputDir) : null
        const hasLocalBuild = project.stack === 'static' && !!localOut && existsSync(localOut) && statSync(localOut).isDirectory()
        const packCwd = hasLocalBuild ? localOut! : project.workdir
        staticPrebuilt = hasLocalBuild || (project.stack === 'static' && !project.buildCommand.trim())

        const heavy = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.next', '.cache'])
        const outTop = project.outputDir ? project.outputDir.replace(/\\/g, '/').split('/')[0] : 'dist'
        if (!hasLocalBuild && project.buildCommand.trim() && outTop) heavy.add(outTop)

        this.emitLog(nodeId, 'system', `[1/4] Empacotando ${packCwd} (ignorando ${[...heavy].join(', ')})...`)
        await tar.create(
          {
            gzip: true,
            file: bundlePath,
            cwd: packCwd,
            portable: true,
            filter: (p: string) => {
              const parts = p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.')
              return !parts.some((s) => heavy.has(s))
            }
          },
          ['.']
        )

        const sizeMb = (statSync(bundlePath).size / (1024 * 1024)).toFixed(1)
        this.emitLog(nodeId, 'system', `[2/4] Enviando bundle (${sizeMb} MB) via SFTP para ${appDir}/bundle.tar.gz...`)
        await this.sftpFastPut(sftp, bundlePath, `${appDir}/bundle.tar.gz`)
        // sudo: execuções anteriores do container podem ter deixado arquivos root (ex.: node_modules)
        await this.execPrivileged(
          conn,
          nodeId,
          auth,
          `cd ${shq(appDir)} && rm -rf src && mkdir -p src && tar -xzf bundle.tar.gz -C src && rm -f bundle.tar.gz`
        )
        this.emitLog(nodeId, 'system', '✔ Código extraído no servidor remoto.')
      }

      // 3. Variáveis de ambiente (.env remoto com permissão 600)
      const envVars = { ...this.db.getProjectEnv(project.id), PORT: String(port) }
      const envContent =
        Object.entries(envVars)
          .map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, '\\n')}`)
          .join('\n') + '\n'
      await this.sftpWriteFile(sftp, `${appDir}/.env`, envContent, 0o600)
      this.emitLog(nodeId, 'system', `[3/4] Arquivo .env remoto gerado (${Object.keys(envVars).length} variáveis).`)

      // 4. Container Docker conforme a stack real do projeto
      let runCmd = ''
      const base = `docker stop ${containerName} 2>/dev/null || true\ndocker rm ${containerName} 2>/dev/null || true\n`
      const addHost = '--add-host=host.docker.internal:host-gateway'

      if (project.stack === 'node' || project.stack === 'python') {
        const isNode = project.stack === 'node'
        const install = isNode
          ? 'if [ -f package-lock.json ]; then npm ci || npm install; elif [ -f package.json ]; then npm install; fi'
          : 'if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi'
        const build = project.buildCommand.trim() ? `${project.buildCommand.trim()}\n` : ''
        const start = project.startCommand.trim() || (isNode ? 'npm start' : 'python main.py')
        const script = `#!/bin/sh\nset -e\ncd /app\n${install}\n${build}exec ${start}\n`
        await this.sftpWriteFile(sftp, `${appDir}/hs-start.sh`, script, 0o755)

        const image = isNode ? 'node:20-alpine' : 'python:3.11-slim'
        runCmd =
          base +
          `docker run -d --name ${containerName} --restart unless-stopped ${addHost} -p ${port}:${port} ` +
          `--env-file ${shq(`${appDir}/.env`)} -v ${shq(srcDir)}:/app -v ${shq(`${appDir}/hs-start.sh`)}:/hs-start.sh:ro ` +
          `-w /app ${image} sh /hs-start.sh`
      } else {
        // Static: build remoto opcional (node:20-alpine) + caddy:alpine servindo a pasta com SPA fallback
        let serveDir = srcDir
        if (!staticPrebuilt && project.buildCommand.trim()) {
          this.emitLog(nodeId, 'system', `Executando build remoto em container temporário (${project.buildCommand})...`)
          const buildScript = `#!/bin/sh\nset -e\ncd /app\nif [ -f package.json ]; then npm install; fi\n${project.buildCommand.trim()}\n`
          await this.sftpWriteFile(sftp, `${appDir}/hs-build.sh`, buildScript, 0o755)
          await this.execPrivileged(
            conn,
            nodeId,
            auth,
            `docker run --rm --env-file ${shq(`${appDir}/.env`)} -v ${shq(srcDir)}:/app -v ${shq(`${appDir}/hs-build.sh`)}:/hs-build.sh:ro -w /app node:20-alpine sh /hs-build.sh`
          )
          if (project.outputDir) serveDir = `${srcDir}/${project.outputDir.replace(/\\/g, '/')}`
        }

        const apiPort = project.apiProxyTarget ? this.resolveRemoteApiPort(project.apiProxyTarget) : null
        const caddyfile = [
          `:${port} {`,
          '  root * /srv',
          '  encode gzip',
          apiPort ? `  handle /api* {\n    reverse_proxy host.docker.internal:${apiPort}\n  }` : '',
          '  handle {',
          project.spaFallback !== false ? '    try_files {path} /index.html' : '',
          '    file_server',
          '  }',
          '}',
          ''
        ]
          .filter(Boolean)
          .join('\n')
        await this.sftpWriteFile(sftp, `${appDir}/Caddyfile`, caddyfile, 0o644)

        runCmd =
          base +
          `docker run -d --name ${containerName} --restart unless-stopped ${addHost} -p ${port}:${port} ` +
          `-v ${shq(serveDir)}:/srv:ro -v ${shq(`${appDir}/Caddyfile`)}:/etc/caddy/Caddyfile:ro caddy:alpine`
      }

      this.emitLog(nodeId, 'system', `[4/4] Subindo container ${containerName}...`)
      await this.execPrivileged(conn, nodeId, auth, runCmd)
      this.emitLog(nodeId, 'system', `✔ Container '${containerName}' ativo na porta ${port}.`)

      const existingDeployments = this.db.listLinuxNodes().find((n) => n.id === nodeId)?.deployments || []
      const updatedDeployments: LinuxDeployment[] = [
        ...existingDeployments.filter((d) => d.projectId !== projectId),
        {
          projectId,
          projectName: project.name,
          port,
          hosts: project.domains,
          deployedAt: Date.now()
        }
      ]

      this.db.updateLinuxNode(nodeId, { deployments: updatedDeployments, lastSeen: Date.now() })
    } finally {
      conn.end()
      if (localTmpDir) {
        try {
          rmSync(localTmpDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }
  }

  private resolveRemoteApiPort(target: string): number | null {
    const t = target.trim()
    if (/^\d+$/.test(t)) return Number(t)
    const match = this.db
      .listProjects()
      .find((p) => p.id === t || p.slug === t || p.name.toLowerCase() === t.toLowerCase())
    if (match?.port) return match.port
    try {
      const u = new URL(t.startsWith('http') ? t : `http://${t}`)
      return u.port ? Number(u.port) : null
    } catch {
      return null
    }
  }

  public async removeDeployment(nodeId: string, projectId: string): Promise<void> {
    const auth = this.db.getLinuxNodeAuth(nodeId)
    if (!auth) throw new Error('Nó Linux não encontrado')

    const project = this.db.getProject(projectId)
    const containerName = `hs-${project?.slug || projectId}`

    const conn = await this.openSshConnection(auth)
    try {
      await this.execPrivileged(conn, nodeId, auth, `docker rm -f ${containerName} 2>/dev/null || true`)

      const existingDeployments = this.db.listLinuxNodes().find((n) => n.id === nodeId)?.deployments || []
      this.db.updateLinuxNode(nodeId, {
        deployments: existingDeployments.filter((d) => d.projectId !== projectId)
      })
    } finally {
      conn.end()
    }
  }

  // -------------------------------------------------------------------------
  // Gerenciamento de Containers Remotos (Start / Stop / Restart / Logs)
  // -------------------------------------------------------------------------

  public async startContainer(nodeId: string, containerIdOrName: string): Promise<void> {
    const auth = this.db.getLinuxNodeAuth(nodeId)
    if (!auth) throw new Error('Nó Linux não encontrado')
    const conn = await this.openSshConnection(auth)
    try {
      this.emitLog(nodeId, 'system', `Iniciando container ${containerIdOrName}...`)
      await this.execPrivileged(conn, nodeId, auth, `docker start ${containerIdOrName}`)
      this.emitLog(nodeId, 'system', `✔ Container ${containerIdOrName} iniciado.`)
    } finally {
      conn.end()
    }
  }

  public async stopContainer(nodeId: string, containerIdOrName: string): Promise<void> {
    const auth = this.db.getLinuxNodeAuth(nodeId)
    if (!auth) throw new Error('Nó Linux não encontrado')
    const conn = await this.openSshConnection(auth)
    try {
      this.emitLog(nodeId, 'system', `Parando container ${containerIdOrName}...`)
      await this.execPrivileged(conn, nodeId, auth, `docker stop ${containerIdOrName}`)
      this.emitLog(nodeId, 'system', `✔ Container ${containerIdOrName} parado.`)
    } finally {
      conn.end()
    }
  }

  public async restartContainer(nodeId: string, containerIdOrName: string): Promise<void> {
    const auth = this.db.getLinuxNodeAuth(nodeId)
    if (!auth) throw new Error('Nó Linux não encontrado')
    const conn = await this.openSshConnection(auth)
    try {
      this.emitLog(nodeId, 'system', `Reiniciando container ${containerIdOrName}...`)
      await this.execPrivileged(conn, nodeId, auth, `docker restart ${containerIdOrName}`)
      this.emitLog(nodeId, 'system', `✔ Container ${containerIdOrName} reiniciado.`)
    } finally {
      conn.end()
    }
  }

  public async getContainerLogs(nodeId: string, containerIdOrName: string, tail = 200): Promise<string> {
    const auth = this.db.getLinuxNodeAuth(nodeId)
    if (!auth) throw new Error('Nó Linux não encontrado')
    const conn = await this.openSshConnection(auth)
    try {
      return await this.execPrivileged(conn, nodeId, auth, `docker logs --tail ${tail} ${containerIdOrName} 2>&1`)
    } finally {
      conn.end()
    }
  }

  // -------------------------------------------------------------------------
  // Métodos Auxiliares SSH e Execução Segura com sudo -S
  // -------------------------------------------------------------------------

  private openSshConnection(auth: LinuxNodeInput): Promise<Client> {
    return new Promise<Client>((resolve, reject) => {
      const conn = new Client()
      const config: ConnectConfig = {
        host: auth.host,
        port: auth.port || 22,
        username: auth.username,
        readyTimeout: 15_000
      }

      if (auth.authType === 'password') {
        config.password = auth.password
      } else if (auth.authType === 'key' && auth.privateKey) {
        config.privateKey = auth.privateKey
        if (auth.passphrase) config.passphrase = auth.passphrase
      }

      conn.on('ready', () => resolve(conn))
      conn.on('error', (err) => reject(new Error(`Falha de conexão SSH: ${err.message}`)))
      conn.connect(config)
    })
  }

  private execPrivileged(
    conn: Client,
    nodeId: string,
    auth: LinuxNodeInput,
    scriptContent: string
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const fullScript = `export DEBIAN_FRONTEND=noninteractive\n${scriptContent}`
      const isRoot = auth.username === 'root'
      const sudoPassword = auth.sudoPassword || auth.password || ''

      const base64Script = Buffer.from(fullScript).toString('base64')
      const remoteCmd = isRoot
        ? `echo "${base64Script}" | base64 -d | bash`
        : `sudo -S -p '' bash -c 'echo "${base64Script}" | base64 -d | bash'`

      conn.exec(remoteCmd, (err, stream) => {
        if (err) return reject(err)
        let output = ''

        if (!isRoot && sudoPassword) {
          stream.write(`${sudoPassword}\n`)
        }

        stream.on('data', (d: Buffer) => {
          const text = d.toString()
          output += text
          text.split(/\r?\n/).forEach((l) => {
            const clean = l.trim()
            if (clean) this.emitLog(nodeId, 'stdout', clean)
          })
        })

        stream.stderr.on('data', (d: Buffer) => {
          const text = d.toString()
          text.split(/\r?\n/).forEach((l) => {
            const clean = l.trim()
            if (clean && !clean.toLowerCase().includes('[sudo] password')) {
              this.emitLog(nodeId, 'stderr', clean)
            }
          })
        })

        stream.on('close', (code: number) => {
          if (code === 0) resolve(output)
          else reject(new Error(`Comando remoto falhou com código ${code}`))
        })
      })
    })
  }

  private async collectLinuxTelemetry(conn: Client): Promise<LinuxTelemetry> {
    const script = `
      echo "===HOSTNAME==="; hostname
      echo "===OS==="; cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || uname -s
      echo "===KERNEL==="; uname -r
      echo "===UPTIME==="; cat /proc/uptime 2>/dev/null | awk '{print $1}' || uptime
      echo "===CPUS==="; nproc 2>/dev/null || echo "1"
      echo "===LOAD==="; cat /proc/loadavg 2>/dev/null | awk '{print $1" "$2" "$3}' || echo "0 0 0"
      echo "===MEM==="; free -b 2>/dev/null | awk '/Mem:/ {print $2" "$3}' || echo "1 0"
      echo "===DISK==="; df -B1 / 2>/dev/null | awk 'NR==2 {print $2" "$3}' || echo "1 0"
      echo "===BATT==="; if [ -d /sys/class/power_supply/BAT* ]; then cat /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -1; else echo "none"; fi
      echo "===AC==="; if [ -d /sys/class/power_supply/A* ]; then cat /sys/class/power_supply/A*/online 2>/dev/null | head -1; else echo "none"; fi
      echo "===TEMP==="; if [ -f /sys/class/thermal/thermal_zone0/temp ]; then cat /sys/class/thermal/thermal_zone0/temp; else echo "none"; fi
      echo "===APPS==="
      command -v docker >/dev/null && echo "docker:1" || echo "docker:0"
      command -v caddy >/dev/null && echo "caddy:1" || echo "caddy:0"
      command -v cloudflared >/dev/null && echo "cloudflared:1" || echo "cloudflared:0"
      echo "===CONTAINERS==="
      if command -v docker >/dev/null 2>&1; then
        docker ps -a --format '{{json .}}' 2>/dev/null || true
      fi
    `

    const raw = await new Promise<string>((resolve, reject) => {
      conn.exec(script, (err, stream) => {
        if (err) return reject(err)
        let data = ''
        stream.on('data', (d: Buffer) => { data += d.toString() })
        stream.on('close', () => resolve(data))
      })
    })

    const parseSection = (name: string): string => {
      const marker = `===${name}===`
      const idx = raw.indexOf(marker)
      if (idx === -1) return ''
      const rest = raw.slice(idx + marker.length).trim()
      const nextIdx = rest.indexOf('===')
      return (nextIdx === -1 ? rest : rest.slice(0, nextIdx)).trim()
    }

    const loadStr = parseSection('LOAD').split(' ')
    const memStr = parseSection('MEM').split(' ')
    const diskStr = parseSection('DISK').split(' ')
    const battStr = parseSection('BATT')
    const acStr = parseSection('AC')
    const tempStr = parseSection('TEMP')
    const appsStr = parseSection('APPS')

    const containersRaw = parseSection('CONTAINERS').split(/\r?\n/).filter(Boolean)
    const containers: LinuxContainer[] = containersRaw
      .map((line) => {
        try {
          const item = JSON.parse(line)
          return {
            id: String(item.ID || item.Id || '').slice(0, 12),
            name: String(item.Names || item.Name || '').replace(/^\//, ''),
            image: String(item.Image || ''),
            status: String(item.Status || item.State || ''),
            ports: String(item.Ports || '')
          }
        } catch {
          const parts = line.split('|')
          if (parts.length >= 4) {
            return {
              id: parts[0] || '',
              name: parts[1] || '',
              image: parts[2] || '',
              status: parts[3] || '',
              ports: parts[4] || ''
            }
          }
          return null
        }
      })
      .filter((c): c is LinuxContainer => c !== null)

    return {
      hostname: parseSection('HOSTNAME') || 'linux-node',
      os: parseSection('OS') || 'Linux',
      kernel: parseSection('KERNEL'),
      uptimeSec: Math.round(Number(parseSection('UPTIME')) || 0),
      cpus: Number(parseSection('CPUS')) || 1,
      load: [Number(loadStr[0]) || 0, Number(loadStr[1]) || 0, Number(loadStr[2]) || 0],
      memTotal: Number(memStr[0]) || 1,
      memUsed: Number(memStr[1]) || 0,
      diskTotal: Number(diskStr[0]) || 1,
      diskUsed: Number(diskStr[1]) || 0,
      batteryPercent: battStr !== 'none' && battStr ? Number(battStr) : null,
      acOnline: acStr !== 'none' && acStr ? acStr === '1' : null,
      temperatureC: tempStr !== 'none' && tempStr ? Math.round(Number(tempStr) / 1000) : null,
      docker: appsStr.includes('docker:1'),
      caddy: appsStr.includes('caddy:1'),
      cloudflared: appsStr.includes('cloudflared:1'),
      ufw: 'active',
      containers
    }
  }

  /** Executa um comando como o próprio usuário SSH (sem sudo) e retorna stdout. */
  private execPlain(conn: Client, cmd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err)
        let out = ''
        let errOut = ''
        stream.on('data', (d: Buffer) => {
          out += d.toString()
        })
        stream.stderr.on('data', (d: Buffer) => {
          errOut += d.toString()
        })
        stream.on('close', (code: number) => {
          if (code === 0 || code === undefined || code === null) resolve(out)
          else reject(new Error(`Comando remoto falhou (${code}): ${errOut.trim() || out.trim()}`))
        })
      })
    })
  }

  private getSftp(conn: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
    })
  }

  private sftpFastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => (err ? reject(new Error(`Falha no upload SFTP: ${err.message}`)) : resolve()))
    })
  }

  private sftpWriteFile(sftp: SFTPWrapper, remotePath: string, content: string, mode: number): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, content, { mode }, (err) =>
        err ? reject(new Error(`Falha ao gravar ${remotePath}: ${err.message}`)) : resolve()
      )
    })
  }

  private emitLog(nodeId: string, stream: LinuxLogEvent['stream'], line: string): void {
    broadcast(IPC.linuxNodeOnLog, { nodeId, stream, line, ts: Date.now() })
  }
}

/** Aspas simples seguras para shell POSIX. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
