import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const apiBaseUrl =
  process.env.FOODFOLIO_DEV_API_URL ??
  "https://foodfolio-dev-api-m4i6rcorua-as.a.run.app";
const firebaseConfigPath =
  process.env.FOODFOLIO_FIREBASE_PLIST ??
  new URL("../ios/Foodfolio/GoogleService-Info.plist", import.meta.url);
const successRecipeUrl =
  process.env.FOODFOLIO_E2E_RECIPE_URL ??
  "https://www.youtube.com/watch?v=0to72EbNg8A";

if (!new URL(apiBaseUrl).hostname.startsWith("foodfolio-dev-api-")) {
  throw new Error("FOODFOLIO_DEV_API_URL must target the Foodfolio dev API");
}

const plist = await readFile(firebaseConfigPath, "utf8");
const apiKey = plist.match(
  /<key>API_KEY<\/key>\s*<string>([^<]+)<\/string>/,
)?.[1];
if (!apiKey) throw new Error("Firebase API_KEY is missing from the plist");

const identityBaseUrl = "https://identitytoolkit.googleapis.com/v1";
const email = `foodfolio-e2e-${Date.now()}@example.com`;
const password = `E2e-${randomBytes(18).toString("base64url")}!9a`;
let idToken;
let accountDeleted = false;
const checks = [];

function record(name, details = undefined) {
  checks.push(details === undefined ? { name } : { name, details });
}

async function jsonRequest(url, init = {}, expectedStatuses = [200]) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!expectedStatuses.includes(response.status)) {
    const code = body?.error?.message ?? body?.error?.code ?? "UNKNOWN_ERROR";
    throw new Error(
      `${init.method ?? "GET"} ${new URL(url).pathname}: ${response.status} ${code}`,
    );
  }
  return { status: response.status, body };
}

async function identity(path, body, expectedStatuses = [200]) {
  return jsonRequest(
    `${identityBaseUrl}/${path}?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    expectedStatuses,
  );
}

async function api(path, init = {}, expectedStatuses = [200]) {
  return jsonRequest(
    `${apiBaseUrl}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    },
    expectedStatuses,
  );
}

async function pollRecipe(recipeId, expectedStatus, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api(`/v1/recipes/${recipeId}`);
    if (body.analysisStatus === expectedStatus) return body;
    if (["completed", "failed"].includes(body.analysisStatus)) {
      throw new Error(
        `Recipe ${recipeId} reached ${body.analysisStatus}, expected ${expectedStatus}`,
      );
    }
    await delay(5_000);
  }
  throw new Error(`Recipe ${recipeId} did not reach ${expectedStatus}`);
}

try {
  const signUp = await identity("accounts:signUp", {
    email,
    password,
    returnSecureToken: true,
  });
  idToken = signUp.body.idToken;
  if (!idToken || !signUp.body.localId)
    throw new Error("Firebase sign-up returned no token");
  record("firebase email sign-up");

  const signIn = await identity("accounts:signInWithPassword", {
    email,
    password,
    returnSecureToken: true,
  });
  idToken = signIn.body.idToken;
  if (!idToken) throw new Error("Firebase sign-in returned no token");
  record("firebase email sign-in");

  const reset = await identity("accounts:sendOobCode", {
    requestType: "PASSWORD_RESET",
    email,
  });
  if (reset.body.email !== email)
    throw new Error("Password reset request was not accepted");
  record("firebase password reset request");

  const settings = await api("/v1/settings");
  if (typeof settings.body.recipeAnalysisNotificationEnabled !== "boolean") {
    throw new Error("Settings did not return a boolean notification value");
  }
  record("Cloud Run API to Neon pooled connection");

  await api("/v1/settings", {
    method: "PATCH",
    body: JSON.stringify({ recipeAnalysisNotificationEnabled: false }),
  });
  record("analysis notification OFF");

  const created = await api(
    "/v1/recipes",
    { method: "POST", body: JSON.stringify({ url: successRecipeUrl }) },
    [201],
  );
  const completed = await pollRecipe(created.body.id, "completed");
  if (
    !completed.title ||
    !completed.ingredients.length ||
    !completed.steps.length
  ) {
    throw new Error("Completed recipe is missing AI-extracted fields");
  }
  record("Cloud Tasks to Worker to Z.ai success", {
    sourceType: completed.sourceType,
    ingredients: completed.ingredients.length,
    steps: completed.steps.length,
  });

  const fullSync = await api("/v1/sync");
  if (!fullSync.body.recipes.some(({ id }) => id === completed.id)) {
    throw new Error("Full sync omitted the completed recipe");
  }
  record("full sync");

  const updated = await api(`/v1/recipes/${completed.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Foodfolio dev E2E edited recipe",
      genre: "主菜",
      ingredients: [{ name: "E2E ingredient", amount: "1個" }],
    }),
  });
  if (updated.body.title !== "Foodfolio dev E2E edited recipe") {
    throw new Error("Recipe edit was not persisted");
  }

  const tag = await api(
    "/v1/tags",
    { method: "POST", body: JSON.stringify({ name: "dev-e2e" }) },
    [201],
  );
  const tagged = await api(`/v1/recipes/${completed.id}/tags`, {
    method: "POST",
    body: JSON.stringify({ tagId: tag.body.id }),
  });
  if (!tagged.body.tags.some(({ id }) => id === tag.body.id)) {
    throw new Error("Recipe tag was not attached");
  }

  const deltaSync = await api(
    `/v1/sync?cursor=${encodeURIComponent(fullSync.body.nextCursor)}`,
  );
  if (!deltaSync.body.recipes.some(({ id }) => id === completed.id)) {
    throw new Error("Delta sync omitted the edited recipe");
  }
  record("recipe edit, tag, and delta sync");

  await api(
    "/v1/device-token",
    {
      method: "PUT",
      body: JSON.stringify({
        token: `dev-e2e-invalid-${randomBytes(12).toString("hex")}`,
      }),
    },
    [204],
  );
  await api("/v1/settings", {
    method: "PATCH",
    body: JSON.stringify({ recipeAnalysisNotificationEnabled: true }),
  });
  record("analysis notification ON and device token registration");

  const failedCreated = await api(
    "/v1/recipes",
    {
      method: "POST",
      body: JSON.stringify({
        url: `https://www.kikkoman.co.jp/nonexistent-foodfolio-e2e-${Date.now()}`,
      }),
    },
    [201],
  );
  const failed = await pollRecipe(failedCreated.body.id, "failed");
  record("Cloud Tasks to Worker non-retryable failure", {
    status: failed.analysisStatus,
  });

  await api(`/v1/recipes/${completed.id}`, { method: "DELETE" }, [204]);
  await api(`/v1/recipes/${failed.id}`, { method: "DELETE" }, [204]);
  const idsAfterDelete = await api("/v1/sync/recipe-ids");
  if (
    idsAfterDelete.body.recipeIds.includes(completed.id) ||
    idsAfterDelete.body.recipeIds.includes(failed.id)
  ) {
    throw new Error("Deleted recipes remain in full reconciliation IDs");
  }
  record("recipe deletion and full ID reconciliation");

  await api("/v1/me", { method: "DELETE" }, [204]);
  accountDeleted = true;
  record("backend and Firebase account deletion");

  const deletedSignIn = await identity(
    "accounts:signInWithPassword",
    { email, password, returnSecureToken: true },
    [400],
  );
  if (!deletedSignIn.body?.error?.message) {
    throw new Error("Deleted Firebase account unexpectedly signed in");
  }
  record("deleted Firebase account rejects sign-in");

  console.log(JSON.stringify({ result: "passed", checks }, null, 2));
} finally {
  if (!accountDeleted && idToken) {
    try {
      const response = await fetch(`${apiBaseUrl}/v1/me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) {
        await identity("accounts:delete", { idToken }, [200]);
      }
    } catch {
      await identity("accounts:delete", { idToken }, [200]);
    }
  }
}
