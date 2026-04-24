import "server-only";

import {
  CHUNK_CHAR_PER_TOKEN_APPROX,
  CHUNK_OVERLAP_TOKENS,
  CHUNK_SIZE_TOKENS,
  SOURCE_MAX_CHARS,
  SOURCE_MAX_CHUNKS,
} from "@persia/shared/ai-agent";

export interface Chunk {
  content: string;
  token_count: number;
  chunk_index: number;
}

export class SourceTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceTooLargeError";
  }
}

export function chunkText(text: string): Chunk[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  if (normalized.length > SOURCE_MAX_CHARS) {
    throw new SourceTooLargeError(`Source exceeds max chars of ${SOURCE_MAX_CHARS}`);
  }

  const units = splitSemantically(normalized);
  const chunks: Chunk[] = [];
  let current = "";
  let currentTokens = 0;
  let chunkIndex = 0;

  const flush = () => {
    const content = current.trim();
    if (!content) return;
    chunks.push({
      content,
      token_count: estimateTokens(content),
      chunk_index: chunkIndex++,
    });
    if (chunks.length > SOURCE_MAX_CHUNKS) {
      throw new SourceTooLargeError(`Source exceeds max chunks of ${SOURCE_MAX_CHUNKS}`);
    }
  };

  for (const unit of units) {
    const unitTokens = estimateTokens(unit);
    if (unitTokens > CHUNK_SIZE_TOKENS) {
      if (current) {
        flush();
        current = "";
        currentTokens = 0;
      }
      for (const hardChunk of splitByTokenWindow(unit)) {
        chunks.push({
          content: hardChunk,
          token_count: estimateTokens(hardChunk),
          chunk_index: chunkIndex++,
        });
        if (chunks.length > SOURCE_MAX_CHUNKS) {
          throw new SourceTooLargeError(`Source exceeds max chunks of ${SOURCE_MAX_CHUNKS}`);
        }
      }
      continue;
    }

    if (current && currentTokens + unitTokens > CHUNK_SIZE_TOKENS) {
      flush();
      current = buildOverlapSeed(current);
      currentTokens = estimateTokens(current);
    }

    current = current ? `${current}\n\n${unit}` : unit;
    currentTokens = estimateTokens(current);
  }

  if (current) flush();
  return chunks;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
}

function splitSemantically(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);
    if (paragraphTokens <= CHUNK_SIZE_TOKENS) {
      units.push(paragraph);
      continue;
    }

    const lines = paragraph
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      units.push(...lines);
      continue;
    }

    const sentences = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (sentences.length > 1) {
      units.push(...sentences);
      continue;
    }

    units.push(paragraph);
  }
  return units;
}

function splitByTokenWindow(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const wordsPerChunk = Math.max(1, CHUNK_SIZE_TOKENS * 3);
  const overlapWords = Math.max(1, CHUNK_OVERLAP_TOKENS * 3);
  const result: string[] = [];

  for (let start = 0; start < words.length; start += Math.max(1, wordsPerChunk - overlapWords)) {
    const slice = words.slice(start, start + wordsPerChunk).join(" ").trim();
    if (slice) result.push(slice);
    if (start + wordsPerChunk >= words.length) break;
  }

  return result;
}

function buildOverlapSeed(content: string): string {
  const words = content.split(/\s+/).filter(Boolean);
  const overlapWords = Math.max(1, CHUNK_OVERLAP_TOKENS * 3);
  return words.slice(-overlapWords).join(" ").trim();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHUNK_CHAR_PER_TOKEN_APPROX));
}
