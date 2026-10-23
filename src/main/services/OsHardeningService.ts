import si from 'systeminformation'
import { mkdirSync } from 'node:fs'
import { createLogger } from '../utils/logger'
import { runPrivileged, psQuote } from '../utils/shell'
import { generateStrongPassword } from '../utils/crypto'
import { workspaceLayout } from '../paths'
import type {
  HardeningOptions,
  HardeningReport,
  HardeningStep,
  NetworkPreview
} from '@shared/types'
import type { AppDatabase } from '../database'
import type { NotificationService } from './NotificationService'

const log = createLogger('os-hardening')

export class OsHardeningService {
  constructor(
    private db: AppDatabase,
    private notifications: NotificationService
  ) {}

  public async previewNetwork(): Promise<NetworkPreview | null> {
    try {
      const [ifaces, defaultGw] = await Promise.all([
        si.networkInterfaces(),
        si.networkGatewayDefault().catch(() => '')
      ])

      const active = Array.isArray(ifaces)
        ? ifaces.find((i) => i.ip4 && !i.internal && (i.operstate === 'up' || i.type === 'wireless' || i.type === 'wired')) ||
          ifaces.find((i) => i.ip4 && !i.internal) ||
          ifaces[0]
        : null

      if (!active) return null

      return {
        iface: active.iface,
        ip: active.ip4,
        mask: (active as any).ip4subnet || (active as any).netmask || '255.255.255.0',
        gateway: defaultGw || (active as any).defaultGateway || '192.168.1.1',
        dhcp: (active as any).dhcp ?? null,
        type: active.type || 'wired',
        dns: ['1.1.1.1', '8.8.8.8']
      }
    } catch (err) {
      log.error('Erro ao coletar preview de rede', err)
      return null
    }
  }

  public async runHardening(options: HardeningOptions): Promise<HardeningReport> {
    const startedAt = Date.now()
    const steps: HardeningStep[] = []
    log.info('Iniciando rotina de Hardening do Windows...', options)

    const settings = this.db.getFullSettings()
    const layout = workspaceLayout(settings.workspaceRoot)
    mkdirSync(layout.apps, { recursive: true })
    mkdirSync(layout.runtime, { recursive: true })
    mkdirSync(layout.logs, { recursive: true })

    // 1. Otimização de Energia (Powercfg)
    if (options.power) {
      const step: HardeningStep = { id: 'power', label: 'Blindagem de Energia e Suspensão (Powercfg)', status: 'ok', output: '' }
      try {
        const psScript = `
          # Ativa Alto Desempenho se disponível
          powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>&1 | Out-Null
          
          # Nunca suspender ou hibernar (AC e DC)
          powercfg /change standby-timeout-ac 0
          powercfg /change standby-timeout-dc 0
          powercfg /change monitor-timeout-ac 5
          powercfg /change disk-timeout-ac 0
          powercfg /hibernate off 2>&1 | Out-Null
          
          # Ignorar fechamento da tampa do notebook (LIDACTION = 0)
          powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
          powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
          
          # Força aplicação imediata no esquema ativo
          powercfg /setactive SCHEME_CURRENT
          Write-Output "Powercfg e tampa configurados com sucesso para modo Servidor 24/7."
        `
        const res = await runPrivileged(psScript)
        step.output = res.output.trim()
        if (res.exitCode !== 0) {
          step.status = 'failed'
          step.output += `\nErro: ${res.error}`
        }
      } catch (err) {
        step.status = 'failed'
        step.output = (err as Error).message
      }
      steps.push(step)
    } else {
      steps.push({ id: 'power', label: 'Blindagem de Energia', status: 'skipped', output: 'Opção não selecionada' })
    }

    // 2. Rede Local (IP Estático ou DHCP + DNS 1.1.1.1 / 8.8.8.8)
    if (options.staticIp) {
      const step: HardeningStep = { id: 'staticIp', label: options.dnsOnly ? 'Configuração de DNS Confiável (DHCP Mantido)' : 'Fixação de IP Local e DNS Confiável', status: 'ok', output: '' }
      try {
        const net = await this.previewNetwork()
        if (!net || !net.ip) {
          step.status = 'failed'
          step.output = 'Nenhuma interface de rede IPv4 ativa identificada.'
        } else {
          const psScript = options.dnsOnly
            ? `
              $iface = ${psQuote(net.iface)}
              # Mantém IP via DHCP e configura DNS 1.1.1.1 e 8.8.8.8
              netsh interface ip set address name=$iface dhcp 2>&1 | Out-Null
              netsh interface ip set dns name=$iface static 1.1.1.1
              netsh interface ip add dns name=$iface 8.8.8.8 index=2
              Write-Output "Interface '$iface' mantida com DHCP e configurada com DNS 1.1.1.1 e 8.8.8.8."
            `
            : `
              $iface = ${psQuote(net.iface)}
              $ip = ${psQuote(net.ip)}
              $mask = ${psQuote(net.mask)}
              $gw = ${psQuote(net.gateway || '192.168.1.1')}
              
              # Define IP Estático e Gateway
              netsh interface ip set address name=$iface static $ip $mask $gw 1
              # DNS Primário Cloudflare
              netsh interface ip set dns name=$iface static 1.1.1.1
              # DNS Secundário Google
              netsh interface ip add dns name=$iface 8.8.8.8 index=2
              Write-Output "Interface '$iface' fixada no IP $ip com DNS 1.1.1.1 e 8.8.8.8."
            `
          const res = await runPrivileged(psScript)
          step.output = res.output.trim()
          if (res.exitCode !== 0) {
            step.status = 'failed'
            step.output += `\nErro: ${res.error}`
          }
        }
      } catch (err) {
        step.status = 'failed'
        step.output = (err as Error).message
      }
      steps.push(step)
    } else {
      steps.push({ id: 'staticIp', label: 'Fixação de IP Local', status: 'skipped', output: 'Opção não selecionada' })
    }

    // 3. Regras de Firewall (TCP 80 e 443)
    if (options.firewall) {
      const step: HardeningStep = { id: 'firewall', label: 'Liberação de Portas HTTP/HTTPS no Firewall do Windows', status: 'ok', output: '' }
      try {
        const psScript = `
          # Remove regra anterior se existir para evitar duplicidade
          netsh advfirewall firewall delete rule name="HomeServer HTTP/HTTPS" protocol=TCP localport=80,443 2>&1 | Out-Null
          # Adiciona regra de entrada permitindo 80 e 443
          netsh advfirewall firewall add rule name="HomeServer HTTP/HTTPS" dir=in action=allow protocol=TCP localport=80,443
          Write-Output "Regra de Firewall 'HomeServer HTTP/HTTPS' (TCP 80, 443) criada com sucesso."
        `
        const res = await runPrivileged(psScript)
        step.output = res.output.trim()
        if (res.exitCode !== 0) {
          step.status = 'failed'
          step.output += `\nErro: ${res.error}`
        }
      } catch (err) {
        step.status = 'failed'
        step.output = (err as Error).message
      }
      steps.push(step)
    } else {
      steps.push({ id: 'firewall', label: 'Regras de Firewall', status: 'skipped', output: 'Opção não selecionada' })
    }

    // 4. Isolamento de Privilégios (Usuário Restrito AppServerRunner + ACLs via SID Universal)
    if (options.restrictedUser) {
      const step: HardeningStep = { id: 'restrictedUser', label: 'Criação do Usuário Restrito AppServerRunner e ACLs', status: 'ok', output: '' }
      try {
        const strongPass = generateStrongPassword(30)
        const appsDir = layout.root

        const psScript = `
          $userName = "AppServerRunner"
          $password = ${psQuote(strongPass)}
          $rootPath = ${psQuote(appsDir)}
          $logs = @()

          # Sub-etapa A: Criação ou atualização da conta
          try {
            $existing = Get-LocalUser -Name $userName -ErrorAction SilentlyContinue
            if (-not $existing) {
              net user $userName $password /add /expires:never /passwordchg:no /comment:"Conta de servico restrita do HomeServer" /Y 2>&1 | Out-Null
              $logs += "Conta '$userName' criada com sucesso."
            } else {
              net user $userName $password /Y 2>&1 | Out-Null
              $logs += "Senha da conta '$userName' atualizada."
            }
          } catch {
            $logs += "Aviso na conta: $($_.Exception.Message)"
          }

          # Sub-etapa B: Associação ao grupo universal de Usuários (SID S-1-5-32-545)
          try {
            $usersGroup = Get-LocalGroup | Where-Object { $_.SID.Value -eq "S-1-5-32-545" } | Select-Object -First 1
            if ($usersGroup) {
              Add-LocalGroupMember -Group $usersGroup.Name -Member $userName -ErrorAction SilentlyContinue 2>&1 | Out-Null
              $logs += "Vinculado ao grupo '$($usersGroup.Name)' (SID S-1-5-32-545)."
            }
          } catch {
            $logs += "Aviso no grupo de usuários: $($_.Exception.Message)"
          }

          # Sub-etapa C: Remoção de Administradores (SID S-1-5-32-544)
          try {
            $adminGroup = Get-LocalGroup | Where-Object { $_.SID.Value -eq "S-1-5-32-544" } | Select-Object -First 1
            if ($adminGroup) {
              Remove-LocalGroupMember -Group $adminGroup.Name -Member $userName -ErrorAction SilentlyContinue 2>&1 | Out-Null
            }
          } catch {}

          # Sub-etapa D: Permissões de pasta exclusivas via icacls
          try {
            icacls $rootPath /grant "\${userName}:(OI)(CI)F" /T /C /Q 2>&1 | Out-Null
            $logs += "Permissoes concedidas em '$rootPath'."
          } catch {
            $logs += "Aviso no icacls: $($_.Exception.Message)"
          }

          $logs -join [Environment]::NewLine
        `
        const res = await runPrivileged(psScript)
        step.output = res.output.trim()
        if (res.exitCode !== 0) {
          step.status = 'failed'
          step.output += `\nErro: ${res.error}`
        } else {
          this.db.setSecret('runner_password', strongPass)
          this.db.setSetting('hardening_runnerConfigured', true)
        }
      } catch (err) {
        step.status = 'failed'
        step.output = (err as Error).message
      }
      steps.push(step)
    } else {
      steps.push({ id: 'restrictedUser', label: 'Isolamento de Privilégios', status: 'skipped', output: 'Opção não selecionada' })
    }

    const finishedAt = Date.now()
    const allOk = steps.filter((s) => s.status === 'failed').length === 0
    this.db.setSetting('hardening_lastRunAt', finishedAt)

    await this.notifications.notify({
      severity: allOk ? 'success' : 'warning',
      category: 'system',
      title: allOk ? 'Otimização de Servidor Concluída' : 'Hardening Concluído com Avisos',
      message: allOk
        ? 'As configurações de energia, rede, firewall e isolamento foram aplicadas com sucesso.'
        : 'Algumas etapas de hardening reportaram avisos ou falhas. Verifique o relatório no painel.',
      extraFacts: {
        Resultado: allOk ? 'Sucesso Total' : 'Com Falhas',
        Duração: `${Math.round((finishedAt - startedAt) / 1000)}s`
      }
    })

    return {
      startedAt,
      finishedAt,
      elevated: true,
      steps
    }
  }
}
