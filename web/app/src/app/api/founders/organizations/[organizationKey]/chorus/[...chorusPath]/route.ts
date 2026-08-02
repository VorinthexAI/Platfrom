import { backendStream } from "@/lib/backend";
import { createChorusProxy } from "@/lib/founders/chorus-proxy";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

const proxy = createChorusProxy({ stream: backendStream, authHeaders: foundersAuthHeaders, rotateSession: applyFoundersSessionRotation });

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
