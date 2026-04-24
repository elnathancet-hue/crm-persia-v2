import "server-only";

export async function parse(buffer: Buffer): Promise<string> {
  return buffer.toString("utf8").trim();
}
