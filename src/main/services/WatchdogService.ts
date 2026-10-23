import si from 'systeminformation'
import { createLogger } from '../utils/logger'
import { isAdmin, runPowerShell } from '../utils/shell'
import type { Telemetry, BatteryInfo, DiskInfo, NetworkInfo } from '@shared/types'
import type { AppDatabase } from '../database'
import type { NotificationService } from './NotificationService'
import type { ProcessManagerService } from './ProcessManagerService'

const log = createLogger('watchdog')

export class WatchdogService {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private processManager: ProcessManagerService | null = null

  // Estado anterior para detecção de transições
  private prevAcConnected: boolean | null = null
  private consecutiveHighTemp = 0
  private consecutiveHighRam = 0
  private lastCriticalShutdownTriggered = false
  private healthFailures: Map<string, number> = new Map()

  // Cache de telemetria para chamadas rápidas
  private cachedTelemetry: Telemetry | null = null
  private lastNetworkRx = 0
  private lastNetworkTx = 0
  private lastNetworkTs = 0

  constructor(
    private db: AppDatabase,
    private notifications: NotificationService
  ) {}

  public setProcessManager(pm: ProcessManagerService): void {
    this.processManager = pm
  }

  public start(): void {
    if (this.running) return
    this.running = true
    log.info('Iniciando loop do Watchdog (intervalo 15s)...')
    // Coleta inicial
    this.tick().catch((err) => log.error('Erro no primeiro tick do Watchdog', err))
    this.timer = setInterval(() => {
      this.tick().catch((err) => log.error('Erro no tick do Watchdog', err))
    }, 15_000)
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.running = false
  }

  public async getTelemetry(): Promise<Telemetry> {
    if (this.cachedTelemetry && Date.now() - this.cachedTelemetry.timestamp < 4_000) {
      return this.cachedTelemetry
    }
    return this.collectTelemetry()
  }

  private async tick(): Promise<void> {
    const settings = this.db.getFullSettings()
    if (!settings.watchdog.enabled) return

    const telemetry = await this.collectTelemetry()
    this.cachedTelemetry = telemetry

    // 1. Monitoramento de Bateria / UPS
    await this.checkBattery(telemetry.battery, settings)

    // 2. Proteção Térmica e Pressão de RAM
    await this.checkHardware(telemetry, settings)

    // 3. Auto-Healing de Aplicações
    if (this.processManager) {
      await this.checkApplications(settings)
    }
  }

  private async collectTelemetry(): Promise<Telemetry> {
    const now = Date.now()
    const [cpuData, currentLoad, temp, mem, disks, ifaces, netStats, batt, osData] = await Promise.all([
      si.cpu().catch(() => ({ manufacturer: '', brand: 'CPU', speed: 0, cores: 1, physicalCores: 1 })),
      si.currentLoad().catch(() => ({ currentLoad: 0, cpus: [] })),
      si.cpuTemperature().catch(() => ({ main: null, cores: [], max: null })),
      si.mem().catch(() => ({ total: 1, used: 0, available: 1, swaptotal: 0, swapused: 0 })),
      si.fsSize().catch(() => [] as si.Systeminformation.FsSizeData[]),
      si.networkInterfaces().catch(() => [] as si.Systeminformation.NetworkInterfacesData[]),
      si.networkStats().catch(() => [] as si.Systeminformation.NetworkStatsData[]),
      si.battery().catch(() => ({ hasBattery: false, isCharging: false, acConnected: true, percent: 100, timeRemaining: null, cycleCount: null })),
      si.osInfo().catch(() => ({ hostname: 'localhost', distro: 'Windows', release: '', arch: 'x64' }))
    ])

    const isElevated = await isAdmin()
    const cpuTemp = await this.resolveCpuTemp(temp)

    // Interface de rede ativa principal
    const activeIface = Array.isArray(ifaces) ? ifaces.find((i) => i.ip4 && !i.internal && i.operstate === 'up') || ifaces[0] : null
    const netStat = Array.isArray(netStats) ? netStats.find((s) => s.iface === activeIface?.iface) || netStats[0] : null

    let rxSec = 0
    let txSec = 0
    if (netStat && this.lastNetworkTs > 0) {
      const dt = (now - this.lastNetworkTs) / 1000
      if (dt > 0) {
        rxSec = Math.max(0, Math.round((netStat.rx_bytes - this.lastNetworkRx) / dt))
        txSec = Math.max(0, Math.round((netStat.tx_bytes - this.lastNetworkTx) / dt))
      }
    }
    if (netStat) {
      this.lastNetworkRx = netStat.rx_bytes
      this.lastNetworkTx = netStat.tx_bytes
      this.lastNetworkTs = now
    }

    const network: NetworkInfo | null = activeIface
      ? {
          iface: activeIface.iface,
          ip4: activeIface.ip4 || '127.0.0.1',
          mac: activeIface.mac || '',
          type: activeIface.type || 'wired',
          speedMbps: activeIface.speed || null,
          gateway: (activeIface as any).defaultGateway || '',
          rxSec,
          txSec
        }
      : null

    const diskInfos: DiskInfo[] = disks.map((d) => ({
      fs: d.fs,
      mount: d.mount,
      type: d.type,
      size: d.size,
      used: d.used,
      percent: Math.round(d.use)
    }))

    const battery: BatteryInfo = {
      hasBattery: batt.hasBattery,
      percent: batt.percent,
      isCharging: batt.isCharging,
      acConnected: batt.acConnected,
      timeRemaining: batt.timeRemaining || null,
      cycleCount: (batt as any).cycleCount || null,
      healthPercent: (batt as any).maxCapacity && (batt as any).designedCapacity
        ? Math.round(((batt as any).maxCapacity / (batt as any).designedCapacity) * 100)
        : null
    }

    const memPercent = Math.round((mem.used / (mem.total || 1)) * 100)

    const telemetry: Telemetry = {
      timestamp: now,
      host: {
        hostname: osData.hostname,
        distro: osData.distro,
        release: osData.release,
        arch: osData.arch,
        uptimeSec: si.time().uptime,
        isAdmin: isElevated
      },
      cpu: {
        model: `${cpuData.manufacturer} ${cpuData.brand}`.trim(),
        cores: cpuData.cores,
        physicalCores: cpuData.physicalCores,
        loadPercent: Math.round(currentLoad.currentLoad),
        perCore: (currentLoad.cpus || []).map((c) => Math.round(c.load)),
        speedGhz: cpuData.speed,
        temperature: cpuTemp
      },
      memory: {
        total: mem.total,
        used: mem.used,
        available: mem.available,
        percent: memPercent,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused
      },
      disks: diskInfos,
      network,
      battery
    }

    return telemetry
  }

  private async checkBattery(battery: BatteryInfo, settings: ReturnType<AppDatabase['getFullSettings']>): Promise<void> {
    if (!battery.hasBattery) return

    // Transição 1: Queda de energia
    if (this.prevAcConnected === true && battery.acConnected === false) {
      log.warn(`Queda de energia detectada! Bateria em ${battery.percent}%`)
      await this.notifications.notify({
        severity: 'warning',
        category: 'power',
        title: 'Queda de Energia Elétrica!',
        message: `Servidor operando no modo No-Break (bateria). Carga restante: ${battery.percent}%.`,
        extraFacts: {
          Bateria: `${battery.percent}%`,
          Status: 'Desconectado da rede elétrica',
          'Tempo Estimado': battery.timeRemaining ? `${battery.timeRemaining} min` : 'Calculando...'
        }
      })
    }

    // Transição 2: Retorno de energia
    if (this.prevAcConnected === false && battery.acConnected === true) {
      log.info(`Energia elétrica restabelecida! Bateria em ${battery.percent}%`)
      await this.notifications.notify({
        severity: 'success',
        category: 'power',
        title: 'Energia Elétrica Restabelecida',
        message: `O fornecimento elétrico foi normalizado. A bateria está recarregando (${battery.percent}%).`,
        extraFacts: {
          Bateria: `${battery.percent}%`,
          Status: battery.isCharging ? 'Carregando' : 'Conectado à tomada'
        }
      })
    }

    this.prevAcConnected = battery.acConnected

    // Transição 3: Bateria Crítica (≤ limiar)
    const critLimit = settings.watchdog.batteryCriticalPercent || 15
    if (!battery.acConnected && battery.percent <= critLimit && !this.lastCriticalShutdownTriggered) {
      this.lastCriticalShutdownTriggered = true
      log.error(`Bateria crítica (${battery.percent}% <= ${critLimit}%). Desligamento de emergência!`)

      await this.notifications.notify({
        severity: 'critical',
        category: 'power',
        title: 'Bateria Crítica - Desligamento de Proteção',
        message: `Bateria atingiu ${battery.percent}%. Encerrando APIs com segurança para evitar corrupção de banco de dados e desligando o host.`,
        extraFacts: {
          Bateria: `${battery.percent}%`,
          Ação: 'Shutdown em 10 segundos'
        }
      })

      if (settings.watchdog.autoShutdown) {
        // Encerra projetos graciosamente
        if (this.processManager) {
          try {
            await this.processManager.stopAll(8_000)
          } catch (err) {
            log.error('Erro ao parar projetos no desligamento crítico', err)
          }
        }
        // Executa shutdown no Windows
        try {
          await runPowerShell(`shutdown.exe /s /t 10 /c "Shutdown seguro pelo HomeServer Watchdog (Bateria ${battery.percent}%)"`)
        } catch (err) {
          log.error('Falha ao acionar shutdown do Windows', err)
        }
      }
    }
  }

  private async checkHardware(telemetry: Telemetry, settings: ReturnType<AppDatabase['getFullSettings']>): Promise<void> {
    // Alerta térmico (> 85°C por 3 ciclos consecutivos)
    const tempThreshold = settings.watchdog.cpuTempThreshold || 85
    if (telemetry.cpu.temperature && telemetry.cpu.temperature >= tempThreshold) {
      this.consecutiveHighTemp++
      if (this.consecutiveHighTemp === 3) {
        log.warn(`Alerta térmico contínuo: CPU a ${telemetry.cpu.temperature}°C`)
        await this.notifications.notify({
          severity: 'warning',
          category: 'thermal',
          title: 'Alerta de Temperatura Excessiva na CPU',
          message: `A CPU atingiu ${telemetry.cpu.temperature}°C por 3 checagens consecutivas. Verifique as saídas de ar ou coolers do computador.`,
          extraFacts: {
            Temperatura: `${telemetry.cpu.temperature}°C`,
            Carga: `${telemetry.cpu.loadPercent}%`
          }
        })
      }
    } else {
      this.consecutiveHighTemp = 0
    }

    // Pressão de Memória (> 90%)
    const ramThreshold = settings.watchdog.ramThresholdPercent || 90
    if (telemetry.memory.percent >= ramThreshold) {
      this.consecutiveHighRam++
      if (this.consecutiveHighRam === 3) {
        log.warn(`Pressão crítica de memória: ${telemetry.memory.percent}% em uso`)
        await this.notifications.notify({
          severity: 'warning',
          category: 'memory',
          title: 'Pressão Excessiva de Memória RAM',
          message: `O uso global de memória RAM atingiu ${telemetry.memory.percent}%. O sistema pode começar a usar swap excessivo.`,
          extraFacts: {
            'RAM Usada': `${Math.round(telemetry.memory.used / (1024 * 1024 * 1024))} GB`,
            'RAM Total': `${Math.round(telemetry.memory.total / (1024 * 1024 * 1024))} GB`,
            Percentual: `${telemetry.memory.percent}%`
          }
        })
      }
    } else {
      this.consecutiveHighRam = 0
    }
  }

  private async resolveCpuTemp(siTemp: { main?: number | null; max?: number | null; [key: string]: any }): Promise<number | null> {
    if (siTemp.main && siTemp.main > 0 && siTemp.main < 125) {
      return Math.round(siTemp.main)
    }
    if (siTemp.max && siTemp.max > 0 && siTemp.max < 125) {
      return Math.round(siTemp.max)
    }

    // Fallback WMI via PowerShell (MSAcpi_ThermalZoneTemperature)
    try {
      const res = await runPowerShell(
        '(Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi -ErrorAction SilentlyContinue).CurrentTemperature',
        1_500
      )
      const raw = res.stdout.trim().split(/\s+/)[0]
      if (raw) {
        const kelvinTenths = parseFloat(raw)
        if (!isNaN(kelvinTenths) && kelvinTenths > 2700 && kelvinTenths < 4000) {
          const celsius = Math.round(kelvinTenths / 10 - 273.15)
          if (celsius > 0 && celsius < 125) {
            return celsius
          }
        }
      }
    } catch {
      /* ignore */
    }

    return null
  }

  private async checkApplications(settings: ReturnType<AppDatabase['getFullSettings']>): Promise<void> {
    if (!this.processManager) return

    const projects = this.db.listProjects().filter((p) => p.status === 'running')
    if (projects.length === 0) return

    let procList: si.Systeminformation.ProcessesProcessData[] = []
    try {
      const procInfo = await si.processes()
      procList = procInfo.list || []
    } catch (err) {
      log.warn('Falha ao listar processos do sistema via systeminformation', err)
    }

    for (const p of projects) {
      // 1. Verificação de vazamento de memória com árvore de processos completa (pai + filhos)
      if (p.pid && procList.length > 0) {
        try {
          const memMB = this.calcProcessTreeMemoryMB(p.pid, procList)
          if (memMB !== null) {
            this.db.updateProject(p.id, { memoryMB: Math.round(memMB) })
            if (p.maxMemoryMB > 0 && memMB > p.maxMemoryMB) {
              log.warn(`Auto-Healing: Projeto ${p.name} excedeu limite de RAM (${memMB.toFixed(1)}MB > ${p.maxMemoryMB}MB)`)
              await this.notifications.notify({
                severity: 'warning',
                category: 'healing',
                title: `Auto-Healing: ${p.name} reiniciado`,
                message: `O projeto ultrapassou o limite de memória configurado (${memMB.toFixed(1)} MB / ${p.maxMemoryMB} MB). Reiniciando processo...`,
                projectId: p.id,
                extraFacts: { Projeto: p.name, 'RAM Usada': `${memMB.toFixed(1)} MB`, Limite: `${p.maxMemoryMB} MB` }
              })
              await this.processManager.restart(p.id, 'Excedeu limite de memória (Auto-Healing)')
              continue
            }
          }
        } catch (err) {
          log.warn(`Falha ao medir memória do projeto ${p.name}`, err)
        }
      }

      // 2. HTTP Healthcheck Inteligente (com fallback para raiz / evitando falsos positivos)
      if (p.port) {
        const failThreshold = settings.watchdog.healthFailThreshold || 3
        const configuredPath = p.healthcheckPath
          ? p.healthcheckPath.startsWith('/')
            ? p.healthcheckPath
            : `/${p.healthcheckPath}`
          : '/health'
        const primaryUrl = `http://127.0.0.1:${p.port}${configuredPath}`

        let ok = false
        try {
          const ctrl = new AbortController()
          const timeout = setTimeout(() => ctrl.abort(), 5_000)
          const res = await fetch(primaryUrl, { signal: ctrl.signal })
          clearTimeout(timeout)

          if (res.status >= 200 && res.status < 400) {
            ok = true
          } else if (res.status === 404 && configuredPath !== '/') {
            // Se a rota específica retornou 404, testa a raiz '/' como fallback
            const rootCtrl = new AbortController()
            const rootTimeout = setTimeout(() => rootCtrl.abort(), 4_000)
            const rootRes = await fetch(`http://127.0.0.1:${p.port}/`, { signal: rootCtrl.signal })
            clearTimeout(rootTimeout)
            // Qualquer código HTTP entre 200 e 404 comprova que o servidor web está rodando e ativo
            if (rootRes.status >= 200 && rootRes.status <= 404) {
              ok = true
            }
          }
        } catch {
          ok = false
        }

        const fails = (this.healthFailures.get(p.id) || 0) + (ok ? 0 : 1)
        if (ok) {
          this.healthFailures.set(p.id, 0)
        } else {
          this.healthFailures.set(p.id, fails)
          log.warn(`Healthcheck falhou para ${p.name} (${fails}/${failThreshold}) na porta ${p.port}`)

          if (fails >= failThreshold) {
            this.healthFailures.set(p.id, 0)
            await this.notifications.notify({
              severity: 'critical',
              category: 'healing',
              title: `Auto-Healing: Falha de Healthcheck em ${p.name}`,
              message: `A aplicação falhou em responder na porta ${p.port} por ${failThreshold} checagens consecutivas. Reiniciando automaticamente...`,
              projectId: p.id,
              extraFacts: { Projeto: p.name, Porta: `${p.port}`, Rota: configuredPath, Falhas: `${fails}` }
            })
            await this.processManager.restart(p.id, 'Falha contínua no Healthcheck (Auto-Healing)')
          }
        }
      }
    }
  }

  private calcProcessTreeMemoryMB(rootPid: number, procList: si.Systeminformation.ProcessesProcessData[]): number | null {
    const pids = new Set<number>([rootPid])
    let added = true
    while (added) {
      added = false
      for (const proc of procList) {
        if (!pids.has(proc.pid) && pids.has(proc.parentPid)) {
          pids.add(proc.pid)
          added = true
        }
      }
    }

    let totalKb = 0
    let foundAny = false
    for (const proc of procList) {
      if (pids.has(proc.pid)) {
        foundAny = true
        totalKb += proc.memRss || 0
      }
    }

    if (!foundAny) return null
    return totalKb / 1024
  }
}
