import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import type {
  GeneratedRecipeImage,
  GeneratedRecipeImageStore,
} from "../../application/analysis/types.js";

const PUBLIC_GCS_ORIGIN = "https://storage.googleapis.com";

export class GcsGeneratedRecipeImageStore
  implements GeneratedRecipeImageStore
{
  constructor(
    private readonly bucketName: string,
    private readonly storage = new Storage(),
  ) {}

  async publish(
    recipeId: string,
    image: GeneratedRecipeImage,
  ): Promise<string> {
    const safeRecipeId = safePathSegment(recipeId);
    const extension = safeExtension(image.extension);
    const objectName = `recipe-images/${safeRecipeId}/${randomUUID()}.${extension}`;
    const file = this.storage.bucket(this.bucketName).file(objectName);

    try {
      await file.save(Buffer.from(image.data), {
        metadata: {
          contentType: image.contentType,
          cacheControl: "public, no-store, max-age=0",
        },
        resumable: false,
        validation: "crc32c",
      });
    } catch {
      await file.delete({ ignoreNotFound: true }).catch(() => {});
      throw new Error("Generated recipe image upload failed");
    }

    return publicObjectUrl(this.bucketName, objectName);
  }

  owns(imageUrl: string | null): boolean {
    if (!imageUrl) return false;
    const prefix = `${PUBLIC_GCS_ORIGIN}/${encodeURIComponent(this.bucketName)}/recipe-images/`;
    return imageUrl.startsWith(prefix);
  }

  async deleteForRecipe(recipeId: string): Promise<void> {
    const prefix = `recipe-images/${safePathSegment(recipeId)}/`;
    try {
      await this.storage.bucket(this.bucketName).deleteFiles({ prefix, force: true });
    } catch {
      throw new Error("Generated recipe image deletion failed");
    }
  }
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/gu, "_");
  if (!safe) throw new Error("Invalid generated recipe image path");
  return safe;
}

function safeExtension(value: string): string {
  const safe = value.toLowerCase().replace(/^\./u, "");
  if (!/^[a-z0-9]{1,8}$/u.test(safe))
    throw new Error("Invalid generated recipe image extension");
  return safe;
}

function publicObjectUrl(bucketName: string, objectName: string): string {
  return `${PUBLIC_GCS_ORIGIN}/${encodeURIComponent(bucketName)}/${objectName
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
