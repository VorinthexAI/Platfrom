import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@vorinthex/shared/ui/icons-mobile";

import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource, capabilityIconSource } from "@/data/capability-icons";
import { type CapabilitySlug } from "@/data/registry";
import { fonts, palette, tracking } from "@/theme/tokens";

const AVAILABLE_APPS: { slug: "archive" | "gallery" | "compass" | "signal" | "ascend"; name: string }[] = [
  { slug: "archive", name: "Archive" },
  { slug: "gallery", name: "Gallery" },
  { slug: "compass", name: "Compass" },
  { slug: "signal", name: "Signal" },
  { slug: "ascend", name: "Ascend" },
];

export function WorkspaceAppSwitcher({ active, backSize = "xs", identity = "active", onBeforeSelect, onSelectActive, trigger = "identity" }: { active: CapabilitySlug; backSize?: "xs" | "sm"; identity?: "active" | "core"; onBeforeSelect?: (slug: CapabilitySlug) => boolean; onSelectActive?: () => void; trigger?: "identity" | "back" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const selected = AVAILABLE_APPS.find(({ slug }) => slug === active)!;
  const displayedName = identity === "core" ? "Core" : selected.name;
  const displayedIcon = identity === "core" ? assistantIconSource : capabilityIconSource[selected.slug];

  function select(slug: CapabilitySlug) {
    setOpen(false);
    if (slug === active) {
      onSelectActive?.();
      return;
    }
    if (!onBeforeSelect || onBeforeSelect(slug)) router.replace({ pathname: "/capability/[slug]", params: { slug } });
  }

  return (
    <>
      {trigger === "back"
        ? <Button accessibilityLabel={`Open app selector. Current app: ${displayedName}`} contentMode="raw" onPress={() => setOpen(true)} size={backSize} variant="icon"><ChevronLeftIcon size="sm" /></Button>
        : <Button accessibilityLabel={`Open app selector. Current app: ${displayedName}`} contentMode="raw" onPress={() => setOpen(true)} size="md" style={styles.trigger} variant="ghost">
          <View style={styles.identity}>
            <ChromeIcon glow={0.55} size={36} source={displayedIcon} />
            <Text style={styles.title}>{displayedName.toUpperCase()}</Text>
            <ChevronRightIcon size="sm" variant="muted" />
          </View>
        </Button>}
      <BottomSheet open={open} onOpenChange={setOpen} title="Switch app" description="Choose a workspace.">
        <BottomSheetMenu>{AVAILABLE_APPS.map((app) => (
          <BottomSheetItem
            accessibilityState={{ selected: app.slug === active }}
            key={app.slug}
            icon={<ChromeIcon glow={0.45} size={32} source={capabilityIconSource[app.slug]} />}
            onPress={() => select(app.slug)}
            style={styles.item}
            textStyle={styles.itemText}
            variant="secondary"
          >
            {app.name}
          </BottomSheetItem>
        ))}</BottomSheetMenu>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { alignSelf: "flex-start", paddingHorizontal: 0 },
  identity: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, letterSpacing: tracking.micro },
  item: { gap: 14, paddingHorizontal: 20 },
  itemText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15 },
});
