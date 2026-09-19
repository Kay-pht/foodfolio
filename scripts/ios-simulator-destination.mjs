import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IOS_RUNTIME_PATTERN =
  /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?$/u;
const IPHONE_DEVICE_TYPE_PREFIX =
  "com.apple.CoreSimulator.SimDeviceType.iPhone-";

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function runtimeVersion(identifier) {
  const match = identifier.match(IOS_RUNTIME_PATTERN);
  if (!match) return undefined;
  return match.slice(1).map((part) => Number(part ?? 0));
}

function isIPhone(device) {
  if (typeof device?.deviceTypeIdentifier === "string") {
    return device.deviceTypeIdentifier.startsWith(IPHONE_DEVICE_TYPE_PREFIX);
  }
  return typeof device?.name === "string" && device.name.startsWith("iPhone ");
}

function compareCandidates(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const versionDifference = right.version[index] - left.version[index];
    if (versionDifference !== 0) return versionDifference;
  }

  const bootedDifference =
    Number(right.state === "Booted") - Number(left.state === "Booted");
  if (bootedDifference !== 0) return bootedDifference;

  return (
    compareText(left.name, right.name) || compareText(left.udid, right.udid)
  );
}

export function resolveIOSSimulatorDestination(inventory) {
  const candidates = [];

  for (const [runtime, devices] of Object.entries(inventory?.devices ?? {})) {
    const version = runtimeVersion(runtime);
    if (!version || !Array.isArray(devices)) continue;

    for (const device of devices) {
      if (
        device?.isAvailable !== true ||
        !isIPhone(device) ||
        typeof device.udid !== "string" ||
        device.udid.length === 0
      ) {
        continue;
      }
      candidates.push({
        name: device.name ?? "",
        state: device.state ?? "",
        udid: device.udid,
        version,
      });
    }
  }

  candidates.sort(compareCandidates);
  const selected = candidates[0];
  if (!selected) {
    throw new Error(
      "No available iPhone Simulator was found. Install an iOS Simulator runtime in Xcode or set IOS_DESTINATION explicitly.",
    );
  }

  return `platform=iOS Simulator,id=${selected.udid}`;
}

function readSimulatorInventory() {
  const output = execFileSync(
    "xcrun",
    ["simctl", "list", "devices", "available", "-j"],
    { encoding: "utf8" },
  );
  return JSON.parse(output);
}

function main() {
  try {
    process.stdout.write(
      `${resolveIOSSimulatorDestination(readSimulatorInventory())}\n`,
    );
  } catch (error) {
    console.error(
      `Unable to resolve an iOS Simulator destination: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
