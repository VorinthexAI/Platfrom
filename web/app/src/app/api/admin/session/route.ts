import { handleFounderAuth } from "@/lib/founder-auth-bridge";

export async function GET(request: Request) {
  return handleFounderAuth(request, "session");
}
