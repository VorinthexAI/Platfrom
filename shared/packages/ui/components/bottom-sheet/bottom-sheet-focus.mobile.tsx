import { createContext, useContext, useMemo, type ReactNode } from "react";

import { bottomSheetFocusCoordinator, type BottomSheetFocusInput } from "./bottom-sheet-focus";

type BottomSheetFocusRegistration = {
  claim: () => void;
  register: (inputId: symbol, input: BottomSheetFocusInput) => () => void;
};

const BottomSheetFocusContext = createContext<BottomSheetFocusRegistration | null>(null);

export function BottomSheetFocusProvider({ active, children, cycleKey, sheetId }: { active: boolean; children: ReactNode; cycleKey: string; sheetId: symbol }) {
  const value = useMemo<BottomSheetFocusRegistration | null>(() => active ? {
    claim: () => bottomSheetFocusCoordinator.claim(sheetId, cycleKey),
    register: (inputId, input) => bottomSheetFocusCoordinator.registerInput(sheetId, cycleKey, inputId, input),
  } : null, [active, cycleKey, sheetId]);
  return <BottomSheetFocusContext.Provider value={value}>{children}</BottomSheetFocusContext.Provider>;
}

export function useBottomSheetFocusRegistration() {
  return useContext(BottomSheetFocusContext);
}
