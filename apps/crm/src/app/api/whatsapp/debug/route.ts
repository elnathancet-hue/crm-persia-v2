import { NextRequest, NextResponse } from "next/server";

// Debug endpoint disabled for security — was writing arbitrary data to DB without auth.
// Re-enable with proper auth if needed for debugging.

export async function POST(request: NextRequest) {
  return NextResponse.json({ error: "Debug endpoint disabled" }, { status: 403 });
}

export async function GET() {
  return NextResponse.json({ status: "debug endpoint disabled" });
}
