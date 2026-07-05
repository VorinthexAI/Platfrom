import { SmoothScrollProvider } from "./_components/smooth-scroll-provider";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SmoothScrollProvider>{children}</SmoothScrollProvider>;
}
