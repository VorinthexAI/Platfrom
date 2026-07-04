import type { ImgHTMLAttributes, ReactNode } from "react";

import { cn } from "../../utils";

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

export function TotpSetup({
  accountLabel,
  children,
  className,
  deepLinkLabel = "On mobile? Click here to set up.",
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

      <a className="vui-totp-setup-deep-link" href={otpauthUri}>
        {deepLinkLabel}
      </a>

      {children ? <div className="vui-totp-setup-extra">{children}</div> : null}
    </section>
  );
}
