export type ErrorDetails = Record<string, unknown> | undefined;
export type ErrorLogContext = {
  method?: string;
  url?: string;
  route?: string;
  handler?: string;
};

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

function logError(error: unknown, context: ErrorLogContext = {}) {
  const requestContext = [context.method, context.url].filter(Boolean).join(" ");
  const routeContext = [context.route, context.handler].filter(Boolean).join(" ");
  const prefix = [requestContext, routeContext].filter(Boolean).join(" | ");

  if (isHttpError(error)) {
    console.error(
      `[RouteError ${error.status} ${error.code}]${prefix ? ` ${prefix}` : ""} - ${error.message}`
    );
    return;
  }

  if (error instanceof Error) {
    console.error(
      `[RouteError 500]${prefix ? ` ${prefix}` : ""} - ${error.message}`,
      error
    );
    return;
  }

  console.error(`[RouteError 500]${prefix ? ` ${prefix}` : ""}`, error);
}

export function errorToResponse(
  error: unknown,
  context: ErrorLogContext = {}
): Response {
  logError(error, context);

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
