"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import {
  Modal,
  ModalClose,
  ModalContent,
  ModalOverlay,
  ModalPortal,
} from "@vorinthex/shared/ui";

export function ModalShell({
  open,
  onOpenChange,
  children,
  ariaLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <ModalPortal forceMount>
            <ModalOverlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              />
            </ModalOverlay>
            <ModalContent
              forceMount
              aria-label={ariaLabel}
              className="fixed inset-0 z-[101] flex items-end justify-center p-4 outline-none sm:items-center"
            >
              <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="cui-modal relative w-full max-w-md"
              >
                <ModalClose className="absolute top-3 right-3 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                  <CloseGlyph />
                  <span className="sr-only">Close</span>
                </ModalClose>
                {children}
              </motion.div>
            </ModalContent>
          </ModalPortal>
        ) : null}
      </AnimatePresence>
    </Modal>
  );
}

function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1.5 1.5l11 11M12.5 1.5l-11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
