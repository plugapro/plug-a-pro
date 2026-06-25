'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CRUDForm,
  CRUDTable,
  ConfirmDialog,
  DestructiveConfirmDialog,
} from '@/components/admin/crud';
import { formatDate, formatDateTime } from '@/lib/utils';
import { reasonsFor } from '@/lib/reason-codes';
import {
  updateProviderProfileSchema,
  certificationSchema,
  equipmentSchema,
  noteSchema,
} from '../schema';
import {
  updateProviderProfile,
  setProviderKyc,
  suspendProvider,
  reactivateProvider,
  deactivateProvider,
  upsertCertification,
  deleteCertification,
  upsertEquipment,
  deleteEquipment,
  addProviderNote,
} from '../actions';

// --- Shapes --------------------------------------------------------------

interface ProviderShape {
  id: string;
  name: string;
  phone: string;
  status: string;
  kycStatus: string;
  strikes: number;
  skills: string[];
  serviceAreas: string[];
  suspendedUntil: Date | null;
  archivedAt: Date | null;
}

interface CertRow {
  id: string;
  type: string;
  number: string | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
  attachmentUrl: string | null;
}

interface EquipRow {
  id: string;
  type: string;
  notes: string | null;
}

interface NoteRow {
  id: string;
  body: string;
  isStrike: boolean;
  createdAt: Date;
  authorName: string;
}

interface AuditRow {
  id: string;
  action: string;
  createdAt: Date;
  actorName: string;
  payload: unknown;
}

interface Props {
  provider: ProviderShape;
  certifications: CertRow[];
  equipment: EquipRow[];
  notes: NoteRow[];
  audit: AuditRow[];
  skillOptions: Array<{ value: string; label: string }>;
  areaOptions: Array<{ value: string; label: string }>;
  canAdmin: boolean;
  canTrust: boolean;
}

type Tab = 'profile' | 'certs' | 'equip' | 'notes' | 'audit';

// --- Component -----------------------------------------------------------

export function ProviderDetailClient(props: Props) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>('profile');

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{props.provider.name}</h1>
          <p className="text-sm text-muted-foreground">
            {props.provider.phone} · {props.provider.status} · KYC {props.provider.kycStatus}
          </p>
          {props.provider.suspendedUntil && new Date(props.provider.suspendedUntil) > new Date() && (
            <p className="mt-1 text-xs text-amber-700">
              Suspended until {formatDateTime(props.provider.suspendedUntil)}
            </p>
          )}
        </div>
        <ActionToolbar provider={props.provider} canAdmin={props.canAdmin} canTrust={props.canTrust} onDone={() => router.refresh()} />
      </header>

      <div className="flex gap-4 border-b">
        {(['profile', 'certs', 'equip', 'notes', 'audit'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm ${tab === t ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
          >
            {t === 'profile' && 'Profile'}
            {t === 'certs' && `Certifications (${props.certifications.length})`}
            {t === 'equip' && `Equipment (${props.equipment.length})`}
            {t === 'notes' && `Notes / strikes (${props.notes.length})`}
            {t === 'audit' && `Audit (${props.audit.length})`}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <ProfileTab
          provider={props.provider}
          skillOptions={props.skillOptions}
          areaOptions={props.areaOptions}
          onSaved={() => router.refresh()}
          canTrust={props.canTrust}
        />
      )}

      {tab === 'certs' && (
        <CertsTab providerId={props.provider.id} rows={props.certifications} onChanged={() => router.refresh()} />
      )}

      {tab === 'equip' && (
        <EquipTab providerId={props.provider.id} rows={props.equipment} onChanged={() => router.refresh()} />
      )}

      {tab === 'notes' && (
        <NotesTab providerId={props.provider.id} rows={props.notes} onChanged={() => router.refresh()} />
      )}

      {tab === 'audit' && <AuditTab rows={props.audit} />}
    </div>
  );
}

// --- Action toolbar (header) --------------------------------------------

function ActionToolbar({
  provider,
  canAdmin,
  canTrust,
  onDone,
}: { provider: ProviderShape; canAdmin: boolean; canTrust: boolean; onDone: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {provider.status === 'SUSPENDED' && canTrust && (
        <ConfirmDialog
          triggerLabel="Reactivate"
          title="Reactivate provider?"
          description="They will start receiving leads again immediately."
          onConfirm={async () => {
            const res = await reactivateProvider({ id: provider.id });
            if (!res.ok) alert(res.message);
            onDone();
          }}
        />
      )}
      {provider.status === 'ACTIVE' && canTrust && (
        <SuspendButton providerId={provider.id} onDone={onDone} />
      )}
      {canAdmin && provider.status !== 'DEACTIVATED' && (
        <DeactivateButton providerId={provider.id} providerName={provider.name} onDone={onDone} />
      )}
    </div>
  );
}

function SuspendButton({ providerId, onDone }: { providerId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [until, setUntil] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [note, setNote] = React.useState('');
  const reasons = reasonsFor('provider.suspend');
  const selected = reasons.find((r) => r.code === reasonCode);

  return (
    <>
      <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
        Suspend
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h3 className="text-lg font-semibold">Suspend provider</h3>
          <div className="mt-3 space-y-2">
            <div>
              <label className="mb-1 block text-xs">Until</label>
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
                const res = await suspendProvider({
                  id: providerId,
                  until: new Date(until).toISOString(),
                  reasonCode,
                  note: note || undefined,
                });
                if (res.ok) {
                  setOpen(false);
                  onDone();
                } else alert(res.message);
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

function DeactivateButton({ providerId, providerName, onDone }: { providerId: string; providerName: string; onDone: () => void }) {
  return (
    <DestructiveConfirmDialog
      triggerLabel="Deactivate"
      title={`Deactivate ${providerName}?`}
      description="This removes them from the marketplace permanently (soft delete). Historical data is retained."
      confirmText={providerName}
      confirmLabel="Deactivate"
      onConfirm={async () => {
        const res = await deactivateProvider({ id: providerId, reasonCode: 'POLICY_VIOLATION' });
        if (!res.ok) alert(res.message);
        onDone();
      }}
    />
  );
}

// --- Profile tab --------------------------------------------------------

function ProfileTab({
  provider,
  skillOptions,
  areaOptions,
  onSaved,
  canTrust,
}: {
  provider: ProviderShape;
  skillOptions: Array<{ value: string; label: string }>;
  areaOptions: Array<{ value: string; label: string }>;
  onSaved: () => void;
  canTrust: boolean;
}) {
  return (
    <div className="space-y-6">
      <CRUDForm
        schema={updateProviderProfileSchema}
        defaultValues={{
          id: provider.id,
          name: provider.name,
          phone: provider.phone,
          skills: provider.skills,
          serviceAreas: provider.serviceAreas,
        }}
        fields={[
          { name: 'id', label: '', type: 'hidden' },
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'phone', label: 'Phone', type: 'tel', required: true },
          { name: 'skills', label: 'Skills', type: 'select', multiple: true, options: skillOptions },
          { name: 'serviceAreas', label: 'Service areas', type: 'select', multiple: true, options: areaOptions },
        ]}
        action={updateProviderProfile}
        onSuccess={onSaved}
        submitLabel="Save profile"
      />

      {canTrust && (
        <div className="rounded border p-3">
          <h3 className="mb-2 text-sm font-semibold">KYC status</h3>
          <div className="flex items-center gap-2">
            <select
              className="rounded border px-2 py-1 text-sm"
              defaultValue={provider.kycStatus}
              onChange={async (e) => {
                const res = await setProviderKyc({ id: provider.id, kycStatus: e.target.value as any });
                if (!res.ok) alert(res.message);
                onSaved();
              }}
            >
              {['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">Auto-saves on change; audited.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Certifications tab -------------------------------------------------

function CertsTab({ providerId, rows, onChanged }: { providerId: string; rows: CertRow[]; onChanged: () => void }) {
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add certification'}
        </button>
      </div>

      {adding && (
        <div className="rounded border p-4">
          <CRUDForm
            schema={certificationSchema}
            defaultValues={{ providerId, type: '', number: '', issuedAt: '', expiresAt: '', attachmentUrl: '' }}
            fields={[
              { name: 'providerId', label: '', type: 'hidden' },
              { name: 'type', label: 'Type', type: 'text', required: true, placeholder: 'Electrical COC' },
              { name: 'number', label: 'Certificate number', type: 'text' },
              { name: 'issuedAt', label: 'Issued', type: 'date' },
              { name: 'expiresAt', label: 'Expires', type: 'date' },
              { name: 'attachmentUrl', label: 'Attachment URL', type: 'text', helpText: 'Optional — paste a signed blob URL' },
            ]}
            action={upsertCertification}
            onSuccess={() => {
              setAdding(false);
              onChanged();
            }}
            submitLabel="Add"
          />
        </div>
      )}

      <CRUDTable<CertRow>
        rows={rows}
        columns={[
          { header: 'Type', accessor: 'type' },
          { header: 'Number', render: (r) => r.number ?? '—' },
          { header: 'Issued', render: (r) => formatDate(r.issuedAt) },
          { header: 'Expires', render: (r) => formatDate(r.expiresAt) },
          {
            header: 'Actions',
            render: (r) => (
              <div className="flex gap-2">
                <button className="rounded border px-2 py-0.5 text-xs" onClick={() => setEditing(r.id)}>
                  Edit
                </button>
                <DestructiveConfirmDialog
                  triggerLabel="Delete"
                  triggerClassName="px-2 py-0.5 text-xs"
                  title="Delete certification?"
                  description="The provider will become ineligible for any job requiring this certification."
                  confirmText="DELETE"
                  onConfirm={async () => {
                    await deleteCertification({ providerId, id: r.id });
                    onChanged();
                  }}
                />
              </div>
            ),
          },
        ]}
        emptyState={<p>No certifications captured yet.</p>}
      />

      {editing && (
        <EditCertModal
          providerId={providerId}
          cert={rows.find((r) => r.id === editing)!}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function EditCertModal({ providerId, cert, onClose, onSaved }: { providerId: string; cert: CertRow; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal onClose={onClose}>
      <h3 className="mb-3 text-lg font-semibold">Edit certification</h3>
      <CRUDForm
        schema={certificationSchema}
        defaultValues={{
          providerId,
          id: cert.id,
          type: cert.type,
          number: cert.number ?? '',
          issuedAt: cert.issuedAt ? new Date(cert.issuedAt).toISOString().slice(0, 10) : '',
          expiresAt: cert.expiresAt ? new Date(cert.expiresAt).toISOString().slice(0, 10) : '',
          attachmentUrl: cert.attachmentUrl ?? '',
        }}
        fields={[
          { name: 'providerId', label: '', type: 'hidden' },
          { name: 'id', label: '', type: 'hidden' },
          { name: 'type', label: 'Type', type: 'text', required: true },
          { name: 'number', label: 'Number', type: 'text' },
          { name: 'issuedAt', label: 'Issued', type: 'date' },
          { name: 'expiresAt', label: 'Expires', type: 'date' },
          { name: 'attachmentUrl', label: 'Attachment URL', type: 'text' },
        ]}
        action={upsertCertification}
        onCancel={onClose}
        onSuccess={onSaved}
        submitLabel="Save"
      />
    </Modal>
  );
}

// --- Equipment tab ------------------------------------------------------

function EquipTab({ providerId, rows, onChanged }: { providerId: string; rows: EquipRow[]; onChanged: () => void }) {
  const [adding, setAdding] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add equipment'}
        </button>
      </div>

      {adding && (
        <div className="rounded border p-4">
          <CRUDForm
            schema={equipmentSchema}
            defaultValues={{ providerId, type: '', notes: '' }}
            fields={[
              { name: 'providerId', label: '', type: 'hidden' },
              { name: 'type', label: 'Type', type: 'text', required: true, placeholder: 'Multimeter' },
              { name: 'notes', label: 'Notes', type: 'textarea' },
            ]}
            action={upsertEquipment}
            onSuccess={() => {
              setAdding(false);
              onChanged();
            }}
            submitLabel="Add"
          />
        </div>
      )}

      <CRUDTable<EquipRow>
        rows={rows}
        columns={[
          { header: 'Type', accessor: 'type' },
          { header: 'Notes', render: (r) => r.notes ?? '—' },
          {
            header: 'Actions',
            render: (r) => (
              <DestructiveConfirmDialog
                triggerLabel="Delete"
                triggerClassName="px-2 py-0.5 text-xs"
                title="Delete equipment entry?"
                description="The provider will become ineligible for any job requiring this equipment."
                confirmText="DELETE"
                onConfirm={async () => {
                  await deleteEquipment({ providerId, id: r.id });
                  onChanged();
                }}
              />
            ),
          },
        ]}
        emptyState={<p>No equipment captured yet.</p>}
      />
    </div>
  );
}

// --- Notes tab ----------------------------------------------------------

function NotesTab({ providerId, rows, onChanged }: { providerId: string; rows: NoteRow[]; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <CRUDForm
        schema={noteSchema}
        defaultValues={{ providerId, body: '', isStrike: false }}
        fields={[
          { name: 'providerId', label: '', type: 'hidden' },
          { name: 'body', label: 'Note', type: 'textarea', required: true },
          { name: 'isStrike', label: 'This is a strike (increments strike counter)', type: 'checkbox' },
        ]}
        action={addProviderNote}
        onSuccess={onChanged}
        submitLabel="Add note"
      />

      <ul className="space-y-2">
        {rows.map((n) => (
          <li key={n.id} className={`rounded border p-3 text-sm ${n.isStrike ? 'border-red-300 bg-red-50' : ''}`}>
            <div className="mb-1 text-xs text-muted-foreground">
              {n.authorName} · {formatDateTime(n.createdAt)}
              {n.isStrike && <span className="ml-2 rounded bg-red-200 px-1 text-[10px] text-red-900">STRIKE</span>}
            </div>
            <p className="whitespace-pre-wrap">{n.body}</p>
          </li>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
      </ul>
    </div>
  );
}

// --- Audit tab ----------------------------------------------------------

function AuditTab({ rows }: { rows: AuditRow[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((a) => (
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
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No audit events yet.</p>}
    </ul>
  );
}

// --- Shared modal -------------------------------------------------------

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
