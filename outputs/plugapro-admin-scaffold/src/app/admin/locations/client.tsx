'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CRUDTable,
  CRUDForm,
  DestructiveConfirmDialog,
  ConfirmDialog,
} from '@/components/admin/crud';
import { createLocationSchema } from './schema';
import {
  createLocation,
  updateLocationLabel,
  deactivateLocation,
  reactivateLocation,
  deleteLocation,
} from './actions';

interface LocationRow {
  id: string;
  type: string;
  label: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
}

interface Props {
  initialNodes: LocationRow[];
  canHardDelete: boolean;
}

export function LocationsClient({ initialNodes, canHardDelete }: Props) {
  const router = useRouter();
  const [showAdd, setShowAdd] = React.useState(false);

  const parentOptions = initialNodes
    .filter((n) => n.type !== 'SUBURB')
    .map((n) => ({ value: n.id, label: `[${n.type}] ${n.label}` }));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          onClick={() => setShowAdd(true)}
        >
          + Add node
        </button>
      </div>

      {showAdd && (
        <div className="rounded border bg-muted/20 p-4">
          <h2 className="mb-3 text-sm font-semibold">Add node</h2>
          <CRUDForm
            schema={createLocationSchema}
            defaultValues={{ type: 'SUBURB', label: '', slug: '', parentId: null, lat: null, lng: null }}
            fields={[
              {
                name: 'type',
                label: 'Type',
                type: 'select',
                required: true,
                options: [
                  { value: 'PROVINCE', label: 'Province' },
                  { value: 'CITY', label: 'City' },
                  { value: 'REGION', label: 'Region' },
                  { value: 'SUBURB', label: 'Suburb' },
                ],
              },
              { name: 'label', label: 'Label', type: 'text', required: true, placeholder: 'Cape Town' },
              {
                name: 'slug',
                label: 'Slug',
                type: 'text',
                required: true,
                placeholder: 'cape_town',
                helpText: 'Lowercase, underscores only',
              },
              {
                name: 'parentId',
                label: 'Parent',
                type: 'select',
                options: parentOptions,
                helpText: 'Leave blank for provinces.',
              },
              { name: 'lat', label: 'Latitude', type: 'number', placeholder: '-33.9249' },
              { name: 'lng', label: 'Longitude', type: 'number', placeholder: '18.4241' },
            ]}
            action={createLocation}
            onCancel={() => setShowAdd(false)}
            onSuccess={() => {
              setShowAdd(false);
              router.refresh();
            }}
            submitLabel="Add node"
          />
        </div>
      )}

      <CRUDTable<LocationRow>
        rows={initialNodes}
        columns={[
          { header: 'Type', accessor: 'type' },
          {
            header: 'Label',
            accessor: 'label',
            inlineEdit: {
              type: 'text',
              validate: (v) => (v.trim().length === 0 ? 'Required' : null),
              onSave: async (row, newValue) => {
                const res = await updateLocationLabel({ id: row.id, label: newValue });
                if (!res.ok) throw new Error(res.message);
                router.refresh();
              },
            },
          },
          { header: 'Slug', accessor: 'slug' },
          {
            header: 'Status',
            render: (row) => (
              <span className={row.isActive ? 'text-green-700' : 'text-muted-foreground'}>
                {row.isActive ? 'Active' : 'Inactive'}
              </span>
            ),
          },
          {
            header: 'Actions',
            render: (row) => (
              <div className="flex gap-2">
                {row.isActive ? (
                  <ConfirmDialog
                    triggerLabel="Deactivate"
                    title="Deactivate this node?"
                    description="Matching and search will stop using this node, but history is preserved. You can reactivate later."
                    onConfirm={async () => {
                      await deactivateLocation({ id: row.id });
                      router.refresh();
                    }}
                  />
                ) : (
                  <ConfirmDialog
                    triggerLabel="Reactivate"
                    title="Reactivate this node?"
                    description="Matching and search will start using this node again."
                    onConfirm={async () => {
                      await reactivateLocation({ id: row.id });
                      router.refresh();
                    }}
                  />
                )}
                {canHardDelete && (
                  <DestructiveConfirmDialog
                    triggerLabel="Delete"
                    title="Permanently delete this location?"
                    description={
                      <>
                        This cannot be undone. Matching history referencing this node will keep its label as text, but the node itself will be gone.
                      </>
                    }
                    confirmText={row.label}
                    confirmLabel="Delete node"
                    onConfirm={async () => {
                      await deleteLocation({ id: row.id });
                      router.refresh();
                    }}
                  />
                )}
              </div>
            ),
          },
        ]}
        emptyState={<p>No locations yet. Add one above.</p>}
      />
    </div>
  );
}
