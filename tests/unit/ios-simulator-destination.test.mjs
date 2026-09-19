import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveIOSSimulatorDestination } from "../../scripts/ios-simulator-destination.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const testIOSScript = join(repositoryRoot, "scripts", "test-ios.sh");
const temporaryDirectories = [];

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function runTestIOS({ destination, inventory }) {
  const root = mkdtempSync(join(tmpdir(), "foodfolio-ios-destination-"));
  temporaryDirectories.push(root);
  const bin = join(root, "bin");
  const xcodebuildLog = join(root, "xcodebuild.log");
  mkdirSync(bin);

  executable(
    join(bin, "xcrun"),
    `#!/bin/sh
if [ "$*" != "simctl list devices available -j" ]; then
  echo "unexpected xcrun arguments: $*" >&2
  exit 3
fi
cat <<'JSON'
${JSON.stringify(inventory)}
JSON
`,
  );
  executable(join(bin, "xcodegen"), "#!/bin/sh\nexit 0\n");
  executable(
    join(bin, "xcodebuild"),
    `#!/bin/sh
printf '%s\\n' "$@" >> "$XCODEBUILD_LOG"
`,
  );

  const environment = {
    ...process.env,
    DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
    PATH: `${bin}:${process.env.PATH}`,
    XCODEBUILD_LOG: xcodebuildLog,
  };
  if (destination !== undefined) environment.IOS_DESTINATION = destination;

  execFileSync("bash", [testIOSScript], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "pipe",
  });
  return readFileSync(xcodebuildLog, "utf8");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("iOS Simulator destination selection", () => {
  it("uses an available iPhone UDID from the newest installed iOS runtime", () => {
    const log = runTestIOS({
      inventory: {
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
            {
              name: "iPhone 17 Pro",
              udid: "OLDER-PRO",
              state: "Shutdown",
              isAvailable: true,
            },
          ],
          "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
            {
              name: "iPhone 17",
              udid: "LATEST-IPHONE",
              state: "Shutdown",
              isAvailable: true,
            },
          ],
        },
      },
    });

    expect(log).toContain("platform=iOS Simulator,id=LATEST-IPHONE");
    expect(log).not.toContain("name=iPhone 17 Pro");
  });

  it("preserves an explicit IOS_DESTINATION without querying CoreSimulator", () => {
    const destination = "platform=iOS Simulator,id=EXPLICIT-DEVICE";
    const log = runTestIOS({ destination, inventory: { devices: {} } });

    expect(log).toContain(destination);
  });

  it("compares runtime versions numerically and prefers a booted device within the newest runtime", () => {
    const destination = resolveIOSSimulatorDestination({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-9-9": [
          {
            name: "iPhone Old",
            udid: "OLD-RUNTIME",
            state: "Booted",
            isAvailable: true,
          },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-10-0": [
          {
            name: "iPhone A",
            udid: "SHUTDOWN-DEVICE",
            state: "Shutdown",
            isAvailable: true,
          },
          {
            name: "iPhone Z",
            udid: "BOOTED-DEVICE",
            state: "Booted",
            isAvailable: true,
          },
        ],
      },
    });

    expect(destination).toBe("platform=iOS Simulator,id=BOOTED-DEVICE");
  });

  it("fails with an actionable error when no available iPhone exists", () => {
    expect(() =>
      resolveIOSSimulatorDestination({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
            {
              name: "iPad (A16)",
              udid: "IPAD-ONLY",
              state: "Shutdown",
              isAvailable: true,
            },
          ],
        },
      }),
    ).toThrow(/Install an iOS Simulator runtime|set IOS_DESTINATION/);
  });
});
