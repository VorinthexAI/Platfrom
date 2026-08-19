import { randomUUID } from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { GlobeIcon, LocationPinIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { ChromeIcon } from "@/components/ChromeIcon";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { InteractiveGlobe } from "@/components/three/InteractiveGlobe";
import { assistantIconSource } from "@/data/capability-icons";
import { COUNTRIES, type CountryFeature, type CountryProperties } from "@/lib/globe-data";
import { askTravelAssistant, fetchTravelOverview, getTravelContext, type Place } from "@/lib/travel-client";
import { compassQueryKeys, invalidateAssistantChanges } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

const CORE_PROMPTS = [
  "List my saved cities",
  "Which cities have I saved in Portugal?",
  "Show my saved cities in Europe",
] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Compass could not complete that request.";
}

export function TravelWorkspace() {
  const queryClient = useQueryClient();
  const travelContext = getTravelContext();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selectedCountry, setSelectedCountry] = useState<CountryProperties>();
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [assistantFailed, setAssistantFailed] = useState(false);
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const overviewQuery = useQuery({ queryKey: compassQueryKeys.overview(travelContext), queryFn: fetchTravelOverview });
  const places = useMemo(() => overviewQuery.data?.places ?? [], [overviewQuery.data]);
  const selectedPlace = places.find(({ key }) => key === selectedPlaceKey);

  const countryByCode = useMemo(() => new Map(COUNTRIES.features.map(({ properties }) => [properties.countryCode, properties])), []);
  const citiesByCountry = useMemo(() => {
    const groups = new Map<string, Place[]>();
    for (const place of [...places].sort((left, right) => left.name.localeCompare(right.name))) {
      const group = groups.get(place.countryCode) ?? [];
      group.push(place);
      groups.set(place.countryCode, group);
    }
    return groups;
  }, [places]);
  const selectedCountryCities = selectedCountry ? citiesByCountry.get(selectedCountry.countryCode) ?? [] : undefined;
  const visibleCountries = useMemo(() => {
    const normalized = countryQuery.trim().toLowerCase();
    return COUNTRIES.features
      .filter(({ properties }) => !normalized || properties.name.toLowerCase().includes(normalized) || properties.countryCode.toLowerCase().includes(normalized))
      .sort((left, right) => left.properties.name.localeCompare(right.properties.name));
  }, [countryQuery]);

  function selectCountry(country: CountryProperties) {
    setSelectedCountry(country);
    setSelectedPlaceKey(undefined);
  }

  function selectPlace(place: Place) {
    setSelectedPlaceKey(place.key);
    setSelectedCountry(countryByCode.get(place.countryCode) ?? {
      countryCode: place.countryCode,
      name: place.countryCode,
      continent: "Saved cities",
      latitude: place.latitude,
      longitude: place.longitude,
    });
    setSheetOpen(false);
  }

  async function askAssistant() {
    const value = assistantInput.trim();
    if (!value) return;
    setAssistantBusy(true);
    setAssistantMessage(undefined);
    setAssistantFailed(false);
    try {
      assistantRequestKey.current ??= randomUUID();
      const response = await askTravelAssistant(value, assistantRequestKey.current);
      setAssistantInput("");
      assistantRequestKey.current = undefined;
      setAssistantMessage(response.message);
      await invalidateAssistantChanges(queryClient, travelContext, response.changes);
    } catch (failure) {
      setAssistantMessage(errorMessage(failure));
      setAssistantFailed(true);
    } finally {
      setAssistantBusy(false);
    }
  }

  const loading = overviewQuery.isPending;
  const loadError = overviewQuery.error ? errorMessage(overviewQuery.error) : undefined;
  const panelTitle = selectedPlace?.name ?? selectedCountry?.name;
  const panelMeta = selectedPlace && selectedCountry
    ? `${selectedCountry.name} · ${selectedPlace.countryCode}`
    : selectedCountry ? `${selectedCountry.continent} · ${selectedCountryCities?.length ?? 0} saved ${(selectedCountryCities?.length ?? 0) === 1 ? "city" : "cities"}` : undefined;
  const panelWidth = Math.min(width - Math.max(insets.left, spacing.md) - Math.max(insets.right, spacing.md), 600);

  return (
    <KeyboardAvoidingView behavior="height" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
        <WorkspaceAppSwitcher active="compass" />
      </View>

      <View style={styles.globe}>
        <InteractiveGlobe />
        {!loadError ? <View style={[styles.globeActions, { right: Math.max(insets.right, spacing.md) }]}>
          <Button accessibilityLabel="Browse countries and saved cities" contentMode="raw" disabled={loading} onPress={() => setSheetOpen(true)} size="md" variant="icon"><SearchIcon size="sm" /></Button>
        </View> : null}
        {loading ? <View accessibilityLabel="Loading saved cities" accessibilityRole="progressbar" style={[styles.selectionSkeleton, { bottom: 0, left: (width - panelWidth) / 2, width: panelWidth }]} /> : null}
        {loadError && !loading ? <View style={styles.loadFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{loadError}</Text><Button onPress={() => void overviewQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : null}
      </View>

      {!loading && panelTitle && !loadError ? <View style={[styles.selectionPanel, { bottom: 0, left: (width - panelWidth) / 2, width: panelWidth }]}>
        <View style={styles.panelIcon}><LocationPinIcon size="md" /></View>
        <View style={styles.panelCopy}>
          <Text numberOfLines={1} style={styles.panelTitle}>{panelTitle}</Text>
          <Text numberOfLines={1} style={styles.panelMeta}>{panelMeta}</Text>
        </View>
        <Button accessibilityLabel={`Browse saved cities in ${selectedCountry?.name ?? panelTitle}`} contentMode="raw" onPress={() => setSheetOpen(true)} size="md" variant="icon"><SearchIcon size="sm" /></Button>
      </View> : !loading && !loadError ? <View pointerEvents="none" style={[styles.hint, { bottom: 0 }]}><GlobeIcon size="sm" variant="muted" /><Text style={styles.hintText}>Rotate freely or browse countries</Text></View> : null}

      {!loadError ? <CoreComposer
        accessibilityLabel="Ask Core about saved cities"
        disabled={assistantBusy}
        editable={!assistantBusy}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        loading={assistantBusy}
        message={assistantMessage ? <View style={assistantFailed ? styles.inlineError : styles.inlineNotice}><Text style={styles.messageText}>{assistantMessage}</Text></View> : null}
        onChangeText={(value) => { setAssistantInput(value); assistantRequestKey.current = undefined; }}
        onFocusChange={(focused) => {
          if (!focused) {
            setAssistantMessage(undefined);
            setAssistantFailed(false);
          }
        }}
        onSubmit={() => void askAssistant()}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" variant="inverse" />}
        value={assistantInput}
      /> : null}

      <BottomSheet height="full" onOpenChange={setSheetOpen} open={sheetOpen} title={selectedCountry ? `${selectedCountry.name} cities` : "Saved cities"}>
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>
          <View style={styles.countrySearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search countries" onChangeText={setCountryQuery} placeholder="Search countries" style={styles.countrySearchInput} value={countryQuery} /></View>

          {selectedCountry ? <>
            <BottomSheetItem icon={<GlobeIcon size="md" />} onPress={() => { setSelectedCountry(undefined); setSelectedPlaceKey(undefined); }}>Show all saved cities</BottomSheetItem>
            <Text style={styles.listLabel}>SAVED CITIES IN {selectedCountry.countryCode}</Text>
            {selectedCountryCities?.map((place) => <BottomSheetItem key={place.key} icon={<LocationPinIcon size="md" />} onPress={() => selectPlace(place)}>{place.name}</BottomSheetItem>)}
            {selectedCountryCities?.length === 0 ? <Text style={styles.emptyText}>No saved cities in {selectedCountry.name}.</Text> : null}
          </> : <>
            <Text style={styles.listLabel}>SAVED CITIES</Text>
            {[...citiesByCountry.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([countryCode, countryPlaces]) => <Fragment key={countryCode}>
              <Text style={styles.countryLabel}>{countryByCode.get(countryCode)?.name ?? countryCode} · {countryCode}</Text>
              {countryPlaces.map((place) => <BottomSheetItem key={place.key} icon={<LocationPinIcon size="md" />} onPress={() => selectPlace(place)}>{place.name}</BottomSheetItem>)}
            </Fragment>)}
            {places.length === 0 ? <Text style={styles.emptyText}>No saved cities are available.</Text> : null}
          </>}

          <Text style={styles.listLabel}>COUNTRIES</Text>
          {visibleCountries.map((country: CountryFeature) => <BottomSheetItem key={country.properties.countryCode} icon={<GlobeIcon size="md" />} onPress={() => selectCountry(country.properties)}>{country.properties.name}</BottomSheetItem>)}
        </ScrollView>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: palette.hairline, borderBottomWidth: 1, backgroundColor: palette.page, zIndex: 4 },
  globe: { flex: 1, overflow: "hidden", backgroundColor: palette.voidBlack },
  globeActions: { position: "absolute", top: 12, flexDirection: "row", gap: 8 },
  selectionSkeleton: { position: "absolute", height: 72, borderRadius: radii.xl, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  loadFailure: { position: "absolute", top: 0, right: spacing.xl, bottom: 0, left: spacing.xl, alignItems: "center", justifyContent: "center", gap: 14 },
  loadFailureText: { maxWidth: 320, color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: "center" },
  selectionPanel: { position: "absolute", minHeight: 72, padding: 10, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: radii.xl, backgroundColor: "rgba(13,17,23,0.94)" },
  panelIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, backgroundColor: palette.panelRaised },
  panelCopy: { minWidth: 0, flex: 1 },
  panelTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 17 },
  panelMeta: { marginTop: 3, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  hint: { position: "absolute", alignSelf: "center", paddingHorizontal: 14, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, backgroundColor: "rgba(10,14,19,0.86)" },
  hintText: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 11, letterSpacing: tracking.micro },
  inlineError: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "rgba(176,74,74,0.45)", borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" },
  inlineNotice: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  messageText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  sheetContent: { gap: 6, paddingBottom: 6 },
  fullSheetScroll: { flex: 1 },
  countrySearch: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  countrySearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  listLabel: { marginTop: 10, marginBottom: 2, color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  countryLabel: { marginTop: 8, paddingHorizontal: 6, color: palette.silver300, fontFamily: fonts.medium, fontSize: 11 },
  emptyText: { paddingVertical: 18, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
});
