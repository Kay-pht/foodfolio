import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function isReady(resource) {
  return resource?.status?.conditions?.some(
    (condition) => condition.type === "Ready" && condition.status === "True",
  );
}

function isRequestBased(resource, template = false) {
  const annotations = template
    ? resource?.spec?.template?.metadata?.annotations
    : resource?.metadata?.annotations;
  const throttling = annotations?.["run.googleapis.com/cpu-throttling"];
  return throttling === undefined || throttling === "true";
}

async function describeResource(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("gcloud", args, {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    // CLI output can include environment values; never echo it on failure.
    throw new Error("Cloud Run describe failed");
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Cloud Run describe returned invalid JSON");
  }
}

export async function verifyCloudRunDeployment({
  serviceName,
  project,
  region,
  image,
  imageDigest,
  describe = describeResource,
}) {
  requireCondition(
    [serviceName, project, region, image, imageDigest].every(
      (value) => typeof value === "string" && value.length > 0,
    ),
    "Service, project, region, expected image, and digest are required",
  );
  const repository = image.split("@")[0].replace(/:[^/]+$/, "");
  requireCondition(
    imageDigest.startsWith(`${repository}@sha256:`) &&
      /^[0-9a-f]{64}$/.test(imageDigest.split("@sha256:")[1] ?? ""),
    "Expected image digest is invalid",
  );
  const scope = ["--project", project, "--region", region, "--format=json"];
  const service = await describe([
    "run",
    "services",
    "describe",
    serviceName,
    ...scope,
  ]);
  requireCondition(service?.metadata?.name === serviceName, "Wrong service");
  requireCondition(isReady(service), "Service is not Ready");
  const revisionName = service?.status?.latestReadyRevisionName;
  requireCondition(
    typeof revisionName === "string" &&
      revisionName.length > 0 &&
      revisionName === service?.status?.latestCreatedRevisionName,
    "Latest created revision is not Ready",
  );
  const traffic = service?.status?.traffic;
  requireCondition(
    Array.isArray(traffic) &&
      traffic.length === 1 &&
      traffic[0].percent === 100 &&
      traffic[0].revisionName === revisionName,
    "Expected 100 percent traffic to the latest Ready revision",
  );
  requireCondition(
    service?.spec?.template?.spec?.containers?.[0]?.image === image,
    "Service image does not match deployment",
  );
  requireCondition(
    isRequestBased(service, true),
    "Service template does not use request-based billing",
  );
  const revision = await describe([
    "run",
    "revisions",
    "describe",
    revisionName,
    ...scope,
  ]);
  requireCondition(
    revision?.metadata?.name === revisionName && isReady(revision),
    "Serving revision is not Ready",
  );
  requireCondition(
    revision?.spec?.containers?.[0]?.image === imageDigest,
    "Serving revision image does not match deployment",
  );
  requireCondition(
    isRequestBased(revision),
    "Serving revision does not use request-based billing",
  );
  return { serviceName, revisionName, billing: "request-based" };
}

async function main() {
  try {
    const result = await verifyCloudRunDeployment({
      serviceName: process.argv[2],
      project: process.env.PROJECT_ID,
      region: process.env.REGION,
      image: process.env.IMAGE,
      imageDigest: process.env.IMAGE_DIGEST,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main();
}
