import "server-only";

import pdfParse from "pdf-parse";

export async function parse(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text.trim();
}
