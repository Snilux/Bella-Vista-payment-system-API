import type { ValidationIssue } from '@bella-vista/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { isDatabaseUnavailable } from '../db/errors.js';
import { AppError, errors } from '../lib/errors.js';

// Single error format { error: { code, message, details } } (docs/api.md). Unexpected errors
// are logged with the request id and answered with INTERNAL_ERROR, never with their details.

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const appError = toAppError(error);
    if (appError.statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    }
    return reply.code(appError.statusCode).send(appError.toResponse());
  });

  app.setNotFoundHandler((_request, reply) => {
    const notFound = errors.notFound();
    return reply.code(notFound.statusCode).send(notFound.toResponse());
  });
}

function toAppError(error: FastifyError): AppError {
  if (error instanceof AppError) return error;
  if (hasZodFastifySchemaValidationErrors(error)) {
    const context = error.validationContext ?? 'body';
    const issues: ValidationIssue[] = error.validation.map((issue) => ({
      path: [context, ...issue.instancePath.split('/').filter(Boolean)].join('.'),
      message: issue.message ?? 'Valor inválido.',
    }));
    return errors.validation({ issues });
  }
  if (isResponseSerializationError(error)) return errors.internal();
  if (isDatabaseUnavailable(error)) return errors.databaseUnavailable();
  const status = error.statusCode;
  if (status === 404) return errors.notFound();
  if (status === 429) return errors.tooManyRequests();
  // Malformed JSON, empty body, unsupported media type, body too large, other Fastify 4xx.
  if (status !== undefined && status >= 400 && status < 500) return errors.invalidRequest(status);
  return errors.internal();
}
