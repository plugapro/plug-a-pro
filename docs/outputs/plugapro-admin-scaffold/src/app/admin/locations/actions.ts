'use server';

// Locations CRUD — refactored onto the kit as the proof of pattern.
//
// If your existing Location model uses a different shape, adapt the Prisma
// calls here. The point of this file is the SHAPE, not the exact schema.

import { Role } from '@prisma/client';
import { crudAction } from '@/lib/crud-action';
import {
  createLocationSchema,
  updateLocationLabelSchema,
  locationIdSchema,
} from './schema';

export const createLocation = crudAction({
  name: 'location.create',
  entity: 'Location',
  schema: createLocationSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  revalidate: ['/admin/locations'],
  run: async (input, ctx) => {
    const created = await ctx.db.location.create({
      data: {
        type: input.type,
        label: input.label,
        slug: input.slug,
        parentId: input.parentId ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
      },
    });
    return { entityId: created.id, created };
  },
});

export const updateLocationLabel = crudAction({
  name: 'location.updateLabel',
  entity: 'Location',
  schema: updateLocationLabelSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  revalidate: ['/admin/locations'],
  auditPayload: (input, out) => ({ before: { label: out.before.label }, after: { label: input.label } }),
  run: async (input, ctx) => {
    const before = await ctx.db.location.findUniqueOrThrow({ where: { id: input.id } });
    const after = await ctx.db.location.update({
      where: { id: input.id },
      data: { label: input.label },
    });
    return { entityId: input.id, before, after };
  },
});

export const deactivateLocation = crudAction({
  name: 'location.deactivate',
  entity: 'Location',
  schema: locationIdSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  revalidate: ['/admin/locations'],
  run: async (input, ctx) => {
    const after = await ctx.db.location.update({
      where: { id: input.id },
      data: { isActive: false },
    });
    return { entityId: input.id, after };
  },
});

export const reactivateLocation = crudAction({
  name: 'location.reactivate',
  entity: 'Location',
  schema: locationIdSchema,
  requiredRole: [Role.ADMIN, Role.OWNER],
  revalidate: ['/admin/locations'],
  run: async (input, ctx) => {
    const after = await ctx.db.location.update({
      where: { id: input.id },
      data: { isActive: true },
    });
    return { entityId: input.id, after };
  },
});

export const deleteLocation = crudAction({
  name: 'location.delete',
  entity: 'Location',
  schema: locationIdSchema,
  requiredRole: [Role.OWNER], // Hard delete is OWNER-only.
  revalidate: ['/admin/locations'],
  run: async (input, ctx) => {
    // Protect against deleting a node with children.
    const childCount = await ctx.db.location.count({ where: { parentId: input.id } });
    if (childCount > 0) {
      throw new Error(`Cannot delete location with ${childCount} child node(s). Remove or reparent children first.`);
    }
    await ctx.db.location.delete({ where: { id: input.id } });
    return { entityId: input.id, deleted: true };
  },
});
