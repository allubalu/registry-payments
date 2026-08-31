import { FeeInputError, InvalidMoneyWireError, UnknownCurrencyError } from '@registry/domain'
import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

/** Machine-readable error codes. The client switches on these, never on prose. */
export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'UNKNOWN_JURISDICTION'
  | 'INVALID_FEE_INPUT'
  | 'INVALID_MONEY'
  | 'INTERNAL'

export interface ApiErrorBody {
  readonly error: ApiErrorCode
  readonly detail: string
  readonly issues?: readonly string[]
}

export interface HttpError {
  readonly status: number
  readonly body: ApiErrorBody
}

/** Thrown by routes for conditions the domain has no opinion about. */
export class UnknownJurisdictionError extends Error {
  constructor(jurisdictionId: string) {
    super(`unknown jurisdiction "${jurisdictionId}"`)
    this.name = 'UnknownJurisdictionError'
  }
}

/**
 * Maps anything thrown into a status and a body.
 *
 * The 400/422 split is the distinction worth keeping. 400 means the request was
 * malformed — not the right shape, or money sent as a JSON number. 422 means the
 * request was well-formed and the *domain* refused it: a required attribute is
 * missing, or the currency is not this pack's. One is the client's bug in
 * building a request; the other is a legitimate answer about the rules.
 */
export function toHttpError(cause: unknown): HttpError {
  if (cause instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: 'INVALID_REQUEST',
        detail: 'request body did not match the expected shape',
        issues: cause.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      },
    }
  }

  if (cause instanceof UnknownJurisdictionError) {
    return { status: 404, body: { error: 'UNKNOWN_JURISDICTION', detail: cause.message } }
  }

  if (cause instanceof InvalidMoneyWireError) {
    return { status: 400, body: { error: 'INVALID_MONEY', detail: cause.message } }
  }

  // An unknown currency code is a malformed money value, not a rules decision.
  if (cause instanceof UnknownCurrencyError) {
    return { status: 400, body: { error: 'INVALID_MONEY', detail: cause.message } }
  }

  if (cause instanceof FeeInputError) {
    return { status: 422, body: { error: 'INVALID_FEE_INPUT', detail: cause.message } }
  }

  // Deliberately opaque: an unexpected failure must not leak its message or
  // stack to the caller. The server log keeps the detail.
  return {
    status: 500,
    body: { error: 'INTERNAL', detail: 'the server could not complete this request' },
  }
}

export function errorHandler(
  cause: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(cause)
    return
  }

  const { status, body } = toHttpError(cause)

  if (status >= 500) {
    // Written to stderr rather than console, matching the CLI: the detail the
    // caller is denied must still reach the operator.
    process.stderr.write(
      `[api] unhandled error: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`,
    )
  }

  response.status(status).json(body)
}
