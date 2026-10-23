import React, { useState, useEffect } from 'react'
import {
  LayoutDashboard,
  Box,
  Globe,
  Sliders,
  BellRing,
  Server,
  FolderOpen,
  Terminal
} from 'lucide-react'
import { Dashboard } from './pages/Dashboard'
import { Projects } from './pages/Projects'
import { Networking } from './pages/Networking'
import { OsOptimizer } from './pages/OsOptimizer'
import { AlertsAndBackup } from './pages/AlertsAndBackup'
import { LinuxNodes } from './pages/LinuxNodes'
import { SystemLogs } from './pages/SystemLogs'
import type { SystemInfo } from '@shared/types'

type Tab = 'dashboard' | 'projects' | 'networking' | 'optimizer' | 'alerts' | 'linux' | 'logs'

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    window.api.getInfo().then(setSysInfo).catch(console.error)
  }, [])

  const tabs: Array<{ id: Tab; label: string; icon: React.FC<{ size: number; className?: string }> }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Aplicações (Mini-Vercel)', icon: Box },
    { id: 'networking', label: 'Rede & Tunnels', icon: Globe },
    { id: 'optimizer', label: 'Otimizador Windows', icon: Sliders },
    { id: 'alerts', label: 'Alertas & Backup', icon: BellRing },
    { id: 'linux', label: 'Nós Linux (SSH)', icon: Server },
    { id: 'logs', label: 'Console do Sistema', icon: Terminal }
  ]

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Sidebar Lateral */}
      <aside className="w-64 shrink-0 bg-neutral-900/60 border-r border-neutral-800 flex flex-col justify-between p-4 z-20">
        <div className="space-y-6">
          {/* Logo e Nome */}
          <div className="flex items-center gap-3 px-2 pt-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 via-cyan-500 to-indigo-600 p-[1.5px] shadow-lg shadow-emerald-500/10">
              <div className="w-full h-full bg-neutral-950 rounded-[10px] flex items-center justify-center">
                <Server size={20} className="text-emerald-400" />
              </div>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight leading-none">MyServer</h1>
              <span className="text-[10px] font-mono font-medium text-emerald-400 tracking-wider">
                ORCHESTRATOR
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 shadow-sm'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60 border border-transparent'
                  }`}
                >
                  <Icon size={17} className={isActive ? 'text-emerald-400' : 'text-neutral-400'} />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Footer Sidebar: Status do Sistema */}
        <div className="pt-4 border-t border-neutral-800/80 space-y-2">
          <div className="p-3 rounded-xl bg-neutral-900/80 border border-neutral-800 text-[11px] space-y-1.5 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-neutral-500">Filosofia:</span>
              <span className="text-emerald-400 font-bold">Local-First</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-500">Privilégios:</span>
              <span className={sysInfo?.isAdmin ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                {sysInfo?.isAdmin ? 'Administrador' : 'Usuário Padrão'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-500">Node LTS:</span>
              <span className={sysInfo?.binaries.node.present ? 'text-cyan-400' : 'text-neutral-400'}>
                {sysInfo?.binaries.node.present ? 'Embutido' : 'Global'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between px-2 text-[10px] text-neutral-500">
            <span>v{sysInfo?.appVersion || '0.1.0'}</span>
            <button
              onClick={() => sysInfo?.workspaceRoot && window.api.openPath(sysInfo.workspaceRoot)}
              className="hover:text-emerald-400 transition-colors flex items-center gap-1"
              title="Abrir pasta de dados"
            >
              <FolderOpen size={11} />
              <span>Workspace</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Conteúdo Principal */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
        {/* Top bar */}
        <header className="h-14 shrink-0 border-b border-neutral-800/80 px-6 flex items-center justify-between bg-neutral-900/30 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-neutral-400">
              Painel de Controle{' '}
              <span className="text-neutral-600 mx-1">/</span>{' '}
              <span className="text-white font-medium capitalize">
                {tabs.find((t) => t.id === activeTab)?.label}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-neutral-400 bg-neutral-900 px-3 py-1 rounded-full border border-neutral-800">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-[11px] text-neutral-300">Servidor Ativo</span>
            </span>
          </div>
        </header>

        {/* Scrollable View Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && <Dashboard onNavigate={setActiveTab} />}
            {activeTab === 'projects' && <Projects />}
            {activeTab === 'networking' && <Networking />}
            {activeTab === 'optimizer' && <OsOptimizer />}
            {activeTab === 'alerts' && <AlertsAndBackup />}
            {activeTab === 'linux' && <LinuxNodes />}
            {activeTab === 'logs' && <SystemLogs />}
          </div>
        </div>
      </main>
    </div>
  )
}
