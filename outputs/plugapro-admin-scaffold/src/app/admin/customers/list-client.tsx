'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CRUDTable } from '@/components/admin/crud';
import { toCsv } from '@/lib/utils';

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  channel: string;
  isBlocked: boolean;
  archivedAt: Date | null;
}

interface Props {
  initial: CustomerRow[];
  filters: { q: string; channel: string; blocked: boolean; includeArchived: boolean };
}

export function CustomersListClient({ initial, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();

  const updateFilter = (key: string, value: string | boolean) => {
    const params = new URLSearchParams(sp?.toString() ?? '');
    if (value === '' || value === false) params.delete(key);
    else params.set(key, value === true ? '1' : String(value));
    router.push(`/admin/customers?${params.toString()}`);
  };

  const exportCsv = (rows: CustomerRow[]) => {
    const csv = toCsv(
      rows.map((r) => ({ ...r, archivedAt: r.archivedAt ? new Date(r.archivedAt).toISOString() : '' })),
      [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'channel', label: 'Channel' },
        { key: 'isBlocked', label: 'Blocked' },
        { key: 'archivedAt', label: 'Archived' },
      ],
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <input
          defaultValue={filters.q}
          placeholder="Search name / phone / email"
          className="flex-1 rounded border px-2 py-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') updateFilter('q', (e.target as HTMLInputElement).value);
          }}
        />
        <select
          value={filters.channel}
          className="rounded border px-2 py-1 text-sm"
          onChange={(e) => updateFilter('channel', e.target.value)}
        >
          <option value="">Any channel</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="PWA">PWA</option>
          <option value="BOTH">Both</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={filters.blocked}
            onChange={(e) => updateFilter('blocked', e.target.checked)}
          />
          Blocked only
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(e) => updateFilter('archived', e.target.checked)}
          />
          Include archived
        </label>
      </div>

      <CRUDTable<CustomerRow>
        rows={initial}
        rowHref={(row) => `/admin/customers/${row.id}`}
        columns={[
          { header: 'Name', accessor: 'name' },
          { header: 'Phone', accessor: 'phone' },
          { header: 'Email', render: (r) => r.email ?? '—' },
          { header: 'Channel', accessor: 'channel' },
          {
            header: 'Status',
            render: (r) =>
              r.archivedAt ? (
                <span className="text-muted-foreground">Archived</span>
              ) : r.isBlocked ? (
                <span className="text-red-600">Blocked</span>
              ) : (
                <span className="text-green-700">Active</span>
              ),
          },
        ]}
        bulk={{
          maxSelect: 50,
          actions: [
            {
              label: 'Export selected to CSV',
              onSelect: (rows) => exportCsv(rows),
            },
          ],
        }}
        emptyState={<p>No customers match these filters.</p>}
      />
    </div>
  );
}
