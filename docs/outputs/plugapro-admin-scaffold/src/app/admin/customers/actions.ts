'use server';

// Customers CRUD server actions. Every one goes through crudAction().

import { z } from 'zod';
import { Role } from '@prisma/client';
import { crudAction } from '@/lib/crud-action';
import { diff } from '@/lib/audit';
import {
  createCustomerSchema,
  updateCustomerSchema,
  blockCustomerSchema,
  suspendCustomerSchema,
  archiveCustomerSchema,
  mergeCustomersSchema,
  addNoteSchema,
} from './schema';

const deleteNoteSchema = z.object({ id: z.string(), customerId: z.string() });

// --- Create --------------------------------------------------------------

export const createCustomer = crudAction({
  name: 'customer.create',
  entity: 'Customer',
  schema: createCustomerSchema,
  requiredRole: [Role.OPS, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: ['/admin/customers'],
  auditPayload: (input, out) => ({ after: out.created }),
  run: async (input, ctx) => {
    const existing = await ctx.db.customer.findUnique({ where: { phone: input.phone } });
    if (existing) {
      throw Object.assign(new Error('Phone already registered'), { code: 'P2002' });
    }
    const created = await ctx.db.customer.create({
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        channel: input.channel,
        address: input.address || null,
      },
    });
    return { entityId: created.id, created };
  },
});

// --- Update --------------------------------------------------------------

export const updateCustomer = crudAction({
  name: 'customer.update',
  entity: 'Customer',
  schema: updateCustomerSchema,
  requiredRole: [Role.OPS, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: (input) => ['/admin/customers', `/admin/customers/${input.id}`],
  auditPayload: (_input, out) => diff(out.before, out.after),
  run: async (input, ctx) => {
    const before = await ctx.db.customer.findUniqueOrThrow({ where: { id: input.id } });
    const after = await ctx.db.customer.update({
      where: { id: input.id },
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        channel: input.channel,
        address: input.address || null,
        internalFlags: input.internalFlags ?? before.internalFlags,
      },
    });
    return { entityId: input.id, before, after };
  },
});

// --- Block ---------------------------------------------------------------

export const blockCustomer = crudAction({
  name: 'customer.block',
  entity: 'Customer',
  schema: blockCustomerSchema,
  requiredRole: [Role.OPS, Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: (input) => ['/admin/customers', `/admin/customers/${input.id}`],
  auditPayload: (input) => ({ reasonCode: input.reasonCode, note: input.note }),
  run: async (input, ctx) => {
    const after = await ctx.db.customer.update({
      where: { id: input.id },
      data: {
        isBlocked: true,
        blockedReason: input.reasonCode,
        blockedAt: new Date(),
      },
    });
    return { entityId: input.id, after };
  },
});

export const unblockCustomer = crudAction({
  name: 'customer.unblock',
  entity: 'Customer',
  schema: blockCustomerSchema, // reuses: requires reasonCode for unblock too
  requiredRole: [Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: (input) => ['/admin/customers', `/admin/customers/${input.id}`],
  auditPayload: (input) => ({ reasonCode: input.reasonCode, note: input.note }),
  run: async (input, ctx) => {
    const after = await ctx.db.customer.update({
      where: { id: input.id },
      data: {
        isBlocked: false,
        blockedReason: null,
        blockedAt: null,
      },
    });
    return { entityId: input.id, after };
  },
});

// --- Suspend -------------------------------------------------------------

export const suspendCustomer = crudAction({
  name: 'customer.suspend',
  entity: 'Customer',
  schema: suspendCustomerSchema,
  requiredRole: [Role.OPS, Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: (input) => ['/admin/customers', `/admin/customers/${input.id}`],
  auditPayload: (input) => ({ until: input.until, reasonCode: input.reasonCode, note: input.note }),
  run: async (input, ctx) => {
    const after = await ctx.db.customer.update({
      where: { id: input.id },
      data: {
        suspendedUntil: new Date(input.until),
        suspendedReason: input.reasonCode,
      },
    });
    return { entityId: input.id, after };
  },
});

// --- Archive (soft delete) ----------------------------------------------

export const archiveCustomer = crudAction({
  name: 'customer.archive',
  entity: 'Customer',
  schema: archiveCustomerSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: (input) => ['/admin/customers', `/admin/customers/${input.id}`],
  auditPayload: (input) => ({ reasonCode: input.reasonCode, note: input.note }),
  run: async (input, ctx) => {
    const after = await ctx.db.customer.update({
      where: { id: input.id },
      data: {
        archivedAt: new Date(),
        archiveReason: input.reasonCode,
      },
    });
    return { entityId: input.id, after };
  },
});

// --- Delete (OWNER only, hard) ------------------------------------------

export const deleteCustomer = crudAction({
  name: 'customer.delete',
  entity: 'Customer',
  schema: archiveCustomerSchema, // same shape
  requiredRole: [Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: ['/admin/customers'],
  auditPayload: (input) => ({ reasonCode: input.reasonCode, note: input.note, hardDelete: true }),
  run: async (input, ctx) => {
    const before = await ctx.db.customer.findUniqueOrThrow({ where: { id: input.id } });
    if (!before.archivedAt) {
      throw new Error('Archive the customer first before a hard delete.');
    }
    // Open bookings? Reject.
    // (Adjust the table name + status enum to match your real schema.)
    const openBookings = await ctx.db.booking.count({
      where: { customerId: input.id, status: { in: ['SCHEDULED', 'IN_PROGRESS'] as any } },
    });
    if (openBookings > 0) {
      throw new Error(`Cannot delete: ${openBookings} open booking(s) exist.`);
    }
    await ctx.db.customer.delete({ where: { id: input.id } });
    return { entityId: input.id, deleted: true };
  },
});

// --- Merge duplicates ---------------------------------------------------

export const mergeCustomers = crudAction({
  name: 'customer.merge',
  entity: 'Customer',
  schema: mergeCustomersSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: ['/admin/customers'],
  auditPayload: (input) => ({ sourceId: input.sourceId, targetId: input.targetId, reasonCode: input.reasonCode, note: input.note }),
  run: async (input, ctx) => {
    if (input.sourceId === input.targetId) {
      throw new Error('Source and target must differ');
    }
    const [source, target] = await Promise.all([
      ctx.db.customer.findUniqueOrThrow({ where: { id: input.sourceId } }),
      ctx.db.customer.findUniqueOrThrow({ where: { id: input.targetId } }),
    ]);
    // Move references. Adjust to your real relation names.
    await ctx.db.booking.updateMany({ where: { customerId: input.sourceId }, data: { customerId: input.targetId } });
    await ctx.db.customerNote.updateMany({ where: { customerId: input.sourceId }, data: { customerId: input.targetId } });
    await ctx.db.customer.update({
      where: { id: input.sourceId },
      data: { archivedAt: new Date(), archiveReason: `merged_into:${input.targetId}` },
    });
    return { entityId: input.targetId, source, target };
  },
});

// --- Notes ---------------------------------------------------------------

export const addCustomerNote = crudAction({
  name: 'customer.note.add',
  entity: 'CustomerNote',
  schema: addNoteSchema,
  requiredRole: [Role.OPS, Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: (input) => [`/admin/customers/${input.customerId}`],
  auditPayload: (input) => ({ body: input.body }),
  run: async (input, ctx) => {
    const note = await ctx.db.customerNote.create({
      data: {
        customerId: input.customerId,
        authorId: ctx.session.user.id,
        body: input.body,
      },
    });
    return { entityId: note.id, note };
  },
});

export const deleteCustomerNote = crudAction({
  name: 'customer.note.delete',
  entity: 'CustomerNote',
  schema: deleteNoteSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  revalidate: (input) => [`/admin/customers/${input.customerId}`],
  run: async (input, ctx) => {
    await ctx.db.customerNote.delete({ where: { id: input.id } });
    return { entityId: input.id, deleted: true };
  },
});
