import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getProgress } from "@/lib/fragments/fragments-server";

export async function GET() {
  const cookieStore = await cookies();
  const explorerId = cookieStore.get("vx_explorer")?.value;
  return NextResponse.json(getProgress(explorerId));
}
