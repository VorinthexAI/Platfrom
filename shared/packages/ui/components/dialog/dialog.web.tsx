import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { CSSProperties, ReactNode } from "react";

import { Button, ButtonSizeProvider } from "../button/button.web";
import { CloseIcon } from "../../icons/close/close.web";

export type DialogProps = {
  children?: ReactNode;
  description?: string;
  dismissible?: boolean;
  footer?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

const overlayStyle: CSSProperties = { background: "rgba(0,0,0,.72)", inset: 0, position: "fixed" };
const surfaceStyle: CSSProperties = { background: "#030507", border: "1px solid rgba(255,255,255,.3)", borderRadius: 24, display: "flex", flexDirection: "column", height: "80vh", left: "50%", maxHeight: "80vh", maxWidth: "80vw", overflow: "hidden", position: "fixed", top: "50%", transform: "translate(-50%, -50%)", width: "80vw" };
const headerStyle: CSSProperties = { alignItems: "flex-start", display: "flex", gap: 12, justifyContent: "space-between", padding: "24px 24px 0" };
const contentStyle: CSSProperties = { flex: 1, minHeight: 0, overflow: "auto", padding: "16px 24px" };
const footerStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 24 };

export function Dialog({ children, description, dismissible = true, footer, onOpenChange, open, title }: DialogProps) {
  return <DialogPrimitive.Root onOpenChange={(next) => { if (dismissible || next) onOpenChange(next); }} open={open}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay style={overlayStyle} />
      <DialogPrimitive.Content onEscapeKeyDown={(event) => { if (!dismissible) event.preventDefault(); }} onInteractOutside={(event) => { if (!dismissible) event.preventDefault(); }} style={surfaceStyle}>
        <ButtonSizeProvider force size="md">
          <div style={headerStyle}><div><DialogPrimitive.Title>{title}</DialogPrimitive.Title>{description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : null}</div><DialogPrimitive.Close asChild><Button aria-label={`Close ${title}`} disabled={!dismissible} iconOnly size="md" variant="secondary"><CloseIcon size="sm" /></Button></DialogPrimitive.Close></div>
          <div style={contentStyle}>{children}</div>
          {footer ? <div style={footerStyle}>{footer}</div> : null}
        </ButtonSizeProvider>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
