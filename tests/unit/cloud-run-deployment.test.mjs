import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { verifyCloudRunDeployment } from "../../scripts/verify-cloud-run-deployment.mjs";

const image =
  "asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app:test";
const imageDigest = `${image.split(":")[0]}@sha256:${"a".repeat(64)}`;
const serviceName = "foodfolio-dev-api";
const revisionName = "foodfolio-dev-api-00001-test";
const ready = { conditions: [{ type: "Ready", status: "True" }] };
const options = {
  serviceName,
  project: "foodfolio-af28aa",
  region: "asia-southeast1",
  image,
  imageDigest,
};

function fixtures() {
  return globalThis.structuredClone({
    service: {
      metadata: { name: serviceName },
      spec: {
        template: {
          metadata: {
            annotations: { "run.googleapis.com/cpu-throttling": "true" },
          },
          spec: { containers: [{ image }] },
        },
      },
      status: {
        ...ready,
        latestCreatedRevisionName: revisionName,
        latestReadyRevisionName: revisionName,
        traffic: [{ percent: 100, revisionName }],
      },
    },
    revision: {
      metadata: {
        name: revisionName,
        annotations: { "run.googleapis.com/cpu-throttling": "true" },
      },
      spec: { containers: [{ image: imageDigest }] },
      status: ready,
    },
  });
}

function verify({ service, revision }) {
  const describe = vi
    .fn()
    .mockResolvedValueOnce(service)
    .mockResolvedValueOnce(revision);
  return verifyCloudRunDeployment({ ...options, describe });
}

describe("ICR-2 serving revision deployment verification", () => {
  it("reads the service and serving revision with explicit scope and returns only safe fields", async () => {
    const { service, revision } = fixtures();
    service.spec.template.spec.containers[0].env = [
      { name: "PRIVATE", value: "secret-value" },
    ];
    const describe = vi
      .fn()
      .mockResolvedValueOnce(service)
      .mockResolvedValueOnce(revision);

    await expect(
      verifyCloudRunDeployment({ ...options, describe }),
    ).resolves.toEqual({ serviceName, revisionName, billing: "request-based" });
    for (const [index, kind, name] of [
      [1, "services", serviceName],
      [2, "revisions", revisionName],
    ]) {
      expect(describe).toHaveBeenNthCalledWith(index, [
        "run",
        kind,
        "describe",
        name,
        "--project",
        options.project,
        "--region",
        options.region,
        "--format=json",
      ]);
    }
  });

  it("accepts the documented request-billing default when annotations are absent", async () => {
    const data = fixtures();
    delete data.service.spec.template.metadata.annotations;
    delete data.revision.metadata.annotations;
    await expect(verify(data)).resolves.toMatchObject({
      billing: "request-based",
    });
  });

  it.each(["false", "invalid"])(
    "rejects serving revision throttling=%s even when the template is correct",
    async (value) => {
      const data = fixtures();
      data.revision.metadata.annotations["run.googleapis.com/cpu-throttling"] =
        value;
      await expect(verify(data)).rejects.toThrow(
        "Serving revision does not use request-based billing",
      );
    },
  );

  it.each([
    ["service is not Ready", (d) => (d.service.status.conditions = [])],
    [
      "created revision is not Ready",
      (d) => (d.service.status.latestCreatedRevisionName = "pending"),
    ],
    [
      "traffic is split",
      (d) =>
        (d.service.status.traffic = [
          { percent: 50, revisionName },
          { percent: 50, revisionName: "old" },
        ]),
    ],
    [
      "traffic is pinned to an old revision",
      (d) => (d.service.status.traffic[0].revisionName = "old"),
    ],
    ["traffic is missing", (d) => delete d.service.status.traffic],
    [
      "template has instance billing",
      (d) =>
        (d.service.spec.template.metadata.annotations[
          "run.googleapis.com/cpu-throttling"
        ] = "false"),
    ],
    [
      "template has the wrong image",
      (d) => (d.service.spec.template.spec.containers[0].image = "old"),
    ],
    ["revision is not Ready", (d) => (d.revision.status.conditions = [])],
    [
      "revision has the wrong image",
      (d) => (d.revision.spec.containers[0].image = "old"),
    ],
    [
      "CLI returned the wrong revision",
      (d) => (d.revision.metadata.name = "wrong"),
    ],
    [
      "CLI returned the wrong service",
      (d) => (d.service.metadata.name = "wrong"),
    ],
  ])("fails closed when %s", async (_label, change) => {
    const data = fixtures();
    change(data);
    await expect(verify(data)).rejects.toThrow();
  });

  it("rejects missing deployment scope before any CLI call", async () => {
    const describe = vi.fn();
    await expect(
      verifyCloudRunDeployment({ ...options, project: undefined, describe }),
    ).rejects.toThrow("required");
    expect(describe).not.toHaveBeenCalled();
  });

  it.each(["", "not-a-digest", `other/app@sha256:${"a".repeat(64)}`])(
    "rejects a missing or invalid expected digest: %s",
    async (digest) => {
      const describe = vi.fn();
      await expect(
        verifyCloudRunDeployment({ ...options, imageDigest: digest, describe }),
      ).rejects.toThrow();
      expect(describe).not.toHaveBeenCalled();
    },
  );
});

describe("DID-1 immutable image index verification", () => {
  const child = `sha256:${"b".repeat(64)}`;
  const index = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: child,
        platform: { os: "linux", architecture: "amd64" },
      },
    ],
  };
  async function check(
    manifest,
    digest = child,
    repository = image.split(":")[0],
  ) {
    const data = fixtures();
    data.revision.spec.containers[0].image = `${repository}@${digest}`;
    const inspect = vi.fn().mockResolvedValue(manifest);
    const describe = vi
      .fn()
      .mockResolvedValueOnce(data.service)
      .mockResolvedValueOnce(data.revision);
    const result = await verifyCloudRunDeployment({
      ...options,
      describe,
      inspect,
    });
    expect(inspect).toHaveBeenCalledWith(imageDigest);
    return result;
  }
  it("accepts the linux/amd64 child of the expected immutable OCI index", async () => {
    await expect(check(index)).resolves.toMatchObject({
      serviceName,
      revisionName,
    });
  });
  it("accepts a Docker manifest list", async () => {
    await expect(
      check({
        ...index,
        mediaType: "application/vnd.docker.distribution.manifest.list.v2+json",
        manifests: [
          {
            ...index.manifests[0],
            mediaType: "application/vnd.docker.distribution.manifest.v2+json",
          },
        ],
      }),
    ).resolves.toMatchObject({ serviceName });
  });
  it.each([
    ["unrelated child", index, `sha256:${"c".repeat(64)}`],
    ["other repository", index, child, "other/app"],
    [
      "wrong platform",
      {
        ...index,
        manifests: [
          {
            ...index.manifests[0],
            platform: { os: "linux", architecture: "arm64" },
          },
        ],
      },
    ],
    [
      "ambiguous platform",
      { ...index, manifests: [...index.manifests, ...index.manifests] },
    ],
    [
      "attestation",
      {
        ...index,
        manifests: [
          {
            ...index.manifests[0],
            annotations: {
              "vnd.docker.reference.type": "attestation-manifest",
            },
          },
        ],
      },
    ],
    [
      "invalid digest",
      { ...index, manifests: [{ ...index.manifests[0], digest: "bad" }] },
    ],
    [
      "non-image child",
      { ...index, manifests: [{ ...index.manifests[0], mediaType: "other" }] },
    ],
    ["missing manifests", { ...index, manifests: undefined }],
    [
      "single manifest",
      { mediaType: "application/vnd.oci.image.manifest.v1+json" },
    ],
    ["invalid response", null],
  ])("fails closed for %s", async (_label, manifest, digest, repository) => {
    await expect(check(manifest, digest, repository)).rejects.toThrow();
  });
});

describe("ICR-1 dev deployment wiring", () => {
  it("deploys and verifies API before deploying and verifying Worker with explicit request billing", async () => {
    const workflow = await readFile(
      new URL("../../.github/workflows/deploy-dev.yml", import.meta.url),
      "utf8",
    );
    for (const service of ["API", "WORKER"]) {
      expect(workflow).toContain(
        `gcloud run deploy "\${${service}_SERVICE}" --image="\${IMAGE}" --cpu-throttling`,
      );
      expect(workflow).toContain(
        `node scripts/verify-cloud-run-deployment.mjs "\${${service}_SERVICE}"`,
      );
    }
    expect(workflow.indexOf("Verify API serving revision")).toBeLessThan(
      workflow.indexOf("name: Deploy Worker"),
    );
    expect(workflow).toContain("value(image_summary.fully_qualified_digest)");
    expect(workflow).toContain('echo "IMAGE_DIGEST=${IMAGE_DIGEST}"');
  });
});
