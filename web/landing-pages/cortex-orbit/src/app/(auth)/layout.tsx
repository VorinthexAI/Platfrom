import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-4 py-16 sm:py-24">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="cui-label">Cortex Orbit</span>
        </div>
        {children}
      </div>
    </div>
  );
}
