import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface Confirmation {
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
}

/** Asks before a destructive action; open while `confirmation` is set. */
export function ConfirmDialog({
  confirmation,
  onClose,
}: {
  confirmation: Confirmation | null
  onClose: () => void
}) {
  return (
    <Dialog open={confirmation !== null} onOpenChange={(open) => !open && onClose()}>
      {confirmation && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation.title}</DialogTitle>
            <DialogDescription>{confirmation.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                confirmation.onConfirm()
                onClose()
              }}
            >
              {confirmation.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
