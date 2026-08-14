"use client";

import type { CSSProperties } from "react";

import { Button } from "../button/button.web";

export type FileViewerProps = { error?: string; html?: string; loading?: boolean; onBack: () => void; onMenu: () => void; onRenderError?: (message: string) => void; pdfUri?: string; title: string };

export function FileViewer({ error, html, loading, onBack, onMenu, pdfUri, title }: FileViewerProps) {
  return <section style={styles.root}>
    <header style={styles.header}><Button aria-label="Back" onClick={onBack} size="md" variant="icon">Back</Button><strong style={styles.title}>{title}</strong><Button aria-label={`Manage ${title}`} onClick={onMenu} size="md" variant="icon">Menu</Button></header>
    {loading ? <p style={styles.center}>Loading...</p> : error ? <p style={styles.center}>{error}</p> : pdfUri ? <iframe src={pdfUri} style={styles.frame} title={title} /> : <iframe sandbox="" srcDoc={html} style={styles.frame} title={title} />}
  </section>;
}

const styles: Record<string, CSSProperties> = {
  root: { background: "#030507", color: "#f5f7f8", display: "flex", flexDirection: "column", height: "100%", minWidth: 0, overflowX: "hidden" },
  header: { alignItems: "center", borderBottom: "1px solid #262d36", display: "flex", gap: 12, minHeight: 60, minWidth: 0, padding: "0 16px" },
  title: { flex: 1, overflow: "hidden", textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  frame: { background: "#030507", border: 0, flex: 1, maxWidth: "100%", minWidth: 0, overflowX: "hidden", width: "100%" },
  center: { margin: "auto", color: "#7b858c" },
};
