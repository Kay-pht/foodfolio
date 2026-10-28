import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { parse } from "dotenv";

const localEnvFile = fileURLToPath(new URL("../.env.local", import.meta.url));
const supportedKeys = new Set(["DEVELOPER_DIR", "FOODFOLIO_GCLOUD_ACCOUNT"]);

export function localMachineValue(
  key,
  { environment = process.env, envFile = localEnvFile } = {},
) {
  if (!supportedKeys.has(key)) throw new Error("Unsupported local machine key");
  if (Object.hasOwn(environment, key))
    return environment[key]?.trim() || undefined;
  try {
    return parse(readFileSync(envFile))[key]?.trim() || undefined;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function gcloudAccessTokenArguments(options) {
  const account = localMachineValue("FOODFOLIO_GCLOUD_ACCOUNT", options);
  if (!account)
    throw new Error("FOODFOLIO_GCLOUD_ACCOUNT must be configured locally");
  return ["auth", "print-access-token", "--account", account];
}
