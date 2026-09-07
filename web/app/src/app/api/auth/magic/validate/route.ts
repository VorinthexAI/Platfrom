import { handleFounderAuth } from "@/lib/founder-auth-bridge";

export async function POST(request: Request) {
  return handleFounderAuth(request, "magic");
}
