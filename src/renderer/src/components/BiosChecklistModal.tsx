import React from 'react'
import { Modal } from './Modal'
import { Zap, CheckCircle2, AlertTriangle, KeyRound } from 'lucide-react'

export interface BiosChecklistModalProps {
  isOpen: boolean
  onClose: () => void
}

export const BiosChecklistModal: React.FC<BiosChecklistModalProps> = ({ isOpen, onClose }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Assistente de BIOS: Autoligamento Pós-Queda de Energia"
      subtitle="Configure o computador para religar automaticamente assim que a tomada voltar a ter energia."
      maxWidth="xl"
    >
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/20 text-amber-200 text-xs flex gap-3">
          <AlertTriangle size={20} className="shrink-0 text-amber-400 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-300">Por que esta etapa é fundamental?</p>
            <p className="mt-1 leading-relaxed">
              Sem essa configuração, caso a energia da sua casa acabe e a bateria se esgote, o servidor permanecerá
              desligado mesmo após o retorno da luz, exigindo que alguém vá até a máquina e aperte o botão físico de ligar.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
            <KeyRound size={14} className="text-emerald-400" />
            1. Como entrar na BIOS da sua placa-mãe
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800">
              <span className="font-bold text-white block">Dell & Alienware</span>
              <span className="text-neutral-400 font-mono mt-0.5 block">Pressione F2 ou F12 ao ligar</span>
            </div>
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800">
              <span className="font-bold text-white block">HP & Compaq</span>
              <span className="text-neutral-400 font-mono mt-0.5 block">Pressione Esc ou F10 ao ligar</span>
            </div>
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800">
              <span className="font-bold text-white block">Lenovo / ThinkPad</span>
              <span className="text-neutral-400 font-mono mt-0.5 block">Pressione F1, F2 ou Enter ao ligar</span>
            </div>
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800">
              <span className="font-bold text-white block">ASUS, Gigabyte, MSI</span>
              <span className="text-neutral-400 font-mono mt-0.5 block">Pressione Del ou F2 repetidamente</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
            <Zap size={14} className="text-emerald-400" />
            2. Opção a ser ativada na BIOS / UEFI
          </h4>
          <div className="p-4 rounded-xl bg-neutral-900/80 border border-neutral-800 text-xs space-y-2">
            <p className="text-neutral-300">
              Navegue com as setas do teclado até o menu <span className="font-semibold text-emerald-400">Power</span>,{' '}
              <span className="font-semibold text-emerald-400">Advanced Power Management (APM)</span> ou{' '}
              <span className="font-semibold text-emerald-400">ACPI Configuration</span>.
            </p>
            <p className="text-neutral-300">
              Procure pelo item:
            </p>
            <div className="p-3 rounded-lg bg-black/60 border border-neutral-700 font-mono text-emerald-300 font-bold">
              Restore on AC/Power Loss → [ Power On ]
            </div>
            <p className="text-neutral-400 text-[11px] leading-relaxed">
              * Em algumas placas-mãe pode se chamar <em>"AC Power Recovery"</em>, <em>"After Power Failure: On"</em> ou <em>"State After G3"</em>.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-400" />
            3. Salvar e Sair
          </h4>
          <p className="text-xs text-neutral-300">
            Pressione <kbd className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 font-mono text-white">F10</kbd> (Save & Exit Setup) e confirme pressionando Enter. Pronto! Seu servidor reiniciará automaticamente em qualquer evento de retomada de energia.
          </p>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs transition-colors"
          >
            Entendido, já configurei!
          </button>
        </div>
      </div>
    </Modal>
  )
}
