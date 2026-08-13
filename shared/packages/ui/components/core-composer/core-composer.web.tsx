import type { ReactNode } from "react";

import { Button } from "../button/button.web";
import { TextInput } from "../text-input/text-input.web";

export type CoreComposerProps = {
  accessibilityHint?: string;
  accessibilityLabel: string;
  disabled?: boolean;
  editable?: boolean;
  leading: ReactNode;
  leadingAccessibilityLabel?: string;
  leadingDisabled?: boolean;
  loading?: boolean;
  maxLength?: number;
  message?: ReactNode;
  onChangeText: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
  onLeadingPress?: () => void;
  onSubmit: () => void;
  prompts: readonly string[];
  sendIcon: ReactNode;
  style?: React.CSSProperties;
  value: string;
};

export function CoreComposer({
  accessibilityLabel,
  disabled,
  editable = true,
  leading,
  leadingAccessibilityLabel,
  leadingDisabled,
  loading,
  maxLength,
  message,
  onChangeText,
  onFocusChange,
  onLeadingPress,
  onSubmit,
  prompts,
  sendIcon,
  style,
  value,
}: CoreComposerProps) {
  return (
    <div style={style}>
      {message}
      <div>
        {onLeadingPress ? (
          <Button aria-label={leadingAccessibilityLabel ?? "Core actions"} disabled={leadingDisabled} onClick={onLeadingPress} size="sm" variant="icon">{leading}</Button>
        ) : leading}
        <TextInput
          aria-label={accessibilityLabel}
          disabled={!editable}
          maxLength={maxLength}
          onBlur={() => onFocusChange?.(false)}
          onChange={(event) => onChangeText(event.target.value)}
          onFocus={() => onFocusChange?.(true)}
          onKeyDown={(event) => { if (event.key === "Enter" && !disabled && value.trim()) onSubmit(); }}
          placeholder={prompts[0] ?? "Ask Core anything..."}
          value={value}
        />
        <Button aria-label="Send to Core" disabled={disabled || !value.trim()} loading={loading} onClick={onSubmit} size="sm" variant="primary">{sendIcon}</Button>
      </div>
    </div>
  );
}
