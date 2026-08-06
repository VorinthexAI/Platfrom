"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@vorinthex/shared/ui/components";
import Bowser from "bowser";
import { APP_STORE_URL, GOOGLE_PLAY_URL } from "@/lib/core";
import styles from "./CorePage.module.css";

const subscribeToPlatform = () => () => undefined;
const getServerDownloadUrl = () => GOOGLE_PLAY_URL;
const getDownloadUrl = () => {
  const osName = Bowser.getParser(navigator.userAgent).getOSName(true);
  return /mac|ios/i.test(osName) ? APP_STORE_URL : GOOGLE_PLAY_URL;
};

export function DownloadAppCta() {
  const downloadUrl = useSyncExternalStore(
    subscribeToPlatform,
    getDownloadUrl,
    getServerDownloadUrl,
  );
  const [isCallingAttention, setIsCallingAttention] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const callAttention = () => {
      clearTimeout(timeoutRef.current);
      setIsCallingAttention(false);
      requestAnimationFrame(() => setIsCallingAttention(true));
      timeoutRef.current = setTimeout(() => setIsCallingAttention(false), 1100);
    };
    const handleHashChange = () => {
      if (window.location.hash === "#download") callAttention();
    };
    const handleGetAppClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        'a[href$="#download"]',
      );
      if (link) callAttention();
    };

    callAttention();
    window.addEventListener("hashchange", handleHashChange);
    document.addEventListener("click", handleGetAppClick);
    return () => {
      clearTimeout(timeoutRef.current);
      window.removeEventListener("hashchange", handleHashChange);
      document.removeEventListener("click", handleGetAppClick);
    };
  }, []);

  return (
    <div className={styles.storeButtons} id="download">
      <span className={isCallingAttention ? styles.downloadAttention : undefined}>
        <Button asChild size="lg" variant="primary">
          <a href={downloadUrl} rel="noreferrer" target="_blank">
            Download app
          </a>
        </Button>
      </span>
    </div>
  );
}
