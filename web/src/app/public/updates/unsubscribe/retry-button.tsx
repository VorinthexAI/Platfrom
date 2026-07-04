"use client";

export function RetryButton() {
  return (
    <button
      className="vui-button vui-button-primary mt-6 w-full"
      onClick={() => window.location.reload()}
      type="button"
    >
      Try again
    </button>
  );
}
