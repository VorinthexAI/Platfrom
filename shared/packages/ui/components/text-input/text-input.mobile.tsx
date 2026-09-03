import { forwardRef, useLayoutEffect, useRef } from "react";
import {
  StyleSheet,
  TextInput as NativeTextInput,
  type TextInputProps as NativeTextInputProps,
} from "react-native";

import { colors, radii } from "../../tokens";
import { useBottomSheetFocusRegistration } from "../bottom-sheet/bottom-sheet-focus.mobile";

export type TextInputProps = NativeTextInputProps & { autoFocusInBottomSheet?: boolean };

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput(
  {
    autoFocusInBottomSheet = true,
    editable,
    focusable,
    onFocus,
    placeholderTextColor = colors.muted,
    readOnly,
    style,
    ...props
  },
  ref,
) {
  const inputRef = useRef<NativeTextInput | null>(null);
  const inputId = useRef(Symbol("bottom-sheet-input")).current;
  const registration = useBottomSheetFocusRegistration();
  const eligibilityRef = useRef({ autoFocusInBottomSheet, editable, focusable, readOnly });
  eligibilityRef.current = { autoFocusInBottomSheet, editable, focusable, readOnly };

  useLayoutEffect(() => registration?.register(inputId, {
    focus: () => inputRef.current?.focus(),
    isEligible: () => eligibilityRef.current.autoFocusInBottomSheet && eligibilityRef.current.editable !== false && eligibilityRef.current.focusable !== false && eligibilityRef.current.readOnly !== true,
  }), [autoFocusInBottomSheet, editable, focusable, inputId, readOnly, registration]);

  const setRef = (instance: NativeTextInput | null) => {
    inputRef.current = instance;
    if (typeof ref === "function") ref(instance);
    else if (ref) ref.current = instance;
  };

  return (
    <NativeTextInput
      editable={editable}
      focusable={focusable}
      onFocus={(event) => {
        registration?.claim();
        onFocus?.(event);
      }}
      placeholderTextColor={placeholderTextColor}
      readOnly={readOnly}
      ref={setRef}
      style={[styles.input, styles.background, style]}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  background: { backgroundColor: colors.page },
});
