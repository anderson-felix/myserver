import { powerMonitor } from 'electron'
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
  private collectPromise: Promise<Telemetry> | null = null
  private lastNetworkRx = 0
  private lastNetworkTx = 0
  private lastNetworkTs = 0

  // Dados Estáticos (coleta única na inicialização)
  private staticHostInfo: {
    cpuData: { manufacturer: string; brand: string; speed: number; cores: number; physicalCores: number }
    osData: { hostname: string; distro: string; release: string; arch: string }
    isElevated: boolean
  } | null = null

  // Dados Lentos (atualizados a cada 60s)
  private cachedDisks: DiskInfo[] = []
  private cachedActiveIface: si.Systeminformation.NetworkInterfacesData | null = null
  private lastSlowDataTs = 0

  // Sensor Térmico WMI (teste único se não suportado, ou no máximo a cada 60s)
  private wmiTempSupported: boolean | null = null
  private lastTempValue: number | null = null
  private lastTempCheckTs = 0

  // Controle de frequência de medição de processos (a cada 30s)
  private lastProcessCheckTs = 0

  private onBatteryHandler = () => {
    log.warn('powerMonitor: Evento nativo on-battery disparado pelo SO Windows!')
    this.handlePowerEvent(false).catch((err) => log.error('Erro ao processar on-battery:', err))
  }

  private onAcHandler = () => {
    log.info('powerMonitor: Evento nativo on-ac disparado pelo SO Windows!')
    this.handlePowerEvent(true).catch((err) => log.error('Erro ao processar on-ac:', err))
  }

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

    try {
      powerMonitor.on('on-battery', this.onBatteryHandler)
      powerMonitor.on('on-ac', this.onAcHandler)
      log.info('powerMonitor: Listeners nativos de hardware registrados com sucesso.')
    } catch (err) {
      log.warn('Falha ao registrar listeners nativos do powerMonitor:', err)
    }

    // Coleta inicial
    this.tick().catch((err) => log.error('Erro no primeiro tick do Watchdog', err))
    this.timer = setInterval(() => {
      this.tick().catch((err) => log.error('Erro no tick do Watchdog', err))
    }, 10_000)
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    try {
      powerMonitor.removeListener('on-battery', this.onBatteryHandler)
      powerMonitor.removeListener('on-ac', this.onAcHandler)
    } catch {
      /* ignore */
    }
    this.running = false
  }

  public async getTelemetry(): Promise<Telemetry> {
    if (this.cachedTelemetry) {
      return this.cachedTelemetry
    }
    if (!this.collectPromise) {
      this.collectPromise = this.collectTelemetry().finally(() => {
        this.collectPromise = null
      })
    }
    return this.collectPromise
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

  private async getStaticHostInfo() {
    if (this.staticHostInfo) return this.staticHostInfo
    const [cpuData, osData, isElevated] = await Promise.all([
      si.cpu().catch(() => ({ manufacturer: '', brand: 'CPU', speed: 0, cores: 1, physicalCores: 1 })),
      si.osInfo().catch(() => ({ hostname: 'localhost', distro: 'Windows', release: '', arch: 'x64' })),
      isAdmin().catch(() => false)
    ])
    this.staticHostInfo = { cpuData, osData, isElevated }
    return this.staticHostInfo
  }

  private async collectTelemetry(): Promise<Telemetry> {
    const now = Date.now()

    // 1. Dados Estáticos (CPU e SO em cache O(1))
    const { cpuData, osData, isElevated } = await this.getStaticHostInfo()

    // 2. Dados Lentos (Disco e Interfaces a cada 60s)
    if (now - this.lastSlowDataTs >= 60_000 || this.cachedDisks.length === 0) {
      const [disks, ifaces] = await Promise.all([
        si.fsSize().catch(() => [] as si.Systeminformation.FsSizeData[]),
        si.networkInterfaces().catch(() => [] as si.Systeminformation.NetworkInterfacesData[])
      ])
      this.cachedDisks = disks.map((d) => ({
        fs: d.fs,
        mount: d.mount,
        type: d.type,
        size: d.size,
        used: d.used,
        percent: Math.round(d.use)
      }))
      this.cachedActiveIface = Array.isArray(ifaces)
        ? ifaces.find((i) => i.ip4 && !i.internal && i.operstate === 'up') || ifaces[0] || null
        : null
      this.lastSlowDataTs = now
    }

    // 3. Dados Rápidos (Carga, Memória, Rede e Bateria)
    const [currentLoad, temp, mem, netStats, batt] = await Promise.all([
      si.currentLoad().catch(() => ({ currentLoad: 0, cpus: [] })),
      si.cpuTemperature().catch(() => ({ main: null, cores: [], max: null })),
      si.mem().catch(() => ({ total: 1, used: 0, available: 1, swaptotal: 0, swapused: 0 })),
      si.networkStats().catch(() => [] as si.Systeminformation.NetworkStatsData[]),
      si.battery().catch(() => ({ hasBattery: false, isCharging: false, acConnected: true, percent: 100, timeRemaining: null, cycleCount: null }))
    ])

    const cpuTemp = await this.resolveCpuTemp(temp)

    // Interface de rede ativa principal
    const activeIface = this.cachedActiveIface
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

    const diskInfos: DiskInfo[] = this.cachedDisks

    const onBatteryOs = powerMonitor.isOnBatteryPower()
    const acConnected = onBatteryOs ? false : (batt.acConnected ?? true)
    const hasBattery = Boolean(batt.hasBattery || onBatteryOs)

    let batteryPercent = batt.percent
    if (hasBattery && (!batteryPercent || batteryPercent <= 0)) {
      try {
        const psRes = await runPowerShell(
          '(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).EstimatedChargeRemaining',
          1_500
        )
        const parsed = parseInt(psRes.stdout.trim(), 10)
        if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
          batteryPercent = parsed
        }
      } catch {
        /* fallback silencioso */
      }
    }

    const battery: BatteryInfo = {
      hasBattery,
      percent: batteryPercent,
      isCharging: onBatteryOs ? false : batt.isCharging,
      acConnected,
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

  public async handlePowerEvent(acConnected: boolean, forceTest = false): Promise<void> {
    if (!forceTest && this.prevAcConnected === acConnected) {
      return
    }

    let percent = this.cachedTelemetry?.battery?.percent ?? 100
    try {
      const batt = await si.battery().catch(() => null)
      if (batt && batt.percent > 0) {
        percent = batt.percent
      } else {
        const psRes = await runPowerShell(
          '(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).EstimatedChargeRemaining',
          1_500
        )
        const parsed = parseInt(psRes.stdout.trim(), 10)
        if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
          percent = parsed
        }
      }
    } catch {
      /* fallback */
    }

    if (acConnected === false) {
      this.prevAcConnected = false
      log.warn(`Queda de energia detectada (Modo No-Break Nativo)! Bateria estimada: ${percent}%`)

      await this.notifications.notify({
        severity: 'warning',
        category: 'power',
        title: 'Queda de Energia Elétrica - No-Break Nativo Ativado!',
        message: `Queda no fornecimento de energia elétrica detectada! O servidor agora está operando no modo No-Break nativo (bateria). Carga atual: ${percent}%.`,
        extraFacts: {
          Bateria: `${percent}%`,
          Status: 'Desconectado da rede elétrica',
          Modo: 'No-Break Nativo (Bateria)',
          Origem: forceTest ? 'Simulação de Teste Manual' : 'powerMonitor (Windows Kernel)'
        }
      })
    } else {
      this.prevAcConnected = true
      this.lastCriticalShutdownTriggered = false
      log.info(`Energia elétrica restabelecida! Bateria estimada: ${percent}%`)

      await this.notifications.notify({
        severity: 'success',
        category: 'power',
        title: 'Energia Elétrica Restabelecida',
        message: `O fornecimento elétrico foi restabelecido! A fonte de alimentação AC está conectada e a bateria está recarregando (${percent}%).`,
        extraFacts: {
          Bateria: `${percent}%`,
          Status: 'Conectado à tomada (AC)',
          Modo: 'Rede Elétrica Normal',
          Origem: forceTest ? 'Simulação de Teste Manual' : 'powerMonitor (Windows Kernel)'
        }
      })
    }
  }

  private async checkBattery(battery: BatteryInfo, settings: ReturnType<AppDatabase['getFullSettings']>): Promise<void> {
    if (!battery.hasBattery) return

    // Sincroniza transição via handlePowerEvent
    if (this.prevAcConnected !== battery.acConnected) {
      await this.handlePowerEvent(battery.acConnected)
    }

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

    // Se já foi testado e não é suportado pelo hardware, nunca executa PowerShell
    if (this.wmiTempSupported === false) {
      return null
    }

    const now = Date.now()
    // Se for suportado, consulta no máximo a cada 60s reutilizando o valor intermediário
    if (this.wmiTempSupported === true && now - this.lastTempCheckTs < 60_000) {
      return this.lastTempValue
    }

    // Teste inicial ou renovação a cada 60 segundos
    this.lastTempCheckTs = now
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
            this.wmiTempSupported = true
            this.lastTempValue = celsius
            return celsius
          }
        }
      }
    } catch {
      /* ignore */
    }

    // Se retornou vazio ou erro, desativa definitivamente o PowerShell de temperatura nesta sessão
    this.wmiTempSupported = false
    this.lastTempValue = null
    return null
  }

  private async checkApplications(settings: ReturnType<AppDatabase['getFullSettings']>): Promise<void> {
    if (!this.processManager) return

    const projects = this.db.listProjects().filter((p) => p.status === 'running')
    if (projects.length === 0) return

    const now = Date.now()
    const shouldCheckProcesses = now - this.lastProcessCheckTs >= 30_000 && projects.some((p) => p.pid)

    let procList: si.Systeminformation.ProcessesProcessData[] = []
    if (shouldCheckProcesses) {
      try {
        const procInfo = await si.processes()
        procList = procInfo.list || []
        this.lastProcessCheckTs = now
      } catch (err) {
        log.warn('Falha ao listar processos do sistema via systeminformation', err)
      }
    }

    const highCpuOverload = Boolean(this.cachedTelemetry && this.cachedTelemetry.cpu.loadPercent >= 88)
    if (highCpuOverload) {
      log.debug('Watchdog: Carga de CPU do host >= 88%. Healthchecks ignorados neste ciclo para evitar falsos positivos.')
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
        // Se a CPU do host estiver em sobrecarga (>= 88%), pula a contabilização de falhas de healthcheck
        if (highCpuOverload) {
          continue
        }

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
          const timeout = setTimeout(() => ctrl.abort(), 8_000)
          const res = await fetch(primaryUrl, { signal: ctrl.signal })
          clearTimeout(timeout)

          if (res.status >= 200 && res.status < 400) {
            ok = true
          } else if (res.status === 404 && configuredPath !== '/') {
            // Se a rota específica retornou 404, testa a raiz '/' como fallback
            const rootCtrl = new AbortController()
            const rootTimeout = setTimeout(() => rootCtrl.abort(), 8_000)
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
