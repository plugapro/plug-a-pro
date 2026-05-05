'use client';

// <ConfirmDialog> and <DestructiveConfirmDialog>.
// The destructive variant requires typing the entity name to proceed.

import * as React from 'react';
import { cn } from '@/lib/utils';

interface BaseProps {
  triggerLabel: string;
  triggerClassName?: string;
  title: string;
  description: React.ReactNode;
  onConfirm: () => Promise<void> | void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  triggerLabel,
  triggerClassName,
  title,
  description,
  onConfirm,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}: BaseProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <>
      <button className={cn('rounded border px-3 py-1.5 text-sm', triggerClassName)} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="mt-2 text-sm text-muted-foreground">{description}</div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>
              {cancelLabel}
            </button>
            <button
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? 'Working…' : confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

interface DestructiveProps extends BaseProps {
  /** The exact string the user must type to enable the confirm button. */
  confirmText: string;
}

export function DestructiveConfirmDialog({
  triggerLabel,
  triggerClassName,
  title,
  description,
  onConfirm,
  confirmText,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
}: DestructiveProps) {
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [pending, setPending] = React.useState(false);

  const matches = typed === confirmText;

  return (
    <>
      <button
        className={cn('rounded border border-red-300 px-3 py-1.5 text-sm text-red-600', triggerClassName)}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="text-lg font-semibold text-red-700">{title}</h2>
          <div className="mt-2 text-sm text-muted-foreground">{description}</div>
          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Type <span className="rounded bg-muted px-1 font-mono text-xs">{confirmText}</span> to confirm
            </label>
            <input
              className="w-full rounded border px-2 py-1 text-sm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>
              {cancelLabel}
            </button>
            <button
              className={cn(
                'rounded px-3 py-1.5 text-sm text-white',
                matches ? 'bg-red-600 hover:bg-red-700' : 'bg-red-300',
              )}
              disabled={!matches || pending}
              onClick={async () => {
                setPending(true);
                try {
                  await onConfirm();
                  setOpen(false);
                  setTyped('');
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? 'Working…' : confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// --- Minimal modal ------------------------------------------------------

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
