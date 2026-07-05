// neural-map.md §5.1 — the marketing route group's own layout, split out
// from the true root layout (`src/app/layout.tsx`, unchanged: fonts,
// `<html>`/`<body>`, structured data, `<Providers>`) now that `(auth)` and
// `console` exist as sibling route groups under the same root. There is
// currently no chrome distinct to marketing pages beyond what the landing
// page itself renders, so this is a deliberate pass-through — kept as its
// own file (rather than omitted) so the route group boundary is explicit
// and ready for marketing-only chrome (e.g. a shared nav/footer across
// future marketing pages) without touching the root layout again.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
