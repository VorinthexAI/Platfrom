import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ChevronRightIcon } from "@vorinthex/shared/ui/icons-mobile";
import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource } from "@/data/capability-icons";
import { useAppsStore } from "@/state/apps";
import { fonts, palette, tracking } from "@/theme/tokens";

function agentIcon(slug: string, logoUrl?: string) {
  if (logoUrl) return { uri: logoUrl };
  return assistantIconSource;
}

export function AgentSwitcher() {
  const [open, setOpen] = useState(false);
  const agents = useAppsStore((state) => state.apps);
  const selected = useAppsStore((state) => state.selectedApp);
  const selectAgent = useAppsStore((state) => state.selectAgent);
  const agent = selected ?? agents[0];
  if (!agent) return null;
  const identity = (
    <View style={styles.identity}>
      <ChromeIcon glow={0.55} size={36} source={agentIcon(agent.slug, agent.logoUrl)} />
      <Text style={styles.title}>{agent.name}</Text>
    </View>
  );
  if (agents.length <= 1) return identity;
  return (
    <>
      <Button accessibilityLabel={`Open agent selector. Current agent: ${agent.name}`} contentMode="raw" onPress={() => setOpen(true)} size="md" style={styles.trigger} variant="ghost">
        <View style={styles.identity}>
          <ChromeIcon glow={0.55} size={36} source={agentIcon(agent.slug, agent.logoUrl)} />
          <Text style={styles.title}>{agent.name}</Text>
          <ChevronRightIcon size="sm" variant="muted" />
        </View>
      </Button>
      <BottomSheet description="Choose an agent." onOpenChange={setOpen} open={open} title="Switch agent">
        <BottomSheetMenu>
          {agents.map((item) => (
            <BottomSheetItem
              accessibilityState={{ selected: item.key === agent.key }}
              icon={<ChromeIcon glow={0.45} size={32} source={agentIcon(item.slug, item.logoUrl)} />}
              key={item.key}
              onPress={() => { setOpen(false); selectAgent(item.slug); }}
              style={styles.item}
              variant="secondary"
            >
              <Text style={styles.itemText}>{item.name}</Text>
            </BottomSheetItem>
          ))}
        </BottomSheetMenu>
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
});
