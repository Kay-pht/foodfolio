import type {
  RepresentativeImageResolver,
  SourceContent,
  SourceContentExtractor,
} from "../../application/analysis/types.js";
import { sourceTypeForUrl } from "../../domain/recipe/url.js";
import {
  serializeSharedConversation,
  type SharedConversationAdapter,
} from "./ai-shared-conversation.js";

export class AiAwareSourceContentExtractor
  implements SourceContentExtractor, RepresentativeImageResolver
{
  constructor(
    private readonly fallback: SourceContentExtractor &
      RepresentativeImageResolver,
    private readonly chatgpt: SharedConversationAdapter,
    private readonly gemini: SharedConversationAdapter,
  ) {}

  async extract(url: URL): Promise<SourceContent> {
    const sourceType = sourceTypeForUrl(url);
    const adapter =
      sourceType === "chatgpt"
        ? this.chatgpt
        : sourceType === "gemini"
          ? this.gemini
          : null;
    if (!adapter) return this.fallback.extract(url);

    const conversation = await adapter.extract(url);
    return {
      sourceType,
      resolvedUrl: conversation.resolvedUrl,
      imageUrl: null,
      textForAi: serializeSharedConversation(conversation.messages),
    };
  }

  async resolveImageUrl(url: URL): Promise<string | null> {
    const sourceType = sourceTypeForUrl(url);
    if (sourceType === "chatgpt" || sourceType === "gemini") return null;
    return this.fallback.resolveImageUrl(url);
  }
}
