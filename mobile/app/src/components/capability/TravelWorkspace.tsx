import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, type TextInput as NativeTextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { CheckIcon, ChevronRightIcon, CloseIcon, GlobeIcon, GlobeViewIcon, LocationPinIcon, PlusIcon, SearchIcon, SendIcon, TableViewIcon } from "@vorinthex/shared/ui/icons-mobile";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";

import { ChromeIcon } from "@/components/ChromeIcon";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { InteractiveGlobe } from "@/components/three/InteractiveGlobe";
import { assistantIconSource } from "@/data/capability-icons";
import { COUNTRIES, type CountryProperties } from "@/lib/globe-data";
import {
  askTravelAssistant,
  createPlace,
  createTrip,
  fetchTravelOverview,
  findCity,
  findPlace,
  findPlaceChildren,
  generatePlaceHeroImage,
  getTravelContext,
  listTrips,
  openPlace,
  searchCountries,
  searchPlaces,
  type CityDetail,
  type CountrySearchResult,
  type CreatePlaceInput,
  type Place,
  type PlaceImageResponse,
  type PlaceSearchResult,
  type Trip,
} from "@/lib/travel-client";
import { hydratePlaceChildren, PLACE_GUIDE_CACHE_MS } from "@/lib/travel-prefetch";
import {
  addOptimisticCompassPlace,
  appendOptimisticCompassTrip,
  compassQueryKeys,
  galleryQueryKeys,
  invalidateAssistantChanges,
  reconcileOptimisticCompassPlace,
  reconcileOptimisticCompassTrip,
  removeOptimisticCompassPlace,
  removeOptimisticCompassTrip,
  type CompassOverview,
} from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

const CORE_PROMPTS = ["List my saved cities", "Which cities have I saved in Portugal?", "Show my saved cities in Europe"] as const;
const GRID_GAP = 10;
type RootView = "globe" | "table";
type TableTab = "places" | "trips";
type DetailSource = "globe" | "table" | "createPlace";
type GeneratedCity = { name: string; latitude: number; longitude: number };

export const COUNTRY_SHEET_CACHE_MS = PLACE_GUIDE_CACHE_MS;
export const COUNTRY_SEARCH_DEBOUNCE_MS = 300;
export const PLACE_SEARCH_DEBOUNCE_MS = 300;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Compass could not complete that request.";
}

export function normalizePlaceName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function withoutCover(place: Place): Trip["places"][number] {
  const { coverUrl: _coverUrl, ...tripPlace } = place;
  return tripPlace;
}

export function TravelWorkspace() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const travelContext = useMemo(() => getTravelContext(), []);
  const insets = useSafeAreaInsets();
  const [rootView, setRootView] = useState<RootView>("globe");
  const [tableTab, setTableTab] = useState<TableTab>("places");
  const [tableGridWidth, setTableGridWidth] = useState(0);
  const [tripGridWidth, setTripGridWidth] = useState(0);
  const [selectedCountry, setSelectedCountry] = useState<CountryProperties>();
  const [selectedCity, setSelectedCity] = useState<GeneratedCity>();
  const [detailSource, setDetailSource] = useState<DetailSource>("globe");
  const [countryDetailOpen, setCountryDetailOpen] = useState(false);
  const [cityDetailOpen, setCityDetailOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [createPlaceOpen, setCreatePlaceOpen] = useState(false);
  const [placeSearchQuery, setPlaceSearchQuery] = useState("");
  const [placeSearchResults, setPlaceSearchResults] = useState<PlaceSearchResult[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [tripSelectionOpen, setTripSelectionOpen] = useState(false);
  const [tripDetailsOpen, setTripDetailsOpen] = useState(false);
  const [selectedPlaceKeys, setSelectedPlaceKeys] = useState<string[]>([]);
  const [tripName, setTripName] = useState("");
  const [tripDescription, setTripDescription] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState<NonNullable<CountrySearchResult>>();
  const [globeFocusTarget, setGlobeFocusTarget] = useState<NonNullable<CountrySearchResult>>();
  const [lastOpenedCountryCode, setLastOpenedCountryCode] = useState<string>();
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantInputFocused, setAssistantInputFocused] = useState(false);
  const [countrySearchFocusBlocked, setCountrySearchFocusBlocked] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [assistantFailed, setAssistantFailed] = useState(false);
  const [countryOpenRequest, setCountryOpenRequest] = useState(0);
  const [cityOpenRequest, setCityOpenRequest] = useState(0);
  const [globeFocusRequest, setGlobeFocusRequest] = useState(0);
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const countryScrollRef = useRef<ScrollView>(null);
  const countrySearchRequest = useRef(0);
  const placeSearchGeneration = useRef(0);
  const countrySearchInput = useRef<NativeTextInput>(null);
  const searchFocusReleaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recordedCountryOpen = useRef(0);
  const recordedCityOpen = useRef(0);

  const overviewQuery = useQuery({ queryKey: compassQueryKeys.overview(travelContext), queryFn: fetchTravelOverview });
  const tripsQuery = useQuery({ queryKey: compassQueryKeys.trips(travelContext), queryFn: ({ signal }) => listTrips(signal), enabled: rootView === "table" || tripSelectionOpen || tripDetailsOpen });
  const places = useMemo(() => overviewQuery.data?.places ?? [], [overviewQuery.data]);
  const trips = tripsQuery.data ?? [];
  const savedCountries = useMemo(() => places.filter(({ kind }) => kind === "country"), [places]);
  const savedCities = useMemo(() => places.filter(({ kind }) => kind === "place"), [places]);
  const countryByCode = useMemo(() => new Map(COUNTRIES.features.map(({ properties }) => [properties.countryCode, properties])), []);
  const savedCountryDetail = selectedCountry ? savedCountries.find(({ countryCode, name }) => countryCode.toLocaleUpperCase() === selectedCountry.countryCode.toLocaleUpperCase() && normalizePlaceName(name) === normalizePlaceName(selectedCountry.name)) : undefined;
  const savedCityDetail = selectedCountry && selectedCity ? savedCities.find(({ countryCode, name }) => countryCode.toLocaleUpperCase() === selectedCountry.countryCode.toLocaleUpperCase() && normalizePlaceName(name) === normalizePlaceName(selectedCity.name)) : undefined;
  const savedCountryCodes = useMemo(() => [...new Set(savedCountries.map(({ countryCode }) => countryCode))], [savedCountries]);
  const tableCardSize = tableGridWidth > 0 ? Math.floor((tableGridWidth - GRID_GAP * 2) / 3) : undefined;
  const tripCardSize = tripGridWidth > 0 ? Math.floor((tripGridWidth - GRID_GAP * 2) / 3) : undefined;

  const savedImage = (place: Place | undefined): PlaceImageResponse | undefined => place?.coverUrl ? {
    status: "ready", durationMs: 0, costUsd: null,
    image: { status: "ready", title: `${place.name} travel image`, url: place.coverUrl, width: 1536, height: 1024, mimeType: "image/png" },
  } : undefined;
  const savedCountryImage = savedImage(savedCountryDetail);
  const savedCityImage = savedImage(savedCityDetail);
  const countryDetailEnabled = countryDetailOpen && Boolean(selectedCountry);
  const countryDetailQuery = useQuery({
    queryKey: compassQueryKeys.countryDetail(travelContext, selectedCountry?.countryCode ?? ""),
    queryFn: ({ signal }) => {
      if (!selectedCountry) throw new Error("Select a country to continue.");
      return findPlace(`${selectedCountry.name} (${selectedCountry.countryCode}), ${selectedCountry.continent}`, { name: selectedCountry.name, code: selectedCountry.countryCode, continent: selectedCountry.continent, lat: selectedCountry.latitude, lon: selectedCountry.longitude }, signal);
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
    enabled: countryDetailEnabled && !savedCountryImage && !countryDetailQuery.isFetching && !countryDetailQuery.isError && Boolean(countryDetailQuery.data?.imageRequestToken),
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
    retry: false,
  });
  const countryDetail = countryDetailQuery.isFetching || countryDetailQuery.isError ? undefined : countryDetailQuery.data;
  const countryDetailLoading = countryDetailEnabled && countryDetailQuery.isFetching;
  const countryDetailError = countryDetailQuery.error ? errorMessage(countryDetailQuery.error) : undefined;
  const countryImage = countryDetail ? savedCountryImage ?? countryImageQuery.data : undefined;
  const countryImageUnavailable = countryDetailQuery.isError || !savedCountryImage && countryImageQuery.isError;
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
    enabled: countryDetailEnabled && detailSource !== "createPlace" && Boolean(childrenRequestToken),
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
    retry: false,
    refetchInterval: false,
  });
  const cityDetailEnabled = cityDetailOpen && Boolean(selectedCountry && selectedCity);
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
    enabled: cityDetailEnabled && !savedCityImage && !cityDetailQuery.isFetching && !cityDetailQuery.isError && Boolean(cityDetailQuery.data?.imageRequestToken),
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
    retry: false,
  });
  const cityDetail = cityDetailQuery.isFetching || cityDetailQuery.isError ? undefined : cityDetailQuery.data;
  const cityDetailLoading = cityDetailEnabled && (cityDetailQuery.isPending || cityDetailQuery.isFetching);
  const cityDetailError = cityDetailQuery.error ? errorMessage(cityDetailQuery.error) : undefined;
  const cityImage = cityDetail ? savedCityImage ?? cityImageQuery.data : undefined;
  const cityImageUnavailable = cityDetailQuery.isError || !savedCityImage && cityImageQuery.isError;

  useEffect(() => {
    const query = countryQuery.trim();
    const request = ++countrySearchRequest.current;
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchCountries(query, controller.signal).then((match) => {
        if (request !== countrySearchRequest.current) return;
        setSearchFocus(match ?? undefined);
        if (match) { setGlobeFocusTarget(match); setGlobeFocusRequest((current) => current + 1); }
      }).catch(() => { if (request === countrySearchRequest.current) setSearchFocus(undefined); });
    }, COUNTRY_SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [countryQuery]);

  useEffect(() => {
    const query = placeSearchQuery.trim();
    const generation = ++placeSearchGeneration.current;
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchPlaces(query, controller.signal).then((results) => {
        if (generation === placeSearchGeneration.current) setPlaceSearchResults(results);
      }).catch((error: unknown) => {
        if (generation === placeSearchGeneration.current && !(error instanceof Error && error.name === "CanceledError")) {
          setPlaceSearchResults([]);
          showToast({ title: errorMessage(error), duration: 2_000 });
        }
      }).finally(() => { if (generation === placeSearchGeneration.current) setPlaceSearchLoading(false); });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [placeSearchQuery, showToast]);

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

  useEffect(() => () => { if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current); }, []);

  function openCountryDetail(country: CountryProperties, source: DetailSource = "globe", focusGlobe = false) {
    setLastOpenedCountryCode(country.countryCode);
    setSearchFocus(undefined);
    if (focusGlobe) {
      setGlobeFocusTarget({ name: country.name, countryCode: country.countryCode, latitude: country.latitude, longitude: country.longitude });
      setGlobeFocusRequest((current) => current + 1);
    }
    setDetailSource(source);
    setSelectedCountry(country);
    setSelectedCity(undefined);
    setCountryDetailOpen(true);
    setCountryOpenRequest((current) => current + 1);
  }

  function openCityDetail(city: GeneratedCity, country: CountryProperties, source: DetailSource = "globe", focusGlobe = false) {
    setSelectedCountry(country);
    setLastOpenedCountryCode(country.countryCode);
    setSearchFocus(undefined);
    if (focusGlobe) {
      setGlobeFocusTarget({ name: city.name, countryCode: country.countryCode, latitude: city.latitude, longitude: city.longitude });
      setGlobeFocusRequest((current) => current + 1);
    }
    setDetailSource(source);
    setSelectedCity(city);
    setCityDetailOpen(true);
    setCityOpenRequest((current) => current + 1);
  }

  function openSavedPlace(place: Place) {
    const country = countryByCode.get(place.countryCode) ?? { countryCode: place.countryCode, name: place.kind === "country" ? place.name : place.countryCode, continent: "Unknown", latitude: place.latitude, longitude: place.longitude };
    if (place.kind === "country") openCountryDetail(country, "table", true);
    else openCityDetail({ name: place.name, latitude: place.latitude, longitude: place.longitude }, country, "table", true);
  }

  function openSearchResult(result: PlaceSearchResult) {
    const country: CountryProperties = { countryCode: result.countryCode, name: result.country, continent: result.continent, latitude: result.lat, longitude: result.long };
    if (result.kind === "country") openCountryDetail({ ...country, name: result.name }, "createPlace");
    else openCityDetail({ name: result.name, latitude: result.lat, longitude: result.long }, country, "createPlace");
  }

  function updatePlaceSearch(value: string) {
    setPlaceSearchQuery(value);
    setPlaceSearchLoading(value.trim().length >= 2);
    if (value.trim().length < 2) setPlaceSearchResults([]);
  }

  async function persistGeneratedPlace(input: CreatePlaceInput, optimisticKey: string, kind: Place["kind"], coverUrl: string | undefined, failureTitle: string) {
    const overviewKey = compassQueryKeys.overview(travelContext);
    await queryClient.cancelQueries({ queryKey: overviewKey, exact: true }).catch(() => undefined);
    queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => addOptimisticCompassPlace(current, { key: optimisticKey, name: input.name, summary: input.summary, countryCode: input.countryCode, kind, latitude: input.latitude, longitude: input.longitude, createdAt: new Date().toISOString(), ...(coverUrl ? { coverUrl } : {}) }));
    void createPlace(input).then((place) => {
      queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => reconcileOptimisticCompassPlace(current, optimisticKey, place));
      setSelectedPlaceKeys((current) => current.map((key) => key === optimisticKey ? place.key : key));
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(travelContext) });
    }).catch(() => {
      queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => removeOptimisticCompassPlace(current, optimisticKey));
      setSelectedPlaceKeys((current) => current.filter((key) => key !== optimisticKey));
      showToast({ title: failureTitle, duration: 2_000 });
    });
  }

  function saveCountry() {
    if (!countryDetail || countryImage?.status !== "ready" || savedCountryDetail) return;
    const input = { name: countryDetail.location.name, summary: countryDetail.summary, countryCode: countryDetail.location.countryCode, latitude: countryDetail.location.latitude, longitude: countryDetail.location.longitude, imageRequestToken: countryDetail.imageRequestToken };
    setCountryDetailOpen(false);
    showToast({ title: "Country saved to my places", duration: 2_000 });
    void persistGeneratedPlace(input, `optimistic-${randomUUID()}`, "country", countryImage.image.url, "Country could not be saved");
  }

  function saveCity() {
    if (!cityDetail || cityImage?.status !== "ready" || savedCityDetail) return;
    const input = { name: cityDetail.location.name, summary: cityDetail.summary, countryCode: cityDetail.location.countryCode, latitude: cityDetail.location.latitude, longitude: cityDetail.location.longitude, imageRequestToken: cityDetail.imageRequestToken };
    setCityDetailOpen(false);
    requestAnimationFrame(() => countryScrollRef.current?.scrollTo({ y: 0, animated: true }));
    showToast({ title: "City saved to my places", duration: 2_000 });
    void persistGeneratedPlace(input, `optimistic-${randomUUID()}`, "place", cityImage.image.url, "City could not be saved");
  }

  function toggleTripPlace(key: string) {
    setSelectedPlaceKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : current.length < 100 ? [...current, key] : current);
  }

  function advanceTripCreation() {
    if (!selectedPlaceKeys.length || selectedPlaceKeys.some((key) => key.startsWith("optimistic-"))) return;
    setTripSelectionOpen(false);
    requestAnimationFrame(() => setTripDetailsOpen(true));
  }

  function submitTrip() {
    const name = tripName.trim();
    if (!name || !selectedPlaceKeys.length || selectedPlaceKeys.some((key) => key.startsWith("optimistic-"))) return;
    const selectedPlaces = selectedPlaceKeys.map((key) => places.find((place) => place.key === key)).filter((place): place is Place => Boolean(place));
    if (!selectedPlaces.length) return;
    const idempotencyKey = randomUUID();
    const optimisticKey = `optimistic-${idempotencyKey}`;
    const optimisticTrip: Trip = { key: optimisticKey, name, ...(tripDescription.trim() ? { description: tripDescription.trim() } : {}), createdAt: new Date().toISOString(), places: selectedPlaces.map(withoutCover), ...(selectedPlaces[0]?.coverUrl ? { coverUrl: selectedPlaces[0].coverUrl } : {}) };
    const tripsKey = compassQueryKeys.trips(travelContext);
    setTripDetailsOpen(false);
    setTripName("");
    setTripDescription("");
    setSelectedPlaceKeys([]);
    void queryClient.cancelQueries({ queryKey: tripsKey, exact: true });
    queryClient.setQueryData(tripsKey, (current: Trip[] | undefined) => appendOptimisticCompassTrip(current, optimisticTrip));
    void createTrip({ name, ...(tripDescription.trim() ? { description: tripDescription.trim() } : {}), placeKeys: selectedPlaces.map(({ key }) => key), idempotencyKey }).then((trip) => {
      queryClient.setQueryData(tripsKey, (current: Trip[] | undefined) => reconcileOptimisticCompassTrip(current, optimisticKey, trip));
    }).catch(() => {
      queryClient.setQueryData(tripsKey, (current: Trip[] | undefined) => removeOptimisticCompassTrip(current, optimisticKey));
      showToast({ title: "Trip could not be created", duration: 2_000 });
    });
  }

  function handleCoreFocusChange(focused: boolean) {
    if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current);
    setAssistantInputFocused(focused);
    if (focused) { setCountrySearchFocusBlocked(true); countrySearchInput.current?.blur(); Keyboard.dismiss(); return; }
    setAssistantMessage(undefined);
    setAssistantFailed(false);
    searchFocusReleaseTimer.current = setTimeout(() => setCountrySearchFocusBlocked(false), 350);
  }

  async function askAssistant() {
    const value = assistantInput.trim();
    if (!value) return;
    setAssistantBusy(true); setAssistantMessage(undefined); setAssistantFailed(false);
    try {
      assistantRequestKey.current ??= randomUUID();
      const response = await askTravelAssistant(value, assistantRequestKey.current);
      setAssistantInput(""); assistantRequestKey.current = undefined; setAssistantMessage(response.message);
      await invalidateAssistantChanges(queryClient, travelContext, response.changes);
    } catch (failure) { setAssistantMessage(errorMessage(failure)); setAssistantFailed(true); }
    finally { setAssistantBusy(false); }
  }

  const loadError = overviewQuery.error ? errorMessage(overviewQuery.error) : undefined;
  const tripsError = tripsQuery.error ? errorMessage(tripsQuery.error) : undefined;
  const activeCountryCode = searchFocus?.countryCode ?? lastOpenedCountryCode;
  return <KeyboardAvoidingView behavior={assistantInputFocused ? "height" : undefined} style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}><WorkspaceAppSwitcher active="compass" /></View>
    <View style={[styles.workspaceViewport, { paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
      <View style={styles.titleRow}>
        <WorkspaceAppSwitcher active="compass" trigger="back" />
        <Text numberOfLines={1} style={styles.workspaceTitle}>Compass</Text>
        <Button accessibilityLabel={rootView === "globe" ? "Show Compass table" : "Show Compass globe"} contentMode="raw" onPress={() => setRootView((current) => current === "globe" ? "table" : "globe")} size="xs" variant="icon">{rootView === "globe" ? <TableViewIcon size="sm" /> : <GlobeViewIcon size="sm" />}</Button>
        <Button accessibilityLabel="Add in Compass" contentMode="raw" onPress={() => setActionsOpen(true)} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
      </View>
      {rootView === "globe" ? <>
        <View style={styles.workspaceSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search Compass countries" editable={!countrySearchFocusBlocked} focusable={!countrySearchFocusBlocked} onChangeText={(value) => { setCountryQuery(value); setSearchFocus(undefined); }} onFocus={() => { if (countrySearchFocusBlocked) { countrySearchInput.current?.blur(); Keyboard.dismiss(); } }} placeholder="Search countries..." ref={countrySearchInput} style={styles.workspaceSearchInput} value={countryQuery} />{countryQuery.trim() ? <Button accessibilityLabel="Clear Compass search" contentMode="raw" iconOnly onPress={() => { setCountryQuery(""); setSearchFocus(undefined); }} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
        <View style={styles.globe}><InteractiveGlobe autoRotate={!countryQuery.trim()} focusRequest={globeFocusRequest} focusTarget={globeFocusTarget} onCountryPress={(country) => { if (country) openCountryDetail(country.properties); }} savedCountryCodes={savedCountryCodes} selectedCountryCode={activeCountryCode} />{loadError && !overviewQuery.isPending ? <View style={styles.loadFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{loadError}</Text><Button onPress={() => void overviewQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : null}</View>
      </> : <View style={styles.tableView}>
        <Tabs accessibilityLabel="Compass table categories" accessibilityRole="tablist" role="tablist" style={styles.rootTabs}><Button accessibilityRole="tab" accessibilityState={{ selected: tableTab === "places" }} onPress={() => setTableTab("places")} size="xs" style={styles.rootTab} variant={tableTab === "places" ? "secondary" : "ghost"}>Places</Button><Button accessibilityRole="tab" accessibilityState={{ selected: tableTab === "trips" }} onPress={() => setTableTab("trips")} size="xs" style={styles.rootTab} variant={tableTab === "trips" ? "secondary" : "ghost"}>Trips</Button></Tabs>
        {tableTab === "places" ? <ScrollView accessibilityLabel="Saved places" accessibilityLiveRegion="polite" accessibilityState={{ busy: overviewQuery.isPending }} contentContainerStyle={[styles.cardGrid, !overviewQuery.isPending && !loadError && places.length === 0 && styles.emptyGrid]} onLayout={({ nativeEvent }) => setTableGridWidth(nativeEvent.layout.width)} role="tabpanel" showsVerticalScrollIndicator={false}>{overviewQuery.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.squareCard, { width: tableCardSize, height: tableCardSize }]} />) : loadError ? <QueryFailure message={loadError} onRetry={() => void overviewQuery.refetch()} /> : places.map((place) => <PlaceCard cardSize={tableCardSize} key={place.key} onPress={() => openSavedPlace(place)} place={place} />)}{!overviewQuery.isPending && !loadError && places.length === 0 ? <Text style={styles.emptyText}>No saved places yet. Create one to start mapping your world.</Text> : null}</ScrollView> : <ScrollView accessibilityLabel="Trips" accessibilityLiveRegion="polite" accessibilityState={{ busy: tripsQuery.isPending }} contentContainerStyle={[styles.cardGrid, !tripsQuery.isPending && !tripsError && trips.length === 0 && styles.emptyGrid]} onLayout={({ nativeEvent }) => setTripGridWidth(nativeEvent.layout.width)} role="tabpanel" showsVerticalScrollIndicator={false}>{tripsQuery.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.squareCard, { width: tripCardSize, height: tripCardSize }]} />) : tripsError ? <QueryFailure message={tripsError} onRetry={() => void tripsQuery.refetch()} /> : trips.map((trip) => <TripCard cardSize={tripCardSize} key={trip.key} trip={trip} />)}{!tripsQuery.isPending && !tripsError && trips.length === 0 ? <Text style={styles.emptyText}>No trips yet. Group saved places into your first trip.</Text> : null}</ScrollView>}
      </View>}
    </View>

    {!loadError ? <CoreComposer accessory={selectedCountry && !countryDetailOpen && !cityDetailOpen ? <Button accessibilityLabel={`Reopen ${selectedCountry.name}`} contentMode="raw" onPress={() => openCountryDetail(selectedCountry, "globe", true)} size="sm" style={styles.placeIsland} variant="secondary"><LocationPinIcon size="sm" /><Text numberOfLines={1} style={styles.placeIslandText}>{selectedCountry.name}</Text><ChevronRightIcon size="sm" /></Button> : undefined} accessibilityLabel="Ask Core about saved cities" disabled={assistantBusy} editable={!assistantBusy} leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />} loading={assistantBusy} message={assistantMessage ? <View style={assistantFailed ? styles.inlineError : styles.inlineNotice}><Text style={styles.messageText}>{assistantMessage}</Text></View> : null} onChangeText={(value) => { setAssistantInput(value); assistantRequestKey.current = undefined; }} onFocusChange={handleCoreFocusChange} onSubmit={() => void askAssistant()} prompts={CORE_PROMPTS} sendIcon={<SendIcon size="sm" variant="inverse" />} value={assistantInput} /> : null}

    <BottomSheet footer={<View style={styles.sheetFooter}>{!savedCountryDetail ? <Button disabled={!countryDetail || countryImage?.status !== "ready"} onPress={saveCountry} size="md" variant="primary">Save</Button> : null}<Button onPress={() => setCountryDetailOpen(false)} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={setCountryDetailOpen} open={countryDetailOpen} title={selectedCountry?.name ?? "Country"}>
      <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" ref={countryScrollRef} showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}><View style={styles.countryDetail}>{countryDetailLoading ? <GuideLoading label={`Loading information about ${selectedCountry?.name ?? "country"}`} text="Generating country guide..." /> : countryDetailError ? <View style={styles.countryDetailFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{countryDetailError}</Text></View> : countryDetail ? <><GuideHero detail={countryDetail} image={countryImage?.image} imageUnavailable={countryImageUnavailable} />{detailSource !== "createPlace" ? <><Text style={styles.popularCitiesTitle}>Popular cities</Text><View style={styles.cityList}>{countryDetail.popularCities.map((city) => <Button accessibilityLabel={`Open ${city.name}, ${selectedCountry?.name ?? "country"}`} contentMode="raw" key={city.name} onPress={() => { if (selectedCountry) openCityDetail(city, selectedCountry, detailSource); }} size="md" style={styles.cityPill} variant="secondary"><Text style={styles.cityName}>{city.name}</Text><ChevronRightIcon size="sm" /></Button>)}</View></> : null}</> : null}</View></ScrollView>
    </BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}>{!savedCityDetail ? <Button disabled={!cityDetail || cityImage?.status !== "ready"} onPress={saveCity} size="md" variant="primary">Save</Button> : null}<Button onPress={() => setCityDetailOpen(false)} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={setCityDetailOpen} open={cityDetailOpen} title={selectedCity?.name ?? "City"}>
      <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}><View style={styles.countryDetail}>{cityDetailLoading ? <GuideLoading label={`Loading information about ${selectedCity?.name ?? "city"}`} text="Generating city guide..." /> : cityDetailError ? <View style={styles.countryDetailFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{cityDetailError}</Text></View> : cityDetail ? <GuideHero detail={cityDetail} image={cityImage?.image} imageUnavailable={cityImageUnavailable} /> : null}</View></ScrollView>
    </BottomSheet>
    <BottomSheet footer={<Button onPress={() => setActionsOpen(false)} size="md" variant="secondary">Close</Button>} onOpenChange={setActionsOpen} open={actionsOpen} title="Add in Compass"><BottomSheetItem onPress={() => { setActionsOpen(false); requestAnimationFrame(() => setCreatePlaceOpen(true)); }} style={styles.sheetAction} variant="secondary">Create place</BottomSheetItem><BottomSheetItem onPress={() => { setActionsOpen(false); setSelectedPlaceKeys([]); setTripName(""); setTripDescription(""); requestAnimationFrame(() => setTripSelectionOpen(true)); }} style={styles.sheetAction} variant="secondary">Create trip</BottomSheetItem></BottomSheet>
    <BottomSheet footer={<Button onPress={() => setCreatePlaceOpen(false)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={setCreatePlaceOpen} open={createPlaceOpen} title="Create place">
      <View style={styles.createPlaceContent}><View style={styles.placeSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search any country or city" autoFocus maxLength={500} onChangeText={updatePlaceSearch} placeholder="Search any country or city" style={styles.placeSearchInput} value={placeSearchQuery} />{placeSearchQuery.trim() ? <Button accessibilityLabel="Clear place search" contentMode="raw" iconOnly onPress={() => updatePlaceSearch("")} size="md" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View><ScrollView accessibilityLabel={placeSearchLoading ? "Searching places" : `${placeSearchResults.length} places found`} accessibilityLiveRegion="polite" accessibilityState={{ busy: placeSearchLoading }} contentContainerStyle={styles.cityList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>{placeSearchLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.cityPillSkeleton} />) : placeSearchResults.map((result) => <Button accessibilityLabel={`Open ${result.name}, ${result.country}`} contentMode="raw" key={`${result.kind}-${result.countryCode}-${result.name}`} onPress={() => openSearchResult(result)} size="md" style={styles.cityPill} variant="secondary"><View style={styles.resultCopy}><Text numberOfLines={1} style={styles.cityName}>{result.name}</Text><Text numberOfLines={1} style={styles.resultCountry}>{result.country} · {result.countryCode}</Text></View><ChevronRightIcon size="sm" /></Button>)}{!placeSearchLoading && placeSearchQuery.trim().length >= 2 && placeSearchResults.length === 0 ? <Text style={styles.emptyText}>No places found.</Text> : null}</ScrollView></View>
    </BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button disabled={selectedPlaceKeys.length === 0 || selectedPlaceKeys.some((key) => key.startsWith("optimistic-"))} onPress={advanceTripCreation} size="md" variant="primary">Next</Button><Button onPress={() => setTripSelectionOpen(false)} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={setTripSelectionOpen} open={tripSelectionOpen} title="Choose places">
      <ScrollView accessibilityLabel="Places available for this trip" accessibilityLiveRegion="polite" accessibilityState={{ busy: overviewQuery.isPending }} contentContainerStyle={[styles.cardGrid, !overviewQuery.isPending && !loadError && places.length === 0 && styles.emptyGrid]} onLayout={({ nativeEvent }) => setTripGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>{overviewQuery.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.squareCard, { width: tripCardSize, height: tripCardSize }]} />) : loadError ? <QueryFailure message={loadError} onRetry={() => void overviewQuery.refetch()} /> : places.map((place) => { const saving = place.key.startsWith("optimistic-"); return <PlaceCard cardSize={tripCardSize} disabled={saving} key={place.key} onPress={() => toggleTripPlace(place.key)} place={place} selectable selected={selectedPlaceKeys.includes(place.key)} />; })}{!overviewQuery.isPending && !loadError && places.length === 0 ? <Text style={styles.emptyText}>Save a place before creating a trip.</Text> : null}</ScrollView>
    </BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button disabled={!tripName.trim()} onPress={submitTrip} size="md" variant="primary">Create</Button><Button onPress={() => setTripDetailsOpen(false)} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={setTripDetailsOpen} open={tripDetailsOpen} title="Create trip"><View style={styles.namingForm}><Text style={styles.inputLabel}>Trip name</Text><TextInput accessibilityLabel="Trip name" autoFocus maxLength={255} onChangeText={setTripName} placeholder="Trip name" value={tripName} /><Text style={styles.inputLabel}>Description (Optional)</Text><TextInput accessibilityLabel="Trip description" maxLength={10000} multiline onChangeText={setTripDescription} placeholder="What belongs in this trip?" style={styles.tripDescriptionInput} textAlignVertical="top" value={tripDescription} /></View></BottomSheet>
  </KeyboardAvoidingView>;
}

function PlaceCard({ cardSize, disabled = false, onPress, place, selectable = false, selected = false }: { cardSize?: number; disabled?: boolean; onPress: () => void; place: Place; selectable?: boolean; selected?: boolean }) {
  return <View style={[styles.squareCard, selected && styles.squareCardSelected, { width: cardSize, height: cardSize }]}>{place.coverUrl ? <Image contentFit="cover" source={place.coverUrl} style={StyleSheet.absoluteFill} /> : null}<Button accessibilityLabel={`${disabled ? "Saving" : selectable ? selected ? "Deselect" : "Select" : "Open"} ${place.name}`} accessibilityState={selectable ? { disabled, selected } : undefined} contentMode="raw" disabled={disabled} onPress={onPress} shape="rounded" size="md" style={[styles.cardMain, place.coverUrl && styles.coveredCardMain]} variant="ghost">{place.coverUrl ? null : place.kind === "country" ? <GlobeIcon size="lg" /> : <LocationPinIcon size="lg" />}<Text numberOfLines={2} style={[styles.cardLabel, place.coverUrl && styles.coveredCardLabel]}>{place.name}</Text></Button>{selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View>;
}

function QueryFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View accessibilityRole="alert" style={styles.tableFailure}><Text style={styles.loadFailureText}>{message}</Text><Button onPress={onRetry} size="sm" variant="secondary">Retry</Button></View>;
}

function TripCard({ cardSize, trip }: { cardSize?: number; trip: Trip }) {
  return <View accessibilityLabel={trip.name} style={[styles.squareCard, styles.cardMain, trip.coverUrl && styles.coveredCardMain, { width: cardSize, height: cardSize }]}>{trip.coverUrl ? <Image contentFit="cover" source={trip.coverUrl} style={StyleSheet.absoluteFill} /> : <GlobeIcon size="lg" />}<Text numberOfLines={2} style={[styles.cardLabel, trip.coverUrl && styles.coveredCardLabel]}>{trip.name}</Text></View>;
}

function GuideLoading({ label, text }: { label: string; text: string }) {
  return <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.countryDetailSkeleton}><LoadingText text={text} /><Skeleton style={[styles.skeletonBlock, styles.skeletonHero]} /><Skeleton style={[styles.skeletonBlock, styles.skeletonText]} /></View>;
}

function GuideHero({ detail, image, imageUnavailable }: { detail: Pick<CityDetail, "summary" | "culture" | "food" | "whyVisit">; image?: PlaceImageResponse["image"]; imageUnavailable: boolean }) {
  const sections = [["summary", detail.summary], ["culture", detail.culture], ["food", detail.food], ["whyVisit", detail.whyVisit]] as const;
  return <View accessibilityLabel={image ? "Destination hero" : imageUnavailable ? "Image unavailable" : "Generating destination hero"} accessibilityRole={!image && !imageUnavailable ? "progressbar" : undefined} style={styles.guideHero}>{!image && !imageUnavailable ? <LoadingText text="Generating image..." /> : null}<PlaceImageFrame image={image} key={image?.url ?? "hero"} unavailable={imageUnavailable} /><View style={styles.guideSections}>{sections.map(([key, section]) => <Text key={key} style={styles.guideText}>{section}</Text>)}</View></View>;
}

function PlaceImageFrame({ image, unavailable }: { image?: PlaceImageResponse["image"]; unavailable: boolean }) {
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const failed = unavailable || loadState === "error";
  return <View style={[styles.imageFrame, failed && styles.imageUnavailable]}>{image && !failed ? <Image accessibilityLabel={image.title} cachePolicy="none" contentFit="cover" onError={() => setLoadState("error")} onLoad={() => setLoadState("loaded")} source={{ uri: image.url }} style={styles.placeImage} transition={250} /> : null}{failed ? <Text style={styles.imageUnavailableText}>Image unavailable</Text> : loadState !== "loaded" ? <Skeleton style={styles.imageSkeleton} /> : null}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: palette.hairline, borderBottomWidth: 1, backgroundColor: palette.page, zIndex: 4 },
  workspaceViewport: { flex: 1, minHeight: 0, gap: spacing.sm, paddingTop: spacing.sm },
  titleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  workspaceTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  workspaceSearch: { minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  workspaceSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  globe: { flex: 1, minHeight: 0, overflow: "hidden", borderRadius: radii.xl, backgroundColor: palette.voidBlack },
  tableView: { flex: 1, minHeight: 0, gap: spacing.sm },
  rootTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  rootTab: { flex: 1 },
  cardGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP, paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  squareCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  squareCardSelected: { borderColor: palette.silver50, borderWidth: 2 },
  cardMain: { width: "100%", height: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xs },
  coveredCardMain: { justifyContent: "flex-end", paddingBottom: 10 },
  cardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  coveredCardLabel: { paddingHorizontal: 5, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: "rgba(0, 0, 0, 0.68)", color: "#FFFFFF" },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  emptyGrid: { alignItems: "center", justifyContent: "center" },
  emptyText: { width: "100%", paddingVertical: 18, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  loadFailure: { position: "absolute", top: 0, right: spacing.xl, bottom: 0, left: spacing.xl, alignItems: "center", justifyContent: "center", gap: 14 },
  tableFailure: { width: "100%", minHeight: 240, alignItems: "center", justifyContent: "center", gap: 14 },
  loadFailureText: { maxWidth: 320, color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: "center" },
  inlineError: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "rgba(176,74,74,0.45)", borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" },
  inlineNotice: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  messageText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  placeIsland: { width: "100%", minHeight: 40, justifyContent: "flex-start", paddingHorizontal: spacing.sm },
  placeIslandText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
  sheetFooter: { width: "100%", gap: spacing.sm, padding: 2 },
  sheetAction: { justifyContent: "center" },
  sheetContent: { gap: 6, paddingBottom: 6 },
  fullSheetScroll: { flex: 1 },
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
  cityList: { gap: spacing.xs, paddingBottom: spacing.xl },
  cityPill: { minHeight: 44, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: spacing.sm, borderRadius: radii.md },
  cityPillSkeleton: { width: "100%", height: 44, borderRadius: radii.md },
  cityName: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  createPlaceContent: { flex: 1, minHeight: 0, gap: spacing.md },
  placeSearch: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, backgroundColor: palette.panelRaised },
  placeSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  resultCopy: { minWidth: 0, flex: 1, gap: 2 },
  resultCountry: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  namingForm: { gap: spacing.sm, paddingTop: spacing.sm },
  inputLabel: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  tripDescriptionInput: { minHeight: 120 },
});
