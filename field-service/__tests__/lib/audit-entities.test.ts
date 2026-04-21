import { AUDIT_ENTITY } from '@/lib/audit-entities'

it('exports canonical entity name strings', () => {
  expect(AUDIT_ENTITY.JOB_REQUEST).toBe('JobRequest')
  expect(AUDIT_ENTITY.QUOTE).toBe('Quote')
  expect(AUDIT_ENTITY.BOOKING).toBe('Booking')
  expect(AUDIT_ENTITY.PAYMENT).toBe('Payment')
  expect(AUDIT_ENTITY.DISPUTE).toBe('Dispute')
  expect(AUDIT_ENTITY.CUSTOMER).toBe('Customer')
  expect(AUDIT_ENTITY.PROVIDER).toBe('Provider')
})
