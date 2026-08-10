"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  forwardRef,
  useId,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Button, type ButtonProps } from "../button/button.web";
import { CloseIcon } from "../../icons/close/close.web";

export type BottomSheetProps = {
  children?: ReactNode;
  description?: string;
  dismissible?: boolean;
  mutation?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tall?: boolean;
  title: string;
};

export function BottomSheetScene({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function BottomSheet({
  children,
  description,
  dismissible = true,
  mutation = false,
  onOpenChange,
  open,
  tall = false,
  title,
}: BottomSheetProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ time: 0, y: 0 });
  const titleId = useId();
  const descriptionId = useId();

  const resetDrag = () => {
    const content = contentRef.current;
    if (!content) return;
    content.removeAttribute("data-dragging");
    content.style.removeProperty("--vui-bottom-sheet-drag-y");
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragStart.current = { time: performance.now(), y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    contentRef.current?.setAttribute("data-dragging", "");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const distance = Math.max(0, event.clientY - dragStart.current.y);
    contentRef.current?.style.setProperty(
      "--vui-bottom-sheet-drag-y",
      `${distance}px`,
    );
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const distance = Math.max(0, event.clientY - dragStart.current.y);
    const velocity =
      distance / Math.max(performance.now() - dragStart.current.time, 1);
    resetDrag();
    if (dismissible && (distance >= 96 || velocity >= 0.65)) onOpenChange(false);
  };

  return (
    <Dialog.Root onOpenChange={(next) => { if (next || dismissible) onOpenChange(next); }} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="vui-bottom-sheet-overlay" />
        <Dialog.Content
          aria-describedby={description ? descriptionId : undefined}
          aria-labelledby={titleId}
          className={`vui-bottom-sheet${tall ? " vui-bottom-sheet-tall" : ""}${mutation ? " vui-bottom-sheet-mutation" : ""}`}
          onEscapeKeyDown={(event) => { if (!dismissible) event.preventDefault(); }}
          onInteractOutside={(event) => { if (!dismissible) event.preventDefault(); }}
          ref={contentRef}
        >
          <div
            aria-hidden="true"
            className="vui-bottom-sheet-drag-handle"
            onLostPointerCapture={resetDrag}
            onPointerCancel={handlePointerEnd}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
          >
            <span />
          </div>
          <header className="vui-bottom-sheet-header">
            <Dialog.Title className="vui-bottom-sheet-title" id={titleId}>
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description
                className="vui-bottom-sheet-description"
                id={descriptionId}
              >
                {description}
              </Dialog.Description>
            ) : null}
          </header>
          <Dialog.Close asChild>
            <Button
              aria-label="Close bottom sheet"
              className="vui-bottom-sheet-close"
              disabled={!dismissible}
              size="sm"
              variant="icon"
            >
              <CloseIcon size="sm" />
            </Button>
          </Dialog.Close>
          <div className="vui-bottom-sheet-content">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type BottomSheetItemProps = ButtonProps;

export const BottomSheetItem = forwardRef<
  HTMLButtonElement,
  BottomSheetItemProps
>(function BottomSheetItem(
  { className = "", size = "lg", variant = "ghost", ...props },
  ref,
) {
  return (
    <Button
      className={["vui-bottom-sheet-item", className].filter(Boolean).join(" ")}
      ref={ref}
      size={size}
      variant={variant}
      {...props}
    />
  );
});
