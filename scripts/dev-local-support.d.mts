export const RECOVER_STALE_LOCAL_ANALYSES_SQL: string;

export function mergeLocalEnvironment(
  ...environmentLayers: Array<Record<string, string | undefined>>
): Record<string, string | undefined>;

export function assertLocalDatabase(name: string, value: string): void;
