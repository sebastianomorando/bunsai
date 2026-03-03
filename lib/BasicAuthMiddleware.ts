import type { Bundana } from "./Bundana";

export interface BasicAuthOptions {
    username: string;
    password: string;
    realm?: string;
}

/**
 * Creates a basic authentication middleware for Bundana
 * @param options Configuration with username, password, and optional realm
 * @returns Middleware function that validates Basic Auth credentials
 * 
 * @example
 * ```ts
 * import { Bundana } from "./lib/Bundana";
 * import { basicAuth } from "./lib/BasicAuthMiddleware";
 * 
 * const app = new Bundana();
 * 
 * // Apply globally to all routes
 * app.use(basicAuth({ username: "admin", password: "secret" }));
 * 
 * // Or apply to specific routes
 * app.get("/admin", handler, [basicAuth({ username: "admin", password: "secret" })]);
 * ```
 */
export function basicAuth<WebSocketData>(
    options: BasicAuthOptions
): (
    req: Bun.BunRequest,
    server: Bun.Server<WebSocketData>,
    next: () => Promise<Response>
) => Response | Promise<Response> {
    const { username, password, realm = "Secure Area" } = options;

    return async (req, server, next) => {
        const authHeader = req.headers.get("Authorization");

        if (!authHeader || !authHeader.startsWith("Basic ")) {
            return new Response("Authentication required", {
                status: 401,
                headers: {
                    "WWW-Authenticate": `Basic realm="${realm}"`,
                    "Content-Type": "text/plain"
                }
            });
        }

        // Extract and decode credentials
        const base64Credentials = authHeader.substring(6); // Remove "Basic "
        const credentials = atob(base64Credentials);
        const [providedUsername, providedPassword] = credentials.split(":");

        // Validate credentials
        if (providedUsername === username && providedPassword === password) {
            return next();
        }

        // Invalid credentials
        return new Response("Invalid credentials", {
            status: 401,
            headers: {
                "WWW-Authenticate": `Basic realm="${realm}"`,
                "Content-Type": "text/plain"
            }
        });
    };
}

/**
 * Creates a basic authentication middleware with multiple valid credentials
 * @param users Array of valid username/password pairs
 * @param realm Optional realm for the authentication prompt
 * @returns Middleware function that validates Basic Auth credentials
 * 
 * @example
 * ```ts
 * app.use(basicAuthMultiple([
 *   { username: "admin", password: "admin123" },
 *   { username: "user", password: "user123" }
 * ]));
 * ```
 */
export function basicAuthMultiple<WebSocketData>(
    users: Array<{ username: string; password: string }>,
    realm: string = "Secure Area"
): (
    req: Bun.BunRequest,
    server: Bun.Server<WebSocketData>,
    next: () => Promise<Response>
) => Response | Promise<Response> {
    return async (req, server, next) => {
        const authHeader = req.headers.get("Authorization");

        if (!authHeader || !authHeader.startsWith("Basic ")) {
            return new Response("Authentication required", {
                status: 401,
                headers: {
                    "WWW-Authenticate": `Basic realm="${realm}"`,
                    "Content-Type": "text/plain"
                }
            });
        }

        // Extract and decode credentials
        const base64Credentials = authHeader.substring(6);
        const credentials = atob(base64Credentials);
        const [providedUsername, providedPassword] = credentials.split(":");

        // Check against all valid users
        const isValid = users.some(
            user => user.username === providedUsername && user.password === providedPassword
        );

        if (isValid) {
            return next();
        }

        // Invalid credentials
        return new Response("Invalid credentials", {
            status: 401,
            headers: {
                "WWW-Authenticate": `Basic realm="${realm}"`,
                "Content-Type": "text/plain"
            }
        });
    };
}
