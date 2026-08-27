import { AppError } from "../api/errors/app-error.js";

export interface SyncCursor {
  updatedAt: string;
  id: string;
}

export function encodeSyncCursor(cursor: SyncCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeSyncCursor(value: string): SyncCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object") throw new Error();
    const item = parsed as Record<string, unknown>;
    if (
      typeof item.updatedAt !== "string" ||
      Number.isNaN(Date.parse(item.updatedAt)) ||
      typeof item.id !== "string"
    )
      throw new Error();
    return { updatedAt: item.updatedAt, id: item.id };
  } catch {
    throw new AppError(400, "INVALID_REQUEST", "Invalid sync cursor");
  }
}
