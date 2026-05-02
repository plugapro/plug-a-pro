'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CRUDTable } from '@/components/admin/crud';

interface Row {
  id: string;
  name: string;
  phone: string;
  status: string;
  kycStatus: string;
  strikes: number;
  certCount: number;
  equipCount: number;
  archivedAt: Date | null;
}

interface Props {
  initial: Row[];
  filters: { q: string; status: string; kyc: string; includeArchived: boolean };
}

export function ProvidersListClient({ initial, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();

  const updateFilter = (key: string, value: string | boolean) => {
    const params = new URLSearchParams(sp?.toString() ?? '');
    if (value === '' || value === false) params.delete(key);
    else params.set(key, value === true ? '1' : String(value));
    router.push(`/admin/providers?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <input
          defaultValue={filters.q}
          placeholder="Search name or phone"
          className="flex-1 rounded border px-2 py-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') updateFilter('q', (e.target as HTMLInputElement).value);
          }}
        />
        <select value={filters.status} className="rounded border px-2 py-1 text-sm" onChange={(e) => updateFilter('status', e.target.value)}>
          <option value="">Any status</option>
          <option value="APPLICATION_PENDING">Application pending</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>
        <select value={filters.kyc} className="rounded border px-2 py-1 text-sm" onChange={(e) => updateFilter('kyc', e.target.value)}>
          <option value="">Any KYC</option>
          <option value="NOT_STARTED">Not started</option>
          <option value="PENDING">Pending</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(e) => updateFilter('archived', e.target.checked)}
          />
          Include archived
        </label>
      </div>

      <CRUDTable<Row>
        rows={initial}
        rowHref={(r) => `/admin/providers/${r.id}`}
        columns={[
          { header: 'Name', accessor: 'name' },
          { header: 'Phone', accessor: 'phone' },
          {
            header: 'Status',
            render: (r) => (
              <span className={
                r.status === 'ACTIVE' ? 'text-green-700' :
                r.status === 'SUSPENDED' ? 'text-amber-600' :
                r.status === 'DEACTIVATED' ? 'text-red-600' :
                'text-muted-foreground'
              }>
                {r.status}
              </span>
            ),
          },
          { header: 'KYC', accessor: 'kycStatus' },
          { header: 'Strikes', render: (r) => (r.strikes > 0 ? <span className="text-red-600">{r.strikes}</span> : '0') },
          { header: 'Certs', accessor: 'certCount' },
          { header: 'Equip', accessor: 'equipCount' },
        ]}
        emptyState={<p>No providers match these filters.</p>}
      />
    </div>
  );
}
