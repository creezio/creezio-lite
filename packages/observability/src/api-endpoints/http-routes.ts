/**
 * Admin — registre des endpoints runtime (session UI).
 * Hono « nu » : hors doc OpenAPI publique. Auth owner reste côté marque.
 */
import { Hono } from "hono";
import type { ApiEndpointsRegistry } from "./registry.js";

export type CreateApiEndpointsRoutesOptions = {
  getRegistry: () => ApiEndpointsRegistry;
};

export function createApiEndpointsRoutes(
  opts: CreateApiEndpointsRoutesOptions,
): Hono {
  const app = new Hono();

  app.get("/endpoints", (c) => c.json(opts.getRegistry()));

  return app;
}
