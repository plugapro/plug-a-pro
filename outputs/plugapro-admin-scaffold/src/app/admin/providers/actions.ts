'use server';

// Providers CRUD server actions.
// Adjust Prisma field names (`skills`, `serviceAreas`) to match your real model.

import { Role } from '@prisma/client';
import { crudAction } from '@/lib/crud-action';
import { diff } from '@/lib/audit';
import {
  createProviderSchema,
  updateProviderProfileSchema,
  setProviderKycSchema,
  suspendProviderSchema,
  deactivateProviderSchema,
  certificationSchema,
  equipmentSchema,
  noteSchema,
  idSchema,
  providerIdSchema,
} from './schema';

// --- Provider core -------------------------------------------------------

export const createProvider = crudAction({
  name: 'provider.create',
  entity: 'Provider',
  schema: createProviderSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: ['/admin/providers'],
  run: async (input, ctx) => {
    const created = await ctx.db.provider.create({
      data: {
        name: input.name,
        phone: input.phone,
        skills: input.skills,
        serviceAreas: input.serviceAreas,
        status: 'ACTIVE',
      },
    });
    return { entityId: created.id, created };
  },
});

export const updateProviderProfile = crudAction({
  name: 'provider.updateProfile',
  entity: 'Provider',
  schema: updateProviderProfileSchema,
  requiredRole: [Role.OPS, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => ['/admin/providers', `/admin/providers/${input.id}`],
  auditPayload: (_input, out) => diff(out.before, out.after),
  run: async (input, ctx) => {
    const before = await ctx.db.provider.findUniqueOrThrow({ where: { id: input.id } });
    const after = await ctx.db.provider.update({
      where: { id: input.id },
      data: {
        name: input.name,
        phone: input.phone,
        skills: input.skills,
        serviceAreas: input.serviceAreas,
      },
    });
    return { entityId: input.id, before, after };
  },
});

export const setProviderKyc = crudAction({
  name: 'provider.setKyc',
  entity: 'Provider',
  schema: setProviderKycSchema,
  requiredRole: [Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => [`/admin/providers/${input.id}`],
  auditPayload: (input) => ({ kycStatus: input.kycStatus, note: input.note }),
  run: async (input, ctx) => {
    const after = await ctx.db.provider.update({
      where: { id: input.id },
      data: { kycStatus: input.kycStatus },
    });
    return { entityId: input.id, after };
  },
});

export const suspendProvider = crudAction({
  name: 'provider.suspend',
  entity: 'Provider',
  schema: suspendProviderSchema,
  requiredRole: [Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => [`/admin/providers/${input.id}`],
  auditPayload: (input) => ({ until: input.until, reasonCode: input.reasonCode, note: input.note }),
  run: async (input, ctx) => {
    const after = await ctx.db.provider.update({
      where: { id: input.id },
      data: {
        status: 'SUSPENDED',
        suspendedUntil: new Date(input.until),
        suspendedReason: input.reasonCode,
      },
    });
    return { entityId: input.id, after };
  },
});

export const reactivateProvider = crudAction({
  name: 'provider.reactivate',
  entity: 'Provider',
  schema: idSchema,
  requiredRole: [Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => [`/admin/providers/${input.id}`],
  run: async (input, ctx) => {
    const after = await ctx.db.provider.update({
      where: { id: input.id },
      data: { status: 'ACTIVE', suspendedUntil: null, suspendedReason: null },
    });
    return { entityId: input.id, after };
  },
});

export const deactivateProvider = crudAction({
  name: 'provider.deactivate',
  entity: 'Provider',
  schema: deactivateProviderSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => ['/admin/providers', `/admin/providers/${input.id}`],
  auditPayload: (input) => ({ reasonCode: input.reasonCode, note: input.note }),
  run: async (input, ctx) => {
    const after = await ctx.db.provider.update({
      where: { id: input.id },
      data: { status: 'DEACTIVATED', archivedAt: new Date(), archiveReason: input.reasonCode },
    });
    return { entityId: input.id, after };
  },
});

// --- Certifications ------------------------------------------------------

export const upsertCertification = crudAction({
  name: 'provider.certification.upsert',
  entity: 'ProviderCertification',
  schema: certificationSchema,
  requiredRole: [Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => [`/admin/providers/${input.providerId}`],
  run: async (input, ctx) => {
    if (input.id) {
      const updated = await ctx.db.providerCertification.update({
        where: { id: input.id },
        data: {
          type: input.type,
          number: input.number,
          issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          attachmentUrl: input.attachmentUrl,
        },
      });
      return { entityId: updated.id, cert: updated };
    }
    const created = await ctx.db.providerCertification.create({
      data: {
        providerId: input.providerId,
        type: input.type,
        number: input.number,
        issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        attachmentUrl: input.attachmentUrl,
      },
    });
    return { entityId: created.id, cert: created };
  },
});

export const deleteCertification = crudAction({
  name: 'provider.certification.delete',
  entity: 'ProviderCertification',
  schema: providerIdSchema,
  requiredRole: [Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => [`/admin/providers/${input.providerId}`],
  run: async (input, ctx) => {
    await ctx.db.providerCertification.delete({ where: { id: input.id } });
    return { entityId: input.id, deleted: true };
  },
});

// --- Equipment -----------------------------------------------------------

export const upsertEquipment = crudAction({
  name: 'provider.equipment.upsert',
  entity: 'ProviderEquipment',
  schema: equipmentSchema,
  requiredRole: [Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => [`/admin/providers/${input.providerId}`],
  run: async (input, ctx) => {
    if (input.id) {
      const updated = await ctx.db.providerEquipment.update({
        where: { id: input.id },
        data: { type: input.type, notes: input.notes },
      });
      return { entityId: updated.id, equipment: updated };
    }
    const created = await ctx.db.providerEquipment.create({
      data: { providerId: input.providerId, type: input.type, notes: input.notes },
    });
    return { entityId: created.id, equipment: created };
  },
});

export const deleteEquipment = crudAction({
  name: 'provider.equipment.delete',
  entity: 'ProviderEquipment',
  schema: providerIdSchema,
  requiredRole: [Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => [`/admin/providers/${input.providerId}`],
  run: async (input, ctx) => {
    await ctx.db.providerEquipment.delete({ where: { id: input.id } });
    return { entityId: input.id, deleted: true };
  },
});

// --- Notes / strikes -----------------------------------------------------

export const addProviderNote = crudAction({
  name: 'provider.note.add',
  entity: 'ProviderNote',
  schema: noteSchema,
  requiredRole: [Role.OPS, Role.TRUST, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.providers',
  revalidate: (input) => [`/admin/providers/${input.providerId}`],
  run: async (input, ctx) => {
    const note = await ctx.db.providerNote.create({
      data: {
        providerId: input.providerId,
        authorId: ctx.session.user.id,
        body: input.body,
        isStrike: input.isStrike ?? false,
      },
    });
    if (input.isStrike) {
      await ctx.db.provider.update({
        where: { id: input.providerId },
        data: { strikes: { increment: 1 } },
      });
    }
    return { entityId: note.id, note };
  },
});
