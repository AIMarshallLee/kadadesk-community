// Community-only API error adapter. No private KADAdesk desktop automation is included.
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
}
