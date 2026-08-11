import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ArchiveIcon, ChevronDownIcon, GalleryIcon } from "@vorinthex/shared/ui/icons-mobile";

import { type CapabilitySlug } from "@/data/registry";
import { fonts, palette, tracking } from "@/theme/tokens";

const AVAILABLE_APPS: { slug: CapabilitySlug; name: string; icon: "archive" | "gallery" }[] = [
  { slug: "archive", name: "Archive", icon: "archive" },
  { slug: "gallery", name: "Gallery", icon: "gallery" },
];

export function WorkspaceAppSwitcher({ active }: { active: "archive" | "gallery" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const selected = AVAILABLE_APPS.find(({ slug }) => slug === active)!;

  function select(slug: CapabilitySlug) {
    setOpen(false);
    if (slug !== active) router.replace({ pathname: "/capability/[slug]", params: { slug } });
  }

  return (
    <>
      <Button accessibilityLabel={`Switch app. ${selected.name} selected`} contentMode="raw" onPress={() => setOpen(true)} size="sm" style={styles.trigger} variant="ghost">
        <Text style={styles.title}>{selected.name.toUpperCase()}</Text>
        <ChevronDownIcon size="sm" variant="muted" />
      </Button>
      <BottomSheet open={open} onOpenChange={setOpen} title="Switch app" description="Move between your Vorinthex workspaces.">
        {AVAILABLE_APPS.map((app) => (
          <BottomSheetItem
            key={app.slug}
            contentMode="raw"
            onPress={() => select(app.slug)}
            size="md"
            variant={app.slug === active ? "secondary" : "ghost"}
          >
            <View style={styles.item}>
              {app.icon === "archive" ? <ArchiveIcon size="md" /> : <GalleryIcon size="md" />}
              <Text style={styles.itemText}>{app.name}</Text>
            </View>
          </BottomSheetItem>
        ))}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, letterSpacing: tracking.micro },
  item: { flexDirection: "row", alignItems: "center", gap: 12 },
  itemText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15 },
});
