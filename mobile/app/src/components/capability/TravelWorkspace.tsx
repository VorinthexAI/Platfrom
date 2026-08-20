import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { ChevronRightIcon, FilterIcon, GlobeIcon, LocationPinIcon, PlusIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";

import { ChromeIcon } from "@/components/ChromeIcon";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { InteractiveGlobe } from "@/components/three/InteractiveGlobe";
import { assistantIconSource } from "@/data/capability-icons";
import { COUNTRIES, type CountryFeature, type CountryProperties } from "@/lib/globe-data";
import {
  askTravelAssistant,
  createPlace,
  fetchTravelOverview,
  findCity,
  findPlace,
  generatePlaceHeroImage,
  getTravelContext,
  type CityDetail,
  type Place,
  type PlaceImageResponse,
} from "@/lib/travel-client";
import { compassQueryKeys, invalidateAssistantChanges } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

const CORE_PROMPTS = [
  "List my saved cities",
  "Which cities have I saved in Portugal?",
  "Show my saved cities in Europe",
] as const;

type SheetView = "browse" | "countryDetail";
type GeneratedCity = { name: string; latitude: number; longitude: number };

export const COUNTRY_SHEET_CACHE_MS = 60 * 60_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Compass could not complete that request.";
}

export function TravelWorkspace() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const travelContext = getTravelContext();
  const insets = useSafeAreaInsets();
  const [selectedCountry, setSelectedCountry] = useState<CountryProperties>();
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("browse");
  const [selectedCity, setSelectedCity] = useState<GeneratedCity>();
  const [citySheetOpen, setCitySheetOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [assistantFailed, setAssistantFailed] = useState(false);
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const countryScrollRef = useRef<ScrollView>(null);
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
  const countryImageQuery = useQuery({
    queryKey: compassQueryKeys.countryImage(travelContext, countryDetailQuery.data?.imageRequestToken ?? ""),
    queryFn: ({ signal }) => {
      if (!countryDetailQuery.data) throw new Error("Country details are unavailable.");
      return generatePlaceHeroImage({ imageRequestToken: countryDetailQuery.data.imageRequestToken }, signal);
    },
    enabled: countryDetailEnabled && !countryDetailQuery.isFetching && !countryDetailQuery.isError && Boolean(countryDetailQuery.data?.imageRequestToken),
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
    retry: false,
  });
  const countryDetail = countryDetailQuery.isFetching || countryDetailQuery.isError ? undefined : countryDetailQuery.data;
  const countryDetailLoading = countryDetailEnabled && countryDetailQuery.isFetching;
  const countryDetailError = countryDetailQuery.error ? errorMessage(countryDetailQuery.error) : undefined;
  const countryImage = countryDetail ? countryImageQuery.data : undefined;
  const countryImageUnavailable = countryDetailQuery.isError || countryImageQuery.isError;
  const cityDetailEnabled = citySheetOpen && Boolean(selectedCountry && selectedCity);
  const cityDetailQuery = useQuery({
    queryKey: compassQueryKeys.cityDetail(travelContext, selectedCountry?.countryCode ?? "", selectedCity?.name ?? ""),
    queryFn: ({ signal }) => {
      if (!selectedCountry || !selectedCity) throw new Error("Select a city to continue.");
      return findCity(selectedCity.name, countryInput(selectedCountry), signal);
    },
    enabled: cityDetailEnabled,
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
  });
  const cityImageQuery = useQuery({
    queryKey: compassQueryKeys.cityImage(travelContext, selectedCountry?.countryCode ?? "", selectedCity?.name ?? "", cityDetailQuery.data?.imageRequestToken ?? ""),
    queryFn: ({ signal }) => {
      if (!cityDetailQuery.data) throw new Error("City details are unavailable.");
      return generatePlaceHeroImage({ imageRequestToken: cityDetailQuery.data.imageRequestToken }, signal);
    },
    enabled: cityDetailEnabled && !cityDetailQuery.isFetching && !cityDetailQuery.isError && Boolean(cityDetailQuery.data?.imageRequestToken),
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
    retry: false,
  });
  const cityDetail = cityDetailQuery.isFetching || cityDetailQuery.isError ? undefined : cityDetailQuery.data;
  const cityDetailLoading = cityDetailEnabled && cityDetailQuery.isFetching;
  const cityDetailError = cityDetailQuery.error ? errorMessage(cityDetailQuery.error) : undefined;
  const cityImage = cityDetail ? cityImageQuery.data : undefined;
  const cityImageUnavailable = cityDetailQuery.isError || cityImageQuery.isError;

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
    setSelectedCity(undefined);
    setCitySheetOpen(false);
    setSelectedPlaceKey(undefined);
    setSheetView("countryDetail");
    setSheetOpen(true);
  }

  function closeCountryDetail() {
    // Keep an already-paid image request alive so its transient result can enter the one-hour query cache.
    setSheetOpen(false);
  }

  function openCityDetail(city: GeneratedCity) {
    setSelectedCity(city);
    setCitySheetOpen(true);
  }

  function cachePlace(place: Place) {
    queryClient.setQueryData<{ places: Place[] }>(compassQueryKeys.overview(travelContext), (current) => ({
      places: [...(current?.places ?? []).filter((saved) => saved.key !== place.key && !(saved.countryCode === place.countryCode && saved.name.toLocaleLowerCase() === place.name.toLocaleLowerCase())), place]
        .sort((left, right) => left.name.localeCompare(right.name)),
    }));
  }

  function saveCountry() {
    if (!countryDetail) return;
    const input = { name: countryDetail.location.name, countryCode: countryDetail.location.countryCode, latitude: countryDetail.location.latitude, longitude: countryDetail.location.longitude };
    const previous = queryClient.getQueryData<{ places: Place[] }>(compassQueryKeys.overview(travelContext));
    cachePlace({ key: `optimistic-${randomUUID()}`, ...input, createdAt: new Date().toISOString() });
    setSheetOpen(false);
    showToast({ title: "Country saved to my places", duration: 2_000 });
    void createPlace(input).then(cachePlace).catch(() => {
      queryClient.setQueryData(compassQueryKeys.overview(travelContext), previous);
      showToast({ title: "Country could not be saved", duration: 2_000 });
    });
  }

  function saveCity() {
    if (!cityDetail) return;
    const input = { name: cityDetail.location.name, countryCode: cityDetail.location.countryCode, latitude: cityDetail.location.latitude, longitude: cityDetail.location.longitude };
    const previous = queryClient.getQueryData<{ places: Place[] }>(compassQueryKeys.overview(travelContext));
    cachePlace({ key: `optimistic-${randomUUID()}`, ...input, createdAt: new Date().toISOString() });
    setCitySheetOpen(false);
    requestAnimationFrame(() => countryScrollRef.current?.scrollTo({ y: 0, animated: true }));
    showToast({ title: "City saved to my places", duration: 2_000 });
    void createPlace(input).then(cachePlace).catch(() => {
      queryClient.setQueryData(compassQueryKeys.overview(travelContext), previous);
      showToast({ title: "City could not be saved", duration: 2_000 });
    });
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
  return (
    <KeyboardAvoidingView behavior="height" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
        <WorkspaceAppSwitcher active="compass" />
      </View>

      <View style={[styles.workspaceViewport, { paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
        <View style={styles.titleRow}>
          <WorkspaceAppSwitcher active="compass" trigger="back" />
          <Text numberOfLines={1} style={styles.workspaceTitle}>Compass</Text>
          <Button accessibilityLabel="Add in Compass" contentMode="raw" onPress={() => setActionsOpen(true)} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
        </View>
        <View style={styles.searchRow}>
          <View style={styles.workspaceSearch}>
            <SearchIcon size="sm" variant="muted" />
            <TextInput accessibilityLabel="Search Compass places" onChangeText={(value) => { setCountryQuery(value); if (value.trim()) openBrowse(); }} onFocus={openBrowse} placeholder="Search..." style={styles.workspaceSearchInput} value={countryQuery} />
          </View>
          <Button accessibilityLabel="Filter Compass" contentMode="raw" onPress={() => setFiltersOpen(true)} size="sm" style={styles.filterButton} variant="icon"><FilterIcon size="sm" /></Button>
        </View>
        <View style={styles.globe}>
          <InteractiveGlobe
            onCountryPress={(country) => { if (country) openCountryDetail(country.properties); }}
            onPlacePress={(marker) => { const place = places.find(({ key }) => key === marker.id); if (place) selectPlace(place); }}
            places={globePlaces}
            selectedCountryCode={selectedCountry?.countryCode}
            selectedPlaceId={selectedPlace?.key}
          />
          {loadError && !loading ? <View style={styles.loadFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{loadError}</Text><Button onPress={() => void overviewQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : null}
        </View>
      </View>

      {!loadError ? <CoreComposer
        accessory={selectedCountry && !sheetOpen && !citySheetOpen ? <Button accessibilityLabel={`Reopen ${selectedCountry.name}`} onPress={() => openCountryDetail(selectedCountry)} size="md" style={styles.placeIsland} variant="secondary"><LocationPinIcon size="sm" /><Text numberOfLines={1} style={styles.placeIslandText}>{selectedCountry.name}</Text><ChevronRightIcon size="sm" /></Button> : undefined}
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
        footer={sheetView === "countryDetail" ? <View style={styles.sheetFooter}><Button onPress={closeCountryDetail} size="md" style={styles.footerButton} variant="secondary">Close</Button><Button disabled={!countryDetail} onPress={saveCountry} size="md" style={styles.footerButton} variant="primary">Save</Button></View> : undefined}
        height="full"
        onOpenChange={(next) => { if (!next && sheetView === "countryDetail") closeCountryDetail(); else setSheetOpen(next); }}
        open={sheetOpen}
        title={sheetView === "countryDetail" ? selectedCountry?.name ?? "Country" : countryQuery.trim() ? "Search places" : selectedCountry ? `${selectedCountry.name} cities` : "Saved places"}
      >
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" ref={countryScrollRef} showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>
          {sheetView === "countryDetail" ? <View style={styles.countryDetail}>
             {countryDetailLoading ? <View accessibilityLabel={`Loading information about ${selectedCountry?.name ?? "country"}`} accessibilityRole="progressbar" style={styles.countryDetailSkeleton}>
              <Skeleton style={[styles.skeletonBlock, styles.skeletonSummary]} />
              <View style={styles.factGrid}>{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} style={[styles.skeletonBlock, styles.skeletonFact]} />)}</View>
              {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.skeletonBlock, styles.skeletonHighlight]} />)}
            </View> : countryDetailError ? <View style={styles.countryDetailFailure}>
              <GlobeIcon size="lg" variant="muted" />
              <Text style={styles.loadFailureText}>{countryDetailError}</Text>
            </View> : countryDetail ? <>
              <GuideHero detail={countryDetail} image={countryImage?.image} imageUnavailable={countryImageUnavailable} />
              <TravelRecommendationSection label="CULTURE" text={countryDetail.culture} />
              <TravelRecommendationSection label="FOOD" text={countryDetail.food} />
              <TravelRecommendationSection label="WHY VISIT" text={countryDetail.whyVisit} />
              <Text style={styles.detailSectionLabel}>POPULAR CITIES</Text>
               <View style={styles.cityList}>{countryDetail.popularCities.map((city, index) => <Button accessibilityLabel={`Open ${city.name}, ${selectedCountry?.name ?? "country"}`} key={city.name} onPress={() => openCityDetail(city)} size="md" style={styles.cityPill} variant="secondary"><Text style={styles.cityRank}>{String(index + 1).padStart(2, "0")}</Text><Text style={styles.cityName}>{city.name}</Text></Button>)}</View>
             </> : null}
          </View> : <>
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
      <BottomSheet
        footer={<View style={styles.sheetFooter}><Button onPress={() => setCitySheetOpen(false)} size="md" style={styles.footerButton} variant="secondary">Close</Button><Button disabled={!cityDetail} onPress={saveCity} size="md" style={styles.footerButton} variant="primary">Save</Button></View>}
        height="full"
        onOpenChange={(next) => { if (!next) setCitySheetOpen(false); }}
        open={citySheetOpen}
        title={selectedCity?.name ?? "City"}
      >
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>
          <View style={styles.countryDetail}>
             {cityDetailLoading ? <View accessibilityLabel={`Loading information about ${selectedCity?.name ?? "city"}`} accessibilityRole="progressbar" style={styles.countryDetailSkeleton}>
              <Skeleton style={[styles.skeletonBlock, styles.skeletonSummary]} />
              {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.skeletonBlock, styles.skeletonHighlight]} />)}
            </View> : cityDetailError ? <View style={styles.countryDetailFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{cityDetailError}</Text></View> : cityDetail ? <>
              <GuideHero detail={cityDetail} image={cityImage?.image} imageUnavailable={cityImageUnavailable} />
              <TravelRecommendationSection label="CULTURE" text={cityDetail.culture} />
              <TravelRecommendationSection label="FOOD" text={cityDetail.food} />
              <TravelRecommendationSection label="WHY VISIT" text={cityDetail.whyVisit} />
             </> : null}
          </View>
        </ScrollView>
      </BottomSheet>
      <BottomSheet footer={<Button onPress={() => setActionsOpen(false)} size="md" variant="secondary">Close</Button>} onOpenChange={setActionsOpen} open={actionsOpen} title="Add in Compass"><Text style={styles.emptyText}>No additional actions are available yet.</Text></BottomSheet>
      <BottomSheet footer={<Button onPress={() => setFiltersOpen(false)} size="md" variant="secondary">Close</Button>} onOpenChange={setFiltersOpen} open={filtersOpen} title="Filter Compass"><Text style={styles.emptyText}>No filters are available yet.</Text></BottomSheet>
    </KeyboardAvoidingView>
  );
}

function countryInput(country: CountryProperties) {
  return { name: country.name, code: country.countryCode, continent: country.continent, lat: country.latitude, lon: country.longitude };
}

function TravelRecommendationSection({ label, text }: { label: string; text: string }) {
  return <><Text style={styles.detailSectionLabel}>{label}</Text><View style={styles.recommendationCard}><Text style={styles.recommendationText}>{text}</Text></View></>;
}

function GuideHero({ detail, image, imageUnavailable }: { detail: Pick<CityDetail, "summary">; image?: PlaceImageResponse["image"]; imageUnavailable: boolean }) {
  return <View accessibilityLabel={image ? "Destination hero" : imageUnavailable ? "Image unavailable" : "Generating destination hero"} accessibilityRole={!image && !imageUnavailable ? "progressbar" : undefined} style={styles.guideHero}><PlaceImageFrame image={image} key={image?.url ?? "hero"} unavailable={imageUnavailable}><View style={styles.heroText}><Text style={styles.heroSummary}>{detail.summary}</Text></View></PlaceImageFrame></View>;
}

function PlaceImageFrame({ children, image, unavailable }: { children?: ReactNode; image?: PlaceImageResponse["image"]; unavailable: boolean }) {
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const failed = unavailable || loadState === "error";
  return <View style={[styles.imageFrame, failed && styles.imageUnavailable]}>
    {image && !failed ? <Image accessibilityLabel={image.title} cachePolicy="none" contentFit="cover" onError={() => setLoadState("error")} onLoad={() => setLoadState("loaded")} source={{ uri: image.url }} style={styles.placeImage} transition={250} /> : null}
    {failed ? <Text style={styles.imageUnavailableText}>Image unavailable</Text> : loadState !== "loaded" ? <Skeleton style={styles.imageSkeleton} /> : null}
    {image && loadState === "loaded" && !failed ? children : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: palette.hairline, borderBottomWidth: 1, backgroundColor: palette.page, zIndex: 4 },
  workspaceViewport: { flex: 1, minHeight: 0, gap: spacing.sm, paddingTop: spacing.sm },
  titleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  workspaceTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  searchRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8 },
  workspaceSearch: { minHeight: 44, flex: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  workspaceSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  filterButton: { width: 44, height: 44 },
  globe: { flex: 1, minHeight: 0, overflow: "hidden", borderRadius: radii.xl, backgroundColor: palette.voidBlack },
  loadFailure: { position: "absolute", top: 0, right: spacing.xl, bottom: 0, left: spacing.xl, alignItems: "center", justifyContent: "center", gap: 14 },
  loadFailureText: { maxWidth: 320, color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: "center" },
  inlineError: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "rgba(176,74,74,0.45)", borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" },
  inlineNotice: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  messageText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  placeIsland: { width: "100%", minHeight: 52, justifyContent: "flex-start", paddingHorizontal: spacing.md },
  placeIslandText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
  sheetFooter: { flexDirection: "row", gap: spacing.sm },
  footerButton: { flex: 1 },
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
  guideHero: { marginBottom: spacing.sm },
  imageFrame: { width: "100%", aspectRatio: 1.15, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  imageUnavailable: { borderColor: palette.hairline, backgroundColor: palette.page, opacity: 0.72 },
  imageUnavailableText: { paddingHorizontal: 4, color: palette.silver500, fontFamily: fonts.regular, fontSize: 9, lineHeight: 13, textAlign: "center" },
  imageSkeleton: { position: "absolute", width: "100%", height: "100%", backgroundColor: palette.hairlineBright, opacity: 0.72 },
  placeImage: { width: "100%", height: "100%" },
  heroText: { position: "absolute", right: 0, bottom: 0, left: 0, padding: spacing.md, backgroundColor: "rgba(2,6,9,0.7)" },
  heroSummary: { color: palette.silver50, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
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
  recommendationCard: { padding: spacing.md, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  recommendationText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
  cityList: { gap: spacing.xs },
  cityPill: { minHeight: 44, paddingHorizontal: spacing.md, flexDirection: "row", justifyContent: "flex-start", gap: spacing.sm, borderRadius: radii.md },
  cityRank: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  cityName: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  emptyText: { paddingVertical: 18, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
});
