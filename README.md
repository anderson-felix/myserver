# MyServer Desktop Orchestrator 🚀

Transforme qualquer PC ou Notebook antigo/mediano em um servidor Web e de APIs seguro, resiliente e de baixo consumo de recursos — com **arquitetura Local-First e Custo Operacional Zero**.

---

## ⚡ Visão Geral da Arquitetura

O **MyServer Orchestrator** foi projetado para operar 100% autônomo na infraestrutura do usuário, sem necessidade de servidores intermediários, bancos em nuvem proprietários ou assinaturas mensais pagas:

- **Zero-Cost:** Utiliza a camada gratuita do Cloudflare Tunnels (Zero Trust) e Quick Tunnels temporários (`trycloudflare.com`), contornando CGNAT sem necessidade de IP público fixo ou abertura manual de portas no roteador doméstico.
- **Local-First:** Todo o estado, métricas, configurações e credenciais residem localmente em um banco de dados SQLite de alta performance (`better-sqlite3` com WAL mode).
- **Segurança de Nível Empresarial:** Criptografia **AES-256-GCM** para segredos e variáveis `.env`, com chave mestre protegida pelo **Windows DPAPI** (`safeStorage`).
- **Resiliência e Proteção de Hardware:** Monitoramento ativo de bateria de notebooks como UPS inteligente, controle térmico de CPU e desligamento seguro com notificação de emergência.

---

## 📦 Binários Portáteis Embutidos (Zero Dependência no Host)

O software inclui e gerencia binários portáteis independentes do sistema operacional do usuário:

| Binário | Versão | Localização | Função |
| :--- | :--- | :--- | :--- |
| **Caddy** | v2.11.7 | `bin/win/caddy.exe` | Reverse Proxy de alto desempenho com API REST ativa em `127.0.0.1:2019` |
| **Cloudflared** | Latest AMD64 | `bin/win/cloudflared.exe` | Túneis Zero Trust e Quick Tunnels com saída via HTTPS e QR Code |
| **NSSM** | v2.24-101 | `bin/win/nssm.exe` | Gerenciador de Serviços Windows (execução em background e auto-restart no boot) |
| **Node.js LTS** | v24.22.0 "Krypton" | `bin/win/node/node.exe` | Runtime Node.js isolado com `npm` e `npx` integrados |

---

## 🛠️ Funcionalidades Implementadas (As 6 Etapas)

### 1. Sistema & Otimizador de SO (Windows)
- **Modo Servidor 1-Clique:** Configuração automática via PowerShell silencioso:
  - Plano de energia de Alto Desempenho (`High Performance`).
  - Desativação de suspensão (`standby-timeout-ac 0`, `hibernate-timeout-ac 0`).
  - Fechamento de tampa do notebook sem suspender (`lid-action-ac 0`).
  - Liberação automática de portas no Firewall do Windows (80 e 443).
- **IP Estático & DNS:** Definição de IP estático local com servidores DNS ultrarrápidos (Cloudflare `1.1.1.1` e Google `8.8.8.8`).
- **Usuário de Serviço Restrito:** Criação do usuário Windows `AppServerRunner` com permissões restritas e `icacls` para isolamento de segurança.
- **Checklist Interativo de BIOS:** Guia integrado para configuração de *Restore AC Power Loss*, *Wake-on-LAN* e *Intel VT-x / AMD-V*.

### 2. Watchdog & UPS Inteligente
- **Detecção de Queda de Energia (AC Drop):** Detecta instantaneamente a desconexão do carregador em notebooks.
- **Alerta de Emergência:** Disparo imediato de notificações via Webhook do Discord e Microsoft Teams com porcentagem de bateria e autonomia estimada.
- **Auto-Shutdown Seguro:** Se a bateria atingir ≤ 15%, o sistema encerra todas as aplicações com segurança, sincroniza o banco SQLite e desliga o computador para evitar corrupção de dados.
- **Controle Térmico & RAM:** Alerta se a temperatura da CPU ultrapassar 85°C ou se a memória RAM exceder 90%.
- **Auto-Cura de Processos:** Monitoramento de uso de RAM por aplicação e healthchecks HTTP periódicos (3 tentativas com reinício automático).

### 3. Mini-Vercel Local (Process Manager)
- **Deploy Local ou Git:** Suporte a clonagem direta de repositórios Git públicos/privados ou pastas locais do sistema.
- **Alocação Dinâmica de Portas:** Detecção de portas livres em tempo real no intervalo `3001-3999` usando `get-port`.
- **Stacks Suportadas:**
  - **Node.js:** Execução isolada usando o binário portátil embutido Node LTS.
  - **Python:** Execução com suporte a ambientes virtuais (`venv`).
  - **Static:** Servido diretamente pelo motor Caddy via diretiva `file_server`.
- **Modos de Execução:** Subprocesso local gerenciado (`tree-kill`) ou Serviço Windows via **NSSM** com inicialização no boot.
- **Terminal ao Vivo:** Visualização de logs em tempo real com **Xterm.js** e buffer circular de 1000 linhas.

### 4. Rede, Proxy Reverso & Tunnels
- **Caddy REST API:** Gerenciamento dinâmico de rotas em JSON puro sem recarregar o executável (`POST /load`).
- **Quick Tunnel Cloudflare:** Geração instantânea de URL pública temporária (`*.trycloudflare.com`) e **QR Code** renderizado na tela para testes em smartphones.
- **Túnel Nomeado Zero Trust:** Instalação e orquestração do serviço permanente `cloudflared` com token de autenticação.
- **Cabeçalhos de Segurança:** Injeção automática de HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e limite de upload de 10MB.

### 5. Backups Criptografados & Notificações
- **Backup Agendado Automático:** Execução diária às 03:00 via `node-cron`.
- **Compressão e Criptografia:** Compactação em `.tar.gz` e criptografia simétrica **AES-256-GCM** com derivação de chave **PBKDF2/scrypt**.
- **Destinos de Backup:** Armazenamento local com rotação de 7 dias e envio off-site para qualquer bucket compatível com S3 (Cloudflare R2, AWS S3, MinIO) com custo zero na camada gratuita.
- **CLI de Recuperação de Desastres:** Script autônomo `scripts/decrypt-backup.mjs` sem dependências externas para restaurar backups em qualquer máquina.
- **Canais de Notificação:** Webhooks do Discord (com Rich Embeds coloridos) e Microsoft Teams (com Adaptive Cards v1.4).

### 6. Gestão de Nós Linux Remotos (SSH)
- **Conexão SSH Segura:** Suporte a autenticação por senha ou chave privada via biblioteca `ssh2`.
- **Telemetria Remota:** Monitoramento contínuo de CPU, RAM, disco e uptime do servidor Linux.
- **Provisionamento em 1-Clique:**
  - Desativação de suspensão da tampa no `systemd` (`HandleLidSwitch=ignore` em `/etc/systemd/logind.conf`).
  - Instalação e ativação do Docker Engine e Docker Compose.
  - Instalação do Caddy e Cloudflared via repositórios oficiais.
  - Configuração do firewall UFW (portas 22, 80, 443).
- **Deploy de Contêineres:** Deploy instantâneo de contêineres Docker com mapeamento de portas e reinício automático (`--restart unless-stopped`).

---

## 💻 Requisitos e Instalação

### Pré-requisitos de Desenvolvimento
- **Node.js:** v20+ ou v24+ no computador de desenvolvimento.
- **Windows:** Windows 10 ou Windows 11 (64-bit).

### Instalação de Dependências
```bash
npm install
```

### Download dos Binários Portáteis
O script automatizado baixa e verifica a integridade de todos os binários portáteis necessários:
```bash
npm run fetch-binaries
```

---

## 🏃 Como Executar

### 1. Modo de Desenvolvimento (Hot Reload)
Inicia o Electron com hot-reload no Vite e no processo Main:
```bash
npm run dev
```

### 2. Validação de Tipagem TypeScript
```bash
npm run typecheck
```

### 3. Compilação de Produção
```bash
npm run build
```

### 4. Empacotar Instalador Windows (NSIS Installer)
Gera o instalador executável `.exe` configurado com elevação UAC (`requireAdministrator`) e atalhos no Desktop/Menu Iniciar em `release/0.1.0/`:
```bash
npm run dist
```

Para gerar a versão descompactada (portátil para testes imediatos):
```bash
npm run dist:dir
```
O executável principal estará pronto em:
```text
release/0.1.0/win-unpacked/MyServer Orchestrator.exe
```

---

## 🛡️ Recuperação de Desastres (Descriptografia de Backups)

Caso precise restaurar seus dados fora da aplicação, utilize o script CLI de zero dependências:

```bash
node scripts/decrypt-backup.mjs "C:\HomeServerApps\backups\backup-2026-10-19.hsenc" "SuaSenhaAqui"
```

O comando descriptografa e gera o arquivo `.tar.gz` original, pronto para descompactação:
```bash
tar -xzf backup-2026-10-19.tar.gz
```

---

## 📂 Estrutura de Diretórios do Projeto

```text
MyServer/
├── bin/
│   └── win/                     # Binários portáteis (caddy, cloudflared, nssm, node)
├── resources/
│   ├── icon.png                 # Ícone da aplicação
│   └── launcher/
│       └── hs-launcher.cjs      # Launcher isolado para serviços Windows
├── scripts/
│   ├── fetch-binaries.mjs       # Script de download automatizado de binários
│   └── decrypt-backup.mjs       # CLI de recuperação de desastres
├── src/
│   ├── main/                    # Processo Principal do Electron (Node.js)
│   │   ├── database/            # SQLite com WAL mode, migrações e criptografia
│   │   ├── ipc/                 # Registro centralizado de handlers IPC fortemente tipados
│   │   ├── services/            # Serviços de background (Watchdog, Processos, Caddy, Cloudflare, Backups, SSH)
│   │   ├── utils/               # Criptografia AES-256-GCM, SafeStorage, Shell silencioso, Logger rotativo
│   │   ├── paths.ts             # Gestão de caminhos (Dev vs Packaged)
│   │   └── index.ts             # Ponto de entrada, System Tray, ciclo de vida
│   ├── preload/                 # Preload seguro do Electron (contextBridge.exposeInMainWorld)
│   ├── renderer/                # Interface Desktop (React 19 + Tailwind v4 + Lucide Icons)
│   │   ├── src/
│   │   │   ├── components/      # Badges, Métricas, Modais, Terminal Xterm.js
│   │   │   ├── pages/           # Dashboard, Projetos, Rede/Tunnels, Otimizador, Backups/Alertas, Nós Linux
│   │   │   ├── App.tsx          # Shell com navegação e barra de status em tempo real
│   │   │   └── main.tsx
│   └── shared/
│       └── types.ts             # Contrato de tipos compartilhados entre Main e Renderer
├── electron-builder.json        # Configuração de empacotamento NSIS e extraResources
├── electron.vite.config.ts      # Configuração do Vite 8 com Tailwind v4 e CSP de produção
├── tsconfig.json                # Configuração TypeScript
└── package.json
```

---

## 🔒 Segurança e Boas Práticas
- **Zero Vazamento de Segredos:** Variáveis de ambiente são salvas com criptografia AES-256-GCM com chave derivada da DPAPI local do Windows.
- **Execução Privilegiada Segura:** Comandos críticos do PowerShell (como regras de firewall e planos de energia) usam o `powershell.exe -WindowStyle Hidden` com elevação protegida.
- **Content Security Policy (CSP):** Rigoroso cabeçalho CSP injetado no renderer para impedir qualquer tipo de XSS ou injeção de script em produção.

---

## 📄 Licença
Distribuído sob a licença **MIT**. Desenvolvido com foco em soberania digital, baixo consumo de energia e reaproveitamento de hardware.
