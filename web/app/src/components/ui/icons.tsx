import type { CapabilityIcon } from "@/data/capabilities";
import {
  ArchiveIcon,
  AscendIcon,
  CompassIcon,
  GalleryIcon,
  SignalIcon,
} from "@vorinthex/shared/ui/icons";

/**
 * Icon shim: every icon comes from the shared library
 * (shared/packages/ui/icons); this module only adds the registry-facing
 * capability map. Web icons default to `variant="inherit"` so they follow
 * the surrounding text color.
 */
export {
  ArchiveIcon,
  ArrowRightIcon,
  AscendIcon,
  BrainIcon,
  ChevronRightIcon,
  CloseIcon,
  CompassIcon,
  FragmentIcon,
  GalleryIcon,
  LockIcon,
  SignalIcon,
} from "@vorinthex/shared/ui/icons";

export const capabilityIcons: Record<CapabilityIcon, typeof ArchiveIcon> = {
  archive: ArchiveIcon,
  gallery: GalleryIcon,
  signal: SignalIcon,
  compass: CompassIcon,
  ascend: AscendIcon,
  chorus: SignalIcon,
  cadence: CompassIcon,
  momentum: AscendIcon,
  prism: GalleryIcon,
};
