import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, type TextInput as NativeTextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { ClockIcon, ChevronRightIcon, CloseIcon, FilterIcon, GlobeIcon, LocationPinIcon, PlusIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { SearchHistoryPill } from "@vorinthex/shared/ui/search-history-pill";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
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
  findPlaceChildren,
  generatePlaceHeroImage,
  getTravelContext,
  openPlace,
  searchCountries,
  type CityDetail,
  type CountrySearchResult,
  type CreatePlaceInput,
  type Place,
  type PlaceImageResponse,
  type RecentPlace,
} from "@/lib/travel-client";
import { deleteContentSearchHistory, getContentContext, type ContentSearchHistoryItem } from "@/lib/content-client";
import { contentQueryKeys, getContentHistory, promoteCachedContentHistory, removeCachedContentHistory } from "@/lib/content-query-cache";
import { hydratePlaceChildren, PLACE_GUIDE_CACHE_MS } from "@/lib/travel-prefetch";
import { addOptimisticCompassPlace, compassQueryKeys, galleryQueryKeys, invalidateAssistantChanges, reconcileOptimisticCompassPlace, removeOptimisticCompassPlace, type CompassOverview } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

const CORE_PROMPTS = [
  "List my saved cities",
  "Which cities have I saved in Portugal?",
  "Show my saved cities in Europe",
] as const;

type SheetView = "browse" | "countryDetail";
type GeneratedCity = { name: string; latitude: number; longitude: number };

export const COUNTRY_SHEET_CACHE_MS = PLACE_GUIDE_CACHE_MS;
export const COUNTRY_SEARCH_DEBOUNCE_MS = 350;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Compass could not complete that request.";
}

export function TravelWorkspace() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const travelContext = useMemo(() => getTravelContext(), []);
  const contentContext = useMemo(() => getContentContext(), []);
  const insets = useSafeAreaInsets();
  const [selectedCountry, setSelectedCountry] = useState<CountryProperties>();
  const [highlightSelectedCountry, setHighlightSelectedCountry] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("browse");
  const [selectedCity, setSelectedCity] = useState<GeneratedCity>();
  const [citySheetOpen, setCitySheetOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [countryQuery, setCountryQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState<NonNullable<CountrySearchResult>>();
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantInputFocused, setAssistantInputFocused] = useState(false);
  const [countrySearchFocusBlocked, setCountrySearchFocusBlocked] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [assistantFailed, setAssistantFailed] = useState(false);
  const [countryOpenRequest, setCountryOpenRequest] = useState(0);
  const [cityOpenRequest, setCityOpenRequest] = useState(0);
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const countryScrollRef = useRef<ScrollView>(null);
  const countrySearchRequest = useRef(0);
  const countrySearchInput = useRef<NativeTextInput>(null);
  const searchFocusReleaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const historyGeneration = useRef(0);
  const recordedCountryOpen = useRef(0);
  const recordedCityOpen = useRef(0);
  const overviewQuery = useQuery({ queryKey: compassQueryKeys.overview(travelContext), queryFn: fetchTravelOverview });
  const places = useMemo(() => overviewQuery.data?.places ?? [], [overviewQuery.data]);
  const recentPlaces = overviewQuery.data?.recentPlaces ?? [];
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
  const childrenRequestToken = countryDetailQuery.data?.childrenRequestToken ?? "";
  useQuery({
    queryKey: compassQueryKeys.placeChildren(travelContext, childrenRequestToken),
    queryFn: async ({ signal }) => {
      if (!countryDetailQuery.data || !selectedCountry) throw new Error("Country details are unavailable.");
      const cities = await findPlaceChildren(countryDetailQuery.data.childrenRequestToken, signal);
      const heroQueries = hydratePlaceChildren(queryClient, travelContext, selectedCountry.countryCode, countryDetailQuery.data.popularCities, cities, generatePlaceHeroImage);
      void Promise.allSettled(heroQueries);
      return cities;
    },
    enabled: countryDetailEnabled && Boolean(childrenRequestToken),
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
    retry: false,
    refetchInterval: false,
  });
  const cityDetailEnabled = citySheetOpen && Boolean(selectedCountry && selectedCity);
  const cityDetailQuery = useQuery({
    queryKey: compassQueryKeys.cityDetail(travelContext, selectedCountry?.countryCode ?? "", selectedCity?.name ?? ""),
    queryFn: ({ signal }) => {
      if (!selectedCountry || !selectedCity) throw new Error("Select a city to continue.");
      return findCity(selectedCity.name, { name: selectedCountry.name, code: selectedCountry.countryCode, continent: selectedCountry.continent, lat: selectedCountry.latitude, lon: selectedCountry.longitude }, signal);
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
  const cityDetailLoading = cityDetailEnabled && (cityDetailQuery.isPending || cityDetailQuery.isFetching);
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
  useEffect(() => {
    const query = countryQuery.trim();
    const request = ++countrySearchRequest.current;
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
       void searchCountries(query, controller.signal).then((match) => {
         if (request !== countrySearchRequest.current) return;
         void queryClient.invalidateQueries({ queryKey: contentQueryKeys.history(contentContext, undefined), exact: true, refetchType: "none" }).catch(() => undefined);
         if (!match) return;
         setSearchFocus(match);
      }).catch((error: unknown) => {
        if (request === countrySearchRequest.current && !(error instanceof Error && error.name === "CanceledError")) setSearchFocus(undefined);
      });
    }, COUNTRY_SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [contentContext, countryQuery, queryClient]);

  useEffect(() => {
    if (!countryDetailEnabled || !countryDetail || recordedCountryOpen.current === countryOpenRequest) return;
    recordedCountryOpen.current = countryOpenRequest;
    void openPlace(countryDetail.location.name, countryDetail.location.countryCode).then(() => queryClient.invalidateQueries({ queryKey: compassQueryKeys.overview(travelContext), exact: true })).catch(() => undefined);
  }, [countryDetail, countryDetailEnabled, countryOpenRequest, queryClient, travelContext]);

  useEffect(() => {
    if (!cityDetailEnabled || !cityDetail || recordedCityOpen.current === cityOpenRequest) return;
    recordedCityOpen.current = cityOpenRequest;
    void openPlace(cityDetail.location.name, cityDetail.location.countryCode).then(() => queryClient.invalidateQueries({ queryKey: compassQueryKeys.overview(travelContext), exact: true })).catch(() => undefined);
  }, [cityDetail, cityDetailEnabled, cityOpenRequest, queryClient, travelContext]);

  useEffect(() => () => {
    if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current);
  }, []);

  function handleCoreFocusChange(focused: boolean) {
    if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current);
    setAssistantInputFocused(focused);
    if (focused) {
      setCountrySearchFocusBlocked(true);
      countrySearchInput.current?.blur();
      Keyboard.dismiss();
      return;
    }
    setAssistantMessage(undefined);
    setAssistantFailed(false);
    searchFocusReleaseTimer.current = setTimeout(() => setCountrySearchFocusBlocked(false), 350);
  }

  function openBrowse() {
    setSheetView("browse");
    setSheetOpen(true);
  }

  function openCountryDetail(country: CountryProperties, focusGlobe = false) {
    setSearchFocus(focusGlobe ? { name: country.name, countryCode: country.countryCode, latitude: country.latitude, longitude: country.longitude } : undefined);
    setHighlightSelectedCountry(true);
    setSelectedCountry(country);
    setSelectedCity(undefined);
    setCitySheetOpen(false);
    setSheetView("countryDetail");
    setSheetOpen(true);
    setCountryOpenRequest((current) => current + 1);
  }

  function closeCountryDetail() {
    // Keep an already-paid image request alive so its transient result can enter the durable session cache.
    setSheetOpen(false);
  }

  function openCityDetail(city: GeneratedCity) {
    setSelectedCity(city);
    setCitySheetOpen(true);
    setSheetOpen(false);
    setCityOpenRequest((current) => current + 1);
  }

  async function openSearchHistory() {
    const generation = ++historyGeneration.current;
    const key = contentQueryKeys.history(contentContext, undefined);
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setHistory(cached ?? []);
    setHistoryLoading(!cached || invalidated);
    setRemovingHistoryQuery(undefined);
    setFiltersOpen(false);
    setHistoryOpen(true);
    if (cached && !invalidated) return;
    try {
      const loaded = await getContentHistory(queryClient, contentContext, undefined);
      if (generation === historyGeneration.current) setHistory(loaded);
    } catch (error) {
      if (generation === historyGeneration.current) showToast({ title: errorMessage(error), duration: 2_000 });
    } finally {
      if (generation === historyGeneration.current) setHistoryLoading(false);
    }
  }

  function applyHistoryQuery(item: ContentSearchHistoryItem) {
    const promoted = promoteCachedContentHistory(queryClient, contentContext, undefined, item);
    setHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    setHistoryOpen(false);
    setSearchFocus(undefined);
    setCountryQuery(item.query);
  }

  async function removeHistoryQuery(item: ContentSearchHistoryItem) {
    if (removingHistoryQuery) return;
    const previous = removeCachedContentHistory(queryClient, contentContext, undefined, item.normalizedQuery);
    setHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch (error) {
      queryClient.setQueryData(contentQueryKeys.history(contentContext, undefined), previous);
      setHistory(previous);
      showToast({ title: errorMessage(error), duration: 2_000 });
    } finally {
      setRemovingHistoryQuery(undefined);
    }
  }

  function openRecentPlace(place: RecentPlace) {
    const country = countryByCode.get(place.countryCode) ?? {
      countryCode: place.countryCode,
      name: place.kind === "country" ? place.name : place.countryCode,
      continent: "Unknown",
      latitude: place.latitude,
      longitude: place.longitude,
    };
    setRecentOpen(false);
    if (place.kind === "country") {
      openCountryDetail(country, true);
      return;
    }
    setSearchFocus(undefined);
    setHighlightSelectedCountry(false);
    setSelectedCountry(country);
    setSheetOpen(false);
    openCityDetail({ name: place.name, latitude: place.latitude, longitude: place.longitude });
  }

  async function persistGeneratedPlace(input: CreatePlaceInput, optimisticKey: string, failureTitle: string) {
    const overviewKey = compassQueryKeys.overview(travelContext);
    await queryClient.cancelQueries({ queryKey: overviewKey, exact: true }).catch(() => undefined);
    queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => addOptimisticCompassPlace(current, {
      key: optimisticKey, name: input.name, summary: input.summary, countryCode: input.countryCode,
      latitude: input.latitude, longitude: input.longitude, createdAt: new Date().toISOString(),
    }));
    void createPlace(input).then((place) => {
      queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => reconcileOptimisticCompassPlace(current, optimisticKey, place));
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(travelContext) });
    }).catch(() => {
      queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => removeOptimisticCompassPlace(current, optimisticKey));
      showToast({ title: failureTitle, duration: 2_000 });
    });
  }

  function saveCountry() {
    if (!countryDetail || countryImage?.status !== "ready") return;
    const input = { name: countryDetail.location.name, summary: countryDetail.summary, countryCode: countryDetail.location.countryCode, latitude: countryDetail.location.latitude, longitude: countryDetail.location.longitude, imageRequestToken: countryDetail.imageRequestToken };
    const optimisticKey = `optimistic-${randomUUID()}`;
    setSheetOpen(false);
    showToast({ title: "Country saved to my places", duration: 2_000 });
    void persistGeneratedPlace(input, optimisticKey, "Country could not be saved");
  }

  function saveCity() {
    if (!cityDetail || cityImage?.status !== "ready") return;
    const input = { name: cityDetail.location.name, summary: cityDetail.summary, countryCode: cityDetail.location.countryCode, latitude: cityDetail.location.latitude, longitude: cityDetail.location.longitude, imageRequestToken: cityDetail.imageRequestToken };
    const optimisticKey = `optimistic-${randomUUID()}`;
    setCitySheetOpen(false);
    requestAnimationFrame(() => countryScrollRef.current?.scrollTo({ y: 0, animated: true }));
    showToast({ title: "City saved to my places", duration: 2_000 });
    void persistGeneratedPlace(input, optimisticKey, "City could not be saved");
  }

  function selectPlace(place: Place) {
    setSelectedCountry(countryByCode.get(place.countryCode) ?? {
      countryCode: place.countryCode,
      name: place.countryCode,
      continent: "Saved cities",
      latitude: place.latitude,
      longitude: place.longitude,
    });
    setHighlightSelectedCountry(true);
    setSearchFocus({ name: place.name, countryCode: place.countryCode, latitude: place.latitude, longitude: place.longitude });
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
    <KeyboardAvoidingView behavior={assistantInputFocused ? "height" : undefined} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
        <WorkspaceAppSwitcher active="compass" />
      </View>

      <View style={[styles.workspaceViewport, { paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
        <View style={styles.titleRow}>
          <WorkspaceAppSwitcher active="compass" trigger="back" />
          <Text numberOfLines={1} style={styles.workspaceTitle}>Compass</Text>
          <Button accessibilityLabel="Recent places" contentMode="raw" onPress={() => setRecentOpen(true)} size="sm" variant="icon"><ClockIcon size="sm" /></Button>
          <Button accessibilityLabel="Add in Compass" contentMode="raw" onPress={() => setActionsOpen(true)} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
        </View>
        <View style={styles.searchRow}>
          <View style={styles.workspaceSearch}>
            <SearchIcon size="sm" variant="muted" />
            <TextInput accessibilityLabel="Search Compass countries" editable={!countrySearchFocusBlocked} focusable={!countrySearchFocusBlocked} onChangeText={(value) => { setCountryQuery(value); setSearchFocus(undefined); }} onFocus={() => { if (countrySearchFocusBlocked) { countrySearchInput.current?.blur(); Keyboard.dismiss(); } }} placeholder="Search countries..." ref={countrySearchInput} style={styles.workspaceSearchInput} value={countryQuery} />
            {countryQuery.trim() ? <Button accessibilityLabel="Clear Compass search" contentMode="raw" iconOnly onPress={() => { setCountryQuery(""); setSearchFocus(undefined); }} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
          </View>
          <Button accessibilityLabel="Filter Compass" contentMode="raw" onPress={() => setFiltersOpen(true)} size="sm" style={styles.filterButton} variant="icon"><FilterIcon size="sm" /></Button>
        </View>
        <View style={styles.globe}>
          <InteractiveGlobe
            onCountryPress={(country) => { if (country) openCountryDetail(country.properties); }}
            focusTarget={searchFocus ?? undefined}
            selectedCountryCode={highlightSelectedCountry ? selectedCountry?.countryCode : undefined}
          />
          {loadError && !loading ? <View style={styles.loadFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{loadError}</Text><Button onPress={() => void overviewQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : null}
        </View>
      </View>

      {!loadError ? <CoreComposer
        accessory={selectedCountry && !sheetOpen && !citySheetOpen ? <Button accessibilityLabel={`Reopen ${selectedCountry.name}`} contentMode="raw" onPress={() => openCountryDetail(selectedCountry)} size="sm" style={styles.placeIsland} variant="secondary"><LocationPinIcon size="sm" /><Text numberOfLines={1} style={styles.placeIslandText}>{selectedCountry.name}</Text><ChevronRightIcon size="sm" /></Button> : undefined}
        accessibilityLabel="Ask Core about saved cities"
        disabled={assistantBusy}
        editable={!assistantBusy}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        loading={assistantBusy}
        message={assistantMessage ? <View style={assistantFailed ? styles.inlineError : styles.inlineNotice}><Text style={styles.messageText}>{assistantMessage}</Text></View> : null}
        onChangeText={(value) => { setAssistantInput(value); assistantRequestKey.current = undefined; }}
        onFocusChange={handleCoreFocusChange}
        onSubmit={() => void askAssistant()}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" variant="inverse" />}
        value={assistantInput}
      /> : null}

      <BottomSheet
        footer={sheetView === "countryDetail" ? <View style={styles.sheetFooter}><Button disabled={!countryDetail || countryImage?.status !== "ready"} onPress={saveCountry} size="md" variant="primary">Save</Button><Button onPress={closeCountryDetail} size="md" variant="secondary">Close</Button></View> : undefined}
        height="full"
        onOpenChange={(next) => { if (!next && sheetView === "countryDetail") closeCountryDetail(); else setSheetOpen(next); }}
        open={sheetOpen}
        title={sheetView === "countryDetail" ? selectedCountry?.name ?? "Country" : countryQuery.trim() ? "Search places" : selectedCountry ? `${selectedCountry.name} cities` : "Saved places"}
      >
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" ref={countryScrollRef} showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>
          {sheetView === "countryDetail" ? <View style={styles.countryDetail}>
             {countryDetailLoading ? <GuideLoading label={`Loading information about ${selectedCountry?.name ?? "country"}`} text="Generating country guide..." /> : countryDetailError ? <View style={styles.countryDetailFailure}>
              <GlobeIcon size="lg" variant="muted" />
              <Text style={styles.loadFailureText}>{countryDetailError}</Text>
            </View> : countryDetail ? <>
              <GuideHero detail={countryDetail} image={countryImage?.image} imageUnavailable={countryImageUnavailable} />
              <Text style={styles.popularCitiesTitle}>Popular cities</Text>
               <View style={styles.cityList}>{countryDetail.popularCities.map((city) => <Button accessibilityLabel={`Open ${city.name}, ${selectedCountry?.name ?? "country"}`} contentMode="raw" key={city.name} onPress={() => openCityDetail(city)} size="md" style={styles.cityPill} variant="secondary"><Text style={styles.cityName}>{city.name}</Text><ChevronRightIcon size="sm" /></Button>)}</View>
             </> : null}
          </View> : <>
             {selectedCountry ? <>
              <BottomSheetItem icon={<GlobeIcon size="md" />} onPress={() => { setSelectedCountry(undefined); setHighlightSelectedCountry(false); }}>Show all saved cities</BottomSheetItem>
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
        footer={<View style={styles.sheetFooter}><Button disabled={!cityDetail || cityImage?.status !== "ready"} onPress={saveCity} size="md" variant="primary">Save</Button><Button onPress={() => setCitySheetOpen(false)} size="md" variant="secondary">Close</Button></View>}
        height="full"
        onOpenChange={(next) => { if (!next) setCitySheetOpen(false); }}
        open={citySheetOpen}
        title={selectedCity?.name ?? "City"}
      >
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>
          <View style={styles.countryDetail}>
             {cityDetailLoading ? <GuideLoading label={`Loading information about ${selectedCity?.name ?? "city"}`} text="Generating city guide..." /> : cityDetailError ? <View style={styles.countryDetailFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{cityDetailError}</Text></View> : cityDetail ? <>
              <GuideHero detail={cityDetail} image={cityImage?.image} imageUnavailable={cityImageUnavailable} />
             </> : null}
          </View>
        </ScrollView>
      </BottomSheet>
      <BottomSheet footer={<Button onPress={() => setActionsOpen(false)} size="md" variant="secondary">Close</Button>} onOpenChange={setActionsOpen} open={actionsOpen} title="Add in Compass"><BottomSheetItem icon={<GlobeIcon size="md" />} onPress={() => { setActionsOpen(false); openBrowse(); }}>Browse countries and saved places</BottomSheetItem></BottomSheet>
      <BottomSheet footer={<Button onPress={() => setFiltersOpen(false)} size="md" variant="secondary">Close</Button>} onOpenChange={setFiltersOpen} open={filtersOpen} title="Filter Compass"><Button onPress={() => void openSearchHistory()} size="md" variant="secondary">Search history</Button></BottomSheet>
      <BottomSheet footer={<Button disabled={historyLoading} onPress={() => setHistoryOpen(false)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { setHistoryOpen(open); if (!open) historyGeneration.current += 1; }} open={historyOpen} title="Search history">
        <ScrollView contentContainerStyle={[styles.searchHistoryList, !historyLoading && history.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>
          {historyLoading ? <View accessibilityLabel="Loading search history" accessibilityRole="progressbar" style={styles.searchHistorySkeletons}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.historySkeleton} />)}</View> : null}
          {!historyLoading && history.length === 0 ? <Text style={styles.emptyText}>No searches saved yet.</Text> : null}
          {!historyLoading ? history.map((item) => <SearchHistoryPill count={item.usageCount} disabled={Boolean(removingHistoryQuery)} key={item.normalizedQuery} onPress={() => applyHistoryQuery(item)} onRemove={() => void removeHistoryQuery(item)} query={item.query} removing={removingHistoryQuery === item.normalizedQuery} />) : null}
        </ScrollView>
      </BottomSheet>
      <BottomSheet footer={<Button onPress={() => setRecentOpen(false)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={setRecentOpen} open={recentOpen} title="Recent places">
        <ScrollView contentContainerStyle={[styles.cityList, recentPlaces.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>
          {recentPlaces.slice(0, 25).map((place) => <Button accessibilityLabel={`Open ${place.name}`} contentMode="raw" key={place.key} onPress={() => openRecentPlace(place)} size="md" style={styles.cityPill} variant="secondary"><Text style={styles.cityName}>{place.name}</Text><ChevronRightIcon size="sm" /></Button>)}
          {recentPlaces.length === 0 ? <Text style={styles.emptyText}>No recent places yet.</Text> : null}
        </ScrollView>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

function GuideLoading({ label, text }: { label: string; text: string }) {
  return <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.countryDetailSkeleton}>
    <LoadingText text={text} />
    <Skeleton style={[styles.skeletonBlock, styles.skeletonHero]} />
    <Skeleton style={[styles.skeletonBlock, styles.skeletonText]} />
  </View>;
}

function GuideHero({ detail, image, imageUnavailable }: { detail: Pick<CityDetail, "summary" | "culture" | "food" | "whyVisit">; image?: PlaceImageResponse["image"]; imageUnavailable: boolean }) {
  const sections = [["summary", detail.summary], ["culture", detail.culture], ["food", detail.food], ["whyVisit", detail.whyVisit]] as const;
  return <View accessibilityLabel={image ? "Destination hero" : imageUnavailable ? "Image unavailable" : "Generating destination hero"} accessibilityRole={!image && !imageUnavailable ? "progressbar" : undefined} style={styles.guideHero}>{!image && !imageUnavailable ? <LoadingText text="Generating image..." /> : null}<PlaceImageFrame image={image} key={image?.url ?? "hero"} unavailable={imageUnavailable} /><View style={styles.guideSections}>{sections.map(([key, section]) => <Text key={key} style={styles.guideText}>{section}</Text>)}</View></View>;
}

function PlaceImageFrame({ image, unavailable }: { image?: PlaceImageResponse["image"]; unavailable: boolean }) {
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const failed = unavailable || loadState === "error";
  return <View style={[styles.imageFrame, failed && styles.imageUnavailable]}>
    {image && !failed ? <Image accessibilityLabel={image.title} cachePolicy="none" contentFit="cover" onError={() => setLoadState("error")} onLoad={() => setLoadState("loaded")} source={{ uri: image.url }} style={styles.placeImage} transition={250} /> : null}
    {failed ? <Text style={styles.imageUnavailableText}>Image unavailable</Text> : loadState !== "loaded" ? <Skeleton style={styles.imageSkeleton} /> : null}
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
  placeIsland: { width: "100%", minHeight: 40, justifyContent: "flex-start", paddingHorizontal: spacing.sm },
  placeIslandText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
  sheetFooter: { width: "100%", gap: spacing.sm, padding: 2 },
  sheetContent: { gap: 6, paddingBottom: 6 },
  fullSheetScroll: { flex: 1 },
  countrySearch: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  countrySearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  listLabel: { marginTop: 10, marginBottom: 2, color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  countryLabel: { marginTop: 8, paddingHorizontal: 6, color: palette.silver300, fontFamily: fonts.medium, fontSize: 11 },
  countryDetailSkeleton: { gap: spacing.md, paddingVertical: spacing.md },
  skeletonBlock: { backgroundColor: palette.hairlineBright, opacity: 0.72 },
  skeletonHero: { width: "100%", aspectRatio: 1.5 },
  skeletonText: { width: "76%", height: 14 },
  countryDetailFailure: { flex: 1, minHeight: 360, alignItems: "center", justifyContent: "center", gap: spacing.md },
  countryDetail: { gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  guideHero: { marginBottom: spacing.sm, gap: spacing.sm },
  imageFrame: { width: "100%", aspectRatio: 1.15, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  imageUnavailable: { borderColor: palette.hairline, backgroundColor: palette.page, opacity: 0.72 },
  imageUnavailableText: { paddingHorizontal: 4, color: palette.silver500, fontFamily: fonts.regular, fontSize: 9, lineHeight: 13, textAlign: "center" },
  imageSkeleton: { position: "absolute", width: "100%", height: "100%", backgroundColor: palette.hairlineBright, opacity: 0.72 },
  placeImage: { width: "100%", height: "100%" },
  guideSections: { gap: spacing.sm },
  guideText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
  popularCitiesTitle: { marginTop: spacing.sm, color: palette.silver300, fontFamily: fonts.medium, fontSize: 14 },
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
  cityList: { gap: spacing.xs },
  cityPill: { minHeight: 44, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: spacing.sm, borderRadius: radii.md },
  cityName: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  searchHistoryList: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
  searchHistorySkeletons: { gap: spacing.xs },
  historySkeleton: { width: "100%", height: 38, borderRadius: 999 },
  sheetEmptyContent: { flexGrow: 1, justifyContent: "center" },
  emptyText: { paddingVertical: 18, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
});
