import type { Metadata } from "next";
import { SharedBookFallback, isValidShareToken } from "./SharedBookFallback";

export const metadata: Metadata = {
  title: "Open shared audio book",
  description: "Open a privately shared audio book in the Vorinthex app.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function SharedBookPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <SharedBookFallback token={isValidShareToken(token) ? token : undefined} />;
}
