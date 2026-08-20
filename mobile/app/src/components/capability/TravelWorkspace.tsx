import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { GlobeIcon, LocationPinIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { ChromeIcon } from "@/components/ChromeIcon";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { InteractiveGlobe } from "@/components/three/InteractiveGlobe";
import { assistantIconSource } from "@/data/capability-icons";
import { COUNTRIES, type CountryFeature, type CountryProperties } from "@/lib/globe-data";
import {
  askTravelAssistant,
  fetchTravelOverview,
  findPlace,
  generatePlaceImages,
  getTravelContext,
  type Place,
  type PlaceImagesResponse,
} from "@/lib/travel-client";
import { compassQueryKeys, invalidateAssistantChanges } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

const CORE_PROMPTS = [
  "List my saved cities",
  "Which cities have I saved in Portugal?",
  "Show my saved cities in Europe",
] as const;

type SheetView = "browse" | "countryDetail";

export const COUNTRY_SHEET_CACHE_MS = 60 * 60_000;

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
  const [sheetView, setSheetView] = useState<SheetView>("browse");
  const [countryQuery, setCountryQuery] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [assistantFailed, setAssistantFailed] = useState(false);
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const overviewQuery = useQuery({ queryKey: compassQueryKeys.overview(travelContext), queryFn: fetchTravelOverview });
  const places = useMemo(() => overviewQuery.data?.places ?? [], [overviewQuery.data]);
  const selectedPlace = places.find(({ key }) => key === selectedPlaceKey);
  const countryDetailEnabled = sheetOpen && sheetView === "countryDetail" && Boolean(selectedCountry);
  const countryDetailQuery = useQuery({
    queryKey: compassQueryKeys.countryDetail(travelContext, selectedCountry?.countryCode ?? ""),
    queryFn: ({ signal }) => {
      if (!selectedCountry) throw new Error("Select a country to continue.");
      return findPlace(`${selectedCountry.name} (${selectedCountry.countryCode}), ${selectedCountry.continent}`, {
        name: selectedCountry.name,
        code: selectedCountry.countryCode,
        continent: selectedCountry.continent,
        lat: selectedCountry.latitude,
        lon: selectedCountry.longitude,
      }, signal);
    },
    enabled: countryDetailEnabled,
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
  });
  const countryImagesQuery = useQuery({
    queryKey: compassQueryKeys.countryImages(travelContext, countryDetailQuery.data?.imageRequestToken ?? ""),
    queryFn: ({ signal }) => {
      if (!countryDetailQuery.data) throw new Error("Country details are unavailable.");
      return generatePlaceImages({ imageRequestToken: countryDetailQuery.data.imageRequestToken }, signal);
    },
    enabled: countryDetailEnabled && !countryDetailQuery.isFetching && !countryDetailQuery.isError && Boolean(countryDetailQuery.data?.imageRequestToken),
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
    retry: false,
  });
  const countryDetail = countryDetailQuery.isFetching || countryDetailQuery.isError ? undefined : countryDetailQuery.data;
  const countryDetailLoading = countryDetailEnabled && countryDetailQuery.isFetching;
  const countryDetailError = countryDetailQuery.error ? errorMessage(countryDetailQuery.error) : undefined;
  const countryImages = countryDetail ? countryImagesQuery.data : undefined;
  const countryImagesUnavailable = countryDetailQuery.isError || countryImagesQuery.isError;

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
  const globePlaces = useMemo(() => places.map((place) => ({
    id: place.key,
    latitude: place.latitude,
    longitude: place.longitude,
    status: "planned" as const,
  })), [places]);

  function openBrowse() {
    setSheetView("browse");
    setSheetOpen(true);
  }

  function openCountryDetail(country: CountryProperties) {
    setSelectedCountry(country);
    setSelectedPlaceKey(undefined);
    setSheetView("countryDetail");
    setSheetOpen(true);
  }

  function closeCountryDetail() {
    // Keep an already-paid image request alive so its transient result can enter the one-hour query cache.
    setSheetOpen(false);
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
        <InteractiveGlobe
          onCountryPress={(country) => { if (country) openCountryDetail(country.properties); }}
          onPlacePress={(marker) => { const place = places.find(({ key }) => key === marker.id); if (place) selectPlace(place); }}
          places={globePlaces}
          selectedCountryCode={selectedCountry?.countryCode}
          selectedPlaceId={selectedPlace?.key}
        />
        {!loadError ? <View style={[styles.globeActions, { right: Math.max(insets.right, spacing.md) }]}>
          <Button accessibilityLabel="Browse countries and saved cities" contentMode="raw" disabled={loading} onPress={openBrowse} size="md" variant="icon"><SearchIcon size="sm" /></Button>
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
        <Button accessibilityLabel={`Browse saved cities in ${selectedCountry?.name ?? panelTitle}`} contentMode="raw" onPress={openBrowse} size="md" variant="icon"><SearchIcon size="sm" /></Button>
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

      <BottomSheet
        description={sheetView === "countryDetail" ? "A concise guide generated for the selected country." : undefined}
        footer={sheetView === "countryDetail" ? <Button onPress={closeCountryDetail} size="md" variant="secondary">Close</Button> : undefined}
        height="full"
        onOpenChange={(next) => { if (!next && sheetView === "countryDetail") closeCountryDetail(); else setSheetOpen(next); }}
        open={sheetOpen}
        title={sheetView === "countryDetail" ? selectedCountry?.name ?? "Country" : selectedCountry ? `${selectedCountry.name} cities` : "Saved cities"}
      >
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>
          {sheetView === "countryDetail" ? <View style={styles.countryDetail}>
            <View accessibilityLabel={countryImages ? "Web-sourced country images" : countryImagesUnavailable ? "Image unavailable" : "Loading country images"} accessibilityRole={!countryImages && !countryImagesUnavailable ? "progressbar" : undefined} style={styles.placeMedia}>
              <PlaceImageFrame conceptTitle={countryImages?.images[0]?.title ?? countryDetail?.assetConcepts[0].title} image={countryImages?.images[0]} unavailable={countryImagesUnavailable} wide={width >= 600} />
              <View style={styles.supportingMedia}>
                {(countryImages ? countryImages.images.slice(1) : [undefined, undefined, undefined]).map((image, index) => <PlaceImageFrame conceptTitle={image?.title ?? countryDetail?.assetConcepts[index + 1]?.title} image={image} key={image?.role ?? index} supporting unavailable={countryImagesUnavailable} />)}
              </View>
              {countryImages ? <Text style={styles.mediaDisclosure}>Images sourced from the web</Text> : null}
            </View>

            {countryDetailLoading ? <View accessibilityLabel={`Loading information about ${selectedCountry?.name ?? "country"}`} accessibilityRole="progressbar" style={styles.countryDetailSkeleton}>
              <Skeleton style={[styles.skeletonBlock, styles.skeletonSummary]} />
              <View style={styles.factGrid}>{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} style={[styles.skeletonBlock, styles.skeletonFact]} />)}</View>
              {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.skeletonBlock, styles.skeletonHighlight]} />)}
            </View> : countryDetailError ? <View style={styles.countryDetailFailure}>
              <GlobeIcon size="lg" variant="muted" />
              <Text style={styles.loadFailureText}>{countryDetailError}</Text>
            </View> : countryDetail ? <>
              <View style={styles.countryHero}>
                <Text style={styles.countryEyebrow}>{countryDetail.location.countryCode} · {countryDetail.location.continent}</Text>
                <Text style={styles.countrySummary}>{countryDetail.summary}</Text>
                {countryDetail.sources.length > 0 ? <View style={styles.sourceList}>{countryDetail.sources.map((source) => <Button key={source.url} onPress={() => void Linking.openURL(source.url)} size="md" variant="secondary">{source.title}</Button>)}</View> : null}
              </View>
              <Text style={styles.detailSectionLabel}>AT A GLANCE</Text>
              <View style={styles.factGrid}>{countryDetail.facts.map((fact) => <View key={`${fact.label}:${fact.value}`} style={styles.factCard}><Text style={styles.factLabel}>{fact.label}</Text><Text style={styles.factValue}>{fact.value}</Text></View>)}</View>
              <Text style={styles.detailSectionLabel}>HIGHLIGHTS</Text>
              <View style={styles.detailList}>{countryDetail.highlights.map((highlight) => <View key={highlight.title} style={styles.highlightCard}><Text style={styles.highlightTitle}>{highlight.title}</Text><Text style={styles.highlightDescription}>{highlight.description}</Text></View>)}</View>
              <Text style={styles.detailSectionLabel}>PRACTICAL</Text>
              <View style={styles.practicalCard}>
                <Text style={styles.factLabel}>Best time to visit</Text><Text style={styles.practicalValue}>{countryDetail.practicalInfo.bestTimeToVisit}</Text>
                <Text style={styles.factLabel}>Languages</Text><Text style={styles.practicalValue}>{countryDetail.practicalInfo.languages.join(", ")}</Text>
                <Text style={styles.factLabel}>Currency</Text><Text style={styles.practicalValue}>{countryDetail.practicalInfo.currency}</Text>
                <Text style={styles.factLabel}>Time zone</Text><Text style={styles.practicalValue}>{countryDetail.practicalInfo.timeZone}</Text>
                <Text style={styles.factLabel}>Safety</Text><Text style={styles.practicalValue}>{countryDetail.practicalInfo.safety}</Text>
                <Text style={styles.factLabel}>Entry requirements</Text><Text style={styles.practicalValue}>{countryDetail.practicalInfo.entryRequirements}</Text>
              </View>
              {countryImages ? <>
                <Text style={styles.detailSectionLabel}>IMAGE SOURCES</Text>
                <View style={styles.sourceList}>{countryImages.images.map((image) => <Button key={`${image.role}:${image.sourcePageUrl}`} onPress={() => void Linking.openURL(image.sourcePageUrl)} size="md" variant="secondary">{image.title}</Button>)}</View>
              </> : null}
              <Text style={styles.verificationNote}>Verify safety and entry requirements with official sources before travel.</Text>
            </> : null}
          </View> : <>
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
            {visibleCountries.map((country: CountryFeature) => <BottomSheetItem key={country.properties.countryCode} icon={<GlobeIcon size="md" />} onPress={() => openCountryDetail(country.properties)}>{country.properties.name}</BottomSheetItem>)}
          </>}
        </ScrollView>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

function PlaceImageFrame({ conceptTitle, image, supporting = false, unavailable, wide = false }: { conceptTitle?: string; image?: PlaceImagesResponse["images"][number]; supporting?: boolean; unavailable: boolean; wide?: boolean }) {
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  useEffect(() => setLoadState("loading"), [image?.url]);
  const failed = unavailable || loadState === "error";
  return <View style={[styles.imageFrame, supporting ? styles.supportingImageFrame : styles.heroImageFrame, wide && !supporting && styles.heroImageFrameWide, failed && styles.imageUnavailable]}>
    {image && !failed ? <Image accessibilityLabel={image.title} contentFit="cover" onError={() => setLoadState("error")} onLoad={() => setLoadState("loaded")} source={{ uri: image.url }} style={styles.placeImage} transition={250} /> : null}
    {failed ? <Text style={styles.imageUnavailableText}>Image unavailable</Text> : loadState !== "loaded" ? <Skeleton style={styles.imageSkeleton} /> : null}
    {conceptTitle && loadState === "loaded" && !failed ? <View style={styles.imageCaption}><Text numberOfLines={1} style={styles.imageCaptionText}>{conceptTitle}</Text></View> : null}
  </View>;
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
  countryDetailSkeleton: { gap: spacing.md, paddingVertical: spacing.md },
  skeletonBlock: { backgroundColor: palette.hairlineBright, opacity: 0.72 },
  skeletonSummary: { width: "100%", height: 112 },
  skeletonFact: { minWidth: 130, flexBasis: "47%", height: 86 },
  skeletonHighlight: { width: "100%", height: 104 },
  countryDetailFailure: { flex: 1, minHeight: 360, alignItems: "center", justifyContent: "center", gap: spacing.md },
  countryDetail: { gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  placeMedia: { gap: spacing.sm },
  supportingMedia: { width: "100%", flexDirection: "row", gap: spacing.sm },
  imageFrame: { minWidth: 0, aspectRatio: 9 / 16, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  heroImageFrame: { width: "100%" },
  heroImageFrameWide: { width: "56%", maxWidth: 315, alignSelf: "center" },
  supportingImageFrame: { flex: 1 },
  imageUnavailable: { borderColor: palette.hairline, backgroundColor: palette.page, opacity: 0.72 },
  imageUnavailableText: { paddingHorizontal: 4, color: palette.silver500, fontFamily: fonts.regular, fontSize: 9, lineHeight: 13, textAlign: "center" },
  imageSkeleton: { position: "absolute", width: "100%", height: "100%", backgroundColor: palette.hairlineBright, opacity: 0.72 },
  placeImage: { width: "100%", height: "100%" },
  imageCaption: { position: "absolute", right: 6, bottom: 6, left: 6, paddingHorizontal: 7, paddingVertical: 5, borderRadius: radii.sm, backgroundColor: "rgba(2,6,9,0.74)" },
  imageCaptionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 9 },
  mediaDisclosure: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, textAlign: "right" },
  countryHero: { paddingVertical: spacing.md, gap: spacing.sm },
  countryEyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 11, letterSpacing: tracking.micro, textTransform: "uppercase" },
  countrySummary: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 16, lineHeight: 25 },
  detailSectionLabel: { marginTop: spacing.sm, color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  factGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  factCard: { minWidth: 130, flexGrow: 1, flexBasis: "47%", padding: spacing.md, gap: 5, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  factLabel: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro, textTransform: "uppercase" },
  factValue: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  detailList: { gap: spacing.sm },
  highlightCard: { padding: spacing.md, gap: 6, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  highlightTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 16 },
  highlightDescription: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  practicalCard: { padding: spacing.md, gap: 7, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  practicalValue: { marginBottom: spacing.sm, color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  sourceList: { gap: spacing.sm },
  verificationNote: { paddingBottom: spacing.md, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, textAlign: "center" },
  emptyText: { paddingVertical: 18, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
});
