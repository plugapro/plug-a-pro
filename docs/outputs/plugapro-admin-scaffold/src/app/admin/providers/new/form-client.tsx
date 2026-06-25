'use client';

import { useRouter } from 'next/navigation';
import { CRUDForm } from '@/components/admin/crud';
import { createProviderSchema } from '../schema';
import { createProvider } from '../actions';

interface Props {
  skillOptions: Array<{ value: string; label: string }>;
  areaOptions: Array<{ value: string; label: string }>;
}

export function NewProviderForm({ skillOptions, areaOptions }: Props) {
  const router = useRouter();
  return (
    <CRUDForm
      schema={createProviderSchema}
      defaultValues={{ name: '', phone: '', skills: [], serviceAreas: [] }}
      fields={[
        { name: 'name', label: 'Full name', type: 'text', required: true },
        { name: 'phone', label: 'Phone', type: 'tel', required: true, placeholder: '+27...' },
        { name: 'skills', label: 'Skills', type: 'select', multiple: true, required: true, options: skillOptions },
        { name: 'serviceAreas', label: 'Service areas (regions)', type: 'select', multiple: true, required: true, options: areaOptions },
      ]}
      action={createProvider}
      onCancel={() => router.push('/admin/providers')}
      onSuccess={(data) => router.push(`/admin/providers/${data.entityId}`)}
      submitLabel="Create provider"
    />
  );
}
