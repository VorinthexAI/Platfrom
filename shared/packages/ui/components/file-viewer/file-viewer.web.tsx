import React from "react";
import { Button } from "../button/button.web";

export type FileViewerProps = { error?: string; htmlUri?: string; loading?: boolean; onBack: () => void; onMenu: () => void; pdfUri?: string; title: string };

export function FileViewer({ error, htmlUri, loading, onBack, onMenu, pdfUri, title }: FileViewerProps) {
  return <section aria-label={title}>
    <header><Button onClick={onBack} size="sm" variant="ghost">Back</Button><span>{title}</span><Button onClick={onMenu} size="sm" variant="ghost">Menu</Button></header>
    {loading ? <p>Loading...</p> : error ? <p role="alert">{error}</p> : pdfUri ? <iframe src={pdfUri} title={title} /> : htmlUri ? <iframe sandbox="" src={htmlUri} title={title} /> : <p>Original preview unavailable.</p>}
  </section>;
}
