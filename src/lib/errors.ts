export type ErrorCode =
  | 'VALIDATION'
  | 'INVALID_PAYLOAD'
  | 'CROSS_WORLD'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UPLOAD_MISSING'
  | 'IN_USE'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string) =>
  new AppError(404, 'NOT_FOUND', `${what} ${id} not found`);

export const validation = (message: string) => new AppError(400, 'VALIDATION', message);

export const crossWorld = (message: string) => new AppError(400, 'CROSS_WORLD', message);

export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export const inUse = (message: string) => new AppError(409, 'IN_USE', message);

export const uploadMissing = (id: string) =>
  new AppError(409, 'UPLOAD_MISSING', `no uploaded object found for artifact ${id}`);

export const invalidPayload = (message: string) =>
  new AppError(400, 'INVALID_PAYLOAD', message);
