import type { ReactNode } from "react";

import { Button } from "../button/button.web";
import { TextInput } from "../text-input/text-input.web";

export type CoreComposerProps = {
  accessory?: ReactNode;
  accessibilityHint?: string;
  accessibilityLabel: string;
  allowEmptySubmit?: boolean;
  disabled?: boolean;
  editable?: boolean;
  expandedAccessory?: ReactNode;
  expandedPrompts?: readonly string[];
  focusRequest?: number;
  focusOnOpenRequest?: boolean;
  expandedLeading?: ReactNode;
  expandedLeadingAccessory?: ReactNode;
  expandedLeadingAccessibilityLabel?: string;
  expandedLeadingDisabled?: boolean;
  expandedToolbar?: ReactNode;
  expandedFooter?: ReactNode;
  leading: ReactNode;
  leadingAccessibilityLabel?: string;
  leadingDisabled?: boolean;
  loading?: boolean;
  maxLength?: number;
  message?: ReactNode;
  onChangeText: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
  onExpandedLeadingPress?: () => void;
  onExpandedKeyboardVisibilityChange?: (visible: boolean) => void;
  onLeadingPress?: () => void;
  onSubmit: () => void;
  openEnabled?: boolean;
  pageActions?: ReactNode;
  pageBackdrop?: ReactNode;
  prompts: readonly string[];
  sendIcon: ReactNode;
  style?: React.CSSProperties;
  value: string;
};

export function CoreComposer({
  accessory,
  accessibilityLabel,
  allowEmptySubmit = false,
  disabled,
  editable = true,
  expandedFooter,
  expandedLeadingAccessory,
  leading,
  leadingAccessibilityLabel,
  leadingDisabled,
  loading,
  maxLength,
  message,
  onChangeText,
  onFocusChange,
  onExpandedKeyboardVisibilityChange,
  onLeadingPress,
  onSubmit,
  openEnabled = true,
  pageActions,
  pageBackdrop,
  prompts,
  sendIcon,
  style,
  value,
}: CoreComposerProps) {
  return (
    <div style={style}>
      {accessory}
      {pageActions}
      {pageBackdrop}
      {message}
      <div>
        {expandedLeadingAccessory}
        {onLeadingPress ? (
          <Button aria-label={leadingAccessibilityLabel ?? "Core actions"} disabled={leadingDisabled} onClick={onLeadingPress} size="sm" variant="icon">{leading}</Button>
        ) : leading}
        <TextInput
          aria-label={accessibilityLabel}
          disabled={!editable || !openEnabled}
          maxLength={maxLength}
          onBlur={() => { onFocusChange?.(false); onExpandedKeyboardVisibilityChange?.(false); }}
          onChange={(event) => onChangeText(event.target.value)}
          onFocus={() => { onFocusChange?.(true); onExpandedKeyboardVisibilityChange?.(true); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !disabled && openEnabled && (value.trim() || allowEmptySubmit)) onSubmit(); }}
          placeholder={prompts[0] ?? "Ask Core anything..."}
          value={value}
        />
        <Button aria-label="Send to Core" disabled={disabled || !openEnabled || (!value.trim() && !allowEmptySubmit)} loading={loading} onClick={onSubmit} size="sm" variant="primary">{sendIcon}</Button>
      </div>
      {expandedFooter}
    </div>
  );
}
