export type ApiErrorCode =
  | "INVALID_URL"
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "DUPLICATE_RECIPE"
  | "RECIPE_ANALYSIS_IN_PROGRESS"
  | "RECIPE_NOT_EDITABLE"
  | "ANALYSIS_LIMIT_EXCEEDED"
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
