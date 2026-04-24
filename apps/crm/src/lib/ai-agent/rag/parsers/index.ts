import "server-only";

import type { DocumentMimeType } from "@persia/shared/ai-agent";
import { parse as parseDocx } from "./docx";
import { parse as parsePdf } from "./pdf";
import { parse as parseTxt } from "./txt";

export async function parseDocument(buffer: Buffer, mimeType: DocumentMimeType): Promise<string> {
  switch (mimeType) {
    case "application/pdf":
      return parsePdf(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return parseDocx(buffer);
    case "text/plain":
      return parseTxt(buffer);
    default:
      throw new Error(`Unsupported mime type: ${mimeType}`);
  }
}
