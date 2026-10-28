import { Resolver, lookup } from 'node:dns/promises'
import { networkInterfaces } from 'node:os'
import { createLogger } from '../utils/logger'
import { runPrivileged, psQuote } from '../utils/shell'
import {
  normalizeHostname,
  isValidHostname,
  extractRootDomain,
  relativeLabel,
  REGISTRAR_META
} from '@shared/domains'
import type {
  DomainRecord,
  DomainInput,
  DomainSubdomain,
  DomainDnsInstructions,
  DnsRecordInstruction,
  NetworkEndpoints,
  DnsHostCheck,
  DnsDiagnosticStep,
  DomainDnsVerification,
  DomainSslStatus,
  HostsApplyResult,
  CloudflareAutoDnsResult,
  Project
} from '@shared/types'
import type { AppDatabase } from '../database'
import type { CaddyProxyService } from './CaddyProxyService'

const log = createLogger('domains')

const ENDPOINTS_TTL_MS = 5 * 60_000
const ENDPOINTS_FAIL_TTL_MS = 30_000
const PUBLIC_DNS_SERVERS = ['1.1.1.1', '8.8.8.8']

interface RoutedHost {
  label: string
  hostname: string
  projectId: string | null
  targetPort: number | null
}

const genId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function describeFetchError(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } }
  if (e?.name === 'AbortError') return 'Tempo esgotado (5s) sem resposta'
  const code = e?.cause?.code
  if (code === 'ENOTFOUND') return 'DNS não resolve (ENOTFOUND)'
  if (code === 'ECONNREFUSED') return 'Conexão recusada (porta fechada)'
  if (code === 'ECONNRESET') return 'Conexão reiniciada pelo servidor'
  if (code && /CERT|SSL|TLS|SELF_SIGNED/i.test(code)) return `Certificado SSL inválido (${code})`
  return e?.cause?.message || e?.message || String(err)
}

function detectNsProvider(ns: string[]): string | null {
  const joined = ns.join(' ').toLowerCase()
  if (!joined) return null
  if (joined.includes('cloudflare.com')) return 'Cloudflare'
  if (joined.includes('.dns.br')) return 'Registro.br'
  if (joined.includes('domaincontrol.com')) return 'GoDaddy'
  if (joined.includes('dns-parking.com') || joined.includes('hostinger')) return 'Hostinger'
  if (joined.includes('registrar-servers.com')) return 'Namecheap'
  if (joined.includes('awsdns')) return 'AWS Route 53'
  if (joined.includes('googledomains') || joined.includes('google')) return 'Google Cloud DNS'
  if (joined.includes('azure-dns')) return 'Azure DNS'
  if (joined.includes('locaweb')) return 'Locaweb'
  if (joined.includes('hostgator')) return 'HostGator'
  if (joined.includes('umbler')) return 'Umbler'
  return ns[0] ?? null
}

export class DomainService {
  private caddyProxy: CaddyProxyService | null = null
  private endpointsCache: { publicIp: string | null; lanIp: string | null; ts: number; ttl: number } | null = null
  private endpointsInFlight: Promise<{ publicIp: string | null; lanIp: string | null }> | null = null

  constructor(private db: AppDatabase) {}

  public setCaddyProxy(caddy: CaddyProxyService): void {
    this.caddyProxy = caddy
  }

  // =========================================================================
  // Listagem / CRUD
  // =========================================================================
  public async list(): Promise<DomainRecord[]> {
    const endpoints = await this.getNetworkEndpoints()
    const projects = this.db.listProjects()
    return this.db.listDomains().map((d) => ({ ...d, instructions: this.buildInstructions(d, endpoints, projects) }))
  }

  public async save(input: DomainInput): Promise<DomainRecord> {
    const domain = normalizeHostname(input.domain)
    if (!isValidHostname(domain)) {
      throw new Error(`Domínio inválido: "${input.domain}". Use o formato minhaempresa.com.br (sem http:// ou barras).`)
    }

    const prev = input.id ? this.db.getDomain(input.id) : null
    if (input.id && !prev) throw new Error('Domínio não encontrado para edição')

    const sameName = this.db.getDomainByName(domain)
    if (sameName && sameName.id !== input.id) {
      throw new Error(`O domínio ${domain} já está cadastrado na Central de Domínios.`)
    }

    const projects = this.db.listProjects()
    const projectExists = (id: string | null | undefined) => !id || projects.some((p) => p.id === id)
    const targetProjectId = input.targetProjectId || null
    if (!projectExists(targetProjectId)) throw new Error('Projeto vinculado ao domínio raiz não existe mais')

    const subdomains = this.normalizeSubdomains(domain, input.subdomains, !!targetProjectId, prev?.subdomains ?? [])
    for (const s of subdomains) {
      if (!projectExists(s.projectId)) throw new Error(`Projeto vinculado a ${s.fullHostname} não existe mais`)
    }

    const settings = this.db.getFullSettings()
    const now = Date.now()
    const hostSignature = (d: { domain: string; connectionMode: string; targetProjectId: string | null; subdomains: DomainSubdomain[] }) =>
      [d.domain, d.connectionMode, d.targetProjectId ? 'root' : '', ...d.subdomains.map((s) => s.fullHostname).sort()].join('|')

    const isTunnel = input.connectionMode === 'cloudflare_tunnel'
    const tunnelId = isTunnel ? settings.tunnel.tunnelId ?? prev?.cfTunnelId ?? null : prev?.cfTunnelId ?? null

    const record: DomainRecord = {
      id: prev?.id ?? genId('dom'),
      domain,
      registrar: input.registrar,
      connectionMode: input.connectionMode,
      targetProjectId,
      subdomains,
      cfZoneId: prev && prev.domain === domain ? prev.cfZoneId : null,
      cfTunnelId: tunnelId,
      cfTunnelCname: tunnelId ? `${tunnelId}.cfargotunnel.com` : null,
      dnsVerified: false,
      sslStatus: 'pending',
      lastCheckedAt: null,
      notes: input.notes?.trim() || null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now
    }

    // Mantém o status de verificação se nenhum hostname/modo mudou
    if (prev && hostSignature(prev) === hostSignature(record)) {
      record.dnsVerified = prev.dnsVerified
      record.sslStatus = prev.sslStatus
      record.lastCheckedAt = prev.lastCheckedAt
    }

    this.db.transaction(() => {
      this.db.upsertDomain(record)
      if (prev && prev.domain !== domain) this.stripDomainFromProjects(prev.domain)
      this.applyDomainToProjects(record)
    })

    log.info(`Domínio ${domain} salvo (${record.connectionMode}, ${record.subdomains.length} subdomínio(s))`)
    await this.syncCaddy()

    const endpoints = await this.getNetworkEndpoints()
    return { ...record, instructions: this.buildInstructions(record, endpoints, this.db.listProjects()) }
  }

  public async delete(id: string): Promise<void> {
    const d = this.db.getDomain(id)
    if (!d) return
    this.db.transaction(() => {
      this.stripDomainFromProjects(d.domain)
      this.db.deleteDomain(id)
    })
    log.info(`Domínio ${d.domain} removido da Central de Domínios`)
    await this.syncCaddy()
  }

  private normalizeSubdomains(
    domain: string,
    raw: DomainInput['subdomains'],
    rootLinked: boolean,
    previous: DomainSubdomain[]
  ): DomainSubdomain[] {
    const out: DomainSubdomain[] = []
    const seen = new Set<string>()
    for (const s of raw ?? []) {
      let label = normalizeHostname(s.subdomain)
      if (!label || label === '@' || label === domain) continue
      if (label.endsWith(`.${domain}`)) label = label.slice(0, -(domain.length + 1))
      // www é gerenciado automaticamente quando o domínio raiz está vinculado
      if (label === 'www' && rootLinked) continue
      const full = `${label}.${domain}`
      if (!isValidHostname(full)) throw new Error(`Subdomínio inválido: "${s.subdomain}"`)
      if (seen.has(full)) continue
      seen.add(full)
      const port = s.targetPort ? Number(s.targetPort) : null
      if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        throw new Error(`Porta inválida para ${full}: ${s.targetPort}`)
      }
      out.push({
        id: s.id || previous.find((p) => p.fullHostname === full)?.id || genId('sub'),
        subdomain: label,
        fullHostname: full,
        projectId: s.projectId || null,
        targetPort: port
      })
    }
    return out
  }

  // =========================================================================
  // Sincronização bidirecional domains <-> projects.domains
  // =========================================================================
  private allRoots(): string[] {
    return this.db.listDomains().map((d) => d.domain)
  }

  /** Hostnames que um registro de domínio atribui a cada projeto. */
  private hostnamesByProject(d: DomainRecord): Map<string, string[]> {
    const map = new Map<string, string[]>()
    const push = (pid: string, h: string) => map.set(pid, [...(map.get(pid) ?? []), h])
    if (d.targetProjectId) {
      push(d.targetProjectId, d.domain)
      push(d.targetProjectId, `www.${d.domain}`)
    }
    for (const s of d.subdomains) if (s.projectId) push(s.projectId, s.fullHostname)
    return map
  }

  /** O registro de domínio é a fonte da verdade para todos os hostnames sob a sua raiz. */
  private applyDomainToProjects(d: DomainRecord): void {
    const roots = this.allRoots()
    const mapping = this.hostnamesByProject(d)
    for (const p of this.db.listProjects()) {
      const kept = p.domains.filter((h) => extractRootDomain(h, roots) !== d.domain)
      const next = Array.from(new Set([...kept, ...(mapping.get(p.id) ?? [])]))
      if (next.length !== p.domains.length || next.some((h, i) => h !== p.domains[i])) {
        this.db.updateProject(p.id, { domains: next })
      }
    }
  }

  private stripDomainFromProjects(root: string): void {
    const roots = Array.from(new Set([...this.allRoots(), root]))
    for (const p of this.db.listProjects()) {
      const next = p.domains.filter((h) => extractRootDomain(h, roots) !== root)
      if (next.length !== p.domains.length) this.db.updateProject(p.id, { domains: next })
    }
  }

  /**
   * Chamado após criar/editar um projeto: reflete `project.domains` na tabela `domains`
   * (auto-cadastrando domínios raiz desconhecidos) e re-sincroniza o Caddy.
   */
  public async syncFromProject(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId)
    if (!project) return

    const hosts = Array.from(new Set(project.domains.map(normalizeHostname).filter(isValidHostname)))
    let changed = false

    this.db.transaction(() => {
      const domains = this.db.listDomains()
      const roots = domains.map((d) => d.domain)
      const settings = this.db.getFullSettings()
      const now = Date.now()

      // 1. Auto-cadastra domínios raiz ainda desconhecidos
      for (const h of hosts) {
        const root = extractRootDomain(h, roots)
        if (roots.includes(root)) continue
        const local = /\.(localhost|local|lan|home|internal|intranet|test|corp)$/.test(root) || root === 'localhost'
        const tunnelId = !local ? settings.tunnel.tunnelId : null
        const rec: DomainRecord = {
          id: genId('dom'),
          domain: root,
          registrar: root.endsWith('.br') ? 'registrobr' : 'other',
          connectionMode: local ? 'lan_only' : 'cloudflare_tunnel',
          targetProjectId: null,
          subdomains: [],
          cfZoneId: null,
          cfTunnelId: tunnelId,
          cfTunnelCname: tunnelId ? `${tunnelId}.cfargotunnel.com` : null,
          dnsVerified: false,
          sslStatus: 'pending',
          lastCheckedAt: null,
          notes: `Cadastrado automaticamente a partir do projeto "${project.name}"`,
          createdAt: now,
          updatedAt: now
        }
        this.db.upsertDomain(rec)
        domains.push(rec)
        roots.push(root)
        log.info(`Domínio ${root} auto-cadastrado a partir do projeto ${project.name}`)
      }

      // 2. Atualiza vínculos de cada domínio com este projeto
      for (const d of domains) {
        const projHosts = hosts.filter((h) => extractRootDomain(h, roots) === d.domain)
        const wantsRoot = projHosts.includes(d.domain) || projHosts.includes(`www.${d.domain}`)
        let target = d.targetProjectId
        if (wantsRoot) target = project.id
        else if (target === project.id) target = null

        let subs = d.subdomains.map((s) => ({ ...s }))
        for (const h of projHosts) {
          if (h === d.domain || (h === `www.${d.domain}` && target)) continue
          const existing = subs.find((s) => s.fullHostname === h)
          if (existing) existing.projectId = project.id
          else subs.push({ id: genId('sub'), subdomain: relativeLabel(h, d.domain), fullHostname: h, projectId: project.id, targetPort: null })
        }
        // Subdomínios que saíram do projeto: desvincula mantendo o registro na Central de Domínios
        subs = subs
          .map((s) => (s.projectId === project.id && !projHosts.includes(s.fullHostname) ? { ...s, projectId: null } : s))
          .filter((s) => !(target && s.subdomain === 'www'))

        const subsChanged = JSON.stringify(subs) !== JSON.stringify(d.subdomains)
        if (target !== d.targetProjectId || subsChanged) {
          const updated: DomainRecord = { ...d, targetProjectId: target, subdomains: subs }
          this.db.updateDomainFields(d.id, { targetProjectId: target, subdomains: subs })
          // Reprojeta nos projetos (inclui www.<raiz> automaticamente e retira hostnames movidos)
          this.applyDomainToProjects(updated)
          changed = true
        }
      }
    })

    if (changed) await this.syncCaddy()
  }

  /** Remove vínculos de um projeto excluído. */
  public async unlinkProject(projectId: string): Promise<void> {
    let changed = false
    for (const d of this.db.listDomains()) {
      const target = d.targetProjectId === projectId ? null : d.targetProjectId
      const subs = d.subdomains
        .map((s) => (s.projectId === projectId ? { ...s, projectId: null } : s))
        .filter((s) => s.projectId || s.targetPort)
      if (target !== d.targetProjectId || subs.length !== d.subdomains.length || subs.some((s, i) => s.projectId !== d.subdomains[i].projectId)) {
        this.db.updateDomainFields(d.id, { targetProjectId: target, subdomains: subs })
        changed = true
      }
    }
    if (changed) await this.syncCaddy()
  }

  private async syncCaddy(): Promise<void> {
    if (!this.caddyProxy) return
    await this.caddyProxy.syncRoutes().catch((err) => log.warn('Falha ao sincronizar Caddy após mudança de domínios', err))
  }

  // =========================================================================
  // Descoberta de IP Público / LAN
  // =========================================================================
  public async getNetworkEndpoints(force = false): Promise<NetworkEndpoints> {
    const settings = this.db.getFullSettings()
    const now = Date.now()
    let publicIp: string | null
    let lanIp: string | null

    if (!force && this.endpointsCache && now - this.endpointsCache.ts < this.endpointsCache.ttl) {
      publicIp = this.endpointsCache.publicIp
      lanIp = this.endpointsCache.lanIp
    } else {
      if (!this.endpointsInFlight) {
        this.endpointsInFlight = (async () => {
          const ip = await this.fetchPublicIp()
          const lan = this.detectLanIp()
          this.endpointsCache = { publicIp: ip, lanIp: lan, ts: Date.now(), ttl: ip ? ENDPOINTS_TTL_MS : ENDPOINTS_FAIL_TTL_MS }
          return { publicIp: ip, lanIp: lan }
        })().finally(() => {
          this.endpointsInFlight = null
        })
      }
      const res = await this.endpointsInFlight
      publicIp = res.publicIp
      lanIp = res.lanIp
    }

    return {
      publicIp,
      lanIp,
      caddyHttpPort: settings.caddyHttpPort || 80,
      tunnelId: settings.tunnel.tunnelId,
      tunnelCname: settings.tunnel.tunnelCname,
      fetchedAt: this.endpointsCache?.ts ?? now
    }
  }

  private async fetchPublicIp(): Promise<string | null> {
    const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/
    try {
      const res = await fetchWithTimeout('https://api4.ipify.org?format=json', {}, 4_000)
      const json = (await res.json()) as { ip?: string }
      if (json.ip && ipv4.test(json.ip)) return json.ip
    } catch (err) {
      log.debug(`ipify indisponível: ${describeFetchError(err)}`)
    }
    try {
      const res = await fetchWithTimeout('https://ifconfig.me/ip', { headers: { 'User-Agent': 'curl/8.0' } }, 4_000)
      const text = (await res.text()).trim()
      if (ipv4.test(text)) return text
    } catch (err) {
      log.debug(`ifconfig.me indisponível: ${describeFetchError(err)}`)
    }
    log.warn('Não foi possível descobrir o IP público (sem internet ou serviços bloqueados)')
    return null
  }

  private detectLanIp(): string | null {
    const candidates: Array<{ ip: string; score: number }> = []
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue
        let score = 0
        if (/^192\.168\./.test(a.address)) score += 3
        else if (/^10\./.test(a.address)) score += 2
        else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 1
        if (/vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier/i.test(name)) score -= 5
        candidates.push({ ip: a.address, score })
      }
    }
    candidates.sort((a, b) => b.score - a.score)
    return candidates[0]?.ip ?? null
  }

  // =========================================================================
  // Hostnames roteados
  // =========================================================================
  private routedHosts(d: DomainRecord, includeAll = false): RoutedHost[] {
    const list: RoutedHost[] = []
    if (d.targetProjectId || includeAll) {
      list.push({ label: '@', hostname: d.domain, projectId: d.targetProjectId, targetPort: null })
      if (!d.subdomains.some((s) => s.subdomain === 'www')) {
        list.push({ label: 'www', hostname: `www.${d.domain}`, projectId: d.targetProjectId, targetPort: null })
      }
    }
    for (const s of d.subdomains) {
      if (s.projectId || s.targetPort || includeAll) {
        list.push({ label: s.subdomain, hostname: s.fullHostname, projectId: s.projectId, targetPort: s.targetPort })
      }
    }
    if (list.length === 0) list.push({ label: '@', hostname: d.domain, projectId: null, targetPort: null })
    return list
  }

  // =========================================================================
  // Instruções DNS sob medida por provedor
  // =========================================================================
  public buildInstructions(d: DomainRecord, endpoints: NetworkEndpoints, projects: Project[]): DomainDnsInstructions {
    const meta = REGISTRAR_META[d.registrar]
    const hosts = this.routedHosts(d, d.connectionMode === 'lan_only')
    const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? null : null)
    const service = `http://127.0.0.1:${endpoints.caddyHttpPort}`
    const warnings: string[] = []
    const steps: string[] = []
    let records: DnsRecordInstruction[] = []
    let hostsLine: string | null = null

    if (!d.targetProjectId && !d.subdomains.some((s) => s.projectId || s.targetPort)) {
      warnings.push('Nenhum projeto vinculado ainda: edite o domínio e vincule o @ ou um subdomínio (api, app...) a um projeto.')
    }

    if (d.connectionMode === 'cloudflare_tunnel') {
      const cname = d.cfTunnelCname || endpoints.tunnelCname
      const value = cname ?? '<ID-DO-TÚNEL>.cfargotunnel.com'
      records = hosts.map((h) => ({
        type: 'CNAME',
        host: h.label,
        hostname: h.hostname,
        value,
        ttl: 'Auto',
        proxied: true,
        note: h.label === '@' ? 'Na Cloudflare o CNAME no @ é permitido (CNAME Flattening)' : undefined
      }))

      if (!cname) {
        warnings.push('Cole o Token do Named Tunnel no card "Named Tunnel" abaixo: o CNAME <tunnelId>.cfargotunnel.com será preenchido automaticamente.')
      }
      if (d.registrar !== 'cloudflare') {
        warnings.push(
          `O Cloudflare Tunnel exige que o DNS do domínio esteja hospedado na Cloudflare (plano Free). Um CNAME para *.cfargotunnel.com criado direto no painel da ${meta.label} NÃO funciona — por isso o passo de troca de nameservers é obrigatório.`
        )
        steps.push(
          'Crie uma conta gratuita em dash.cloudflare.com → clique em "Adicionar domínio" (Add a site) → digite ' +
            d.domain +
            ' → escolha o plano Free.',
          'A Cloudflare exibirá 2 nameservers (ex: ana.ns.cloudflare.com e bob.ns.cloudflare.com). Copie-os.'
        )
        steps.push(...this.nameserverSteps(d))
      } else {
        steps.push(`O domínio já está na Cloudflare ✓ — nenhuma troca de nameservers é necessária.`)
      }
      steps.push(
        `No painel Zero Trust (one.dash.cloudflare.com) → Networks → Tunnels → seu túnel → aba "Public Hostname" → adicione cada hostname da tabela "Public Hostnames" apontando para ${service}. A Cloudflare cria os registros CNAME automaticamente.`,
        `Alternativa manual: em dash.cloudflare.com → ${d.domain} → DNS → Records, crie os registros CNAME abaixo com a nuvem laranja (Proxied) ativada.`,
        'Ou use o botão "⚡ Configurar DNS na Cloudflare (1-Clique)" informando um API Token com as permissões Zone:DNS:Edit e Account:Cloudflare Tunnel:Edit.',
        `O Caddy local na porta ${endpoints.caddyHttpPort} recebe o tráfego do túnel e entrega cada hostname ao projeto correto — HTTPS é feito pela borda da Cloudflare.`
      )
    } else if (d.connectionMode === 'direct_dns') {
      const ip = endpoints.publicIp ?? '<SEU_IP_PÚBLICO>'
      records = hosts.map((h) =>
        h.label === '@'
          ? { type: 'A', host: '@', hostname: h.hostname, value: ip, ttl: '3600 (1 hora)' }
          : { type: 'CNAME', host: h.label, hostname: h.hostname, value: d.domain, ttl: '3600 (1 hora)' }
      )
      if (!hosts.some((h) => h.label === '@')) {
        records.unshift({ type: 'A', host: '@', hostname: d.domain, value: ip, ttl: '3600 (1 hora)', note: 'Necessário para os CNAMEs abaixo resolverem' })
      }
      steps.push(...this.directDnsSteps(d))
      steps.push(
        `No roteador (geralmente http://192.168.0.1 ou 192.168.1.1) → "Encaminhamento de Portas / Virtual Server / NAT" → encaminhe TCP 80 e TCP 443 para ${endpoints.lanIp ?? 'o IP local deste PC'}.`,
        'Libere as portas 80 e 443 no Firewall do Windows (o assistente de Hardening do MyServer já faz isso).',
        'Aguarde a propagação (5 min a 4 h) e clique em "🔍 Verificar DNS & HTTPS Agora". O Caddy emitirá o certificado Let\'s Encrypt automaticamente.'
      )
      if (!endpoints.publicIp) warnings.push('Não foi possível descobrir seu IP público agora (sem internet?). Clique em "Atualizar IP" mais tarde.')
      warnings.push(
        'Se o IP WAN mostrado no roteador for diferente do IP público acima (ou começar com 100.64–100.127), sua operadora usa CGNAT: o DNS direto não funcionará — use o modo Túnel Cloudflare.',
        'IPs residenciais costumam mudar: considere IP fixo com a operadora ou o modo Túnel Cloudflare (não depende de IP).'
      )
    } else {
      const names = hosts.map((h) => h.hostname)
      hostsLine = `127.0.0.1 ${names.join(' ')}`
      records = hosts.map((h) => ({ type: 'HOSTS', host: h.label, hostname: h.hostname, value: '127.0.0.1', ttl: '—' }))
      steps.push(
        'Clique em "⚡ Ativar no Windows Hosts (1-Clique)": o MyServer adiciona as entradas em C:\\Windows\\System32\\drivers\\etc\\hosts (pede permissão de Administrador uma única vez).',
        `Abra http://${d.domain}${endpoints.caddyHttpPort !== 80 ? `:${endpoints.caddyHttpPort}` : ''} no navegador deste PC — funciona na hora, sem internet.`,
        `Para outros dispositivos da rede (celular, outro PC): adicione "${endpoints.lanIp ?? '<IP-DESTE-PC>'} ${names.join(' ')}" no arquivo hosts deles ou crie a entrada no DNS local do roteador.`
      )
      if (d.domain.endsWith('.local')) {
        warnings.push('Domínios .local podem conflitar com mDNS/Bonjour em macOS/iOS. Prefira .localhost ou .lan para máxima compatibilidade.')
      }
    }

    return {
      mode: d.connectionMode,
      registrarLabel: meta.label,
      panelUrl: meta.panelUrl,
      steps,
      records,
      tunnelIngress:
        d.connectionMode === 'cloudflare_tunnel'
          ? hosts.map((h) => ({ hostname: h.hostname, service, projectName: projectName(h.projectId) ?? (h.targetPort ? `Porta :${h.targetPort}` : null) }))
          : [],
      hostsLine,
      warnings
    }
  }

  private nameserverSteps(d: DomainRecord): string[] {
    switch (d.registrar) {
      case 'registrobr':
        return [
          'Acesse registro.br/painel → faça login → clique no domínio ' + d.domain + '.',
          'Na seção "DNS", clique em "Alterar servidores DNS" → cole os 2 nameservers da Cloudflare em "Servidor 1" e "Servidor 2" → "Salvar dados".',
          'Domínios .br costumam propagar entre 5 minutos e 2 horas. A Cloudflare enviará um e-mail quando o site estiver "Active".'
        ]
      case 'godaddy':
        return [
          'Acesse dcc.godaddy.com → "Meus Produtos" → ao lado do domínio clique em "DNS".',
          'Aba "Servidores de nomes" → "Alterar servidores de nomes" → "Usarei meus próprios servidores de nomes" → cole os 2 nameservers da Cloudflare → Salvar.',
          'A GoDaddy pode exibir um aviso de que os registros DNS deixarão de funcionar nela — confirme (o DNS passa a ser gerenciado pela Cloudflare).'
        ]
      case 'hostinger':
        return [
          'Acesse hpanel.hostinger.com → "Domínios" → clique em "Gerenciar" no domínio.',
          'Menu lateral "DNS / Nameservers" → aba "Nameservers" → "Alterar nameservers" → "Alterar nameservers" (personalizados) → cole os 2 da Cloudflare → Salvar.'
        ]
      case 'namecheap':
        return [
          'Acesse namecheap.com → "Domain List" → "Manage" no domínio.',
          'Em "Nameservers" selecione "Custom DNS" → cole os 2 nameservers da Cloudflare → clique no ✓ verde para salvar.'
        ]
      default:
        return ['No painel da empresa onde você comprou o domínio, procure "Nameservers" / "Servidores DNS" e substitua pelos 2 nameservers da Cloudflare.']
    }
  }

  private directDnsSteps(d: DomainRecord): string[] {
    switch (d.registrar) {
      case 'registrobr':
        return [
          'Acesse registro.br/painel → clique no domínio ' + d.domain + '.',
          'Na seção "DNS", se aparecer "Utilizar DNS do Registro.br", clique para ativar. Depois clique em "Editar zona" → "Nova entrada".',
          'Crie cada registro da tabela abaixo (Tipo, Nome e Dados) e clique em "Salvar alterações".'
        ]
      case 'godaddy':
        return [
          'Acesse dcc.godaddy.com → "Meus Produtos" → "DNS" ao lado do domínio.',
          'Se já existir um registro A "@" apontando para "Parked", edite-o. Clique em "Adicionar novo registro" para os demais da tabela.'
        ]
      case 'hostinger':
        return [
          'Acesse hpanel.hostinger.com → "Domínios" → "Gerenciar" → "DNS / Nameservers" → "Registros DNS".',
          'Apague registros A/CNAME antigos de "@" e "www" que apontem para a hospedagem da Hostinger e adicione os registros da tabela.'
        ]
      case 'namecheap':
        return [
          'Acesse namecheap.com → "Domain List" → "Manage" → aba "Advanced DNS".',
          'Remova o "URL Redirect Record" e o "CNAME parkingpage" padrão e clique em "Add New Record" para cada linha da tabela.'
        ]
      case 'cloudflare':
        return [
          'Acesse dash.cloudflare.com → ' + d.domain + ' → DNS → Records → "Add record".',
          'Use a nuvem CINZA (DNS only) para o Caddy emitir o certificado Let\'s Encrypt diretamente — ou laranja se preferir o proxy da Cloudflare (SSL/TLS em modo "Full").'
        ]
      default:
        return ['No painel DNS do seu provedor, crie os registros da tabela abaixo.']
    }
  }

  // =========================================================================
  // Verificação DNS + HTTPS em tempo real
  // =========================================================================
  public async verifyDomainDns(id: string): Promise<DomainDnsVerification> {
    const d = this.db.getDomain(id)
    if (!d) throw new Error('Domínio não encontrado')
    const endpoints = await this.getNetworkEndpoints()
    const result =
      d.connectionMode === 'lan_only' ? await this.verifyLocal(d, endpoints) : await this.verifyPublic(d, endpoints)

    this.db.updateDomainFields(d.id, {
      dnsVerified: result.dnsVerified,
      sslStatus: result.sslStatus,
      lastCheckedAt: result.checkedAt
    })
    log.info(`Verificação DNS de ${d.domain}: dns=${result.dnsVerified} ssl=${result.sslStatus} — ${result.diagnosticMessage}`)
    return result
  }

  private async verifyPublic(d: DomainRecord, endpoints: NetworkEndpoints): Promise<DomainDnsVerification> {
    const resolver = new Resolver({ timeout: 4_000, tries: 2 })
    resolver.setServers(PUBLIC_DNS_SERVERS)

    const hostnames = Array.from(new Set([d.domain, ...this.routedHosts(d).map((h) => h.hostname)]))
    const nsRecords = await resolver.resolveNs(d.domain).catch(() => [] as string[])
    const isCloudflareNs = nsRecords.some((n) => n.toLowerCase().endsWith('.ns.cloudflare.com'))
    const nsProvider = detectNsProvider(nsRecords)
    const routed = new Set(this.routedHosts(d).map((h) => h.hostname))

    const checks: DnsHostCheck[] = await Promise.all(
      hostnames.map(async (hostname) => {
        const [aRecords, cnameRecords] = await Promise.all([
          resolver.resolve4(hostname).catch(() => [] as string[]),
          resolver.resolveCname(hostname).catch(() => [] as string[])
        ])
        const resolved = aRecords.length > 0 || cnameRecords.length > 0
        let pointsToExpected = false
        if (d.connectionMode === 'cloudflare_tunnel') {
          pointsToExpected = cnameRecords.some((c) => c.toLowerCase().endsWith('.cfargotunnel.com')) || (isCloudflareNs && aRecords.length > 0)
        } else {
          pointsToExpected =
            (!!endpoints.publicIp && aRecords.includes(endpoints.publicIp)) ||
            cnameRecords.some((c) => normalizeHostname(c) === d.domain)
        }

        let httpsReachable = false
        let httpStatus: number | null = null
        let error: string | null = null
        if (resolved) {
          try {
            const res = await fetchWithTimeout(`https://${hostname}/`, { method: 'HEAD', redirect: 'manual' }, 5_000)
            httpsReachable = true
            httpStatus = res.status
          } catch (err) {
            error = describeFetchError(err)
          }
        } else {
          error = 'Nenhum registro A/CNAME encontrado'
        }
        return { hostname, aRecords, cnameRecords, resolved, pointsToExpected, httpsReachable, httpStatus, error }
      })
    )

    // Somente hostnames efetivamente roteados contam para o veredito (o @ sem projeto é informativo)
    const relevant = checks.filter((c) => routed.has(c.hostname))
    const evaluated = relevant.length > 0 ? relevant : checks
    const dnsVerified = evaluated.every((c) => c.pointsToExpected)
    const anyResolved = evaluated.some((c) => c.resolved)
    const allTls = evaluated.every((c) => c.httpsReachable)
    const sslStatus: DomainSslStatus = allTls ? 'active' : anyResolved ? 'error' : 'pending'
    const appOk = evaluated.every((c) => c.httpStatus !== null && c.httpStatus < 500)
    const rootCheck = checks.find((c) => c.hostname === d.domain)

    const steps: DnsDiagnosticStep[] = []
    if (d.connectionMode === 'cloudflare_tunnel') {
      steps.push({
        label: 'Nameservers na Cloudflare',
        ok: isCloudflareNs,
        detail: nsRecords.length
          ? `${nsRecords.join(', ')} (${nsProvider})`
          : 'Nenhum nameserver encontrado — o domínio pode estar expirado, recém-registrado ou digitado incorretamente.'
      })
    } else {
      steps.push({
        label: 'Domínio registrado com nameservers ativos',
        ok: nsRecords.length > 0,
        detail: nsRecords.length ? `${nsRecords.join(', ')} (${nsProvider})` : 'Nenhum nameserver encontrado.'
      })
    }
    const badDns = evaluated.filter((c) => !c.pointsToExpected)
    steps.push({
      label: d.connectionMode === 'cloudflare_tunnel' ? 'Registros apontando para o túnel (Proxied)' : `Registros apontando para ${endpoints.publicIp ?? 'seu IP público'}`,
      ok: dnsVerified,
      detail: badDns.length
        ? `Pendentes: ${badDns.map((c) => `${c.hostname} → ${[...c.cnameRecords, ...c.aRecords].join(', ') || 'sem registro'}`).join(' · ')}`
        : `${evaluated.length} hostname(s) resolvendo corretamente`
    })
    const badTls = evaluated.filter((c) => !c.httpsReachable)
    steps.push({
      label: 'Certificado HTTPS válido',
      ok: allTls,
      detail: badTls.length ? badTls.map((c) => `${c.hostname}: ${c.error ?? 'sem resposta'}`).join(' · ') : 'TLS ativo em todos os hostnames'
    })
    const badApp = evaluated.filter((c) => c.httpsReachable && (c.httpStatus ?? 0) >= 500)
    steps.push({
      label: 'Aplicação respondendo',
      ok: appOk,
      detail: badApp.length
        ? badApp.map((c) => `${c.hostname}: HTTP ${c.httpStatus}${c.httpStatus === 530 || c.httpStatus === 502 ? ' (túnel desconectado ou Public Hostname ausente)' : ''}`).join(' · ')
        : appOk
          ? evaluated.map((c) => `${c.hostname}: HTTP ${c.httpStatus}`).join(' · ')
          : 'Aguardando HTTPS'
    })

    let diagnosticMessage: string
    if (!nsRecords.length) diagnosticMessage = 'O domínio ainda não possui nameservers públicos. Verifique se o registro foi concluído/pago no provedor.'
    else if (d.connectionMode === 'cloudflare_tunnel' && !isCloudflareNs)
      diagnosticMessage = `Os nameservers ainda apontam para ${nsProvider}. Troque-os pelos nameservers da Cloudflare (passo a passo no guia) e aguarde a propagação.`
    else if (!dnsVerified) diagnosticMessage = `DNS ainda não aponta corretamente para ${badDns.map((c) => c.hostname).join(', ')}. Confira os registros no guia e aguarde a propagação (até 4 h).`
    else if (!allTls) diagnosticMessage = 'DNS OK, mas o HTTPS ainda não responde. Aguarde alguns minutos pela emissão do certificado e confira se o túnel/portas estão ativos.'
    else if (!appOk) diagnosticMessage = 'HTTPS ativo, mas a aplicação retornou erro 5xx. Verifique se o projeto está rodando e se o Public Hostname aponta para http://127.0.0.1:80.'
    else diagnosticMessage = `Tudo certo! ${d.domain} está online com HTTPS ativo. 🎉`

    return {
      domainId: d.id,
      domain: d.domain,
      nsRecords,
      nsProvider,
      isCloudflareNs,
      aRecords: rootCheck?.aRecords ?? [],
      cnameRecords: rootCheck?.cnameRecords ?? [],
      httpsReachable: allTls,
      hosts: checks,
      dnsVerified,
      sslStatus,
      steps,
      diagnosticMessage,
      checkedAt: Date.now()
    }
  }

  private async verifyLocal(d: DomainRecord, endpoints: NetworkEndpoints): Promise<DomainDnsVerification> {
    const hosts = this.routedHosts(d, true)
    const expected = new Set(['127.0.0.1', endpoints.lanIp ?? ''])
    const port = endpoints.caddyHttpPort
    const checks: DnsHostCheck[] = await Promise.all(
      hosts.map(async ({ hostname }) => {
        let aRecords: string[] = []
        let error: string | null = null
        try {
          const res = await lookup(hostname, { family: 4, all: true })
          aRecords = res.map((r) => r.address)
        } catch (err) {
          error = `Não resolve localmente (${(err as NodeJS.ErrnoException).code ?? 'erro'}) — ative no arquivo hosts`
        }
        const resolved = aRecords.length > 0
        let httpStatus: number | null = null
        if (resolved) {
          try {
            const res = await fetchWithTimeout(`http://${hostname}${port !== 80 ? `:${port}` : ''}/`, { method: 'HEAD', redirect: 'manual' }, 4_000)
            httpStatus = res.status
          } catch (err) {
            error = describeFetchError(err)
          }
        }
        return {
          hostname,
          aRecords,
          cnameRecords: [],
          resolved,
          pointsToExpected: aRecords.some((a) => expected.has(a)),
          httpsReachable: false,
          httpStatus,
          error
        }
      })
    )

    const dnsVerified = checks.every((c) => c.pointsToExpected)
    const appOk = checks.every((c) => c.httpStatus !== null && c.httpStatus < 500)
    const bad = checks.filter((c) => !c.pointsToExpected)
    const steps: DnsDiagnosticStep[] = [
      {
        label: 'Resolução local (arquivo hosts)',
        ok: dnsVerified,
        detail: bad.length ? `Não apontam para este PC: ${bad.map((c) => c.hostname).join(', ')}` : 'Todos os hostnames resolvem para este PC'
      },
      {
        label: `Caddy respondendo na porta ${port}`,
        ok: appOk,
        detail: checks.map((c) => `${c.hostname}: ${c.httpStatus !== null ? `HTTP ${c.httpStatus}` : c.error ?? 'sem resposta'}`).join(' · ')
      }
    ]

    return {
      domainId: d.id,
      domain: d.domain,
      nsRecords: [],
      nsProvider: 'Arquivo hosts / Rede local',
      isCloudflareNs: false,
      aRecords: checks[0]?.aRecords ?? [],
      cnameRecords: [],
      httpsReachable: false,
      hosts: checks,
      dnsVerified,
      sslStatus: 'pending',
      steps,
      diagnosticMessage: !dnsVerified
        ? 'Clique em "⚡ Ativar no Windows Hosts (1-Clique)" para que este PC resolva os domínios locais.'
        : !appOk
          ? 'Resolução OK, mas o Caddy/projeto não respondeu. Inicie o projeto vinculado e sincronize as rotas.'
          : `Tudo certo! http://${d.domain} está acessível neste PC. 🎉`,
      checkedAt: Date.now()
    }
  }

  // =========================================================================
  // Windows hosts (1-Clique)
  // =========================================================================
  public async applyHostsFile(id: string): Promise<HostsApplyResult> {
    const d = this.db.getDomain(id)
    if (!d) throw new Error('Domínio não encontrado')
    const hostnames = Array.from(new Set(this.routedHosts(d, true).map((h) => h.hostname)))
    const marker = `# MyServer:${d.domain}`
    const entries = hostnames.map((h) => `127.0.0.1`.padEnd(16) + `${h} ${marker}`)

    const script = `
      $hosts = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'
      $marker = ${psQuote(marker)}
      $entries = @(${entries.map((e) => psQuote(e)).join(', ')})
      $lines = @()
      if (Test-Path -LiteralPath $hosts) {
        $item = Get-Item -LiteralPath $hosts -Force
        if ($item.IsReadOnly) { $item.IsReadOnly = $false }
        $lines = @([IO.File]::ReadAllLines($hosts))
      }
      $filtered = @($lines | Where-Object { -not $_.EndsWith($marker) })
      $final = @($filtered) + $entries
      [IO.File]::WriteAllLines($hosts, [string[]]$final)
      ipconfig /flushdns | Out-Null
      Write-Output "Entradas aplicadas: $($entries.Count)"
    `
    const res = await runPrivileged(script, 60_000)
    if (res.exitCode !== 0) throw new Error(`Falha ao editar o arquivo hosts: ${res.error || res.output}`)
    log.info(`Arquivo hosts atualizado para ${d.domain}: ${hostnames.join(', ')}`)
    await this.syncCaddy()
    return { hostsPath: 'C:\\Windows\\System32\\drivers\\etc\\hosts', entries }
  }

  // =========================================================================
  // Automação Cloudflare (API Token) — DNS + Ingress do túnel em 1 clique
  // =========================================================================
  public async autoConfigureCloudflareDns(id: string, apiToken?: string): Promise<CloudflareAutoDnsResult> {
    const d = this.db.getDomain(id)
    if (!d) throw new Error('Domínio não encontrado')
    if (apiToken && apiToken.trim()) this.db.setSecret('cloudflare_api_token', apiToken.trim())
    const token = this.db.getSecret('cloudflare_api_token')
    if (!token) throw new Error('Informe um API Token da Cloudflare (permissões Zone:DNS:Edit e Account:Cloudflare Tunnel:Edit).')

    const settings = this.db.getFullSettings()
    const tunnelId = settings.tunnel.tunnelId
    if (!tunnelId) throw new Error('Configure primeiro o Named Tunnel (token do conector) para que o ID do túnel seja conhecido.')
    const tunnelCname = `${tunnelId}.cfargotunnel.com`

    const cf = async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetchWithTimeout(
        `https://api.cloudflare.com/client/v4${path}`,
        { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } },
        15_000
      )
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: Array<{ code: number; message: string }> }
      if (!res.ok || !json.success) {
        const msg = json.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`
        throw new Error(msg)
      }
      return json.result as T
    }

    const zones = await cf<Array<{ id: string; name: string; account?: { id: string } }>>(`/zones?name=${encodeURIComponent(d.domain)}`)
    if (!zones.length) {
      throw new Error(`${d.domain} não foi encontrado na sua conta Cloudflare. Adicione o site em dash.cloudflare.com e troque os nameservers primeiro.`)
    }
    const zoneId = zones[0].id
    const accountId = settings.tunnel.accountId || zones[0].account?.id
    const hostnames = Array.from(new Set(this.routedHosts(d).map((h) => h.hostname)))

    const records: CloudflareAutoDnsResult['records'] = []
    for (const hostname of hostnames) {
      try {
        const existing = await cf<Array<{ id: string; type: string; content: string; proxied: boolean }>>(
          `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`
        )
        const conflicting = existing.filter((r) => ['A', 'AAAA', 'CNAME'].includes(r.type))
        const body = JSON.stringify({ type: 'CNAME', name: hostname, content: tunnelCname, proxied: true, ttl: 1, comment: 'MyServer Orchestrator' })
        if (conflicting.some((r) => r.type === 'CNAME' && r.content === tunnelCname && r.proxied)) {
          records.push({ hostname, action: 'unchanged' })
        } else if (conflicting.length > 0) {
          await cf(`/zones/${zoneId}/dns_records/${conflicting[0].id}`, { method: 'PUT', body })
          for (const extra of conflicting.slice(1)) {
            await cf(`/zones/${zoneId}/dns_records/${extra.id}`, { method: 'DELETE' })
          }
          records.push({ hostname, action: 'updated' })
        } else {
          await cf(`/zones/${zoneId}/dns_records`, { method: 'POST', body })
          records.push({ hostname, action: 'created' })
        }
      } catch (err) {
        records.push({ hostname, action: 'failed', error: (err as Error).message })
      }
    }

    let ingressUpdated = false
    let ingressError: string | null = null
    if (!accountId) {
      ingressError = 'Account ID não encontrado no token do túnel nem na zona.'
    } else {
      try {
        const service = `http://127.0.0.1:${settings.caddyHttpPort || 80}`
        const current = await cf<{ config?: { ingress?: Array<Record<string, unknown>> } & Record<string, unknown> } | null>(
          `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`
        ).catch(() => null)
        const managed = new Set(hostnames)
        const kept = (current?.config?.ingress ?? []).filter((r) => typeof r.hostname === 'string' && !managed.has(r.hostname as string))
        const ingress = [...hostnames.map((hostname) => ({ hostname, service })), ...kept, { service: 'http_status:404' }]
        await cf(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
          method: 'PUT',
          body: JSON.stringify({ config: { ...(current?.config ?? {}), ingress } })
        })
        ingressUpdated = true
      } catch (err) {
        ingressError = (err as Error).message
      }
    }

    this.db.updateDomainFields(d.id, { cfZoneId: zoneId, cfTunnelId: tunnelId, cfTunnelCname: tunnelCname })
    log.info(
      `Cloudflare auto-DNS para ${d.domain}: ${records.map((r) => `${r.hostname}=${r.action}`).join(', ')} · ingress=${ingressUpdated ? 'ok' : ingressError}`
    )
    return { zoneId, records, ingressUpdated, ingressError }
  }
}
