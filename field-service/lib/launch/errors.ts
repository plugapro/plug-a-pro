export class CategoryGatedByPilotError extends Error {
  readonly code = 'pilot.category_gated' as const
  readonly category: string

  constructor(category: string) {
    super(`Category "${category}" is not available in the West Rand pilot`)
    this.name = 'CategoryGatedByPilotError'
    this.category = category
  }
}

export type PilotGateErrorCode =
  | 'pilot.suburb_not_supported'
  | 'pilot.category_not_supported'
  | 'pilot.electrical_disabled'

export class PilotGateError extends Error {
  readonly code: PilotGateErrorCode

  constructor(code: PilotGateErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'PilotGateError'
    this.code = code
  }
}
