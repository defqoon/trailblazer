import type { Context } from "hono";
import type { z } from "zod";

/** Parse the JSON body with a zod schema; returns data or a 400 response. */
export async function parseBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, res: c.json({ error: "invalid JSON" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, res: c.json({ error: "validation failed", issues: parsed.error.issues }, 400) };
  }
  return { ok: true, data: parsed.data };
}
