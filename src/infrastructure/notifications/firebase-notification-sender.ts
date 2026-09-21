import { getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import {
  NOT_RECIPE_MESSAGE,
  type NotificationSender,
} from "../../application/analysis/types.js";

export class FirebaseNotificationSender implements NotificationSender {
  constructor() {
    if (getApps().length === 0) initializeApp();
  }
  private async send(
    tokens: string[],
    recipeId: string,
    title: string,
    result: "completed" | "failed" | "not_recipe",
  ): Promise<string[]> {
    if (tokens.length === 0) return [];
    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification:
        result === "not_recipe"
          ? { title: NOT_RECIPE_MESSAGE }
          : {
              title:
                result === "completed"
                  ? "レシピの解析が完了しました"
                  : "レシピの解析に失敗しました",
              body: title,
            },
      data: { recipeId, analysisResult: result },
    });
    return response.responses.flatMap((item, index) => {
      const code = item.error?.code;
      return !item.success &&
        [
          "messaging/registration-token-not-registered",
          "messaging/invalid-registration-token",
        ].includes(code ?? "")
        ? [tokens[index]!]
        : [];
    });
  }
  sendRecipeAnalysisCompleted(
    tokens: string[],
    recipeId: string,
    title: string,
  ) {
    return this.send(tokens, recipeId, title, "completed");
  }
  sendRecipeAnalysisFailed(tokens: string[], recipeId: string, title: string) {
    return this.send(tokens, recipeId, title, "failed");
  }
  sendRecipeAnalysisNotRecipe(tokens: string[], recipeId: string) {
    return this.send(tokens, recipeId, NOT_RECIPE_MESSAGE, "not_recipe");
  }
}
