import type { ImgHTMLAttributes, ReactNode } from "react";

import { cn } from "../../utils";
import { Button } from "../button/button.web";

export type TotpSetupProps = {
  accountLabel?: string;
  children?: ReactNode;
  className?: string;
  deepLinkLabel?: string;
  issuerLabel?: string;
  otpauthUri: string;
  qrCodeImageProps?: Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    "alt" | "className" | "src"
  >;
  qrCodeImageSrc: string;
};

export function isValidTotpUri(value: string) {
  try {
    const uri = new URL(value);
    return uri.protocol === "otpauth:" && uri.hostname === "totp" && Boolean(uri.pathname.replace(/^\//, ""));
  } catch { return false; }
}

export function TotpSetup({
  accountLabel,
  children,
  className,
  deepLinkLabel = "Open authenticator app",
  issuerLabel = "Authenticator app",
  otpauthUri,
  qrCodeImageProps,
  qrCodeImageSrc,
}: TotpSetupProps) {
  return (
    <section className={cn("vui-totp-setup", className)}>
      <div className="vui-totp-setup-copy">
        <p className="vui-label">Two-factor setup</p>
        <h2>Scan the QR code</h2>
        <p>
          Add this sign-in method to {issuerLabel}
          {accountLabel ? ` for ${accountLabel}` : ""}.
        </p>
      </div>

      <div className="vui-totp-setup-qr" aria-label="TOTP setup QR code">
        {/* Backend returns the exact QR image payload; Next image optimization is not useful here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          {...qrCodeImageProps}
          alt="Scan this QR code with your authenticator app"
          className="vui-totp-setup-qr-image"
          src={qrCodeImageSrc}
        />
      </div>

      <Button asChild disabled={!isValidTotpUri(otpauthUri)} size="md" variant="primary">
        <a className="vui-totp-setup-deep-link" href={isValidTotpUri(otpauthUri) ? otpauthUri : undefined}>{deepLinkLabel}</a>
      </Button>

      {children ? <div className="vui-totp-setup-extra">{children}</div> : null}
    </section>
  );
}
