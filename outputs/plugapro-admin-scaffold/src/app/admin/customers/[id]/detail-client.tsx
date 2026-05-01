'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CRUDForm,
  ConfirmDialog,
  DestructiveConfirmDialog,
} from '@/components/admin/crud';
import { formatDateTime } from '@/lib/utils';
import { reasonsFor } from '@/lib/reason-codes';
import { updateCustomerSchema, addNoteSchema } from '../schema';
import {
  updateCustomer,
  blockCustomer,
  unblockCustomer,
  suspendCustomer,
  archiveCustomer,
  deleteCustomer,
  addCustomerNote,
  deleteCustomerNote,
} from '../actions';

interface CustomerShape {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  channel: string;
  address: string | null;
  internalFlags: string[];
  isBlocked: boolean;
  blockedReason: string | null;
  suspendedUntil: Date | null;
  archivedAt: Date | null;
}

interface Props {
  customer: CustomerShape;
  notes: Array<{ id: string; body: string; createdAt: Date; authorName: string }>;
  audit: Array<{ id: string; action: string; createdAt: Date; actorName: string; payload: unknown }>;
  bookingCount: number;
  canHardDelete: boolean;
  canArchive: boolean;
}

type Tab = 'profile' | 'notes' | 'audit' | 'bookings';

export function CustomerDetailClient({ customer, notes, audit, bookingCount, canHardDelete, canArchive }: Props) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>('profile');
  const [editing, setEditing] = React.useState(false);

  return (
    <div className="space-y-6">
      {/* Action toolbar */}
      <div className="flex flex-wrap gap-2 rounded-md border bg-muted/30 p-3">
        <button
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Cancel edit' : 'Edit'}
        </button>

        {!customer.isBlocked ? (
          <BlockAction customerId={customer.id} customerName={customer.name} onDone={() => router.refresh()} />
        ) : (
          <UnblockAction customerId={customer.id} onDone={() => router.refresh()} />
        )}

        <SuspendAction customerId={customer.id} onDone={() => router.refresh()} />

        {canArchive && !customer.archivedAt && (
          <ArchiveAction customerId={customer.id} customerName={customer.name} onDone={() => router.refresh()} />
        )}
        {canHardDelete && customer.archivedAt && (
          <DeleteAction customerId={customer.id} customerName={customer.name} onDone={() => router.push('/admin/customers')} />
        )}
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="rounded border bg-muted/20 p-4">
          <h2 className="mb-3 text-sm font-semibold">Edit customer</h2>
          <CRUDForm
            schema={updateCustomerSchema}
            defaultValues={{
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              email: customer.email ?? '',
              channel: customer.channel as any,
              address: customer.address ?? '',
              internalFlags: customer.internalFlags as any,
            }}
            fields={[
              { name: 'id', label: '', type: 'hidden' },
              { name: 'name', label: 'Name', type: 'text', required: true },
              { name: 'phone', label: 'Phone', type: 'tel', required: true },
              { name: 'email', label: 'Email', type: 'email' },
              {
                name: 'channel',
                label: 'Channel',
                type: 'select',
                options: [
                  { value: 'WHATSAPP', label: 'WhatsApp' },
                  { value: 'PWA', label: 'PWA' },
                  { value: 'BOTH', label: 'Both' },
                ],
              },
              { name: 'address', label: 'Address', type: 'textarea' },
              {
                name: 'internalFlags',
                label: 'Internal flags',
                type: 'select',
                multiple: true,
                options: [
                  { value: 'VIP', label: 'VIP' },
                  { value: 'HIGH_RISK', label: 'High risk' },
                  { value: 'DO_NOT_CONTACT_AFTER_18', label: 'Do not contact after 18:00' },
                  { value: 'PAYMENT_RISK', label: 'Payment risk' },
                  { value: 'FRAUD_SUSPECTED', label: 'Fraud suspected' },
                ],
              },
            ]}
            action={updateCustomer}
            onCancel={() => setEditing(false)}
            onSuccess={() => {
              setEditing(false);
              router.refresh();
            }}
            submitLabel="Save changes"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 border-b">
        {(['profile', 'notes', 'audit', 'bookings'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm ${
              tab === t ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
            }`}
          >
            {t === 'profile' && 'Profile'}
            {t === 'notes' && `Notes (${notes.length})`}
            {t === 'audit' && `Audit (${audit.length})`}
            {t === 'bookings' && `Bookings (${bookingCount})`}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">Phone</dt><dd>{customer.phone}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{customer.email ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Channel</dt><dd>{customer.channel}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Address</dt><dd>{customer.address ?? '—'}</dd></div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Internal flags</dt>
            <dd>
              {customer.internalFlags.length === 0 ? (
                '—'
              ) : (
                <div className="flex flex-wrap gap-1">
                  {customer.internalFlags.map((f) => (
                    <span key={f} className="rounded bg-muted px-2 py-0.5 text-xs">
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </dd>
          </div>
        </dl>
      )}

      {tab === 'notes' && (
        <div className="space-y-4">
          <NoteForm customerId={customer.id} onSubmitted={() => router.refresh()} />
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded border p-3 text-sm">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {n.authorName} · {formatDateTime(n.createdAt)}
                  </span>
                  <DestructiveConfirmDialog
                    triggerLabel="Delete"
                    triggerClassName="px-2 py-0.5 text-xs"
                    title="Delete this note?"
                    description="Notes are append-only audit trail by convention, but admins can remove an incorrect one. The deletion itself is audited."
                    confirmText="DELETE"
                    confirmLabel="Delete note"
                    onConfirm={async () => {
                      await deleteCustomerNote({ id: n.id, customerId: customer.id });
                      router.refresh();
                    }}
                  />
                </div>
                <p className="whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
            {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
          </ul>
        </div>
      )}

      {tab === 'audit' && (
        <ul className="space-y-2">
          {audit.map((a) => (
            <li key={a.id} className="rounded border p-3 text-sm">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDateTime(a.createdAt)} · {a.actorName}</span>
                <span className="font-mono">{a.action}</span>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
{JSON.stringify(a.payload, null, 2)}
              </pre>
            </li>
          ))}
          {audit.length === 0 && <p className="text-sm text-muted-foreground">No audit events yet.</p>}
        </ul>
      )}

      {tab === 'bookings' && (
        <div className="text-sm">
          <p className="text-muted-foreground">
            Cross-reference {bookingCount} booking(s). Link to filtered bookings view:
          </p>
          <a
            className="text-primary underline"
            href={`/admin/bookings?customerId=${customer.id}`}
          >
            Open bookings for this customer →
          </a>
        </div>
      )}
    </div>
  );
}

// --- Action components --------------------------------------------------

function BlockAction({ customerId, customerName, onDone }: { customerId: string; customerName: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [reasonCode, setReasonCode] = React.useState('');
  const [note, setNote] = React.useState('');
  const reasons = reasonsFor('customer.block');
  const selected = reasons.find((r) => r.code === reasonCode);

  return (
    <>
      <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600" onClick={() => setOpen(true)}>
        Block
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h3 className="text-lg font-semibold text-red-700">Block {customerName}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The customer can still have historical records visible, but will not be matched to new jobs.
          </p>
          <div className="mt-3 space-y-2">
            <select className="w-full rounded border px-2 py-1 text-sm" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">Select reason…</option>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            {selected?.requiresNote && (
              <textarea className="w-full rounded border px-2 py-1 text-sm" rows={3} placeholder="Required note" value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={!reasonCode || (selected?.requiresNote && !note.trim())}
              onClick={async () => {
                const res = await blockCustomer({ id: customerId, reasonCode, note: note || undefined });
                if (res.ok) {
                  setOpen(false);
                  onDone();
                } else {
                  alert(res.message);
                }
              }}
            >
              Block
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function UnblockAction({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  return (
    <ConfirmDialog
      triggerLabel="Unblock"
      title="Unblock this customer?"
      description="They will be matchable to new jobs immediately."
      onConfirm={async () => {
        const res = await unblockCustomer({ id: customerId, reasonCode: 'MANUAL_UNBLOCK' });
        if (!res.ok) alert(res.message);
        onDone();
      }}
    />
  );
}

function SuspendAction({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [until, setUntil] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [note, setNote] = React.useState('');
  const reasons = reasonsFor('customer.suspend');
  const selected = reasons.find((r) => r.code === reasonCode);

  return (
    <>
      <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>Suspend</button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h3 className="text-lg font-semibold">Suspend customer</h3>
          <div className="mt-3 space-y-2">
            <div>
              <label className="mb-1 block text-xs">Until (local time)</label>
              <input type="datetime-local" className="w-full rounded border px-2 py-1 text-sm" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
            <select className="w-full rounded border px-2 py-1 text-sm" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">Reason…</option>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            {selected?.requiresNote && (
              <textarea className="w-full rounded border px-2 py-1 text-sm" rows={3} placeholder="Required note" value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              disabled={!until || !reasonCode || (selected?.requiresNote && !note.trim())}
              onClick={async () => {
                const res = await suspendCustomer({
                  id: customerId,
                  until: new Date(until).toISOString(),
                  reasonCode,
                  note: note || undefined,
                });
                if (res.ok) {
                  setOpen(false);
                  onDone();
                } else {
                  alert(res.message);
                }
              }}
            >
              Suspend
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ArchiveAction({ customerId, customerName, onDone }: { customerId: string; customerName: string; onDone: () => void }) {
  return (
    <DestructiveConfirmDialog
      triggerLabel="Archive"
      title={`Archive ${customerName}?`}
      description="Soft-delete. The record becomes hidden from default lists but data is preserved. Can be restored by an Admin."
      confirmText={customerName}
      confirmLabel="Archive customer"
      onConfirm={async () => {
        const res = await archiveCustomer({ id: customerId, reasonCode: 'ADMIN_ARCHIVE' });
        if (!res.ok) alert(res.message);
        onDone();
      }}
    />
  );
}

function DeleteAction({ customerId, customerName, onDone }: { customerId: string; customerName: string; onDone: () => void }) {
  return (
    <DestructiveConfirmDialog
      triggerLabel="Hard delete (OWNER)"
      title={`Permanently delete ${customerName}?`}
      description={
        <>
          This is irreversible. Booking records stay but reference a now-deleted customer. Use only for
          POPIA / GDPR erasure requests or confirmed duplicates.
        </>
      }
      confirmText={customerName}
      confirmLabel="Permanently delete"
      onConfirm={async () => {
        const res = await deleteCustomer({ id: customerId, reasonCode: 'GDPR_POPIA_REQUEST' });
        if (!res.ok) alert(res.message);
        onDone();
      }}
    />
  );
}

function NoteForm({ customerId, onSubmitted }: { customerId: string; onSubmitted: () => void }) {
  return (
    <CRUDForm
      schema={addNoteSchema}
      defaultValues={{ customerId, body: '' }}
      fields={[
        { name: 'customerId', label: '', type: 'hidden' },
        { name: 'body', label: 'Note', type: 'textarea', required: true, placeholder: 'Internal note — visible to ops only' },
      ]}
      action={addCustomerNote}
      onSuccess={onSubmitted}
      submitLabel="Add note"
    />
  );
}

// Minimal modal wrapper (same shape as the one in confirm.tsx — inlined here to keep this file self-contained).
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
