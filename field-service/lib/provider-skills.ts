import { labelsFromServiceCategoryTags, normalizeServiceCategorySelections } from './service-categories'

type ProviderSkillsClient = {
  technicianSkill?: {
    updateMany: (...args: any[]) => Promise<unknown>
    upsert: (...args: any[]) => Promise<unknown>
  }
  provider?: any
}

export async function syncProviderSkills(
  client: ProviderSkillsClient,
  providerId: string,
  selectedValues: string[],
) {
  const skillTags = normalizeServiceCategorySelections(selectedValues)
  const skillLabels = labelsFromServiceCategoryTags(skillTags)

  if (client.technicianSkill) {
    await client.technicianSkill.updateMany({
      where: {
        providerId,
        ...(skillTags.length > 0 ? { skillTag: { notIn: skillTags } } : {}),
      },
      data: { active: false },
    })

    for (const skillTag of skillTags) {
      await client.technicianSkill.upsert({
        where: {
          providerId_skillTag: {
            providerId,
            skillTag,
          },
        },
        create: {
          providerId,
          skillTag,
          active: true,
        },
        update: {
          active: true,
        },
      })
    }
  }

  if (client.provider?.update) {
    await client.provider.update({
      where: { id: providerId },
      data: { skills: skillTags },
    })
  }

  return { skillTags, skillLabels }
}
