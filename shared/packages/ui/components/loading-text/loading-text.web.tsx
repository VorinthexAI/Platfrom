import type { CSSProperties } from "react";

export type LoadingTextProps = {
  style?: CSSProperties;
  text: string;
};

export function LoadingText({ style, text }: LoadingTextProps) {
  return <span aria-live="polite" className="vui-loading-text" style={style}>{text}</span>;
}
