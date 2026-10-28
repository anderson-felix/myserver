/**
 * Utilitários puros (sem APIs do Node) para normalização de domínios/hostnames.
 * Compartilhados entre Main Process e Renderer.
 */
import type { DomainRegistrar, DomainConnectionMode } from './types'

/** Sufixos públicos de 2 níveis mais comuns (subset da Public Suffix List). */
const MULTI_LEVEL_SUFFIXES = new Set([
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'app.br', 'dev.br', 'art.br', 'blog.br', 'eco.br',
  'ind.br', 'inf.br', 'tec.br', 'tv.br', 'adv.br', 'arq.br', 'eng.br', 'med.br', 'nom.br', 'psi.br',
  'srv.br', 'emp.br', 'log.br', 'ong.br', 'rec.br', 'tur.br', 'vet.br', 'wiki.br',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp',
  'com.ar', 'com.mx', 'com.co', 'com.pe', 'com.uy', 'com.py', 'com.ve', 'com.ec', 'cl.cl',
  'co.nz', 'co.za', 'com.pt', 'com.es', 'com.tr', 'com.cn', 'com.hk', 'com.sg', 'co.in', 'co.kr'
])

const LOCAL_TLDS = new Set(['localhost', 'local', 'lan', 'home', 'internal', 'intranet', 'test', 'corp'])

/** Remove protocolo, caminho, porta, ponto final e espaços; força minúsculas. */
export function normalizeHostname(raw: string): string {
  let h = String(raw || '').trim().toLowerCase()
  h = h.replace(/^[a-z]+:\/\//, '')
  h = h.split('/')[0].split('?')[0].split('#')[0]
  h = h.replace(/:\d+$/, '')
  h = h.replace(/^\*\./, '')
  h = h.replace(/\.+$/, '')
  return h
}

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

export function isValidHostname(host: string): boolean {
  const h = normalizeHostname(host)
  if (!h || h.length > 253 || !h.includes('.')) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false
  return h.split('.').every((l) => LABEL_RE.test(l) || /^xn--[a-z0-9-]+$/.test(l))
}

export function isLocalHostname(host: string): boolean {
  const h = normalizeHostname(host)
  const tld = h.split('.').pop() || ''
  return LOCAL_TLDS.has(tld)
}

/**
 * Deriva o domínio raiz (registrável) de um hostname.
 * Prioriza domínios já cadastrados (match mais longo), senão usa heurística de sufixos.
 */
export function extractRootDomain(host: string, knownRoots: string[] = []): string {
  const h = normalizeHostname(host)
  const known = knownRoots
    .map(normalizeHostname)
    .filter((r) => h === r || h.endsWith(`.${r}`))
    .sort((a, b) => b.length - a.length)
  if (known.length > 0) return known[0]

  const labels = h.split('.')
  if (labels.length <= 2) return h
  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_LEVEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.')
  return lastTwo
}

/** True se `host` é o próprio `root` ou um subdomínio dele. */
export function hostBelongsTo(host: string, root: string): boolean {
  const h = normalizeHostname(host)
  const r = normalizeHostname(root)
  return h === r || h.endsWith(`.${r}`)
}

/** Rótulo relativo ao domínio raiz: "api.empresa.com.br" → "api" · raiz → "@" */
export function relativeLabel(host: string, root: string): string {
  const h = normalizeHostname(host)
  const r = normalizeHostname(root)
  if (h === r) return '@'
  return h.endsWith(`.${r}`) ? h.slice(0, -(r.length + 1)) : h
}

export function suggestRegistrar(domain: string): DomainRegistrar {
  const d = normalizeHostname(domain)
  if (d.endsWith('.br')) return 'registrobr'
  return 'other'
}

export function suggestConnectionMode(domain: string): DomainConnectionMode {
  return isLocalHostname(domain) ? 'lan_only' : 'cloudflare_tunnel'
}

export const REGISTRAR_META: Record<DomainRegistrar, { label: string; emoji: string; panelUrl: string | null }> = {
  registrobr: { label: 'Registro.br', emoji: '🇧🇷', panelUrl: 'https://registro.br/painel/' },
  godaddy: { label: 'GoDaddy', emoji: '🌐', panelUrl: 'https://dcc.godaddy.com/control/portfolio' },
  cloudflare: { label: 'Cloudflare', emoji: '☁️', panelUrl: 'https://dash.cloudflare.com/' },
  hostinger: { label: 'Hostinger', emoji: '🟣', panelUrl: 'https://hpanel.hostinger.com/domains' },
  namecheap: { label: 'Namecheap', emoji: '🔶', panelUrl: 'https://ap.www.namecheap.com/domains/list/' },
  other: { label: 'Local / Outro', emoji: '💻', panelUrl: null }
}

export const CONNECTION_MODE_META: Record<DomainConnectionMode, { label: string; short: string }> = {
  cloudflare_tunnel: { label: 'Túnel Cloudflare Zero Trust', short: 'Cloudflare Tunnel' },
  direct_dns: { label: 'DNS Direto / IP Público', short: 'DNS Direto' },
  lan_only: { label: 'Rede Local / Intranet', short: 'Rede Local' }
}
