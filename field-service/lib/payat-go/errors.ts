export class PayAtGoAuthError extends Error {
  constructor(message = 'Pay@Go authentication failed.') {
    super(message)
    this.name = 'PayAtGoAuthError'
  }
}

export class PayAtGoValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayAtGoValidationError'
  }
}

export class PayAtGoProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: string,
  ) {
    super(message)
    this.name = 'PayAtGoProviderError'
  }
}

export class PayAtGoNetworkError extends Error {
  constructor(message = 'Pay@Go network request failed.') {
    super(message)
    this.name = 'PayAtGoNetworkError'
  }
}

export class PayAtGoConfigurationError extends Error {
  constructor(public readonly key: string, message?: string) {
    super(message ?? `Missing Pay@Go configuration: ${key}`)
    this.name = 'PayAtGoConfigurationError'
  }
}
