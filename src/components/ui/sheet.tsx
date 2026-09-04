import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

type SheetProps = { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }
export function Sheet({ open, onOpenChange, title, description, children }: SheetProps) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="sheet-overlay" />
    <Dialog.Content className="sheet-content">
      <div className="sheet-heading"><div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description>{description}</Dialog.Description>}</div><Dialog.Close className="sheet-close" aria-label="Close panel"><X size={18} /></Dialog.Close></div>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
