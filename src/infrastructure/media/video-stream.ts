import { Readable, type Writable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import type { PublishedMedia } from "../../application/analysis/types.js";

export type VideoStreamPublisher = (
  media: { index: number; kind: "video"; contentType: string },
  write: (destination: Writable) => Promise<void>,
) => Promise<PublishedMedia>;

export class VideoSizeError extends Error {
  constructor(readonly classification: "too_large" | "empty_body") {
    super("Video size is outside the allowed range");
  }
}

export class VideoSourceError extends Error {
  constructor(cause: unknown) {
    super("Video source did not complete", { cause });
  }
}

export async function transferVideo(
  source: Readable | ReadableStream<Uint8Array>,
  destination: Writable,
  maxBytes: number,
  sourceCompletion?: Promise<void>,
): Promise<void> {
  const input =
    source instanceof Readable
      ? source
      : Readable.fromWeb(source as NodeWebStream<Uint8Array>);
  const cancelInput = () => {
    if (!destination.writableFinished) input.destroy();
  };
  destination.once("close", cancelInput);
  try {
    await pipeline(async function* () {
      let bytes = 0;
      try {
        for await (const chunk of input as AsyncIterable<Uint8Array>) {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) throw new VideoSizeError("too_large");
          yield chunk;
        }
        await sourceCompletion;
      } catch (error) {
        if (error instanceof VideoSizeError) throw error;
        throw new VideoSourceError(error);
      }
      if (bytes === 0) throw new VideoSizeError("empty_body");
    }, destination);
  } finally {
    destination.off("close", cancelInput);
  }
}
