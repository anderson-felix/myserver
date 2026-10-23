import { execa } from 'execa'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from './logger'

const log = createLogger('shell')

export interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface PrivilegedResult {
  output: string
  exitCode: number
  elevated: boolean
  error: string | null
}

/** Aspas simples literais do PowerShell ('' escapa '). */
export function psQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

const PS_PRELUDE = `$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function HS-Run {
  param([Parameter(Mandatory=$true)][string]$Exe, [string[]]$ArgList = @(), [switch]$AllowFail)
  $out = & $Exe @ArgList 2>&1 | Out-String -Width 4096
  if ($out.Trim()) { Write-Output $out.TrimEnd() }
  if (-not $AllowFail -and $LASTEXITCODE -ne 0) { throw "Falhou (exit $LASTEXITCODE): $([IO.Path]::GetFileName($Exe)) $($ArgList -join ' ')" }
}
`

/** Executa um script PowerShell oculto (sem elevação). */
export async function runPowerShell(script: string, timeoutMs = 120_000): Promise<ShellResult> {
  const full = `${PS_PRELUDE}\n${script}`
  const encoded = Buffer.from(full, 'utf16le').toString('base64')
  // Linha de comando do Windows é limitada a ~32k caracteres → scripts grandes vão para arquivo.
  if (encoded.length > 24_000) return runPowerShellFile(full, timeoutMs)
  const r = await execa(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { reject: false, windowsHide: true, timeout: timeoutMs }
  )
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), exitCode: r.exitCode ?? -1 }
}

async function runPowerShellFile(fullScript: string, timeoutMs: number): Promise<ShellResult> {
  const dir = await mkdtemp(join(tmpdir(), 'hs-ps-'))
  const file = join(dir, 'script.ps1')
  try {
    // BOM UTF-8 para o Windows PowerShell 5.1 ler acentos corretamente
    await writeFile(file, '\uFEFF' + fullScript, 'utf8')
    const r = await execa('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      reject: false,
      windowsHide: true,
      timeout: timeoutMs
    })
    return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), exitCode: r.exitCode ?? -1 }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

let adminCache: boolean | null = null

/** `net session` só retorna 0 quando o processo tem token de Administrador. */
export async function isAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  if (adminCache !== null) return adminCache
  const r = await execa('net', ['session'], { reject: false, windowsHide: true })
  adminCache = r.exitCode === 0
  return adminCache
}

/**
 * Executa um script com privilégios de Administrador.
 * - Se o app já roda elevado (instalador com requireAdministrator): executa direto.
 * - Senão (ex.: `npm run dev`): dispara UAC via Start-Process -Verb RunAs e coleta a saída.
 * O script pode usar `HS-Run` (lança exceção em exit code ≠ 0). Exceções → exitCode 1.
 */
export async function runPrivileged(script: string, timeoutMs = 300_000): Promise<PrivilegedResult> {
  const dir = await mkdtemp(join(tmpdir(), 'hs-elev-'))
  const scriptFile = join(dir, 'task.ps1')
  const outFile = join(dir, 'out.txt')
  const codeFile = join(dir, 'code.txt')
  const wrapper = `${PS_PRELUDE}
$__code = 0
$__out = try {
  & {
${script}
  } 2>&1 | Out-String -Width 4096
} catch {
  $__code = 1
  "##HS-ERROR: $($_.Exception.Message)"
}
[IO.File]::WriteAllText(${psQuote(outFile)}, [string]$__out, [Text.Encoding]::UTF8)
[IO.File]::WriteAllText(${psQuote(codeFile)}, [string]$__code)
exit $__code
`
  const elevated = await isAdmin()
  try {
    await writeFile(scriptFile, '\uFEFF' + wrapper, 'utf8')
    if (elevated) {
      await execa('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
        reject: false,
        windowsHide: true,
        timeout: timeoutMs
      })
    } else {
      const launcher = `$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', ${psQuote(`"${scriptFile}"`)}); exit $p.ExitCode`
      const r = await runPowerShell(launcher, timeoutMs)
      if (!existsSync(codeFile)) {
        const reason = /cancel/i.test(r.stderr) ? 'Elevação (UAC) cancelada pelo usuário' : r.stderr.trim() || 'Falha ao elevar privilégios'
        return { output: '', exitCode: 1, elevated: false, error: reason }
      }
    }
    const output = existsSync(outFile) ? (await readFile(outFile, 'utf8')).replace(/^\uFEFF/, '') : ''
    const exitCode = existsSync(codeFile) ? Number((await readFile(codeFile, 'utf8')).trim() || '1') : 1
    const errLine = output.split(/\r?\n/).find((l) => l.startsWith('##HS-ERROR:'))
    return { output, exitCode, elevated: true, error: errLine ? errLine.replace('##HS-ERROR:', '').trim() : null }
  } catch (err) {
    log.error('runPrivileged falhou', err)
    return { output: '', exitCode: 1, elevated, error: (err as Error).message }
  } finally {
    // O script pode conter segredos (senha do runner, token) → remove imediatamente
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Status de serviços Windows (não localizado, ao contrário do `sc query`). */
export async function getServicesStatus(names: string[]): Promise<Record<string, { state: string; pid: number } | null>> {
  const result: Record<string, { state: string; pid: number } | null> = {}
  for (const n of names) result[n] = null
  if (process.platform !== 'win32' || names.length === 0) return result
  const filter = names.map((n) => `Name='${n.replace(/'/g, '')}'`).join(' OR ')
  const r = await runPowerShell(
    `Get-CimInstance Win32_Service -Filter ${psQuote(filter)} | Select-Object Name,State,ProcessId | ConvertTo-Json -Compress`,
    30_000
  )
  const text = r.stdout.trim()
  if (!text) return result
  try {
    const parsed = JSON.parse(text) as { Name: string; State: string; ProcessId: number } | Array<{ Name: string; State: string; ProcessId: number }>
    for (const s of Array.isArray(parsed) ? parsed : [parsed]) {
      const key = names.find((n) => n.toLowerCase() === s.Name.toLowerCase()) ?? s.Name
      result[key] = { state: s.State, pid: s.ProcessId }
    }
  } catch (err) {
    log.warn('Falha ao interpretar status de serviços', err)
  }
  return result
}
