import { forwardRef, type TextareaHTMLAttributes } from "react";

import { BrainIcon } from "../../icons/brain/brain.web";
import { Button } from "../button/button.web";

export type AiTextEditorProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  onOpenActions: () => void;
  transformation?: "enhance" | "translate";
  value: string;
};

export const AiTextEditor = forwardRef<HTMLTextAreaElement, AiTextEditorProps>(function AiTextEditor({ "aria-label": ariaLabel, onOpenActions, style, transformation, value, ...props }, ref) {
  const label = ariaLabel ?? "Text";
  return <div style={{ position: "relative", width: "100%" }}>
    {transformation ? <div aria-label={`${transformation === "enhance" ? "Enhancing" : "Translating"} ${label.toLocaleLowerCase()}`} role="progressbar" style={{ minHeight: 280, width: "100%" }} /> : <textarea {...props} aria-label={ariaLabel} ref={ref} style={{ minHeight: 280, paddingBottom: 64, width: "100%", ...style }} value={value} />}
    {!transformation ? <Button aria-label={`${label} AI actions`} disabled={!value.trim()} onClick={onOpenActions} size="md" style={{ bottom: 12, height: 42, padding: 0, position: "absolute", right: 12, width: 42 }} variant="secondary"><BrainIcon size="sm" /></Button> : null}
  </div>;
});
