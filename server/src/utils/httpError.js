export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, { code: 'BAD_REQUEST', details });
export const validationError = (details) =>
  new HttpError(400, 'Please correct the highlighted fields.', { code: 'VALIDATION_ERROR', details });
export const unauthorized = (message = 'Authentication required') => new HttpError(401, message, { code: 'UNAUTHORIZED' });
export const forbidden = (message = 'You do not have permission to do that') =>
  new HttpError(403, message, { code: 'FORBIDDEN' });
export const notFound = (message = 'Not found') => new HttpError(404, message, { code: 'NOT_FOUND' });
export const tooManyRequests = (message) => new HttpError(429, message, { code: 'TOO_MANY_REQUESTS' });
