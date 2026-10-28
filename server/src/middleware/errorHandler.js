import { HttpError } from '../utils/httpError.js';

// Postgres error codes that indicate bad input rather than a server fault.
const PG_CLIENT_ERRORS = {
  23502: 'A required field is missing',
  23503: 'A referenced record does not exist',
  23514: 'A value is not allowed',
  '22P02': 'A value has an invalid format',
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
}

// Express recognises error handlers by their four parameters, so `_next` must stay.
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  if (PG_CLIENT_ERRORS[err.code]) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: PG_CLIENT_ERRORS[err.code] } });
  }

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' } });
}
