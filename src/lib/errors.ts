/** A business-rule violation whose message is safe to show to the user. */
export class AppError extends Error {
  /** Untranslated message template with {placeholders}; `message` holds the interpolated English text. */
  public template: string;
  constructor(
    message: string,
    public params: Record<string, string | number> = {},
    public field?: string,
  ) {
    let text = message;
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
    super(text);
    this.template = message;
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
