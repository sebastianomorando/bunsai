export type ErrorDetails = Record<string, unknown> | undefined;

type HttpErrorOptions = {
  code?: string;
  details?: ErrorDetails;
  expose?: boolean;
  cause?: unknown;
};

export class HttpError extends Error {
  status: number;
  code: string;
  details?: ErrorDetails;
  expose: boolean;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.status = status;
    this.code = options.code ?? "HTTP_ERROR";
    this.details = options.details;
    this.expose = options.expose ?? status < 500;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request", options: HttpErrorOptions = {}) {
    super(400, message, { code: "BAD_REQUEST", ...options });
  }
}

export class NotAuthenticatedError extends HttpError {
  constructor(message = "Authentication required", options: HttpErrorOptions = {}) {
    super(401, message, { code: "NOT_AUTHENTICATED", ...options });
  }
}

export class NotAuthorizedError extends HttpError {
  constructor(message = "Forbidden", options: HttpErrorOptions = {}) {
    super(403, message, { code: "NOT_AUTHORIZED", ...options });
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found", options: HttpErrorOptions = {}) {
    super(404, message, { code: "NOT_FOUND", ...options });
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict", options: HttpErrorOptions = {}) {
    super(409, message, { code: "CONFLICT", ...options });
  }
}

export class ValidationError extends HttpError {
  constructor(message = "Validation failed", options: HttpErrorOptions = {}) {
    super(422, message, { code: "VALIDATION_ERROR", ...options });
  }
}

export class RateLimitError extends HttpError {
  constructor(message = "Too many requests", options: HttpErrorOptions = {}) {
    super(429, message, { code: "RATE_LIMITED", ...options });
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

export function errorToResponse(error: unknown): Response {
  if (isHttpError(error)) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status }
    );
  }

  if (error instanceof SyntaxError) {
    return Response.json(
      { error: "Invalid JSON body", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const generic = "Internal Server Error";
  return Response.json(
    {
      error: generic,
      code: "INTERNAL_SERVER_ERROR",
    },
    { status: 500 }
  );
}
