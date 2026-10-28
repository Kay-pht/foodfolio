import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import Ajv from "ajv";
import { localMachineValue } from "../local-machine-env.mjs";

import {
  assertChanges,
  assertRedReport,
  digest,
  nextFix,
  notify,
  proofAttestation,
  recordSession,
  safeTestPath,
  saveState,
  validateEvidence,
} from "./core.mjs";
import { RESULT_SCHEMA, runAgent, isolationProfile } from "./agent.mjs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
  isSuccessfulQualityRunForPr,
  resolveCurrentMergeTree,
} from "../pr-final-merge.mjs";
import { isReusableQualityRun } from "../find-reusable-quality-proof.mjs";

const validateResult = new Ajv({ strict: true }).compile(RESULT_SCHEMA);
const root = fileURLToPath(new URL("../../", import.meta.url));

export function command(binary, args, options = {}) {
  const { failureLog, ...executionOptions } = options;
  try {
    return execFileSync(binary, args, {
      encoding: "utf8",
      timeout: 30 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      ...executionOptions,
    }).trim();
  } catch (error) {
    if (failureLog)
      writeFileSync(
        failureLog,
        JSON.stringify({
          binary,
          args,
          status: error.status,
          stdout: error.stdout,
          stderr: error.stderr,
        }),
        { mode: 0o600 },
      );
    throw new Error(
      `${binary} failed (${error.status ?? error.code ?? "execution error"}); raw output withheld from notifications.`,
      { cause: error },
    );
  }
}

function git(directory, args) {
  return command("git", ["-C", directory, ...args]);
}

export function requireReviewedController(directory = root) {
  const head = git(directory, ["rev-parse", "HEAD"]);
  git(directory, ["merge-base", "--is-ancestor", head, "origin/main"]);
  if (
    git(directory, [
      "status",
      "--porcelain",
      "--",
      "scripts/alert-repair",
      "scripts/review-proof.mjs",
    ])
  ) {
    throw new Error(
      "Controller contains local changes; only committed main code may execute.",
    );
  }
  const specification = git(directory, [
    "show",
    "origin/main:specs/tasks/ALERT-REPAIR-001.yaml",
  ]);
  if (!/^status: approved$/m.test(specification))
    throw new Error("Controller specification is not approved on main.");
}

export function changedPaths(directory) {
  const tracked = git(directory, ["diff", "--name-only", "HEAD"]);
  const untracked = git(directory, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  return [...new Set(`${tracked}\n${untracked}`.split("\n").filter(Boolean))];
}

export function snapshot(directory, paths) {
  return Object.fromEntries(
    paths.map((path) => {
      const target = resolve(directory, path);
      if (
        !target.startsWith(`${resolve(directory)}/`) ||
        !lstatSync(target).isFile() ||
        !realpathSync(target).startsWith(`${realpathSync(directory)}/`)
      )
        throw new Error("Snapshot path must be an ordinary repository file.");
      return [path, digest(readFileSync(target))];
    }),
  );
}

export function assertFrozen(directory, frozen) {
  for (const [path, hash] of Object.entries(frozen)) {
    if (
      !existsSync(join(directory, path)) ||
      snapshot(directory, [path])[path] !== hash
    )
      throw new Error(
        `Frozen contract or original regression test changed: ${path}`,
      );
  }
}

export function verificationEnvironment(home) {
  const developerDirectory = localMachineValue("DEVELOPER_DIR");
  return {
    HOME: home,
    PATH: process.env.PATH,
    TMPDIR: join(home, "tmp"),
    CI: "true",
    LANG: "en_US.UTF-8",
    TZ: "Asia/Tokyo",
    ...(developerDirectory ? { DEVELOPER_DIR: developerDirectory } : {}),
    // Testcontainers creates its own database and rewrites DATABASE_URL.
    ...(process.env.DOCKER_HOST
      ? { DOCKER_HOST: process.env.DOCKER_HOST }
      : {}),
  };
}

export function requiresIosVerification(directory, base) {
  const paths = [
    ...git(directory, ["diff", "--name-only", base]).split("\n"),
    ...changedPaths(directory),
  ];
  return paths.some(
    (path) =>
      path.startsWith("ios/") ||
      path === "schemas/extracted-recipe.schema.json" ||
      path.startsWith("src/api/"),
  );
}

function verify(directory, incident, stageDirectory, mode) {
  const home = join(stageDirectory, "verify-home");
  mkdirSync(join(home, "tmp"), { recursive: true, mode: 0o700 });
  const env = verificationEnvironment(home);
  // Docker Desktop's socket is read from the current context, never DB credentials.
  if (!env.DOCKER_HOST)
    env.DOCKER_HOST = command("docker", [
      "context",
      "inspect",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]);
  if (process.platform !== "darwin")
    throw new Error("Live validation isolation requires macOS.");
  const dockerSocket = env.DOCKER_HOST.startsWith("unix://")
    ? env.DOCKER_HOST.slice(7)
    : null;
  const profile =
    isolationProfile({
      userHome: homedir(),
      directory: realpathSync(directory),
      stageDirectory: realpathSync(stageDirectory),
      runtime: dirname(dirname(realpathSync(process.execPath))),
      writable: true,
      validation: true,
    }) +
    (dockerSocket
      ? `\n(allow file-read* file-write* (literal ${JSON.stringify(dockerSocket)}))`
      : "");
  const run = (binary, args) =>
    command("/usr/bin/sandbox-exec", ["-p", profile, binary, ...args], {
      cwd: directory,
      env,
      failureLog: join(stageDirectory, "failure.json"),
    });
  run("npm", ["run", "check:specs"]);
  if (mode === "spec") return { specification: true };
  run("npm", ["run", "prisma:generate"]);
  if (mode === "red") {
    const report = join(stageDirectory, "red.json");
    let failed = false;
    try {
      run("npx", [
        "--no-install",
        "vitest",
        "run",
        ...incident.contract.regressionTests.map(safeTestPath),
        `--reporter=${join(directory, "scripts/alert-repair/red-reporter.mjs")}`,
        `--outputFile=${report}`,
      ]);
    } catch {
      failed = true;
    }
    if (!failed || !existsSync(report))
      throw new Error(
        "Bug was not reproduced with a failing regression assertion.",
      );
    assertRedReport(JSON.parse(readFileSync(report, "utf8")));
    return { red: true, report };
  }
  const logs = {};
  if (incident.kind === "bug") {
    logs.regression = run("npx", [
      "--no-install",
      "vitest",
      "run",
      ...incident.contract.regressionTests.map(safeTestPath),
    ]);
  }
  logs.verify = run("npm", ["run", "verify"]);
  if (requiresIosVerification(directory, incident.base)) {
    logs.ios = run("npm", ["run", "verify:ios"]);
  }
  const evidence = join(stageDirectory, "verification.json");
  writeFileSync(evidence, JSON.stringify(logs), { mode: 0o600 });
  return {
    green: true,
    evidence,
    commands: [
      "regression",
      "npm run verify",
      ...(logs.ios ? ["npm run verify:ios"] : []),
    ],
  };
}

function currentPr(incident) {
  return JSON.parse(
    command("gh", [
      "pr",
      "view",
      String(incident.pr.number),
      "--repo",
      incident.repository,
      "--json",
      "number,url,headRefOid,isDraft,state",
    ]),
  );
}

function publish(incident, stateDirectory, draftOnly = false) {
  const directory = incident.workspace;
  const paths = changedPaths(directory);
  if (paths.length) {
    git(directory, ["add", "--all"]);
    git(directory, [
      "commit",
      "-m",
      `${incident.kind === "spec_change" ? "Propose specification change" : "Fix runtime alert"} ${incident.id}`,
    ]);
  }
  incident.head = git(directory, ["rev-parse", "HEAD"]);
  git(directory, ["push", "-u", "origin", incident.branch]);
  // Recover a PR created before a process interruption, without opening a duplicate.
  const existing = JSON.parse(
    command("gh", [
      "pr",
      "list",
      "--repo",
      incident.repository,
      "--head",
      incident.branch,
      "--state",
      "all",
      "--json",
      "number,url,state",
    ]),
  );
  if (existing.length) {
    if (existing.length !== 1 || existing[0].state !== "OPEN")
      throw new Error(
        "Incident branch already has a closed or ambiguous PR; human reconciliation required.",
      );
    incident.pr = existing[0];
    return;
  }
  const body = join(stateDirectory, incident.id, "pr-body.md");
  const spec = incident.kind === "spec_change";
  writeFileSync(
    body,
    [
      spec
        ? "仕様変更を伴う提案です。製品仕様の人間承認待ちのためDraftを維持します。"
        : "Slackランタイムアラートで確認した既存仕様違反を修正します。",
      "",
      `案件: ${incident.id}`,
      `元アラート: https://app.slack.com/archives/${incident.channel}/p${incident.thread.replace(".", "")}`,
      "",
      "期待動作 / 現行仕様",
      incident.contract.expectedBehavior,
      "",
      "根拠",
      ...incident.contract.evidence.map(
        (entry) => `- ${entry.path}: ${entry.reason}`,
      ),
      "",
      "変更概要",
      incident.summary,
      "",
      "検証",
      JSON.stringify(incident.verification ?? { pending: true }),
      "",
      "既存DB・共有DBへのmigration、deploy、mergeは行いません。",
      draftOnly && !spec
        ? "検証または作業が未完了です。自動LGTMの対象ではありません。"
        : "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const title = `${spec ? "[仕様変更・承認待ち]" : "fix:"} runtime alert ${incident.id}`;
  const url = command("gh", [
    "pr",
    "create",
    "--repo",
    incident.repository,
    "--base",
    "main",
    "--head",
    incident.branch,
    "--draft",
    "--title",
    title,
    "--body-file",
    body,
  ]);
  const number = Number(url.match(/\/pull\/(\d+)$/)?.[1]);
  if (!number)
    throw new Error(
      "Could not identify created PR; reconcile by incident branch before continuing.",
    );
  incident.pr = { number, url };
}

export function isControllerQualityEvidence(
  run,
  { repository, prNumber, headSha, treeSha, artifacts },
) {
  const hasTreeProof = artifacts.some(
    (artifact) =>
      artifact.name === `quality-proof-${treeSha}` &&
      artifact.expired === false,
  );
  if (!hasTreeProof || run.status !== "completed") return false;
  if (isSuccessfulQualityRunForPr(run, { repository, prNumber, headSha }))
    return true;
  // GitHub's workflow_dispatch run payload legitimately has pull_requests: [].
  // Bind it using the exact head and the current PR's independently resolved
  // prospective merge tree, rather than inventing a PR association in that API.
  return (
    run.event === "workflow_dispatch" &&
    run.head_sha === headSha &&
    isReusableQualityRun(run, repository)
  );
}

function readyAndQuality(incident) {
  let pr = currentPr(incident);
  if (pr.headRefOid !== incident.head || pr.state !== "OPEN")
    throw new Error("PR changed before verification.");
  if (pr.isDraft)
    command("gh", [
      "pr",
      "ready",
      String(pr.number),
      "--repo",
      incident.repository,
    ]);
  // gh may return immediately before checks have been registered. Require a real
  // completed successful Quality / checks for the *current* head, never a skip.
  const started = Date.now();
  while (Date.now() - started < 30 * 60_000) {
    pr = currentPr(incident);
    if (pr.state !== "OPEN" || pr.isDraft)
      throw new Error("PR is no longer ready and open.");
    const checks = JSON.parse(
      command("gh", [
        "api",
        `repos/${incident.repository}/commits/${pr.headRefOid}/check-runs?per_page=100`,
      ]),
    );
    const quality = checks.check_runs
      .filter(
        (check) =>
          check.name === "checks" && check.app?.slug === "github-actions",
      )
      .sort((a, b) => b.id - a.id)[0];
    if (quality?.status === "completed") {
      if (quality.conclusion !== "success")
        throw new Error(`Quality failed: ${quality.conclusion}`);
      const runId = quality.details_url?.match(/\/actions\/runs\/(\d+)/)?.[1];
      if (!runId)
        throw new Error("Quality check has no verifiable workflow run.");
      const run = JSON.parse(
        command("gh", [
          "api",
          `repos/${incident.repository}/actions/runs/${runId}`,
        ]),
      );
      const pull = JSON.parse(
        command("gh", [
          "api",
          `repos/${incident.repository}/pulls/${incident.pr.number}`,
        ]),
      );
      const mergeCommit = JSON.parse(
        command("gh", [
          "api",
          `repos/${incident.repository}/git/commits/${pull.merge_commit_sha}`,
        ]),
      );
      const treeSha = resolveCurrentMergeTree(pull, mergeCommit, pr.headRefOid);
      const artifacts =
        JSON.parse(
          command("gh", [
            "api",
            `repos/${incident.repository}/actions/runs/${runId}/artifacts?per_page=100`,
          ]),
        ).artifacts ?? [];
      if (
        !isControllerQualityEvidence(run, {
          repository: incident.repository,
          prNumber: incident.pr.number,
          headSha: pr.headRefOid,
          treeSha,
          artifacts,
        })
      ) {
        throw new Error(
          "Quality workflow identity or exact HEAD evidence does not match.",
        );
      }
      if (pr.headRefOid !== incident.head) {
        git(incident.workspace, ["fetch", "origin", incident.branch]);
        // The isolated workspace must be clean before accepting Auto Fix changes.
        if (git(incident.workspace, ["status", "--porcelain"]))
          throw new Error("Unexpected local changes while CI updated HEAD.");
        git(incident.workspace, [
          "merge",
          "--ff-only",
          `origin/${incident.branch}`,
        ]);
        incident.head = pr.headRefOid;
      }
      const allChecks = JSON.parse(
        command("gh", [
          "pr",
          "checks",
          String(pr.number),
          "--repo",
          incident.repository,
          "--json",
          "name,bucket",
        ]),
      );
      if (allChecks.some((check) => ["fail", "cancel"].includes(check.bucket)))
        throw new Error("A required PR check failed.");
      if (!allChecks.some((check) => check.bucket === "pending"))
        return {
          head: incident.head,
          treeSha,
          quality: quality.details_url,
          proof: {
            run: {
              id: run.id,
              event: run.event,
              status: run.status,
              conclusion: run.conclusion,
              name: run.name,
              path: run.path,
              head_sha: run.head_sha,
              repository: run.repository?.full_name,
            },
            base: pull.base.sha,
            head: pull.head.sha,
            mergeCommit: mergeCommit.sha,
            parents: mergeCommit.parents.map((parent) => parent.sha),
            artifacts: artifacts
              .filter(
                (artifact) => artifact.name === `quality-proof-${treeSha}`,
              )
              .map((artifact) => ({
                id: artifact.id,
                name: artifact.name,
                expired: artifact.expired,
              })),
          },
        };
    }
    // A bounded synchronous delay avoids starting another agent while CI runs.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000);
  }
  throw new Error("Quality did not finish within 30 minutes.");
}

function collectLogs(incident) {
  const seconds = Number(incident.thread);
  const start = new Date((seconds - 15 * 60) * 1000).toISOString();
  const end = new Date((seconds + 15 * 60) * 1000).toISOString();
  try {
    return JSON.parse(
      command(
        "gcloud",
        [
          "logging",
          "read",
          `resource.type="cloud_run_revision" AND timestamp>="${start}" AND timestamp<="${end}" AND (severity>=ERROR OR jsonPayload.analysisStatus="failed")`,
          "--project",
          "foodfolio-af28aa",
          "--order",
          "desc",
          "--limit",
          "100",
          "--format",
          "json",
        ],
        { timeout: 60_000 },
      ),
    );
  } catch {
    return {
      unavailable: true,
      reason:
        "Bounded read-only Cloud Logging lookup failed; do not infer the cause.",
    };
  }
}

export function liveAdapters() {
  return {
    createWorkspace(incident, directory) {
      requireReviewedController();
      incident.repository = "Kay-pht/foodfolio";
      incident.branch = `codex/alert-${incident.id}`;
      incident.workspace = join(directory, incident.id, "checkout");
      if (existsSync(incident.workspace))
        throw new Error(
          "Interrupted workspace already exists; retain it for human reconciliation.",
        );
      const remote = git(root, ["remote", "get-url", "origin"]);
      if (
        !/^(https:\/\/github\.com\/|git@github\.com:)Kay-pht\/foodfolio(?:\.git)?$/.test(
          remote,
        )
      )
        throw new Error("Unexpected repository remote.");
      command("git", [
        "clone",
        "--no-local",
        "--branch",
        "main",
        "--single-branch",
        remote,
        incident.workspace,
      ]);
      incident.base = git(incident.workspace, ["rev-parse", "HEAD"]);
      git(incident.workspace, ["switch", "-c", incident.branch]);
      git(incident.workspace, [
        "config",
        "user.name",
        git(root, ["config", "user.name"]),
      ]);
      git(incident.workspace, [
        "config",
        "user.email",
        git(root, ["config", "user.email"]),
      ]);
      git(incident.workspace, ["config", "core.hooksPath", ".githooks"]);
      command("npm", ["ci", "--ignore-scripts"], {
        cwd: incident.workspace,
        env: {
          PATH: process.env.PATH,
          HOME: join(directory, incident.id),
          CI: "true",
        },
      });
    },
    agent: runAgent,
    paths: changedPaths,
    snapshot,
    assertFrozen,
    verify,
    publish,
    readyAndQuality,
    expectations(directory) {
      return snapshot(
        directory,
        git(directory, ["ls-files", "--", "docs", "specs", "tests"])
          .split("\n")
          .filter(Boolean),
      );
    },
    tracked(directory, paths) {
      return paths.filter((path) => {
        try {
          git(directory, ["ls-files", "--error-unmatch", "--", path]);
          return true;
        } catch {
          return false;
        }
      });
    },
    format(directory, paths) {
      if (paths.length)
        command("npx", ["--no-install", "prettier", "--write", ...paths], {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            HOME: join(directory, ".format-home"),
          },
        });
    },
    head: (incident) => git(incident.workspace, ["rev-parse", "HEAD"]),
    diff: (incident) => git(incident.workspace, ["diff", incident.base, "--"]),
    logs: collectLogs,
    draft(incident) {
      command("gh", [
        "pr",
        "ready",
        String(incident.pr.number),
        "--undo",
        "--repo",
        incident.repository,
      ]);
    },
    unchanged(incident) {
      if (git(incident.workspace, ["status", "--porcelain"]))
        throw new Error(
          "Reviewer or an external process changed repository files.",
        );
      if (currentPr(incident).headRefOid !== incident.head)
        throw new Error("PR HEAD changed during review.");
    },
    proof(incident, attestation, directory) {
      const path = join(directory, incident.id, "review-attestation.json");
      writeFileSync(path, JSON.stringify(attestation), { mode: 0o600 });
      command(
        process.execPath,
        [join(root, "scripts/review-proof.mjs"), "--attestation", path],
        { cwd: incident.workspace },
      );
    },
  };
}

export async function processQueue({
  state,
  directory,
  adapters = liveAdapters(),
  codexPath = process.env.CODEX_CLI_PATH ?? "codex",
}) {
  // Never resume an unknown partial process automatically. Its artifacts and
  // remote PR must be reconciled before any new writes for that case.
  for (const interrupted of state.cases.filter(
    (entry) => entry.status === "running",
  )) {
    interrupted.status = "AUTOMATION_BLOCKED";
    notify(
      state,
      interrupted,
      interrupted.status,
      "前回処理が中断しました。証拠・作業コピーを保持し、人間の確認を待ちます。",
    );
  }
  const incident = state.cases.find((entry) => entry.status === "queued");
  if (!incident) {
    await saveState(directory, state);
    return null;
  }
  incident.status = "running";
  await saveState(directory, state);
  let serial = 0;
  const persist = () => saveState(directory, state);
  const session = async (role, context = {}) => {
    const stageDirectory = join(
      directory,
      incident.id,
      `stage-${++serial}-${role}`,
    );
    mkdirSync(stageDirectory, { recursive: true, mode: 0o700 });
    const response = await adapters.agent({
      role,
      incident,
      directory: incident.workspace,
      stageDirectory,
      context,
      codexPath,
    });
    if (!validateResult(response.result))
      throw new Error(`Invalid structured ${role} result.`);
    recordSession(state, incident, role, response.id, response.result);
    await persist();
    if (response.result.needsExternalValidation)
      throw new Error(
        "外部API検証が必要です。料金上限を確認したtrusted adapterがないためAPIを呼ばず停止します。予算は案件全体30円です。",
      );
    if (response.result.decision === "blocked")
      throw new Error(response.result.summary);
    return response;
  };
  const stage = () => join(directory, incident.id, `verification-${serial}`);
  try {
    await adapters.createWorkspace(incident, directory);
    await persist();
    const triage = await session("triage", {
      logs: await adapters.logs(incident),
    });
    if (adapters.paths(incident.workspace).length)
      throw new Error("Read-only investigation modified files.");
    if (triage.result.decision === "no_bug") {
      incident.status = "NO_BUG";
      notify(state, incident, incident.status, triage.result.summary);
      await persist();
      return incident;
    }
    if (!["bug", "spec_change"].includes(triage.result.decision))
      throw new Error(
        "Investigation did not establish a valid change classification.",
      );
    validateEvidence(triage.result);
    incident.kind = triage.result.decision;
    incident.contract = triage.result;
    incident.summary = triage.result.summary;
    incident.rootCause = triage.result.rootCauseKey || incident.id;
    const related = state.cases.find(
      (entry) =>
        entry.id !== incident.id &&
        entry.rootCause === incident.rootCause &&
        entry.pr,
    );
    if (related) {
      incident.status = "RELATED";
      incident.pr = related.pr;
      incident.relatedTo = related.id;
      notify(
        state,
        incident,
        incident.status,
        "同じ原因の既存案件・PRに関連付けました。追加PRは作成しません。未デプロイの修正を本番復旧とは扱いません。",
      );
      await persist();
      return incident;
    }
    for (const evidence of triage.result.evidence) {
      if (
        !/^(docs\/|specs\/tasks\/|src\/|tests\/|ios\/|prisma\/)/.test(
          evidence.path,
        )
      )
        throw new Error(
          "Evidence must cite an existing original-contract repository file.",
        );
    }
    incident.originalEvidence = adapters.snapshot(
      incident.workspace,
      triage.result.evidence.map((entry) => entry.path),
    );
    if (incident.kind === "bug")
      incident.originalExpectations = adapters.expectations(incident.workspace);
    if (incident.kind === "bug") {
      if (!triage.result.regressionTests.length)
        throw new Error("Bug fix needs a direct regression test.");
      triage.result.regressionTests.forEach(safeTestPath);
    }
    const prepared = await session("prepare");
    if (prepared.result.decision !== "implemented")
      throw new Error("Specification preparation incomplete.");
    const preparedPaths = adapters.paths(incident.workspace);
    assertChanges(preparedPaths, "prepare", incident.kind);
    if (adapters.tracked(incident.workspace, preparedPaths).length)
      throw new Error(
        "Preparation may only add new specifications and tests; existing expectations are immutable.",
      );
    if (!preparedPaths.some((path) => path.startsWith("specs/tasks/")))
      throw new Error("Missing task specification before implementation.");
    if (
      incident.kind === "bug" &&
      incident.contract.regressionTests.some(
        (path) => !preparedPaths.includes(path),
      )
    )
      throw new Error(
        "Each planned regression test must actually be created before runtime edits.",
      );
    adapters.snapshot(incident.workspace, preparedPaths);
    await adapters.format(incident.workspace, preparedPaths);
    adapters.assertFrozen(incident.workspace, incident.originalEvidence);
    incident.frozen = adapters.snapshot(incident.workspace, preparedPaths);
    if (incident.kind === "bug") {
      incident.red = await adapters.verify(
        incident.workspace,
        incident,
        stage(),
        "red",
      );
    } else {
      await adapters.verify(incident.workspace, incident, stage(), "spec");
    }
    const implemented = await session("implement", { red: incident.red });
    if (implemented.result.decision !== "implemented")
      throw new Error("Implementation incomplete.");
    incident.summary = implemented.result.summary;
    assertChanges(
      adapters.paths(incident.workspace),
      "implement",
      incident.kind,
    );
    adapters.assertFrozen(incident.workspace, incident.frozen);
    if (incident.originalExpectations)
      adapters.assertFrozen(incident.workspace, incident.originalExpectations);
    adapters.snapshot(incident.workspace, adapters.paths(incident.workspace));
    await adapters.format(
      incident.workspace,
      adapters
        .paths(incident.workspace)
        .filter((path) => !Object.hasOwn(incident.frozen, path)),
    );
    incident.canPublish = true;
    incident.verification = await adapters.verify(
      incident.workspace,
      incident,
      stage(),
      "green",
    );
    await adapters.publish(
      incident,
      directory,
      incident.kind === "spec_change",
    );
    incident.verifiedHead = incident.head;
    await persist();
    notify(
      state,
      incident,
      "PR_CREATED",
      incident.kind === "spec_change"
        ? "仕様変更を伴う別Draft PRです。人間の仕様承認を待ちます。"
        : "回帰テストと必要なローカル検証を通過しました。独立レビューへ進みます。",
    );
    if (incident.kind === "spec_change") {
      incident.status = "SPEC_APPROVAL_REQUIRED";
      await persist();
      return incident;
    }
    while (true) {
      incident.ci = await adapters.readyAndQuality(incident);
      adapters.assertFrozen(incident.workspace, incident.frozen);
      if (incident.originalExpectations)
        adapters.assertFrozen(
          incident.workspace,
          incident.originalExpectations,
        );
      // Auto Fix may have created a new commit: verify the final tree, not just
      // the pre-format tree, before independently reviewing it.
      if (incident.verifiedHead !== incident.head) {
        incident.verification = await adapters.verify(
          incident.workspace,
          incident,
          stage(),
          "green",
        );
        incident.verifiedHead = incident.head;
      }
      const before = adapters.head(incident);
      if (before !== incident.head)
        throw new Error("Local/remote HEAD mismatch before review.");
      const review = await session("review", {
        diff: await adapters.diff(incident),
        red: incident.red,
        verification: incident.verification,
        ci: incident.ci,
      });
      await adapters.unchanged(incident);
      if (review.result.reviewedSha !== incident.head)
        throw new Error("Review is not bound to current HEAD.");
      if (review.result.decision === "review_pass") {
        if (review.result.findings.length)
          throw new Error("Review pass conflicts with unresolved findings.");
        await adapters.proof(
          incident,
          proofAttestation(incident, review.id),
          directory,
        );
        incident.status = "LGTM";
        notify(
          state,
          incident,
          incident.status,
          "最新HEADの独立レビューと必要な検証を完了しました。人間によるマージ待ちです。本番の修復・デプロイ完了を意味しません。",
        );
        break;
      }
      if (
        review.result.decision !== "review_changes" ||
        !review.result.findings.length ||
        review.result.findings.some(
          (finding) =>
            !finding.requirement.trim() ||
            !finding.reproduction.trim() ||
            !finding.problem.trim(),
        )
      )
        throw new Error(
          "Review requires concrete existing-specification violations and reproduction evidence.",
        );
      nextFix(incident);
      await adapters.draft(incident);
      await persist();
      const fixed = await session("fix", { findings: review.result.findings });
      if (fixed.result.decision !== "implemented")
        throw new Error("Fix incomplete.");
      assertChanges(adapters.paths(incident.workspace), "fix", incident.kind);
      adapters.assertFrozen(incident.workspace, incident.frozen);
      if (incident.originalExpectations)
        adapters.assertFrozen(
          incident.workspace,
          incident.originalExpectations,
        );
      adapters.snapshot(incident.workspace, adapters.paths(incident.workspace));
      await adapters.format(
        incident.workspace,
        adapters
          .paths(incident.workspace)
          .filter((path) => !Object.hasOwn(incident.frozen, path)),
      );
      incident.verification = await adapters.verify(
        incident.workspace,
        incident,
        stage(),
        "green",
      );
      await adapters.publish(incident, directory);
      incident.verifiedHead = incident.head;
      await persist();
    }
  } catch (error) {
    incident.status = "AUTOMATION_BLOCKED";
    incident.reason = error.message;
    if (!incident.pr && incident.canPublish) {
      try {
        await adapters.publish(incident, directory, true);
      } catch {
        incident.publishFailed = true;
      }
    }
    // Keep an existing PR draft on failure; do not publish an unvalidated patch
    // or hide a control-plane violation by creating a new remote PR.
    if (incident.pr) {
      try {
        await adapters.draft(incident);
      } catch {
        incident.draftUpdateFailed = true;
      }
    }
    notify(state, incident, incident.status, incident.reason);
  }
  await persist();
  return incident;
}
