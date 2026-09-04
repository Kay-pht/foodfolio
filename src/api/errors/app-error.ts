export type ApiErrorCode =
  | "INVALID_URL"
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "AI_CONSENT_REQUIRED"
  | "INVALID_AI_CONSENT_VERSION"
  | "INVALID_AI_CONSENT_TIMESTAMP"
  | "NOT_FOUND"
  | "DUPLICATE_RECIPE"
  | "RECIPE_ANALYSIS_IN_PROGRESS"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "TEMPORARILY_UNAVAILABLE";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
