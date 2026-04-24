import "server-only";

import mammoth from "mammoth";

export async function parse(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}
