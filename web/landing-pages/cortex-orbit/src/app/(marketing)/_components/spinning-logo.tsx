import Image from "next/image";

export function SpinningLogo({ size = 28 }: { size?: number }) {
  return (
    <span className="cui-spin-3d inline-flex shrink-0" style={{ width: size, height: size }}>
      <span className="cui-spin-3d-inner inline-flex">
        <Image
          src="/logos/logo-transparent.png"
          alt=""
          width={size}
          height={size}
          priority
          className="select-none"
        />
      </span>
    </span>
  );
}
