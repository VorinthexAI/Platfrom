"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@vorinthex/shared/ui";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onSignOut = async () => {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  return (
    <Button loading={loading} onClick={onSignOut} variant="secondary">
      Sign out
    </Button>
  );
}
