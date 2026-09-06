export const RECOVER_STALE_LOCAL_ANALYSES_SQL: string;

export function mergeLocalEnvironment(
  ambientEnvironment: Record<string, string | undefined>,
  localEnvironment: Record<string, string>,
): Record<string, string | undefined>;

export function assertLocalDatabase(name: string, value: string): void;
