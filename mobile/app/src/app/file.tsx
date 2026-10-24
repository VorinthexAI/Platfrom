import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback } from "react";

import { FilesWorkspace } from "@/components/FilesWorkspace";

export default function FileRoute() {
  const { fileKey, fileTitle, scopeKey, returnTo } = useLocalSearchParams<{ fileKey: string; fileTitle?: string; scopeKey?: string; returnTo?: string }>();
  const router = useRouter();
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace((returnTo || "/home") as Href);
  }, [returnTo, router]);
  return <FilesWorkspace fileOnly initialFileKey={fileKey} initialFileTitle={fileTitle} initialScopeKey={scopeKey} onCloseFile={close} />;
}
