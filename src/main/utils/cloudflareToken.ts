/**
 * Decodifica o token do conector cloudflared.
 * Todo token "eyJh..." é um JSON em Base64 no formato { "a": accountTag, "t": tunnelId, "s": secret }.
 */
export interface DecodedTunnelToken {
  accountId: string
  tunnelId: string
  tunnelCname: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function decodeTunnelToken(rawToken: string): DecodedTunnelToken | null {
  // Aceita também o comando completo colado do painel: "cloudflared.exe service install eyJh..."
  const candidate = String(rawToken || '')
    .trim()
    .split(/\s+/)
    .reverse()
    .find((part) => part.startsWith('ey')) ?? String(rawToken || '').trim()

  try {
    const normalized = candidate.replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(normalized, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as { a?: string; t?: string; s?: string }
    if (!parsed.t || !UUID_RE.test(parsed.t)) return null
    return {
      accountId: parsed.a ?? '',
      tunnelId: parsed.t.toLowerCase(),
      tunnelCname: `${parsed.t.toLowerCase()}.cfargotunnel.com`
    }
  } catch {
    return null
  }
}

/** Extrai somente o token (eyJ...) caso o usuário cole o comando inteiro de instalação. */
export function extractTunnelToken(raw: string): string {
  const parts = String(raw || '').trim().split(/\s+/)
  return parts.reverse().find((p) => p.startsWith('ey')) ?? String(raw || '').trim()
}
