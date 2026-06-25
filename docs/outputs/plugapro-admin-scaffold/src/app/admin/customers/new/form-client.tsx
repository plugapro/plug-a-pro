'use client';

import { useRouter } from 'next/navigation';
import { CRUDForm } from '@/components/admin/crud';
import { createCustomerSchema } from '../schema';
import { createCustomer } from '../actions';

export function NewCustomerForm() {
  const router = useRouter();

  return (
    <CRUDForm
      schema={createCustomerSchema}
      defaultValues={{ name: '', phone: '', email: '', channel: 'WHATSAPP', address: '' }}
      fields={[
        { name: 'name', label: 'Full name', type: 'text', required: true },
        { name: 'phone', label: 'Phone', type: 'tel', required: true, placeholder: '+27...' },
        { name: 'email', label: 'Email', type: 'email', helpText: 'Optional' },
        {
          name: 'channel',
          label: 'Preferred channel',
          type: 'select',
          options: [
            { value: 'WHATSAPP', label: 'WhatsApp' },
            { value: 'PWA', label: 'App / PWA' },
            { value: 'BOTH', label: 'Both' },
          ],
        },
        { name: 'address', label: 'Address', type: 'textarea' },
      ]}
      action={createCustomer}
      onCancel={() => router.push('/admin/customers')}
      onSuccess={(data) => router.push(`/admin/customers/${data.entityId}`)}
      submitLabel="Create customer"
    />
  );
}
