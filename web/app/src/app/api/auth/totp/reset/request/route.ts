import { handleFounderAuth } from "@/lib/founder-auth-bridge";

export function POST(request: Request) {
  return handleFounderAuth(request, "reset");
}
