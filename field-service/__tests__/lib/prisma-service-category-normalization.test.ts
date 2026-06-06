import { describe, expect, it } from 'vitest'

import { normalizeServiceCategoryPrismaArgs } from '@/lib/prisma-service-category-normalization'

describe('normalizeServiceCategoryPrismaArgs', () => {
  it('normalizes create data for provider applications, providers and job requests', () => {
    const providerApplicationArgs = {
      data: {
        name: 'Applicant',
        skills: ['Plumbing', 'DIY & Assembly'],
      },
    }
    normalizeServiceCategoryPrismaArgs('ProviderApplication', 'create', providerApplicationArgs)
    expect(providerApplicationArgs.data.skills).toEqual(['plumbing', 'diy'])

    const providerArgs = {
      data: {
        name: 'Provider',
        skills: ['Garden & Landscaping'],
      },
    }
    normalizeServiceCategoryPrismaArgs('Provider', 'create', providerArgs)
    expect(providerArgs.data.skills).toEqual(['garden'])

    const jobArgs = { data: { title: 'Leak', category: 'Plumbing' } }
    normalizeServiceCategoryPrismaArgs('JobRequest', 'create', jobArgs)
    expect(jobArgs.data.category).toBe('plumbing')
  })

  it('normalizes createMany arrays, update list operations and upsert create/update payloads', () => {
    const createManyArgs = {
      data: [
        { name: 'A', skills: ['Plumbing'] },
        { name: 'B', skills: ['Painting'] },
      ],
    }
    normalizeServiceCategoryPrismaArgs('Provider', 'createMany', createManyArgs)
    expect(createManyArgs.data.map((row) => row.skills)).toEqual([['plumbing'], ['painting']])

    const updateArgs = {
      data: {
        skills: { set: ['DIY & Assembly'], push: 'Plumbing' },
      },
    }
    normalizeServiceCategoryPrismaArgs('ProviderApplication', 'update', updateArgs)
    expect(updateArgs.data.skills).toEqual({ set: ['diy'], push: 'plumbing' })

    const upsertArgs = {
      create: { category: 'Plumbing', title: 'Leak' },
      update: { category: 'Painting' },
    }
    normalizeServiceCategoryPrismaArgs('JobRequest', 'upsert', upsertArgs)
    expect(upsertArgs).toMatchObject({
      create: { category: 'plumbing' },
      update: { category: 'painting' },
    })
  })

  it('normalizes nested writes only when the nested key maps to a targeted model', () => {
    const args = {
      data: {
        name: 'Outer Plumbing Label',
        provider: {
          update: {
            skills: ['Plumbing'],
            name: 'Keep Plumbing Label',
          },
        },
        jobRequests: {
          create: [{ category: 'Plumbing', title: 'Leak' }],
        },
      },
    }

    normalizeServiceCategoryPrismaArgs('ProviderApplication', 'update', args)

    expect(args.data.name).toBe('Outer Plumbing Label')
    expect(args.data.provider.update.skills).toEqual(['plumbing'])
    expect(args.data.provider.update.name).toBe('Keep Plumbing Label')
    expect(args.data.jobRequests.create[0].category).toBe('plumbing')
  })

  it('canonicalizes service area waitlist category while leaving unrelated category fields alone', () => {
    const waitlistArgs = { data: { phone: '+2782', city: 'Cape Town', category: 'Plumbing' } }
    normalizeServiceCategoryPrismaArgs('ServiceAreaWaitlist', 'create', waitlistArgs)
    expect(waitlistArgs.data.category).toBe('plumbing')

    const customerArgs = { data: { category: 'Plumbing', name: 'Not a target model' } }
    normalizeServiceCategoryPrismaArgs('Customer', 'create', customerArgs)
    expect(customerArgs.data.category).toBe('Plumbing')
  })
})
