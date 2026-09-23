import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@vorinthex/shared/ui/icons-mobile";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";

import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource, capabilityIconSource } from "@/data/capability-icons";
import { entitledPickerApps, getCapability, visibleWorkspaceSlugs, type CapabilitySlug, type WorkspacePickerState } from "@/data/registry";
import { patchJson } from "@/lib/auth-transport";
import { useAppsStore } from "@/state/apps";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

export function WorkspaceAppSwitcher({ active, backSize = "xs", identity = "active", onBeforeSelect, onSelectActive, placeholder, trigger = "identity" }: { active: CapabilitySlug; backSize?: "xs" | "sm"; identity?: "active" | "core"; onBeforeSelect?: (slug: CapabilitySlug) => boolean; onSelectActive?: () => void; placeholder?: { icon: ReactNode; name: string }; trigger?: "identity" | "back" }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [gridWidth, setGridWidth] = useState(0);
  const registry = useAppsStore((state) => state.apps);
  const enterWorkspace = useAppsStore((state) => state.enterWorkspace);
  const rootTeamMember = useAuthStore((state) => state.rootTeamMember);
  const workspacePicker = useAuthStore((state) => state.workspacePicker);
  const applyWorkspacePicker = useAuthStore((state) => state.applyWorkspacePicker);
  const entitled = entitledPickerApps(workspacePicker, rootTeamMember);
  const visibleSlugs = visibleWorkspaceSlugs(workspacePicker, rootTeamMember);
  const availableApps = visibleSlugs.map((slug) => {
    const serverApp = registry.find((app) => app.slug === slug);
    if (!serverApp && slug !== "hq") throw new Error(`App registry has no app for ${slug}.`);
    return { slug, name: serverApp?.name ?? getCapability(slug).name };
  });
  const selected = availableApps.find(({ slug }) => slug === active) ?? availableApps[0]!;
  const displayedName = placeholder?.name ?? (identity === "core" ? registry.find((app) => app.slug === "core")!.name : selected.name);
  const displayedIcon = identity === "core" ? assistantIconSource : capabilityIconSource[selected.slug];
  const cardSize = gridWidth > 0 ? Math.floor((gridWidth - 10) / 2) : 140;

  function select(slug: CapabilitySlug) {
    setOpen(false);
    setCustomizeOpen(false);
    if (slug === active) {
      onSelectActive?.();
      return;
    }
    if (!onBeforeSelect || onBeforeSelect(slug)) {
      enterWorkspace(slug);
      router.replace({ pathname: "/capability/[slug]", params: { slug } });
    }
  }

  function openCustomize() {
    setDraftKeys(workspacePicker.selectedScopeKeys ?? entitled.map((app) => app.scopeKey || app.slug));
    setCustomizeOpen(true);
  }

  function toggleDraft(id: string) {
    setDraftKeys((current) => {
      if (current.includes(id)) return current.length === 1 ? current : current.filter((key) => key !== id);
      return [...current, id];
    });
  }

  function saveCustomize() {
    const scopeKeys = entitled.filter((app) => draftKeys.includes(app.scopeKey || app.slug)).map((app) => app.scopeKey).filter(Boolean);
    if (!scopeKeys.length) return;
    const previous = workspacePicker;
    const next: WorkspacePickerState = { apps: workspacePicker.apps.length ? workspacePicker.apps : entitled, selectedScopeKeys: scopeKeys };
    applyWorkspacePicker(next);
    setCustomizeOpen(false);
    const nextVisible = visibleWorkspaceSlugs(next, rootTeamMember);
    if (!nextVisible.includes(active) && nextVisible[0] && (!onBeforeSelect || onBeforeSelect(nextVisible[0]))) {
      enterWorkspace(nextVisible[0]);
      router.replace({ pathname: "/capability/[slug]", params: { slug: nextVisible[0] } });
    }
    void patchJson<{ scopeKeys: string[] }, WorkspacePickerState>("/auth/me/workspace-apps", { scopeKeys })
      .then((server) => applyWorkspacePicker(server))
      .catch(() => {
        applyWorkspacePicker(previous);
        showToast({ title: "Apps could not be updated.", duration: 2_500 });
      });
  }

  return (
    <>
      {trigger === "back"
        ? <Button accessibilityLabel={`Open app selector. Current app: ${displayedName}`} contentMode="raw" onPress={() => setOpen(true)} size={backSize} variant="icon"><ChevronLeftIcon size="sm" /></Button>
        : <Button accessibilityLabel={`Open app selector. Current app: ${displayedName}`} contentMode="raw" onPress={() => setOpen(true)} size="md" style={styles.trigger} variant="ghost">
          <View style={styles.identity}>
            {placeholder?.icon ?? <ChromeIcon glow={0.55} size={36} source={displayedIcon} />}
            <Text style={styles.title}>{displayedName}</Text>
            <ChevronRightIcon size="sm" variant="muted" />
          </View>
        </Button>}
      <BottomSheet
        description="Choose a workspace."
        footer={<><Button onPress={openCustomize} size="md" variant="primary">Customize</Button><Button onPress={() => { setOpen(false); setCustomizeOpen(false); }} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(next) => { setOpen(next); if (!next) setCustomizeOpen(false); }}
        open={open}
        title="Switch app"
      >
        <BottomSheetMenu>{availableApps.map((app) => (
          <BottomSheetItem
            accessibilityState={{ selected: app.slug === active }}
            key={app.slug}
            icon={<ChromeIcon glow={0.45} size={32} source={capabilityIconSource[app.slug]} />}
            onPress={() => select(app.slug)}
            style={styles.item}
            variant="secondary"
          >
            <Text style={styles.itemText}>{app.name}</Text>
          </BottomSheetItem>
        ))}</BottomSheetMenu>
      </BottomSheet>
      <BottomSheet
        description="Choose only the apps you want to use."
        footer={<><Button onPress={saveCustomize} size="md" variant="primary">Save</Button><Button onPress={() => setCustomizeOpen(false)} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={setCustomizeOpen}
        open={open && customizeOpen}
        title="Apps"
      >
        <ScrollView contentContainerStyle={styles.grid} onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { width: cardSize, height: cardSize }]}>
            <View style={styles.cardMain}><Text style={styles.cardLabel}>More coming soon</Text></View>
          </View>
          {entitled.map((app) => {
            const id = app.scopeKey || app.slug;
            const selectedCard = draftKeys.includes(id);
            return (
              <View key={id} style={[styles.card, selectedCard && styles.selectedCard, { width: cardSize, height: cardSize }]}>
                <Button accessibilityState={{ selected: selectedCard }} contentMode="raw" onPress={() => toggleDraft(id)} shape="rounded" size="md" style={styles.cardMain} variant="ghost">
                  <ChromeIcon glow={0.45} size={48} source={capabilityIconSource[app.slug]} />
                  <Text numberOfLines={1} style={styles.cardLabel}>{app.name}</Text>
                </Button>
                {selectedCard ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
              </View>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { alignSelf: "flex-start", paddingHorizontal: 0 },
  identity: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, letterSpacing: tracking.micro },
  item: { gap: 14, paddingHorizontal: 20 },
  itemText: { color: palette.silver100, flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  grid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: spacing.lg },
  card: { position: "relative", borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  selectedCard: { borderColor: palette.silver50, shadowColor: palette.silver50, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.62, shadowRadius: 5, elevation: 4 },
  cardMain: { height: "100%", width: "100%", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 10, paddingHorizontal: 8 },
  cardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
});
