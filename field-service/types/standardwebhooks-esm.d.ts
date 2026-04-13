declare module 'https://esm.sh/standardwebhooks@1.0.0' {
  export class Webhook {
    constructor(secret: string)
    verify(
      payload: string,
      headers: Headers | Record<string, string>,
    ): unknown
  }
}
