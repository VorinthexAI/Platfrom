import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { FilesWorkspace } from "@/components/FilesWorkspace";

export default function FileRoute() {
  const { fileKey, fileTitle, scopeKey } = useLocalSearchParams<{ fileKey: string; fileTitle?: string; scopeKey?: string }>();
  const router = useRouter();
  const close = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace("/home"); }, [router]);
  return <FilesWorkspace fileOnly initialFileKey={fileKey} initialFileTitle={fileTitle} initialScopeKey={scopeKey} onCloseFile={close} />;
}
