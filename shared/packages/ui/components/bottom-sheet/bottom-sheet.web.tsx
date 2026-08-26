"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  forwardRef,
  useId,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Button, ButtonSizeProvider, type ButtonProps } from "../button/button.web";
import { CloseIcon } from "../../icons/close/close.web";

export type BottomSheetProps = {
  children?: ReactNode;
  description?: string;
  dismissible?: boolean;
  footer?: ReactNode;
  height?: "full";
  hideHeading?: boolean;
  hideCloseButton?: boolean;
  onOpenChange: (open: boolean) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  open: boolean;
  pageKey?: string;
  title: string;
};

export function BottomSheetScene({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function BottomSheet({
  children,
  description,
  dismissible = true,
  footer,
  height,
  hideHeading = false,
  hideCloseButton = false,
  onOpenChange,
  open,
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
        <ButtonSizeProvider force size="md">
          <Dialog.Content
            aria-describedby={description ? descriptionId : undefined}
            aria-labelledby={titleId}
            className={`vui-bottom-sheet${height === "full" ? " vui-bottom-sheet-full" : ""}`}
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
            <header className={`vui-bottom-sheet-header${hideHeading ? " vui-bottom-sheet-header-empty" : ""}`}>
              <Dialog.Title className="vui-bottom-sheet-title" hidden={hideHeading} id={titleId}>
                {title}
              </Dialog.Title>
              {!hideHeading && description ? (
                <Dialog.Description
                  className="vui-bottom-sheet-description"
                  id={descriptionId}
                >
                  {description}
                </Dialog.Description>
              ) : null}
            </header>
            {!hideCloseButton ? <Dialog.Close asChild>
              <Button
                aria-label="Close bottom sheet"
                className="vui-bottom-sheet-close"
                disabled={!dismissible}
                size="md"
                variant="icon"
              >
                <CloseIcon size="sm" />
              </Button>
            </Dialog.Close> : null}
            <div className="vui-bottom-sheet-content">{children}</div>
            {footer ? <footer className="vui-bottom-sheet-footer">{footer}</footer> : null}
          </Dialog.Content>
        </ButtonSizeProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type BottomSheetItemProps = Omit<ButtonProps, "size">;

export const BottomSheetItem = forwardRef<
  HTMLButtonElement,
  BottomSheetItemProps
>(function BottomSheetItem(
  { className = "", variant = "ghost", ...props },
  ref,
) {
  return (
    <Button
      className={["vui-bottom-sheet-item", className].filter(Boolean).join(" ")}
      ref={ref}
      size="md"
      variant={variant}
      {...props}
    />
  );
});
