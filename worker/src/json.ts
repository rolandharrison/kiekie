/**
 * Body parsing that never throws: a malformed or absent JSON body is
 * indistinguishable from `{}` here, and every route validates the fields it
 * needs anyway.
 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const value = await req.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
