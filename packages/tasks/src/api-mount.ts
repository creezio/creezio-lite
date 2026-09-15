import type { ApiMount } from "@creezio/api-kernel";
import type { PlatformTasksStore } from "./types.js";

function actorFromReq(req: {
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}): string | null {
  const h = req.headers?.["x-creezio-user-id"];
  if (typeof h === "string" && h.trim()) return h.trim();
  const body = req.body as { userId?: string } | undefined;
  if (body?.userId) return String(body.userId);
  return null;
}

export function createTasksApiMount(store: PlatformTasksStore): ApiMount {
  return {
    handle: async ({ req, subPath }) => {
      const method = req.method.toUpperCase();
      const userId = actorFromReq(req);
      if (!userId) {
        return {
          status: 401,
          body: { ok: false, error: "user_required" },
        };
      }

      if ((subPath === "" || subPath === "list") && method === "GET") {
        return { status: 200, body: { ok: true, tasks: store.list(userId) } };
      }

      if ((subPath === "" || subPath === "create") && method === "POST") {
        const body = (req.body || {}) as { title?: string; body?: string };
        try {
          const task = store.create({
            userId,
            title: String(body.title || ""),
            body: body.body,
          });
          return { status: 201, body: { ok: true, task } };
        } catch (e) {
          return {
            status: 400,
            body: {
              ok: false,
              error: e instanceof Error ? e.message : "error",
            },
          };
        }
      }

      const idMatch = subPath.match(/^([0-9a-f-]{36})$/i);
      if (idMatch) {
        const id = idMatch[1]!;
        if (method === "GET") {
          const task = store.get(id);
          if (!task || task.userId !== userId) {
            return { status: 404, body: { ok: false, error: "not_found" } };
          }
          return { status: 200, body: { ok: true, task } };
        }
        if (method === "PATCH") {
          try {
            const patch = (req.body || {}) as {
              title?: string;
              body?: string;
              status?: "open" | "done" | "cancelled";
            };
            const task = store.update(id, patch, userId);
            return { status: 200, body: { ok: true, task } };
          } catch (e) {
            const msg = e instanceof Error ? e.message : "error";
            return {
              status: msg === "forbidden" ? 403 : 404,
              body: { ok: false, error: msg },
            };
          }
        }
        if (method === "DELETE") {
          try {
            const ok = store.remove(id, userId);
            return {
              status: ok ? 200 : 404,
              body: { ok },
            };
          } catch (e) {
            return {
              status: 403,
              body: {
                ok: false,
                error: e instanceof Error ? e.message : "error",
              },
            };
          }
        }
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}
