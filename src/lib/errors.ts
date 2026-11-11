/** A business-rule violation whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    message: string,
    public params: Record<string, string | number> = {},
    public field?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function assert(cond: unknown, message: string, params: Record<string, string | number> = {}, field?: string): asserts cond {
  if (!cond) throw new AppError(message, params, field);
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  redirectTo?: string;
  data?: T;
  params?: Record<string, string | number>;
}
