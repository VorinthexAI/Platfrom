import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Linking, PanResponder, ScrollView, StyleSheet, Text, useWindowDimensions, View, type TextInput as NativeTextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { BrainIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, CloseIcon, FilterIcon, FolderIcon, GlobeIcon, GlobeViewIcon, LocationPinIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon, StarIcon, TableViewIcon } from "@vorinthex/shared/ui/icons-mobile";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { Switch } from "@vorinthex/shared/ui/switch";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";

import { ChromeIcon } from "@/components/ChromeIcon";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { InteractiveGlobe } from "@/components/three/InteractiveGlobe";
import { assistantIconSource, capabilityIconSource } from "@/data/capability-icons";
import { COUNTRIES, type CountryProperties } from "@/lib/globe-data";
import { normalizeCapturedJpeg, type CapturedImage } from "@/lib/captured-image";
import { deleteContentDocument, deleteContentSearchHistory, getContentContext, type ContentFolder, type ContentSearchHistoryItem } from "@/lib/content-client";
import { contentQueryKeys, getContentFolderTree, getContentHistory, promoteCachedContentHistory, removeCachedContentHistory } from "@/lib/content-query-cache";
import { deleteGalleryImages, fetchGalleryOverview, fetchGalleryUploadStatus, isManagedGalleryCollection, uploadGalleryImages, type GalleryCollection } from "@/lib/gallery-client";
import {
  askTravelAssistant,
  createPlace,
  createTrip,
  deletePlace,
  deleteTrip,
  fetchTravelOverview,
  findCity,
  findPlace,
  findPlaceChildren,
  findPlaces,
  generatePlaceReference,
  generateTripGuide,
  generatePlaceHeroImage,
  getTravelContext,
  listPlaceReferences,
  listTripGuides,
  listTrips,
  openPlace,
  setTripAttachments,
  searchCountries,
  searchPlaces,
  searchTrips,
  updatePlace,
  updateTrip,
  type CityDetail,
  type CountrySearchResult,
  type CreatePlaceInput,
  type Place,
  type PlaceImageResponse,
  type PlaceReference,
  type PlaceReferenceKind,
  type PlaceSearchResult,
  type Trip,
  type TripAttachment,
  type TripGuide,
} from "@/lib/travel-client";
import { formatGuideBody, formatGuideContent, type GuideTextRun } from "@/lib/travel-guide-format";
import { hydratePlaceChildren, PLACE_GUIDE_CACHE_MS } from "@/lib/travel-prefetch";
import {
  addOptimisticCompassPlace,
  appendOptimisticCompassTrip,
  compassQueryKeys,
  galleryQueryKeys,
  getGalleryCollections,
  invalidateAssistantChanges,
  patchCachedCompassPlace,
  reconcileOptimisticCompassPlace,
  reconcileOptimisticCompassTrip,
  removeCachedCompassPlace,
  removeCachedCompassTrip,
  removeOptimisticCompassPlace,
  removeOptimisticCompassTrip,
  upsertCachedCompassTrip,
  type CompassOverview,
} from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

const CORE_PROMPTS = ["List my saved cities", "Which cities have I saved in Portugal?", "Show my saved cities in Europe"] as const;
const GRID_GAP = 10;
type RootView = "globe" | "table";
type TableTab = "places" | "trips";
type DetailSource = "globe" | "table" | "createPlace";
type GeneratedCity = { name: string; latitude: number; longitude: number };
type TripDetailTab = "places" | "images";
type AssetTab = "folders" | "collections";
type PlaceStatusFilter = "all" | Place["status"];
type GeneratedDocument = Pick<TripGuide, "key" | "name" | "content" | "createdAt" | "updatedAt">;

const PLACE_REFERENCE_OPTIONS: readonly { kind: PlaceReferenceKind; label: string; singular: string }[] = [
  { kind: "brief", label: "Briefs", singular: "Brief" },
  { kind: "accommodations", label: "Accommodations", singular: "Accommodation" },
  { kind: "restaurants", label: "Restaurants", singular: "Restaurant" },
  { kind: "activities", label: "Activities", singular: "Activity" },
];

export const COUNTRY_SHEET_CACHE_MS = PLACE_GUIDE_CACHE_MS;
export const COUNTRY_SEARCH_DEBOUNCE_MS = 300;
export const PLACE_SEARCH_DEBOUNCE_MS = 300;
export const PLACE_SEARCH_HISTORY_DEBOUNCE_MS = 800;
export const SHEET_TRANSITION_DELAY_MS = 230;

function errorMessage(error: unknown, fallback = "The request could not be completed.") {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function waitForImageRetry(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new Error("Image generation cancelled.")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 500);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function generatePlaceHeroUntilReady(imageRequestToken: string, signal: AbortSignal) {
  for (;;) {
    try { return await generatePlaceHeroImage({ imageRequestToken }, signal); }
    catch (error) {
      if (signal.aborted) throw error;
      await waitForImageRetry(signal);
    }
  }
}

export function normalizePlaceName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function placeSaveIdentity(kind: Place["kind"], countryCode: string, name: string) {
  return kind === "country" ? `country:${countryCode.toLocaleUpperCase()}` : `place:${countryCode.toLocaleUpperCase()}:${normalizePlaceName(name)}`;
}

export function deduplicatePlaceSearchResults(results: PlaceSearchResult[]) {
  const names = new Set<string>();
  return results.filter(({ name }) => {
    const normalized = normalizePlaceName(name);
    if (names.has(normalized)) return false;
    names.add(normalized);
    return true;
  });
}

export function reorderPlaces<T>(items: readonly T[], index: number, direction: "up" | "down") {
  if (items.length < 2 || index < 0 || index >= items.length) return [...items];
  const target = direction === "up" ? (index - 1 + items.length) % items.length : (index + 1) % items.length;
  const reordered = [...items];
  [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
  return reordered;
}

export function formatGuideDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

const wait = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

export function TravelWorkspace({ initialTripKey, openTripAssets: shouldOpenTripAssets = false }: { initialTripKey?: string; openTripAssets?: boolean } = {}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const travelContext = useMemo(() => getTravelContext(), []);
  const contentContext = useMemo(() => getContentContext(), []);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [rootView, setRootView] = useState<RootView>("globe");
  const [tripView, setTripView] = useState<RootView>("globe");
  const [tableTab, setTableTab] = useState<TableTab>("places");
  const [tableGridWidth, setTableGridWidth] = useState(0);
  const [placeTableQuery, setPlaceTableQuery] = useState("");
  const [tableSearchTerm, setTableSearchTerm] = useState("");
  const [placeSearchHistory, setPlaceSearchHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [placeHistoryLoading, setPlaceHistoryLoading] = useState(false);
  const [removingPlaceHistoryQuery, setRemovingPlaceHistoryQuery] = useState<string>();
  const [placeFavoritesOnly, setPlaceFavoritesOnly] = useState(false);
  const [placeStatusFilter, setPlaceStatusFilter] = useState<PlaceStatusFilter>("all");
  const [tableFilterOpen, setTableFilterOpen] = useState(false);
  const [placeHistoryOpen, setPlaceHistoryOpen] = useState(false);
  const placeHistoryGeneration = useRef(0);
  const [selectedTablePlaceKeys, setSelectedTablePlaceKeys] = useState<string[]>([]);
  const [placeBulkMenuOpen, setPlaceBulkMenuOpen] = useState(false);
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string>();
  const [selectedPlaceSnapshot, setSelectedPlaceSnapshot] = useState<Place>();
  const [placeAiMenuOpen, setPlaceAiMenuOpen] = useState(false);
  const [placeMenuOpen, setPlaceMenuOpen] = useState(false);
  const [placeDeleteOpen, setPlaceDeleteOpen] = useState(false);
  const [placeDeleting, setPlaceDeleting] = useState(false);
  const [placeReferencesOpen, setPlaceReferencesOpen] = useState(false);
  const [placeReferenceKind, setPlaceReferenceKind] = useState<PlaceReferenceKind>("brief");
  const [selectedPlaceReference, setSelectedPlaceReference] = useState<PlaceReference>();
  const [placeReferenceGenerating, setPlaceReferenceGenerating] = useState(false);
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
  const [tripOrderOpen, setTripOrderOpen] = useState(false);
  const [tripDetailsOpen, setTripDetailsOpen] = useState(false);
  const [selectedPlaceKeys, setSelectedPlaceKeys] = useState<string[]>([]);
  const [orderPlaceKeys, setOrderPlaceKeys] = useState<string[]>([]);
  const [selectedOrderPlaceKeys, setSelectedOrderPlaceKeys] = useState<string[]>([]);
  const [orderRemoveOpen, setOrderRemoveOpen] = useState(false);
  const [tripName, setTripName] = useState("");
  const [tripDescription, setTripDescription] = useState("");
  const [selectedTripKey, setSelectedTripKey] = useState<string>();
  const [tripGlobePlaceKey, setTripGlobePlaceKey] = useState<string>();
  const [tripGlobeFocusRequest, setTripGlobeFocusRequest] = useState(0);
  const [tripDetailTab, setTripDetailTab] = useState<TripDetailTab>("places");
  const [selectedTripPlaceKeys, setSelectedTripPlaceKeys] = useState<string[]>([]);
  const [tripBulkMenuOpen, setTripBulkMenuOpen] = useState(false);
  const [tripRemoveOpen, setTripRemoveOpen] = useState(false);
  const [tripMenuOpen, setTripMenuOpen] = useState(false);
  const [tripAddMenuOpen, setTripAddMenuOpen] = useState(false);
  const [tripAiMenuOpen, setTripAiMenuOpen] = useState(false);
  const [tripAddPlacesOpen, setTripAddPlacesOpen] = useState(false);
  const [selectedTripAddPlaceKeys, setSelectedTripAddPlaceKeys] = useState<string[]>([]);
  const [tripDeleteOpen, setTripDeleteOpen] = useState(false);
  const [tripEditOpen, setTripEditOpen] = useState(false);
  const [tripGuidesOpen, setTripGuidesOpen] = useState(false);
  const [selectedTripGuide, setSelectedTripGuide] = useState<TripGuide>();
  const [tripGuideGenerating, setTripGuideGenerating] = useState(false);
  const [tripFavoritesOnly, setTripFavoritesOnly] = useState(false);
  const [tripCompletedOnly, setTripCompletedOnly] = useState(false);
  const [editTripName, setEditTripName] = useState("");
  const [editTripDescription, setEditTripDescription] = useState("");
  const [editTripFavorite, setEditTripFavorite] = useState(false);
  const [editTripCompleted, setEditTripCompleted] = useState(false);
  const [editTripCover, setEditTripCover] = useState<CapturedImage | null | undefined>();
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [assetTab, setAssetTab] = useState<AssetTab>("folders");
  const [assetFolders, setAssetFolders] = useState<ContentFolder[]>([]);
  const [assetCollections, setAssetCollections] = useState<GalleryCollection[]>([]);
  const [selectedAssetAttachments, setSelectedAssetAttachments] = useState<TripAttachment[]>([]);
  const [assetGridWidth, setAssetGridWidth] = useState(0);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [imageViewerKey, setImageViewerKey] = useState<string>();
  const [pendingPlaceSaves, setPendingPlaceSaves] = useState<string[]>([]);
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
  const pendingPlaceSaveRef = useRef(new Set<string>());
  const countrySearchRequest = useRef(0);
  const placeSearchGeneration = useRef(0);
  const countrySearchInput = useRef<NativeTextInput>(null);
  const placeSearchInput = useRef<NativeTextInput>(null);
  const searchFocusReleaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recordedCountryOpen = useRef(0);
  const recordedCityOpen = useRef(0);
  const orderScrollRef = useRef<ScrollView>(null);
  const tripMutationVersion = useRef(new Map<string, number>());
  const optimisticTripDeleteVersion = useRef(new Map<string, number>());
  const tripMutationQueue = useRef(new Map<string, Promise<void>>());
  const optimisticTripRef = useRef(new Map<string, Trip>());
  const placeMutationVersion = useRef(new Map<string, number>());
  const placeMutationQueue = useRef(new Map<string, Promise<void>>());
  const optimisticPlaceRef = useRef(new Map<string, Place>());
  const authoritativePlaceRef = useRef(new Map<string, Place>());
  const sheetTransitionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const assetsGeneration = useRef(0);
  const initialAssetsOpened = useRef(false);
  const assetLongPress = useRef<string | undefined>(undefined);
  const tripGuideGeneratingRef = useRef(false);
  const placeReferenceGeneratingRef = useRef(false);
  const placeReferenceGeneration = useRef(0);

  const overviewQuery = useQuery({ queryKey: compassQueryKeys.overview(travelContext), queryFn: fetchTravelOverview });
  const tripsQuery = useQuery({ queryKey: compassQueryKeys.trips(travelContext), queryFn: ({ signal }) => listTrips(signal), enabled: rootView === "table" || tripSelectionOpen || tripDetailsOpen || Boolean(selectedTripKey || initialTripKey) });
  const savedPlaceSearchQuery = useQuery({ queryKey: compassQueryKeys.placeSearch(travelContext, tableSearchTerm), queryFn: ({ signal }) => searchPlaces(tableSearchTerm, signal, false), enabled: rootView === "table" && tableTab === "places" && tableSearchTerm.length >= 2 });
  const tripSearchQuery = useQuery({ queryKey: compassQueryKeys.tripSearch(travelContext, tableSearchTerm), queryFn: ({ signal }) => searchTrips(tableSearchTerm, signal, false), enabled: rootView === "table" && tableTab === "trips" && tableSearchTerm.length >= 2 });
  const places = useMemo(() => overviewQuery.data?.places ?? [], [overviewQuery.data]);
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const visiblePlaces = useMemo(() => {
    const candidates = tableSearchTerm.length >= 2 ? savedPlaceSearchQuery.data ?? [] : places;
    return candidates.filter((place) => (!placeFavoritesOnly || place.isFavorite) && (placeStatusFilter === "all" || place.status === placeStatusFilter));
  }, [placeFavoritesOnly, placeStatusFilter, places, savedPlaceSearchQuery.data, tableSearchTerm]);
  const visibleTrips = useMemo(() => {
    const candidates = tableSearchTerm.length >= 2 ? tripSearchQuery.data ?? [] : trips;
    return candidates.filter((trip) => (!tripFavoritesOnly || trip.isFavorite) && (!tripCompletedOnly || trip.status === "completed"));
  }, [tableSearchTerm, tripCompletedOnly, tripFavoritesOnly, tripSearchQuery.data, trips]);
  const selectedTrip = selectedTripKey ? trips.find(({ key }) => key === selectedTripKey) : undefined;
  const selectedPlace = selectedPlaceKey
    ? (selectedPlaceSnapshot?.key === selectedPlaceKey ? selectedPlaceSnapshot : undefined)
      ?? selectedTrip?.places.find(({ key }) => key === selectedPlaceKey)
      ?? places.find(({ key }) => key === selectedPlaceKey)
      ?? trips.flatMap(({ places: tripPlaces }) => tripPlaces).find(({ key }) => key === selectedPlaceKey)
    : undefined;
  const placeReferencesQuery = useQuery({
    queryKey: compassQueryKeys.placeReferences(travelContext, selectedPlace?.key ?? "", placeReferenceKind),
    queryFn: ({ signal }) => {
      if (!selectedPlace) throw new Error("Select a place to view its references.");
      return listPlaceReferences(selectedPlace.key, placeReferenceKind, signal);
    },
    enabled: placeReferencesOpen && Boolean(selectedPlace),
  });
  const tripGuidesQuery = useQuery({
    queryKey: compassQueryKeys.tripGuides(travelContext, selectedTrip?.key ?? ""),
    queryFn: ({ signal }) => {
      if (!selectedTrip) throw new Error("Select a trip to view its travel guides.");
      return listTripGuides(selectedTrip.key, signal);
    },
    enabled: tripGuidesOpen && Boolean(selectedTrip),
  });
  const currentPlaceReference = selectedPlaceReference ? placeReferencesQuery.data?.find(({ key }) => key === selectedPlaceReference.key) ?? selectedPlaceReference : undefined;
  const currentTripGuide = selectedTripGuide ? tripGuidesQuery.data?.find(({ key }) => key === selectedTripGuide.key) ?? selectedTripGuide : undefined;
  const tripImages = useMemo(() => (selectedTrip?.places ?? []).flatMap(({ key, name: title, coverUrl }) => coverUrl ? [{ key, title, url: coverUrl }] : []), [selectedTrip]);
  const imageViewerIndex = imageViewerKey ? tripImages.findIndex(({ key }) => key === imageViewerKey) : -1;
  const imageViewer = imageViewerIndex >= 0 ? tripImages[imageViewerIndex] : undefined;
  const focusTripImage = (offset: number) => {
    if (tripImages.length < 2) return;
    const image = tripImages[(imageViewerIndex + offset + tripImages.length) % tripImages.length];
    if (image) setImageViewerKey(image.key);
  };
  const allSelectedPlacesFavorite = selectedTablePlaceKeys.length > 0 && selectedTablePlaceKeys.every((key) => places.find((place) => place.key === key)?.isFavorite);
  const savedCountries = useMemo(() => places.filter(({ kind }) => kind === "country"), [places]);
  const savedCities = useMemo(() => places.filter(({ kind }) => kind === "place"), [places]);
  const countryByCode = useMemo(() => new Map(COUNTRIES.features.map(({ properties }) => [properties.countryCode, properties])), []);
  const savedCountryDetail = selectedCountry ? savedCountries.find(({ countryCode }) => countryCode.toLocaleUpperCase() === selectedCountry.countryCode.toLocaleUpperCase()) : undefined;
  const savedCityDetail = selectedCountry && selectedCity ? savedCities.find(({ countryCode, name }) => countryCode.toLocaleUpperCase() === selectedCountry.countryCode.toLocaleUpperCase() && normalizePlaceName(name) === normalizePlaceName(selectedCity.name)) : undefined;
  const countryAlreadySaved = Boolean(savedCountryDetail || selectedCountry && pendingPlaceSaves.includes(placeSaveIdentity("country", selectedCountry.countryCode, selectedCountry.name)));
  const cityAlreadySaved = Boolean(savedCityDetail || selectedCountry && selectedCity && pendingPlaceSaves.includes(placeSaveIdentity("place", selectedCountry.countryCode, selectedCity.name)));
  const savedCountryCodes = useMemo(() => [...new Set(savedCountries.map(({ countryCode }) => countryCode))], [savedCountries]);
  const fallbackGridWidth = Math.max(0, windowWidth - Math.max(insets.left, spacing.md) - Math.max(insets.right, spacing.md));
  const tableCardSize = Math.floor(((tableGridWidth || fallbackGridWidth) - GRID_GAP * 2) / 3);
  const tripCardSize = Math.floor(((tripGridWidth || fallbackGridWidth) - GRID_GAP * 2) / 3);
  const imageCardSize = Math.floor(((tripGridWidth || fallbackGridWidth) - GRID_GAP * 3) / 4);
  const assetCardSize = Math.floor(((assetGridWidth || fallbackGridWidth) - GRID_GAP * 2) / 3);

  const savedImage = (place: Place | undefined): PlaceImageResponse | undefined => place?.coverUrl ? {
    status: "ready", durationMs: 0, costUsd: null,
    image: { status: "ready", title: `${place.name} travel image`, url: place.coverUrl, width: 1536, height: 1024, mimeType: "image/png" },
  } : undefined;
  const savedCountryImage = savedImage(selectedPlace?.kind === "country" ? selectedPlace : savedCountryDetail);
  const savedCityImage = savedImage(selectedPlace?.kind === "place" ? selectedPlace : savedCityDetail);
  const countryDetailEnabled = (countryDetailOpen || selectedPlace?.kind === "country") && Boolean(selectedCountry);
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
      return generatePlaceHeroUntilReady(countryDetailQuery.data.imageRequestToken, signal);
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
    enabled: countryDetailEnabled && detailSource === "globe" && Boolean(childrenRequestToken),
    staleTime: COUNTRY_SHEET_CACHE_MS,
    gcTime: COUNTRY_SHEET_CACHE_MS,
    retry: false,
    refetchInterval: false,
  });
  const cityDetailEnabled = (cityDetailOpen || selectedPlace?.kind === "place") && Boolean(selectedCountry && selectedCity);
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
      return generatePlaceHeroUntilReady(cityDetailQuery.data.imageRequestToken, signal);
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
    const query = placeTableQuery.trim();
    const timer = setTimeout(() => setTableSearchTerm(query.length >= 2 ? query : ""), PLACE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [placeTableQuery]);

  useEffect(() => {
    const query = placeTableQuery.trim();
    if (rootView !== "table" || query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const request = tableTab === "places" ? searchPlaces(query, controller.signal, true) : searchTrips(query, controller.signal, true);
      void request.then(() => queryClient.invalidateQueries({ queryKey: contentQueryKeys.history(contentContext, undefined), exact: true, refetchType: "none" })).catch(() => undefined);
    }, PLACE_SEARCH_HISTORY_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [contentContext, placeTableQuery, queryClient, rootView, tableTab]);

  useEffect(() => {
    const query = placeSearchQuery.trim();
    const generation = ++placeSearchGeneration.current;
    if (!createPlaceOpen || query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void findPlaces(query, controller.signal).then((results) => {
        if (generation === placeSearchGeneration.current) setPlaceSearchResults(deduplicatePlaceSearchResults(results));
      }).catch((error: unknown) => {
        if (generation === placeSearchGeneration.current && !(error instanceof Error && error.name === "CanceledError")) {
          setPlaceSearchResults([]);
          showToast({ title: errorMessage(error), duration: 2_000 });
        }
      }).finally(() => { if (generation === placeSearchGeneration.current) setPlaceSearchLoading(false); });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [createPlaceOpen, placeSearchQuery, showToast]);

  useEffect(() => {
    if (!createPlaceOpen) return;
    const timer = setTimeout(() => placeSearchInput.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [createPlaceOpen]);

  useEffect(() => {
    if (detailSource === "createPlace" || !countryDetailEnabled || !countryDetail || recordedCountryOpen.current === countryOpenRequest) return;
    recordedCountryOpen.current = countryOpenRequest;
    void openPlace(countryDetail.location.name, countryDetail.location.countryCode).then(() => queryClient.invalidateQueries({ queryKey: compassQueryKeys.overview(travelContext), exact: true })).catch(() => undefined);
  }, [countryDetail, countryDetailEnabled, countryOpenRequest, detailSource, queryClient, travelContext]);

  useEffect(() => {
    if (detailSource === "createPlace" || !cityDetailEnabled || !cityDetail || recordedCityOpen.current === cityOpenRequest) return;
    recordedCityOpen.current = cityOpenRequest;
    void openPlace(cityDetail.location.name, cityDetail.location.countryCode).then(() => queryClient.invalidateQueries({ queryKey: compassQueryKeys.overview(travelContext), exact: true })).catch(() => undefined);
  }, [cityDetail, cityDetailEnabled, cityOpenRequest, detailSource, queryClient, travelContext]);

  useEffect(() => {
    for (const trip of trips) {
      if (!tripMutationQueue.current.has(trip.key)) optimisticTripRef.current.set(trip.key, trip);
    }
  }, [trips]);

  useEffect(() => {
    for (const place of places) {
      if (!placeMutationQueue.current.has(place.key)) authoritativePlaceRef.current.set(place.key, place);
    }
  }, [places]);

  useEffect(() => {
    if (!shouldOpenTripAssets || initialAssetsOpened.current || !initialTripKey) return;
    const trip = trips.find(({ key }) => key === initialTripKey);
    if (!trip) return;
    initialAssetsOpened.current = true;
    const timer = setTimeout(() => { setTripView("globe"); setSelectedTripKey(trip.key); beginAssetSelection(trip); }, 0);
    return () => clearTimeout(timer);
    // The route restoration is intentionally consumed once for the matching trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTripKey, shouldOpenTripAssets, trips]);

  useEffect(() => () => {
    if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current);
    if (sheetTransitionTimer.current) clearTimeout(sheetTransitionTimer.current);
  }, []);

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
    setDetailSource("table");
    setSelectedCountry(country);
    setSelectedCity(place.kind === "place" ? { name: place.name, latitude: place.latitude, longitude: place.longitude } : undefined);
    setSelectedPlaceSnapshot(place);
    setSelectedPlaceKey(place.key);
  }

  function openSelectedPlaceOnWeb() {
    if (!selectedPlace) return;
    void Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(selectedPlace.name)}`).catch((error: unknown) => {
      showToast({ title: errorMessage(error, "The browser could not be opened."), duration: 2_000 });
    });
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

  function setFindPlaceOpen(open: boolean) {
    setCreatePlaceOpen(open);
    if (!open) updatePlaceSearch("");
  }

  async function persistGeneratedPlace(input: CreatePlaceInput, optimisticKey: string, kind: Place["kind"], coverUrl: string | undefined, failureTitle: string, saveIdentity: string) {
    const overviewKey = compassQueryKeys.overview(travelContext);
    showToast({ title: kind === "country" ? "Country saved" : "City saved", duration: 2_000 });
    await queryClient.cancelQueries({ queryKey: overviewKey, exact: true }).catch(() => undefined);
    queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => addOptimisticCompassPlace(current, { key: optimisticKey, name: input.name, summary: input.summary, countryCode: input.countryCode, kind, latitude: input.latitude, longitude: input.longitude, status: "wishlist", isFavorite: false, createdAt: new Date().toISOString(), ...(coverUrl ? { coverUrl } : {}) }));
    void createPlace(input).then((place) => {
      queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => reconcileOptimisticCompassPlace(current, optimisticKey, place));
      setSelectedPlaceKeys((current) => current.map((key) => key === optimisticKey ? place.key : key));
      pendingPlaceSaveRef.current.delete(saveIdentity);
      setPendingPlaceSaves((current) => current.filter((identity) => identity !== saveIdentity));
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(travelContext) });
    }).catch(() => {
      queryClient.setQueryData(overviewKey, (current: CompassOverview | undefined) => removeOptimisticCompassPlace(current, optimisticKey));
      setSelectedPlaceKeys((current) => current.filter((key) => key !== optimisticKey));
      pendingPlaceSaveRef.current.delete(saveIdentity);
      setPendingPlaceSaves((current) => current.filter((identity) => identity !== saveIdentity));
      showToast({ title: failureTitle, duration: 2_000 });
    });
  }

  function saveCountry() {
    if (!countryDetail || countryImage?.status !== "ready" || countryAlreadySaved) return;
    const saveIdentity = placeSaveIdentity("country", countryDetail.location.countryCode, countryDetail.location.name);
    if (pendingPlaceSaveRef.current.has(saveIdentity)) return;
    pendingPlaceSaveRef.current.add(saveIdentity);
    setPendingPlaceSaves((current) => [...current, saveIdentity]);
    const input = { name: countryDetail.location.name, summary: countryDetail.summary, countryCode: countryDetail.location.countryCode, latitude: countryDetail.location.latitude, longitude: countryDetail.location.longitude, imageRequestToken: countryDetail.imageRequestToken };
    setCountryDetailOpen(false);
    void persistGeneratedPlace(input, `optimistic-${randomUUID()}`, "country", countryImage.image.url, "Country could not be saved", saveIdentity);
  }

  function saveCity() {
    if (!cityDetail || cityImage?.status !== "ready" || cityAlreadySaved) return;
    const saveIdentity = placeSaveIdentity("place", cityDetail.location.countryCode, cityDetail.location.name);
    if (pendingPlaceSaveRef.current.has(saveIdentity)) return;
    pendingPlaceSaveRef.current.add(saveIdentity);
    setPendingPlaceSaves((current) => [...current, saveIdentity]);
    const input = { name: cityDetail.location.name, summary: cityDetail.summary, countryCode: cityDetail.location.countryCode, latitude: cityDetail.location.latitude, longitude: cityDetail.location.longitude, imageRequestToken: cityDetail.imageRequestToken };
    setCityDetailOpen(false);
    requestAnimationFrame(() => countryScrollRef.current?.scrollTo({ y: 0, animated: true }));
    void persistGeneratedPlace(input, `optimistic-${randomUUID()}`, "place", cityImage.image.url, "City could not be saved", saveIdentity);
  }

  function updateSavedPlace(place: Place, patch: Partial<Pick<Place, "status" | "isFavorite">>) {
    const previous = optimisticPlaceRef.current.get(place.key) ?? authoritativePlaceRef.current.get(place.key) ?? place;
    authoritativePlaceRef.current.set(place.key, authoritativePlaceRef.current.get(place.key) ?? place);
    const version = (placeMutationVersion.current.get(place.key) ?? 0) + 1;
    placeMutationVersion.current.set(place.key, version);
    const optimistic = { ...previous, ...patch };
    optimisticPlaceRef.current.set(place.key, optimistic);
    const optimisticReady = queryClient.cancelQueries({ queryKey: compassQueryKeys.all(travelContext) }).catch(() => undefined).then(() => {
      patchCachedCompassPlace(queryClient, travelContext, optimisticPlaceRef.current.get(place.key) ?? optimistic);
    });
    const prior = placeMutationQueue.current.get(place.key) ?? Promise.resolve();
    const operation = Promise.all([prior, optimisticReady]).then(() => updatePlace({ placeKey: place.key, ...patch })).then((updated) => {
      authoritativePlaceRef.current.set(place.key, updated);
      if (placeMutationVersion.current.get(place.key) !== version) return updated;
      optimisticPlaceRef.current.delete(place.key);
      patchCachedCompassPlace(queryClient, travelContext, updated);
      return updated;
    }).catch((error: unknown) => {
      if (placeMutationVersion.current.get(place.key) === version) {
        optimisticPlaceRef.current.delete(place.key);
        patchCachedCompassPlace(queryClient, travelContext, authoritativePlaceRef.current.get(place.key) ?? place);
        void queryClient.invalidateQueries({ queryKey: compassQueryKeys.all(travelContext) });
      }
      throw error;
    });
    let queued: Promise<void>;
    queued = operation.then(() => undefined, () => undefined).finally(() => {
      if (placeMutationQueue.current.get(place.key) === queued) placeMutationQueue.current.delete(place.key);
    });
    placeMutationQueue.current.set(place.key, queued);
    return operation;
  }

  function toggleTablePlaceSelection(key: string) {
    setSelectedTablePlaceKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }

  function handleTablePlaceLongPress(key: string) {
    void Haptics.selectionAsync();
    toggleTablePlaceSelection(key);
  }

  function updateSelectedPlaces(patch: Partial<Pick<Place, "status" | "isFavorite">>) {
    const selectedByKey = new Map([...places, ...visiblePlaces].map((place) => [place.key, place]));
    const selected = selectedTablePlaceKeys.map((key) => selectedByKey.get(key)).filter((place): place is Place => Boolean(place));
    const selectionComplete = selected.length > 0 && selected.length === selectedTablePlaceKeys.length;
    const successTitle = patch.status === "visited" ? "Places marked as visited"
      : patch.status === "wishlist" ? "Places marked as want to go"
        : patch.isFavorite ? "Places favorited" : "Places unfavorited";
    setSelectedTablePlaceKeys([]);
    setPlaceBulkMenuOpen(false);
    showToast({ title: selectionComplete ? successTitle : "Some places could not be updated", duration: 2_000 });
    void Promise.allSettled(selected.map((place) => updateSavedPlace(place, patch))).then((results) => {
      if (selectionComplete && results.some(({ status }) => status === "rejected")) showToast({ title: "Some places could not be updated", duration: 2_000 });
    });
  }

  function updateSelectedPlace(patch: Partial<Pick<Place, "status" | "isFavorite">>, successTitle: string) {
    if (!selectedPlace) return;
    const previous = selectedPlace;
    setPlaceMenuOpen(false);
    setSelectedPlaceSnapshot((current) => current?.key === previous.key ? { ...current, ...patch } : current);
    showToast({ title: successTitle, duration: 2_000 });
    const update = updateSavedPlace(selectedPlace, patch);
    const version = placeMutationVersion.current.get(previous.key);
    void update.then((updated) => {
      if (placeMutationVersion.current.get(previous.key) === version) setSelectedPlaceSnapshot((current) => current?.key === updated.key ? updated : current);
    }).catch((error: unknown) => {
      if (placeMutationVersion.current.get(previous.key) === version) setSelectedPlaceSnapshot((current) => current?.key === previous.key ? authoritativePlaceRef.current.get(previous.key) ?? previous : current);
      showToast({ title: errorMessage(error, "Place could not be updated"), duration: 2_000 });
    });
  }

  function openPlaceDelete() {
    setPlaceMenuOpen(false);
    delaySheetTransition(() => setPlaceDeleteOpen(true));
  }

  async function confirmDeletePlace() {
    if (!selectedPlace || placeDeleting) return;
    const previous = selectedPlace;
    const placeKey = selectedPlace.key;
    setPlaceDeleting(true);
    setPlaceReferencesOpen(false);
    setSelectedPlaceReference(undefined);
    setPlaceDeleteOpen(false);
    setSelectedPlaceKey(undefined);
    setSelectedPlaceSnapshot(undefined);
    showToast({ title: "Place deleted", duration: 2_000 });
    const optimisticReady = queryClient.cancelQueries({ queryKey: compassQueryKeys.all(travelContext) }).catch(() => undefined).then(() => {
      removeCachedCompassPlace(queryClient, travelContext, placeKey);
    });
    try {
      await placeMutationQueue.current.get(placeKey);
      await optimisticReady;
      await deletePlace(placeKey);
      optimisticPlaceRef.current.delete(placeKey);
      authoritativePlaceRef.current.delete(placeKey);
      placeMutationVersion.current.delete(placeKey);
      setSelectedTablePlaceKeys((current) => current.filter((key) => key !== placeKey));
      setSelectedPlaceKeys((current) => current.filter((key) => key !== placeKey));
      setSelectedTripPlaceKeys((current) => current.filter((key) => key !== placeKey));
    } catch (error) {
      setSelectedPlaceSnapshot(previous);
      setSelectedPlaceKey(placeKey);
      void queryClient.invalidateQueries({ queryKey: compassQueryKeys.all(travelContext) });
      showToast({ title: errorMessage(error, "Place could not be deleted"), duration: 2_000 });
    } finally {
      setPlaceDeleting(false);
    }
  }

  async function openPlaceSearchHistory() {
    const generation = ++placeHistoryGeneration.current;
    const key = contentQueryKeys.history(contentContext, undefined);
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setPlaceSearchHistory(cached ?? []);
    setPlaceHistoryLoading(!cached || invalidated);
    setRemovingPlaceHistoryQuery(undefined);
    setTableFilterOpen(false);
    delaySheetTransition(() => setPlaceHistoryOpen(true));
    if (cached && !invalidated) return;
    try {
      const loaded = await getContentHistory(queryClient, contentContext, undefined);
      if (generation === placeHistoryGeneration.current) setPlaceSearchHistory(loaded);
    } catch (error) {
      if (generation === placeHistoryGeneration.current) showToast({ title: errorMessage(error, "Search history could not be loaded."), duration: 2_000 });
    } finally {
      if (generation === placeHistoryGeneration.current) setPlaceHistoryLoading(false);
    }
  }

  function closePlaceSearchHistory() {
    placeHistoryGeneration.current += 1;
    setPlaceHistoryOpen(false);
  }

  function applyPlaceHistoryQuery(item: ContentSearchHistoryItem) {
    const promoted = promoteCachedContentHistory(queryClient, contentContext, undefined, item);
    setPlaceSearchHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    setPlaceTableQuery(item.query.slice(0, 500));
    closePlaceSearchHistory();
  }

  async function removePlaceHistoryQuery(item: ContentSearchHistoryItem) {
    if (removingPlaceHistoryQuery) return;
    const previous = removeCachedContentHistory(queryClient, contentContext, undefined, item.normalizedQuery);
    setPlaceSearchHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    setRemovingPlaceHistoryQuery(item.normalizedQuery);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch (error) {
      queryClient.setQueryData(contentQueryKeys.history(contentContext, undefined), previous);
      setPlaceSearchHistory(previous);
      showToast({ title: errorMessage(error, "The search could not be removed."), duration: 2_000 });
    } finally {
      setRemovingPlaceHistoryQuery(undefined);
    }
  }

  function toggleTripPlace(key: string) {
    setSelectedPlaceKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : current.length < 100 ? [...current, key] : current);
  }

  function toggleTripAddPlace(key: string) {
    const available = Math.max(0, 100 - (selectedTrip?.places.length ?? 0));
    setSelectedTripAddPlaceKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : current.length < available ? [...current, key] : current);
  }

  function openTripAddPlaces() {
    if (!selectedTrip) return;
    setTripAddMenuOpen(false);
    setSelectedTripAddPlaceKeys([]);
    delaySheetTransition(() => setTripAddPlacesOpen(true));
  }

  function addSelectedTripPlaces() {
    if (!selectedTrip || selectedTripAddPlaceKeys.length === 0) return;
    const existingKeys = new Set(selectedTrip.places.map(({ key }) => key));
    const additions = selectedTripAddPlaceKeys.map((key) => places.find((place) => place.key === key)).filter((place): place is Place => place !== undefined).filter(({ key }) => !existingKeys.has(key));
    if (additions.length !== selectedTripAddPlaceKeys.length) {
      showToast({ title: "One or more selected places are no longer available", duration: 2_000 });
      return;
    }
    const tripKey = selectedTrip.key;
    setSelectedTripAddPlaceKeys([]);
    setTripAddPlacesOpen(false);
    optimisticTripUpdate(tripKey, (current) => ({ ...current, places: [...current.places, ...additions.filter(({ key }) => !current.places.some((place) => place.key === key))], updatedAt: new Date().toISOString() }), (optimistic) => updateTrip({ tripKey, placeKeys: optimistic.places.map(({ key }) => key) }), "Places could not be added", additions.length === 1 ? "Place added to trip" : "Places added to trip");
  }

  function advanceTripCreation() {
    if (!selectedPlaceKeys.length || selectedPlaceKeys.some((key) => key.startsWith("optimistic-"))) return;
    setTripSelectionOpen(false);
    setOrderPlaceKeys(selectedPlaceKeys);
    setSelectedOrderPlaceKeys([]);
    delaySheetTransition(() => setTripOrderOpen(true));
  }

  function advanceTripOrder() {
    if (!orderPlaceKeys.length) return;
    setSelectedPlaceKeys(orderPlaceKeys);
    setTripOrderOpen(false);
    delaySheetTransition(() => setTripDetailsOpen(true));
  }

  function submitTrip() {
    const name = tripName.trim();
    if (!name || !selectedPlaceKeys.length || selectedPlaceKeys.some((key) => key.startsWith("optimistic-"))) return;
    const selectedPlaces = selectedPlaceKeys.map((key) => places.find((place) => place.key === key)).filter((place): place is Place => Boolean(place));
    if (selectedPlaces.length !== selectedPlaceKeys.length) {
      showToast({ title: "One or more selected places are no longer available", duration: 2_000 });
      return;
    }
    const idempotencyKey = randomUUID();
    const optimisticKey = `optimistic-${idempotencyKey}`;
    const now = new Date().toISOString();
    const optimisticTrip: Trip = { key: optimisticKey, name, ...(tripDescription.trim() ? { description: tripDescription.trim() } : {}), createdAt: now, updatedAt: now, status: "planned", isFavorite: false, attachments: [], places: selectedPlaces, ...(selectedPlaces[0]?.coverUrl ? { coverUrl: selectedPlaces[0].coverUrl } : {}) };
    const tripsKey = compassQueryKeys.trips(travelContext);
    setTripDetailsOpen(false);
    setTripName("");
    setTripDescription("");
    setSelectedPlaceKeys([]);
    optimisticTripRef.current.set(optimisticKey, optimisticTrip);
    showToast({ title: "Trip created", duration: 2_000 });
    void (async () => {
      await queryClient.cancelQueries({ queryKey: tripsKey, exact: true }).catch(() => undefined);
      queryClient.setQueryData(tripsKey, (current: Trip[] | undefined) => appendOptimisticCompassTrip(current, optimisticTrip));
      try {
        const trip = await createTrip({ name, ...(tripDescription.trim() ? { description: tripDescription.trim() } : {}), placeKeys: selectedPlaces.map(({ key }) => key), idempotencyKey });
        await queryClient.cancelQueries({ queryKey: tripsKey, exact: true }).catch(() => undefined);
        optimisticTripRef.current.delete(optimisticKey);
        optimisticTripRef.current.set(trip.key, trip);
        queryClient.setQueryData(tripsKey, (current: Trip[] | undefined) => reconcileOptimisticCompassTrip(current, optimisticKey, trip));
      } catch {
        await queryClient.cancelQueries({ queryKey: tripsKey, exact: true }).catch(() => undefined);
        optimisticTripRef.current.delete(optimisticKey);
        queryClient.setQueryData(tripsKey, (current: Trip[] | undefined) => removeOptimisticCompassTrip(current, optimisticKey));
        showToast({ title: "Trip could not be created", duration: 2_000 });
      }
    })();
  }

  function delaySheetTransition(open: () => void) {
    if (sheetTransitionTimer.current) clearTimeout(sheetTransitionTimer.current);
    sheetTransitionTimer.current = setTimeout(() => {
      sheetTransitionTimer.current = undefined;
      open();
    }, SHEET_TRANSITION_DELAY_MS);
  }

  function openTripGuides() {
    if (!selectedTrip) return;
    setTripMenuOpen(false);
    setTripAiMenuOpen(false);
    setSelectedTripGuide(undefined);
    delaySheetTransition(() => setTripGuidesOpen(true));
  }

  function closeTripGuides() {
    setTripGuidesOpen(false);
    setSelectedTripGuide(undefined);
  }

  async function createTripGuide() {
    if (!selectedTrip || tripGuideGeneratingRef.current) return;
    const tripKey = selectedTrip.key;
    tripGuideGeneratingRef.current = true;
    setTripGuideGenerating(true);
    try {
      const guide = await generateTripGuide(tripKey, randomUUID());
      queryClient.setQueryData<TripGuide[]>(compassQueryKeys.tripGuides(travelContext, tripKey), (current) => [guide, ...(current ?? []).filter(({ key }) => key !== guide.key)]);
      setSelectedTripGuide(guide);
      showToast({ title: "Travel guide request complete", duration: 2_000 });
    } catch (error) {
      setSelectedTripGuide(undefined);
      showToast({ title: errorMessage(error), duration: 2_000 });
    } finally {
      tripGuideGeneratingRef.current = false;
      setTripGuideGenerating(false);
    }
  }

  function openPlaceReferences(kind: PlaceReferenceKind) {
    if (!selectedPlace) return;
    setPlaceAiMenuOpen(false);
    setPlaceMenuOpen(false);
    setPlaceReferenceKind(kind);
    setSelectedPlaceReference(undefined);
    delaySheetTransition(() => setPlaceReferencesOpen(true));
  }

  function closePlaceReferences() {
    placeReferenceGeneration.current += 1;
    setPlaceReferencesOpen(false);
    setSelectedPlaceReference(undefined);
  }

  async function createPlaceReference() {
    if (!selectedPlace || placeReferenceGeneratingRef.current) return;
    const placeKey = selectedPlace.key;
    const kind = placeReferenceKind;
    const generation = ++placeReferenceGeneration.current;
    placeReferenceGeneratingRef.current = true;
    setPlaceReferenceGenerating(true);
    try {
      const reference = await generatePlaceReference(placeKey, kind, randomUUID());
      queryClient.setQueryData<PlaceReference[]>(compassQueryKeys.placeReferences(travelContext, placeKey, kind), (current) => [reference, ...(current ?? []).filter(({ key }) => key !== reference.key)]);
      if (generation === placeReferenceGeneration.current && selectedPlaceKey === placeKey) setSelectedPlaceReference(reference);
      showToast({ title: `${PLACE_REFERENCE_OPTIONS.find((option) => option.kind === kind)?.singular ?? "Reference"} request complete`, duration: 2_000 });
    } catch (error) {
      setSelectedPlaceReference(undefined);
      showToast({ title: errorMessage(error), duration: 2_000 });
    } finally {
      placeReferenceGeneratingRef.current = false;
      setPlaceReferenceGenerating(false);
    }
  }

  function nextTripMutationVersion(tripKey: string) {
    const next = (tripMutationVersion.current.get(tripKey) ?? 0) + 1;
    tripMutationVersion.current.set(tripKey, next);
    return next;
  }

  function enqueueTripMutation<T>(tripKey: string, operation: () => Promise<T>, settle: (result: { value: T } | { error: unknown }) => Promise<void>) {
    const previous = tripMutationQueue.current.get(tripKey) ?? Promise.resolve();
    let queued: Promise<void>;
    queued = previous.catch(() => undefined).then(operation).then(
      (value) => settle({ value }),
      (error: unknown) => settle({ error }),
    ).finally(() => {
      if (tripMutationQueue.current.get(tripKey) === queued) tripMutationQueue.current.delete(tripKey);
    });
    tripMutationQueue.current.set(tripKey, queued);
  }

  async function convergeTripsAfterAmbiguousFailure(tripKey: string, failedVersion: number) {
    const tripsKey = compassQueryKeys.trips(travelContext);
    await queryClient.cancelQueries({ queryKey: tripsKey, exact: true }).catch(() => undefined);
    try {
      const authoritative = await queryClient.fetchQuery({ queryKey: tripsKey, queryFn: ({ signal }) => listTrips(signal), staleTime: 0 });
      const authoritativeTrip = authoritative.find(({ key }) => key === tripKey);
      const currentVersion = tripMutationVersion.current.get(tripKey);
      const newerDelete = currentVersion !== failedVersion && optimisticTripDeleteVersion.current.get(tripKey) === currentVersion;
      const newerOptimistic = currentVersion !== failedVersion ? optimisticTripRef.current.get(tripKey) : undefined;
      if (newerDelete) {
        removeCachedCompassTrip(queryClient, travelContext, tripKey);
        optimisticTripRef.current.delete(tripKey);
      } else if (newerOptimistic) {
        upsertCachedCompassTrip(queryClient, travelContext, newerOptimistic);
      } else if (authoritativeTrip) {
        optimisticTripRef.current.set(tripKey, authoritativeTrip);
      } else {
        optimisticTripRef.current.delete(tripKey);
      }
    } catch {
      optimisticTripRef.current.delete(tripKey);
      await queryClient.invalidateQueries({ queryKey: tripsKey, exact: true });
    }
  }

  function optimisticTripUpdate(tripKey: string, update: (current: Trip) => Trip, request: (optimistic: Trip, version: number) => Promise<Trip>, failureTitle: string, successTitle: string) {
    const cached = queryClient.getQueryData<Trip[]>(compassQueryKeys.trips(travelContext))?.find(({ key }) => key === tripKey);
    const previous = optimisticTripRef.current.get(tripKey) ?? cached;
    if (!previous) return;
    const version = nextTripMutationVersion(tripKey);
    optimisticTripDeleteVersion.current.delete(tripKey);
    const optimistic = update(previous);
    optimisticTripRef.current.set(tripKey, optimistic);
    upsertCachedCompassTrip(queryClient, travelContext, optimistic);
    showToast({ title: successTitle, duration: 2_000 });
    const optimisticReady = queryClient.cancelQueries({ queryKey: compassQueryKeys.trips(travelContext), exact: true }).catch(() => undefined);
    enqueueTripMutation(tripKey, async () => {
      await optimisticReady;
      return request(optimistic, version);
    }, async (result) => {
      const current = tripMutationVersion.current.get(tripKey) === version;
      if ("value" in result) {
        if (current) {
          await queryClient.cancelQueries({ queryKey: compassQueryKeys.trips(travelContext), exact: true }).catch(() => undefined);
          optimisticTripRef.current.set(tripKey, result.value);
          upsertCachedCompassTrip(queryClient, travelContext, result.value);
          for (const place of result.value.places) patchCachedCompassPlace(queryClient, travelContext, place);
        }
        return;
      }
      await convergeTripsAfterAmbiguousFailure(tripKey, version);
      showToast({ title: result.error instanceof Error && result.error.message ? result.error.message : failureTitle, duration: 2_000 });
    });
  }

  function moveOrderPlace(index: number, direction: "up" | "down") {
    const wrapsToEnd = direction === "up" && index === 0;
    const wrapsToStart = direction === "down" && index === orderPlaceKeys.length - 1;
    setOrderPlaceKeys((current) => reorderPlaces(current, index, direction));
    if (wrapsToEnd) requestAnimationFrame(() => orderScrollRef.current?.scrollToEnd({ animated: true }));
    if (wrapsToStart) requestAnimationFrame(() => orderScrollRef.current?.scrollTo({ y: 0, animated: true }));
  }

  function toggleOrderSelection(key: string) {
    setSelectedOrderPlaceKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }

  function handleOrderLongPress(key: string) {
    void Haptics.selectionAsync();
    setSelectedOrderPlaceKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }

  function removeSelectedOrderPlaces() {
    const remaining = orderPlaceKeys.filter((key) => !selectedOrderPlaceKeys.includes(key));
    if (!remaining.length) {
      showToast({ title: "A trip must contain at least one place", duration: 2_000 });
      return;
    }
    setOrderPlaceKeys(remaining);
    setSelectedOrderPlaceKeys([]);
    setOrderRemoveOpen(false);
  }

  function handleTripPlaceLongPress(key: string) {
    void Haptics.selectionAsync();
    setSelectedTripPlaceKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }

  function handleTripPlacePress(place: Place) {
    if (selectedTripPlaceKeys.length) {
      setSelectedTripPlaceKeys((current) => current.includes(place.key) ? current.filter((key) => key !== place.key) : [...current, place.key]);
      return;
    }
    openSavedPlace(place);
  }

  function removeTripPlaces() {
    if (!selectedTrip) return;
    const removedKeys = [...selectedTripPlaceKeys];
    const remaining = selectedTrip.places.filter(({ key }) => !removedKeys.includes(key));
    if (!remaining.length) {
      showToast({ title: "A trip must contain at least one place", duration: 2_000 });
      return;
    }
    const tripKey = selectedTrip.key;
    setSelectedTripPlaceKeys([]);
    setTripRemoveOpen(false);
    optimisticTripUpdate(tripKey, (current) => ({ ...current, places: current.places.filter(({ key }) => !removedKeys.includes(key)), updatedAt: new Date().toISOString() }), (optimistic) => updateTrip({ tripKey, placeKeys: optimistic.places.map(({ key }) => key) }), "Places could not be removed", "Places removed from trip");
  }

  function openTripEdit() {
    if (!selectedTrip) return;
    setTripMenuOpen(false);
    setEditTripName(selectedTrip.name);
    setEditTripDescription(selectedTrip.description ?? "");
    setEditTripFavorite(Boolean(selectedTrip.isFavorite));
    setEditTripCompleted(selectedTrip.status === "completed");
    setEditTripCover(undefined);
    setOrderPlaceKeys(selectedTrip.places.map(({ key }) => key));
    delaySheetTransition(() => setTripEditOpen(true));
  }

  function toggleTripCompleted() {
    if (!selectedTrip) return;
    const tripKey = selectedTrip.key;
    const status = selectedTrip.status === "completed" ? "planned" as const : "completed" as const;
    setTripMenuOpen(false);
    optimisticTripUpdate(tripKey, (current) => ({ ...current, status, places: status === "completed" ? current.places.map((place) => ({ ...place, status: "visited" })) : current.places, updatedAt: new Date().toISOString() }), () => updateTrip({ tripKey, status }), "Trip status could not be updated", status === "completed" ? "Trip completed and places marked as visited" : "Trip marked as planned");
  }

  async function chooseTripCover() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 1 });
      if (!result.canceled && result.assets[0]) setEditTripCover(result.assets[0]);
    } catch (error) {
      showToast({ title: errorMessage(error), duration: 2_000 });
    }
  }

  function saveTripEdit() {
    if (!selectedTrip || !editTripName.trim()) return;
    const tripKey = selectedTrip.key;
    const name = editTripName.trim();
    const description = editTripDescription.trim() || undefined;
    const coverChange = editTripCover;
    const placeKeys = [...orderPlaceKeys];
    if (!placeKeys.length) return;
    setTripEditOpen(false);
    const status = editTripCompleted ? "completed" as const : "planned" as const;
    optimisticTripUpdate(tripKey, (current) => {
      const placeByKey = new Map(current.places.map((place) => [place.key, place]));
      const orderedPlaces = placeKeys.map((key) => placeByKey.get(key)).filter((place): place is Place => Boolean(place));
      return { ...current, name, description, status, isFavorite: editTripFavorite, places: status === "completed" ? orderedPlaces.map((place) => ({ ...place, status: "visited" })) : orderedPlaces, updatedAt: new Date().toISOString(), ...(coverChange !== undefined ? { coverUrl: coverChange?.uri } : {}) };
    }, async () => {
      let coverImageKey: string | null | undefined;
      let uploadedImageKey: string | undefined;
      let updateStarted = false;
      if (coverChange === null) coverImageKey = null;
      try {
        if (coverChange) {
          const normalized = await normalizeCapturedJpeg(coverChange, { maxSide: 2400, compress: 0.88 });
          const upload = await uploadGalleryImages([{ clientKey: `${Date.now()}-${tripKey}`, filename: `trip-cover-${Date.now()}.jpg`, uri: normalized.uri, sizeBytes: normalized.sizeBytes, processingMode: "cover" }]);
          const job = upload.jobs[0];
          if (!job) throw new Error("The trip cover upload could not be started.");
          uploadedImageKey = job.imageKey;
          let status = job.status;
          for (let attempt = 0; status !== "completed" && status !== "failed" && attempt < 40; attempt += 1) {
            await wait(3_000);
            status = (await fetchGalleryUploadStatus([job.key])).jobs[0]?.status ?? status;
          }
          if (status !== "completed") throw new Error("The trip cover could not be processed.");
          coverImageKey = job.imageKey;
        }
        updateStarted = true;
        const trip = await updateTrip({ tripKey, name, description: description ?? null, status, isFavorite: editTripFavorite, placeKeys, ...(coverImageKey !== undefined ? { coverImageKey } : {}) });
        return trip;
      } catch (error) {
        if (uploadedImageKey && !updateStarted) void deleteGalleryImages([uploadedImageKey]).catch(() => undefined);
        throw error;
      }
    }, "Trip could not be updated", editTripCompleted && selectedTrip.status !== "completed" ? "Trip completed and places marked as visited" : "Trip updated");
  }

  function confirmDeleteTrip() {
    if (!selectedTrip) return;
    const tripKey = selectedTrip.key;
    const tripsKey = compassQueryKeys.trips(travelContext);
    const version = nextTripMutationVersion(tripKey);
    optimisticTripDeleteVersion.current.set(tripKey, version);
    optimisticTripRef.current.delete(tripKey);
    const optimisticReady = (async () => {
      await queryClient.cancelQueries({ queryKey: tripsKey, exact: true }).catch(() => undefined);
      removeCachedCompassTrip(queryClient, travelContext, tripKey);
    })();
    setTripDeleteOpen(false);
    setTripMenuOpen(false);
    setSelectedTripKey(undefined);
    showToast({ title: "Trip deleted", duration: 2_000 });
    enqueueTripMutation(tripKey, async () => {
      await optimisticReady;
      return deleteTrip(tripKey);
    }, async (result) => {
      if ("value" in result) {
        await queryClient.cancelQueries({ queryKey: tripsKey, exact: true }).catch(() => undefined);
        removeCachedCompassTrip(queryClient, travelContext, tripKey);
        optimisticTripRef.current.delete(tripKey);
        optimisticTripDeleteVersion.current.delete(tripKey);
        return;
      }
      await convergeTripsAfterAmbiguousFailure(tripKey, version);
      optimisticTripDeleteVersion.current.delete(tripKey);
      showToast({ title: errorMessage(result.error), duration: 2_000 });
    });
  }

  function beginAssetSelection(trip: Trip) {
    setSelectedAssetAttachments(trip.attachments ?? []);
    const generation = ++assetsGeneration.current;
    const cachedFolders = queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext));
    const cachedCollections = queryClient.getQueryData<GalleryCollection[]>(galleryQueryKeys.collections(travelContext));
    setAssetsOpen(true);
    setAssetsLoading(!cachedFolders || !cachedCollections);
    setAssetFolders(cachedFolders ?? []);
    setAssetCollections((cachedCollections ?? []).filter((collection) => !isManagedGalleryCollection(collection)));
    void Promise.all([
      getContentFolderTree(queryClient, contentContext),
      getGalleryCollections(queryClient, travelContext, async () => (await fetchGalleryOverview(undefined, undefined, 1)).collections),
    ]).then(([folders, collections]) => {
      if (generation !== assetsGeneration.current) return;
      setAssetFolders(folders);
      setAssetCollections(collections.filter((collection) => !isManagedGalleryCollection(collection)));
    }).catch((error: unknown) => {
      if (generation === assetsGeneration.current) showToast({ title: errorMessage(error), duration: 2_000 });
    }).finally(() => {
      if (generation === assetsGeneration.current) setAssetsLoading(false);
    });
  }

  function openAssets() {
    if (!selectedTrip) return;
    setTripMenuOpen(false);
    delaySheetTransition(() => beginAssetSelection(selectedTrip));
  }

  function closeAssets() {
    assetsGeneration.current += 1;
    setAssetsLoading(false);
    setAssetsOpen(false);
  }

  function toggleAssetAttachment(attachment: TripAttachment) {
    setSelectedAssetAttachments((current) => current.some(({ type, key }) => type === attachment.type && key === attachment.key)
      ? current.filter(({ type, key }) => type !== attachment.type || key !== attachment.key)
      : [...current, attachment]);
  }

  function handleAssetLongPress(attachment: TripAttachment) {
    const id = `${attachment.type}:${attachment.key}`;
    assetLongPress.current = id;
    setTimeout(() => { if (assetLongPress.current === id) assetLongPress.current = undefined; }, 50);
    toggleAssetAttachment(attachment);
    void Haptics.selectionAsync();
  }

  function openAsset(attachment: TripAttachment) {
    const id = `${attachment.type}:${attachment.key}`;
    if (assetLongPress.current === id) { assetLongPress.current = undefined; return; }
    if (!selectedTrip) return;
    closeAssets();
    router.replace({ pathname: "/capability/[slug]", params: { slug: attachment.type === "folder" ? "archive" : "gallery", assetKey: attachment.key, returnTripKey: selectedTrip.key, returnTripName: selectedTrip.name } });
  }

  function saveAssetAttachments() {
    if (!selectedTrip) return;
    const tripKey = selectedTrip.key;
    const attachments = [...selectedAssetAttachments];
    closeAssets();
    optimisticTripUpdate(tripKey, (current) => ({ ...current, attachments, updatedAt: new Date().toISOString() }), () => setTripAttachments({ tripKey, attachments }), "Trip assets could not be updated", "Trip assets updated");
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
  const semanticSearchActive = tableSearchTerm.length >= 2;
  const placeTablePending = overviewQuery.isPending || semanticSearchActive && savedPlaceSearchQuery.isPending;
  const placeTableError = semanticSearchActive && savedPlaceSearchQuery.error ? errorMessage(savedPlaceSearchQuery.error) : loadError;
  const tripTablePending = tripsQuery.isPending || semanticSearchActive && tripSearchQuery.isPending;
  const tripTableError = semanticSearchActive && tripSearchQuery.error ? errorMessage(tripSearchQuery.error) : tripsError;
  const activeCountryCode = searchFocus?.countryCode ?? lastOpenedCountryCode;
  const orderPlaceByKey = new Map(places.map((place) => [place.key, place]));
  const orderedPlaces = orderPlaceKeys.map((key) => orderPlaceByKey.get(key)).filter((place): place is Place => Boolean(place));
  const editPlaceByKey = new Map((selectedTrip?.places ?? []).map((place) => [place.key, place]));
  const editOrderedPlaces = orderPlaceKeys.map((key) => editPlaceByKey.get(key)).filter((place): place is Place => Boolean(place));
  const tripGlobePlaceIndex = selectedTrip ? Math.max(0, selectedTrip.places.findIndex(({ key }) => key === tripGlobePlaceKey)) : 0;
  const tripGlobePlace = selectedTrip?.places[tripGlobePlaceIndex];
  const availableTripAddPlaces = selectedTrip ? places.filter((place) => !selectedTrip.places.some(({ key }) => key === place.key)) : [];
  const selectTripGlobePlace = (key: string) => { setTripGlobePlaceKey(key); setTripGlobeFocusRequest((current) => current + 1); };
  return <KeyboardAvoidingView behavior={assistantInputFocused ? "height" : undefined} style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}><WorkspaceAppSwitcher active="compass" /></View>
    <View style={[styles.workspaceViewport, { paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
      {selectedPlace ? <>
        <View style={styles.titleRow}><Button accessibilityLabel={selectedTrip ? `Back to ${selectedTrip.name}` : "Back to Places"} contentMode="raw" onPress={() => { setSelectedPlaceKey(undefined); setSelectedPlaceSnapshot(undefined); }} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button><Text numberOfLines={1} style={styles.workspaceTitle}>{selectedPlace.name}</Text><Button accessibilityLabel="Place menu" contentMode="raw" onPress={() => setPlaceMenuOpen(true)} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button></View>
        <View style={styles.detailHeaderActions}><Button accessibilityLabel="AI place actions" contentMode="raw" onPress={() => setPlaceAiMenuOpen(true)} size="sm" variant="icon"><BrainIcon size="sm" /></Button></View>
        <ScrollView accessibilityLabel={`${selectedPlace.name} place details`} contentContainerStyle={styles.savedPlaceDetail} showsVerticalScrollIndicator={false}>{selectedPlace.kind === "country" ? countryDetailLoading ? <GuideLoading label={`Loading information about ${selectedPlace.name}`} text="Generating country guide..." /> : countryDetailError ? <View style={styles.countryDetailFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{countryDetailError}</Text></View> : countryDetail ? <GuideHero detail={countryDetail} image={countryImage?.image} onImageError={() => void overviewQuery.refetch()} /> : null : cityDetailLoading ? <GuideLoading label={`Loading information about ${selectedPlace.name}`} text="Generating city guide..." /> : cityDetailError ? <View style={styles.countryDetailFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{cityDetailError}</Text></View> : cityDetail ? <GuideHero detail={cityDetail} image={cityImage?.image} onImageError={() => void overviewQuery.refetch()} /> : null}</ScrollView>
      </> : selectedTrip ? <>
        <View style={styles.titleRow}><Button accessibilityLabel="Back to trips" contentMode="raw" onPress={() => { setSelectedTripKey(undefined); setSelectedTripPlaceKeys([]); }} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button><Text numberOfLines={1} style={styles.workspaceTitle}>{selectedTrip.name}</Text><Button accessibilityLabel="Trip menu" contentMode="raw" onPress={() => setTripMenuOpen(true)} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button><Button accessibilityLabel="Add to trip" contentMode="raw" onPress={() => setTripAddMenuOpen(true)} size="sm" variant="icon"><PlusIcon size="sm" /></Button></View>
        <View style={styles.detailHeaderActions}><Button accessibilityLabel="AI trip actions" contentMode="raw" onPress={() => setTripAiMenuOpen(true)} size="sm" variant="icon"><BrainIcon size="sm" /></Button>{tripDetailTab === "places" ? <Button accessibilityLabel={tripView === "globe" ? "Show trip table" : "Show trip globe"} contentMode="raw" onPress={() => setTripView((current) => current === "globe" ? "table" : "globe")} size="sm" variant="icon">{tripView === "globe" ? <TableViewIcon size="sm" /> : <GlobeViewIcon size="sm" />}</Button> : null}</View>
        {selectedTripPlaceKeys.length ? <BulkToolbar count={selectedTripPlaceKeys.length} onClear={() => setSelectedTripPlaceKeys([])} onMore={() => setTripBulkMenuOpen(true)} /> : null}
        <Tabs accessibilityLabel="Trip detail categories" accessibilityRole="tablist" role="tablist" style={styles.rootTabs}><Button accessibilityRole="tab" accessibilityState={{ selected: tripDetailTab === "places" }} onPress={() => setTripDetailTab("places")} size="xs" style={styles.rootTab} variant={tripDetailTab === "places" ? "secondary" : "ghost"}>Places</Button><Button accessibilityRole="tab" accessibilityState={{ selected: tripDetailTab === "images" }} onPress={() => setTripDetailTab("images")} size="xs" style={styles.rootTab} variant={tripDetailTab === "images" ? "secondary" : "ghost"}>Generated Images</Button></Tabs>
        {tripDetailTab === "images" ? <ScrollView accessibilityLabel="Trip images" contentContainerStyle={styles.imageGrid} onLayout={({ nativeEvent }) => setTripGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>{tripImages.map((image) => <Button accessibilityLabel={`Open ${image.title} image`} contentMode="raw" key={image.key} onPress={() => setImageViewerKey(image.key)} shape="rounded" size="xl" style={[styles.imageCard, { width: imageCardSize, height: imageCardSize }]} variant="ghost"><Image contentFit="cover" source={image.url} style={StyleSheet.absoluteFill} /></Button>)}</ScrollView> : tripView === "globe" ? <View style={styles.tripGlobe}><InteractiveGlobe autoRotate={false} focusRequest={tripGlobeFocusRequest} focusTarget={tripGlobePlace} markers={selectedTrip.places} onMarkerPress={selectTripGlobePlace} /><TripPlaceArc onFocus={selectTripGlobePlace} onOpen={handleTripPlacePress} places={selectedTrip.places} selectedKey={tripGlobePlace?.key} /></View> : <ScrollView accessibilityLabel="Trip places" contentContainerStyle={styles.cardGrid} onLayout={({ nativeEvent }) => setTripGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>{selectedTrip.places.map((place) => <PlaceCard accessibilityLongPress cardSize={tripCardSize} key={place.key} onLongPress={() => handleTripPlaceLongPress(place.key)} onPress={() => handleTripPlacePress(place)} place={place} selectable selected={selectedTripPlaceKeys.includes(place.key)} />)}</ScrollView>}
      </> : <><View style={styles.titleRow}>
        <WorkspaceAppSwitcher active="compass" backSize="sm" trigger="back" />
        <Text numberOfLines={1} style={styles.workspaceTitle}>Compass</Text>
        <Button accessibilityLabel={rootView === "globe" ? "Show Compass table" : "Show Compass globe"} contentMode="raw" onPress={() => setRootView((current) => current === "globe" ? "table" : "globe")} size="sm" variant="icon">{rootView === "globe" ? <TableViewIcon size="sm" /> : <GlobeViewIcon size="sm" />}</Button>
        <Button accessibilityLabel={rootView === "globe" ? "Add in Compass" : "Compass actions"} contentMode="raw" onPress={() => setActionsOpen(true)} size="sm" variant="icon">{rootView === "globe" ? <PlusIcon size="sm" /> : <MoreHorizontalIcon size="sm" />}</Button>
      </View>
      {rootView === "globe" ? <>
        <View style={styles.workspaceSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search Compass countries" editable={!countrySearchFocusBlocked} focusable={!countrySearchFocusBlocked} onChangeText={(value) => { setCountryQuery(value); setSearchFocus(undefined); }} onFocus={() => { if (countrySearchFocusBlocked) { countrySearchInput.current?.blur(); Keyboard.dismiss(); } }} placeholder="Search countries..." ref={countrySearchInput} style={styles.workspaceSearchInput} value={countryQuery} />{countryQuery.trim() ? <Button accessibilityLabel="Clear Compass search" contentMode="raw" iconOnly onPress={() => { setCountryQuery(""); setSearchFocus(undefined); }} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
        <View style={styles.globe}><InteractiveGlobe autoRotate={!countryQuery.trim()} focusRequest={globeFocusRequest} focusTarget={globeFocusTarget} onCountryPress={(country) => { if (country) openCountryDetail(country.properties); }} savedCountryCodes={savedCountryCodes} selectedCountryCode={activeCountryCode} />{loadError && !overviewQuery.isPending ? <View style={styles.loadFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{loadError}</Text><Button onPress={() => void overviewQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : null}</View>
      </> : <View style={styles.tableView}>
        {tableTab === "places" && selectedTablePlaceKeys.length ? <BulkToolbar count={selectedTablePlaceKeys.length} onClear={() => setSelectedTablePlaceKeys([])} onMore={() => setPlaceBulkMenuOpen(true)} /> : <View style={styles.rootActions}><View style={styles.rootSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel={tableTab === "places" ? "Search Places" : "Search Trips"} maxLength={500} onChangeText={setPlaceTableQuery} placeholder="Search..." returnKeyType="search" style={styles.rootSearchInput} value={placeTableQuery} />{placeTableQuery.trim() ? <Button accessibilityLabel={`Clear ${tableTab === "places" ? "Places" : "Trips"} search`} contentMode="raw" iconOnly onPress={() => setPlaceTableQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View><Button accessibilityLabel={`Filter ${tableTab === "places" ? "Places" : "Trips"}`} contentMode="raw" onPress={() => setTableFilterOpen(true)} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={tableTab === "places" ? placeFavoritesOnly || placeStatusFilter !== "all" ? "accent" : "default" : tripFavoritesOnly || tripCompletedOnly ? "accent" : "default"} /></Button></View>}
        <Tabs accessibilityLabel="Compass table categories" accessibilityRole="tablist" role="tablist" style={styles.rootTabs}><Button accessibilityRole="tab" accessibilityState={{ selected: tableTab === "places" }} onPress={() => setTableTab("places")} size="xs" style={styles.rootTab} variant={tableTab === "places" ? "secondary" : "ghost"}>Places</Button><Button accessibilityRole="tab" accessibilityState={{ selected: tableTab === "trips" }} onPress={() => { setSelectedTablePlaceKeys([]); setTableTab("trips"); }} size="xs" style={styles.rootTab} variant={tableTab === "trips" ? "secondary" : "ghost"}>Trips</Button></Tabs>
        {tableTab === "places" ? <ScrollView accessibilityLabel="My Places" accessibilityLiveRegion="polite" accessibilityState={{ busy: placeTablePending }} contentContainerStyle={[styles.cardGrid, !placeTablePending && !placeTableError && visiblePlaces.length === 0 && styles.emptyGrid]} onLayout={({ nativeEvent }) => setTableGridWidth(nativeEvent.layout.width)} role="tabpanel" showsVerticalScrollIndicator={false}>{placeTablePending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.squareCard, { width: tableCardSize, height: tableCardSize }]} />) : placeTableError ? <QueryFailure message={placeTableError} onRetry={() => void (semanticSearchActive ? savedPlaceSearchQuery.refetch() : overviewQuery.refetch())} /> : visiblePlaces.map((place) => <PlaceCard accessibilityLongPress cardSize={tableCardSize} key={place.key} onLongPress={() => handleTablePlaceLongPress(place.key)} onPress={() => { if (selectedTablePlaceKeys.length) toggleTablePlaceSelection(place.key); else openSavedPlace(place); }} place={place} selectable={selectedTablePlaceKeys.length > 0} selected={selectedTablePlaceKeys.includes(place.key)} />)}{!placeTablePending && !placeTableError && visiblePlaces.length === 0 ? <Text style={styles.emptyText}>{tableSearchTerm ? "No saved places matched this search." : places.length ? "No places match these filters." : "No saved places yet. Create one to start mapping your world."}</Text> : null}</ScrollView> : <ScrollView accessibilityLabel="Trips" accessibilityLiveRegion="polite" accessibilityState={{ busy: tripTablePending }} contentContainerStyle={[styles.cardGrid, !tripTablePending && !tripTableError && visibleTrips.length === 0 && styles.emptyGrid]} onLayout={({ nativeEvent }) => setTableGridWidth(nativeEvent.layout.width)} role="tabpanel" showsVerticalScrollIndicator={false}>{tripTablePending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.squareCard, { width: tableCardSize, height: tableCardSize }]} />) : tripTableError ? <QueryFailure message={tripTableError} onRetry={() => void (semanticSearchActive ? tripSearchQuery.refetch() : tripsQuery.refetch())} /> : visibleTrips.map((trip) => <TripCard cardSize={tableCardSize} key={trip.key} onPress={() => { setTripView("globe"); setSelectedTripKey(trip.key); setTripDetailTab("places"); }} trip={trip} />)}{!tripTablePending && !tripTableError && visibleTrips.length === 0 ? <Text style={styles.emptyText}>{tableSearchTerm ? "No trips matched this search." : "No trips yet. Group saved places into your first trip."}</Text> : null}</ScrollView>}
        {tableTab === "trips" && !tripTablePending && !tripTableError && !tableSearchTerm && (tripFavoritesOnly || tripCompletedOnly) && visibleTrips.length === 0 ? <View style={styles.filteredTripEmpty}><Text style={styles.emptyText}>No trips match these filters.</Text></View> : null}
      </View>}</>}
    </View>

    <CoreComposer accessory={rootView === "globe" && !selectedPlace && !selectedTrip && selectedCountry && !countryDetailOpen && !cityDetailOpen ? <Button accessibilityLabel={`Reopen ${selectedCountry.name}`} contentMode="raw" onPress={() => openCountryDetail(selectedCountry, "globe", true)} size="sm" style={styles.placeIsland} variant="secondary"><LocationPinIcon size="sm" /><Text numberOfLines={1} style={styles.placeIslandText}>{selectedCountry.name}</Text><ChevronRightIcon size="sm" /></Button> : undefined} accessibilityLabel="Ask Core about saved cities" disabled={assistantBusy} editable={!assistantBusy} leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />} loading={assistantBusy} message={assistantMessage ? <View style={assistantFailed ? styles.inlineError : styles.inlineNotice}><Text style={styles.messageText}>{assistantMessage}</Text></View> : null} onChangeText={(value) => { setAssistantInput(value); assistantRequestKey.current = undefined; }} onFocusChange={handleCoreFocusChange} onSubmit={() => void askAssistant()} prompts={CORE_PROMPTS} sendIcon={<SendIcon size="sm" variant="inverse" />} value={assistantInput} />

    <BottomSheet footer={<View style={styles.sheetFooter}>{!countryAlreadySaved && countryDetail ? <Button disabled={countryImage?.status !== "ready"} onPress={saveCountry} size="md" variant="primary">Save</Button> : null}<Button onPress={() => setCountryDetailOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={setCountryDetailOpen} open={countryDetailOpen} title={selectedCountry?.name ?? "Country"}>
      <ScrollView contentContainerStyle={[styles.sheetContent, countryDetailError && styles.sheetEmptyContent]} keyboardShouldPersistTaps="handled" ref={countryScrollRef} showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}><View style={[styles.countryDetail, countryDetailError && styles.sheetEmptyContent]}>{countryDetailLoading ? <GuideLoading label={`Loading information about ${selectedCountry?.name ?? "country"}`} text="Generating country guide..." /> : countryDetailError ? <View style={styles.countryDetailFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{countryDetailError}</Text></View> : countryDetail ? <><GuideHero detail={countryDetail} image={countryImage?.image} onImageError={() => { if (savedCountryImage) void overviewQuery.refetch(); }} />{detailSource === "globe" ? <><Text style={styles.popularCitiesTitle}>Popular cities</Text><View style={[styles.cityList, styles.countryCityList]}>{countryDetail.popularCities.map((city) => <Button accessibilityLabel={`Open ${city.name}, ${selectedCountry?.name ?? "country"}`} contentMode="raw" key={city.name} onPress={() => { if (selectedCountry) openCityDetail(city, selectedCountry, detailSource); }} size="md" style={[styles.cityPill, styles.sheetSecondary]} variant="secondary"><Text style={styles.cityName}>{city.name}</Text><ChevronRightIcon size="sm" /></Button>)}</View></> : null}</> : null}</View></ScrollView>
    </BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}>{!cityAlreadySaved && cityDetail ? <Button disabled={cityImage?.status !== "ready"} onPress={saveCity} size="md" variant="primary">Save</Button> : null}<Button onPress={() => setCityDetailOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={setCityDetailOpen} open={cityDetailOpen} title={selectedCity?.name ?? "City"}>
      <ScrollView contentContainerStyle={[styles.sheetContent, cityDetailError && styles.sheetEmptyContent]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}><View style={[styles.countryDetail, cityDetailError && styles.sheetEmptyContent]}>{cityDetailLoading ? <GuideLoading label={`Loading information about ${selectedCity?.name ?? "city"}`} text="Generating city guide..." /> : cityDetailError ? <View style={styles.countryDetailFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{cityDetailError}</Text></View> : cityDetail ? <GuideHero detail={cityDetail} image={cityImage?.image} onImageError={() => { if (savedCityImage) void overviewQuery.refetch(); }} /> : null}</View></ScrollView>
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={setActionsOpen} open={actionsOpen} title=""><BottomSheetItem onPress={() => { setActionsOpen(false); updatePlaceSearch(""); delaySheetTransition(() => setCreatePlaceOpen(true)); }} style={styles.sheetAction} variant="secondary">Find place</BottomSheetItem><BottomSheetItem onPress={() => { setActionsOpen(false); setSelectedPlaceKeys([]); setTripName(""); setTripDescription(""); delaySheetTransition(() => setTripSelectionOpen(true)); }} style={styles.sheetAction} variant="secondary">Create trip</BottomSheetItem></BottomSheet>
    <BottomSheet hideHeading onOpenChange={setPlaceBulkMenuOpen} open={placeBulkMenuOpen} title=""><BottomSheetItem onPress={() => updateSelectedPlaces({ status: "visited" })} style={styles.sheetAction} variant="secondary">Mark as visited</BottomSheetItem><BottomSheetItem onPress={() => updateSelectedPlaces({ status: "wishlist" })} style={styles.sheetAction} variant="secondary">Mark as want to go</BottomSheetItem><BottomSheetItem onPress={() => updateSelectedPlaces({ isFavorite: !allSelectedPlacesFavorite })} style={styles.sheetAction} variant="secondary">{allSelectedPlacesFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem></BottomSheet>
    <BottomSheet hideHeading onOpenChange={setPlaceAiMenuOpen} open={placeAiMenuOpen} title="AI actions">{PLACE_REFERENCE_OPTIONS.map((option) => <BottomSheetItem key={option.kind} onPress={() => openPlaceReferences(option.kind)} style={styles.sheetAction} variant="secondary">{option.label}</BottomSheetItem>)}</BottomSheet>
    <BottomSheet hideHeading onOpenChange={setPlaceMenuOpen} open={placeMenuOpen} title=""><BottomSheetItem onPress={() => updateSelectedPlace({ status: selectedPlace?.status === "visited" ? "wishlist" : "visited" }, selectedPlace?.status === "visited" ? "Place marked as want to go" : "Place marked as visited")} style={styles.sheetAction} variant="secondary">{selectedPlace?.status === "visited" ? "Mark as want to go" : "Mark as visited"}</BottomSheetItem><BottomSheetItem onPress={() => updateSelectedPlace({ isFavorite: !selectedPlace?.isFavorite }, selectedPlace?.isFavorite ? "Place unfavorited" : "Place favorited")} style={styles.sheetAction} variant="secondary">{selectedPlace?.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem><BottomSheetItem onPress={() => { setPlaceMenuOpen(false); openSelectedPlaceOnWeb(); }} style={styles.sheetAction} variant="secondary">Web search</BottomSheetItem><BottomSheetItem onPress={openPlaceDelete} style={styles.sheetAction} variant="secondary">Delete</BottomSheetItem></BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button disabled={placeDeleting} onPress={() => void confirmDeletePlace()} size="md" variant="primary">Delete</Button><Button disabled={placeDeleting} onPress={() => setPlaceDeleteOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} onOpenChange={setPlaceDeleteOpen} open={placeDeleteOpen} title="Delete place?" />
    <BottomSheet hideHeading onOpenChange={setTableFilterOpen} open={tableFilterOpen} title=""><View style={styles.filterSheet}>{tableTab === "places" ? <><View style={styles.filterSwitchRow}><Switch accessibilityLabel="Filter by favorite places" checked={placeFavoritesOnly} onCheckedChange={(checked) => { setPlaceFavoritesOnly(checked); setTableFilterOpen(false); }} /><Text style={styles.filterSwitchLabel}>Favorites</Text></View><View style={styles.filterSwitchRow}><Switch accessibilityLabel="Filter by places you want to go" checked={placeStatusFilter === "wishlist"} onCheckedChange={(checked) => { setPlaceStatusFilter(checked ? "wishlist" : "all"); setTableFilterOpen(false); }} /><Text style={styles.filterSwitchLabel}>Want to go</Text></View><View style={styles.filterSwitchRow}><Switch accessibilityLabel="Filter by visited places" checked={placeStatusFilter === "visited"} onCheckedChange={(checked) => { setPlaceStatusFilter(checked ? "visited" : "all"); setTableFilterOpen(false); }} /><Text style={styles.filterSwitchLabel}>Visited</Text></View></> : <><View style={styles.filterSwitchRow}><Switch accessibilityLabel="Filter by favorite trips" checked={tripFavoritesOnly} onCheckedChange={(checked) => { setTripFavoritesOnly(checked); setTableFilterOpen(false); }} /><Text style={styles.filterSwitchLabel}>Favorites</Text></View><View style={styles.filterSwitchRow}><Switch accessibilityLabel="Filter by completed trips" checked={tripCompletedOnly} onCheckedChange={(checked) => { setTripCompletedOnly(checked); setTableFilterOpen(false); }} /><Text style={styles.filterSwitchLabel}>Completed trips</Text></View></>}<Button onPress={() => void openPlaceSearchHistory()} size="md" style={styles.sheetSecondary} variant="secondary">Search history</Button></View></BottomSheet>
    <SearchHistorySheet history={placeSearchHistory} loading={placeHistoryLoading} onClose={closePlaceSearchHistory} onOpenChange={(open) => { if (!open) closePlaceSearchHistory(); }} onRemove={(item) => void removePlaceHistoryQuery(item)} onSelect={applyPlaceHistoryQuery} open={placeHistoryOpen} removingQuery={removingPlaceHistoryQuery} />
    <BottomSheet footer={<Button onPress={() => setFindPlaceOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button>} height="full" onOpenChange={setFindPlaceOpen} open={createPlaceOpen} title="Find place">
      <View style={styles.createPlaceContent}><View style={styles.workspaceSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search places" maxLength={500} onChangeText={updatePlaceSearch} placeholder="Search any country or city..." ref={placeSearchInput} style={styles.workspaceSearchInput} value={placeSearchQuery} />{placeSearchQuery.trim() ? <Button accessibilityLabel="Clear place search" contentMode="raw" iconOnly onPress={() => updatePlaceSearch("")} size="md" style={[styles.sheetSearchClear, styles.sheetSecondary]} variant="secondary"><CloseIcon size="sm" /></Button> : null}</View><ScrollView accessibilityLabel={placeSearchLoading ? "Searching places" : `${placeSearchResults.length} places found`} accessibilityLiveRegion="polite" accessibilityState={{ busy: placeSearchLoading }} contentContainerStyle={[styles.cityList, !placeSearchLoading && placeSearchQuery.trim().length >= 2 && placeSearchResults.length === 0 && styles.sheetEmptyContent]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}>{placeSearchLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.cityPillSkeleton} />) : placeSearchResults.map((result) => <Button accessibilityLabel={`Open ${result.name}, ${result.country}`} contentMode="raw" key={`${result.kind}-${result.countryCode}-${normalizePlaceName(result.name)}`} onPress={() => openSearchResult(result)} size="md" style={[styles.cityPill, styles.sheetSecondary]} variant="secondary"><Text numberOfLines={1} style={styles.cityName}>{result.name}</Text><ChevronRightIcon size="sm" /></Button>)}{!placeSearchLoading && placeSearchQuery.trim().length >= 2 && placeSearchResults.length === 0 ? <Text style={styles.emptyText}>No places found.</Text> : null}</ScrollView></View>
    </BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button disabled={selectedPlaceKeys.length === 0 || selectedPlaceKeys.some((key) => key.startsWith("optimistic-"))} onPress={advanceTripCreation} size="md" variant="primary">Next</Button><Button onPress={() => setTripSelectionOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={setTripSelectionOpen} open={tripSelectionOpen} title="Choose places">
      <ScrollView accessibilityLabel="Places available for this trip" accessibilityLiveRegion="polite" accessibilityState={{ busy: overviewQuery.isPending }} contentContainerStyle={[styles.cardGrid, !overviewQuery.isPending && (Boolean(loadError) || places.length === 0) && styles.emptyGrid]} onLayout={({ nativeEvent }) => setTripGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>{overviewQuery.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.squareCard, { width: tripCardSize, height: tripCardSize }]} />) : loadError ? <QueryFailure message={loadError} onRetry={() => void overviewQuery.refetch()} /> : places.map((place) => { const saving = place.key.startsWith("optimistic-"); return <PlaceCard cardSize={tripCardSize} disabled={saving} key={place.key} onPress={() => toggleTripPlace(place.key)} place={place} selectable selected={selectedPlaceKeys.includes(place.key)} />; })}{!overviewQuery.isPending && !loadError && places.length === 0 ? <Text style={styles.emptyText}>Save a place before creating a trip.</Text> : null}</ScrollView>
    </BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button onPress={advanceTripOrder} size="md" variant="primary">Next</Button><Button onPress={() => setTripOrderOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={setTripOrderOpen} open={tripOrderOpen} title="Order Places">
      {selectedOrderPlaceKeys.length ? <OrderBulkToolbar count={selectedOrderPlaceKeys.length} onClear={() => setSelectedOrderPlaceKeys([])} onRemove={() => setOrderRemoveOpen(true)} /> : null}
      <ScrollView accessibilityLabel="Order trip places" contentContainerStyle={styles.orderList} ref={orderScrollRef} showsVerticalScrollIndicator={false}>{orderedPlaces.map((place, index) => { const selected = selectedOrderPlaceKeys.includes(place.key); return <View key={place.key} style={[styles.orderPill, selected && styles.outlineSelected]}><Button accessibilityActions={[{ name: "longpress", label: selected ? `Deselect ${place.name}` : `Select ${place.name}` }]} accessibilityLabel={place.name} accessibilityState={{ selected }} contentMode="raw" onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") handleOrderLongPress(place.key); }} onLongPress={() => handleOrderLongPress(place.key)} onPress={() => { if (selectedOrderPlaceKeys.length) toggleOrderSelection(place.key); }} shape="pill" size="md" style={styles.orderMain} variant="ghost">{place.coverUrl ? <Image contentFit="cover" source={place.coverUrl} style={styles.orderHero} /> : <View style={styles.orderHeroFallback}><LocationPinIcon size="sm" /></View>}<Text numberOfLines={1} style={styles.orderName}>{place.name}</Text></Button><View style={styles.orderButtons}><Button accessibilityLabel={`Move ${place.name} up`} contentMode="raw" iconOnly onPress={() => moveOrderPlace(index, "up")} size="md" style={[styles.orderControl, styles.sheetSecondary]} variant="secondary"><ChevronUpIcon size="sm" /></Button><Button accessibilityLabel={`Move ${place.name} down`} contentMode="raw" iconOnly onPress={() => moveOrderPlace(index, "down")} size="md" style={[styles.orderControl, styles.sheetSecondary]} variant="secondary"><ChevronDownIcon size="sm" /></Button></View></View>; })}</ScrollView>
    </BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button disabled={!tripName.trim()} onPress={submitTrip} size="md" variant="primary">Create</Button><Button onPress={() => setTripDetailsOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={setTripDetailsOpen} open={tripDetailsOpen} title="Name trip"><View style={styles.namingForm}><Text style={styles.inputLabel}>Trip name</Text><TextInput accessibilityLabel="Trip name" autoFocus maxLength={255} onChangeText={setTripName} placeholder="Trip name" value={tripName} /><Text style={styles.inputLabel}>Description (Optional)</Text><TextInput accessibilityLabel="Trip description" maxLength={10000} multiline onChangeText={setTripDescription} placeholder="What belongs in this trip?" style={styles.tripDescriptionInput} textAlignVertical="top" value={tripDescription} /></View></BottomSheet>

    <BottomSheet footer={<View style={styles.sheetFooter}><Button onPress={removeSelectedOrderPlaces} size="md" variant="primary">Remove</Button><Button onPress={() => setOrderRemoveOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} onOpenChange={setOrderRemoveOpen} open={orderRemoveOpen} title="Remove places?" />
    <BottomSheet footer={<Button onPress={() => setTripBulkMenuOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button>} onOpenChange={setTripBulkMenuOpen} open={tripBulkMenuOpen} title="Selected places"><BottomSheetItem onPress={() => { setTripBulkMenuOpen(false); delaySheetTransition(() => setTripRemoveOpen(true)); }} style={styles.sheetAction} variant="secondary">Remove</BottomSheetItem></BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button onPress={removeTripPlaces} size="md" variant="primary">Remove</Button><Button onPress={() => setTripRemoveOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} onOpenChange={setTripRemoveOpen} open={tripRemoveOpen} title="Remove places?" />

    <BottomSheet hideHeading onOpenChange={setTripMenuOpen} open={tripMenuOpen} title=""><BottomSheetItem onPress={openTripEdit} style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem><BottomSheetItem onPress={toggleTripCompleted} style={styles.sheetAction} variant="secondary">{selectedTrip?.status === "completed" ? "Mark as planned" : "Mark as completed"}</BottomSheetItem><BottomSheetItem onPress={openAssets} style={styles.sheetAction} variant="secondary">Show assets</BottomSheetItem><BottomSheetItem onPress={() => { setTripMenuOpen(false); delaySheetTransition(() => setTripDeleteOpen(true)); }} style={styles.sheetAction} variant="secondary">Delete</BottomSheetItem></BottomSheet>
    <BottomSheet hideHeading onOpenChange={setTripAddMenuOpen} open={tripAddMenuOpen} title=""><BottomSheetItem onPress={openTripAddPlaces} style={styles.sheetAction} variant="secondary">Add places</BottomSheetItem></BottomSheet>
    <BottomSheet hideHeading onOpenChange={setTripAiMenuOpen} open={tripAiMenuOpen} title=""><BottomSheetItem onPress={openTripGuides} style={styles.sheetAction} variant="secondary">Travel guides</BottomSheetItem></BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button disabled={selectedTripAddPlaceKeys.length === 0 || selectedTripAddPlaceKeys.some((key) => key.startsWith("optimistic-"))} onPress={addSelectedTripPlaces} size="md" variant="primary">Add places</Button><Button onPress={() => setTripAddPlacesOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={setTripAddPlacesOpen} open={tripAddPlacesOpen} title="Choose places">
      <ScrollView accessibilityLabel="Places available to add to this trip" accessibilityLiveRegion="polite" accessibilityState={{ busy: overviewQuery.isPending }} contentContainerStyle={[styles.cardGrid, !overviewQuery.isPending && (Boolean(loadError) || availableTripAddPlaces.length === 0) && styles.emptyGrid]} onLayout={({ nativeEvent }) => setTripGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>{overviewQuery.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.squareCard, { width: tripCardSize, height: tripCardSize }]} />) : loadError ? <QueryFailure message={loadError} onRetry={() => void overviewQuery.refetch()} /> : availableTripAddPlaces.map((place) => { const saving = place.key.startsWith("optimistic-"); return <PlaceCard cardSize={tripCardSize} disabled={saving} key={place.key} onPress={() => toggleTripAddPlace(place.key)} place={place} selectable selected={selectedTripAddPlaceKeys.includes(place.key)} />; })}{!overviewQuery.isPending && !loadError && availableTripAddPlaces.length === 0 ? <Text style={styles.emptyText}>All saved places are already in this trip.</Text> : null}</ScrollView>
    </BottomSheet>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button onPress={confirmDeleteTrip} size="md" variant="primary">Delete</Button><Button onPress={() => setTripDeleteOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} onOpenChange={setTripDeleteOpen} open={tripDeleteOpen} title="Delete trip?" />
    <BottomSheet footer={<View style={styles.sheetFooter}><Button disabled={!editTripName.trim()} onPress={saveTripEdit} size="md" variant="primary">Save</Button><Button onPress={() => setTripEditOpen(false)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={setTripEditOpen} open={tripEditOpen} title="Edit trip"><ScrollView contentContainerStyle={styles.tripDetailsForm} ref={orderScrollRef} showsVerticalScrollIndicator={false} style={styles.fullSheetScroll}><TextInput accessibilityLabel="Trip name" maxLength={255} onChangeText={setEditTripName} placeholder="Trip name" value={editTripName} /><Text style={styles.inputLabel}>Description (Optional)</Text><TextInput accessibilityLabel="Trip description" maxLength={10000} multiline onChangeText={setEditTripDescription} placeholder="What belongs in this trip?" style={styles.tripDescriptionInput} textAlignVertical="top" value={editTripDescription} /><View style={styles.tripDetailsCoverControl}><Button accessibilityLabel={(editTripCover === undefined ? selectedTrip?.coverUrl : editTripCover?.uri) ? "Change trip cover" : "Set trip cover"} contentMode="raw" onPress={() => void chooseTripCover()} shape="rounded" size="md" style={styles.tripDetailsCoverButton} variant="secondary">{(editTripCover === undefined ? selectedTrip?.coverUrl : editTripCover?.uri) ? <Image contentFit="cover" source={editTripCover === undefined ? selectedTrip?.coverUrl : editTripCover?.uri} style={styles.tripCover} /> : <GlobeIcon size="lg" />}</Button>{(editTripCover === undefined ? selectedTrip?.coverUrl : editTripCover?.uri) ? <Button accessibilityLabel="Remove trip cover" contentMode="raw" onPress={() => setEditTripCover(null)} size="md" style={styles.tripDetailsCoverRemove} variant="secondary"><CloseIcon size="sm" /></Button> : null}</View><View style={styles.switchRow}><Switch accessibilityLabel="Favorite trip" checked={editTripFavorite} onCheckedChange={setEditTripFavorite} /><Text style={styles.inputLabel}>Favorite</Text></View><Text style={styles.inputLabel}>Place order</Text><View style={styles.editOrderList}>{editOrderedPlaces.map((place, index) => <View key={place.key} style={styles.orderPill}><View style={[styles.orderMain, styles.editOrderMain]}>{place.coverUrl ? <Image contentFit="cover" source={place.coverUrl} style={styles.orderHero} /> : <View style={styles.orderHeroFallback}><LocationPinIcon size="sm" /></View>}<Text numberOfLines={1} style={styles.orderName}>{place.name}</Text></View><View style={styles.orderButtons}><Button accessibilityLabel={`Move ${place.name} up`} contentMode="raw" iconOnly onPress={() => moveOrderPlace(index, "up")} size="md" style={[styles.orderControl, styles.sheetSecondary]} variant="secondary"><ChevronUpIcon size="sm" /></Button><Button accessibilityLabel={`Move ${place.name} down`} contentMode="raw" iconOnly onPress={() => moveOrderPlace(index, "down")} size="md" style={[styles.orderControl, styles.sheetSecondary]} variant="secondary"><ChevronDownIcon size="sm" /></Button></View></View>)}</View></ScrollView></BottomSheet>

    <BottomSheet description="Press and hold to edit linked assets." footer={<View style={styles.sheetFooter}><Button onPress={saveAssetAttachments} size="md" variant="primary">Save</Button><Button onPress={closeAssets} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={(open) => { if (!open) closeAssets(); }} open={assetsOpen} title="Show Assets"><Tabs accessibilityLabel="Trip asset categories" accessibilityRole="tablist" role="tablist" style={styles.assetTabs}><Button accessibilityRole="tab" accessibilityState={{ selected: assetTab === "folders" }} onPress={() => setAssetTab("folders")} size="md" style={[styles.assetTab, assetTab === "folders" && styles.sheetSecondary]} textStyle={styles.assetTabText} variant={assetTab === "folders" ? "secondary" : "ghost"}>Folders</Button><Button accessibilityRole="tab" accessibilityState={{ selected: assetTab === "collections" }} onPress={() => setAssetTab("collections")} size="md" style={[styles.assetTab, assetTab === "collections" && styles.sheetSecondary]} textStyle={styles.assetTabText} variant={assetTab === "collections" ? "secondary" : "ghost"}>Collections</Button></Tabs><ScrollView accessibilityLabel={assetTab === "folders" ? "Trip asset folders" : "Trip asset collections"} contentContainerStyle={styles.assetGrid} onLayout={({ nativeEvent }) => setAssetGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>{assetsLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.assetCard, { width: assetCardSize, height: assetCardSize }]} />) : assetTab === "folders" ? assetFolders.map((folder) => { const attachment = { type: "folder" as const, key: folder.key }; const selected = selectedAssetAttachments.some(({ type, key }) => type === attachment.type && key === attachment.key); return <AssetCard coverUrl={folder.coverUrl} key={folder.key} name={folder.name} onLongPress={() => handleAssetLongPress(attachment)} onPress={() => openAsset(attachment)} selected={selected} size={assetCardSize} />; }) : assetCollections.map((collection) => { const attachment = { type: "collection" as const, key: collection.key }; const selected = selectedAssetAttachments.some(({ type, key }) => type === attachment.type && key === attachment.key); return <AssetCard coverUrl={collection.coverUrl ?? undefined} key={collection.key} name={collection.name} onLongPress={() => handleAssetLongPress(attachment)} onPress={() => openAsset(attachment)} selected={selected} size={assetCardSize} />; })}</ScrollView></BottomSheet>

    <GeneratedDocumentSheets appendGeneration createLabel="Request new" documents={placeReferencesQuery.data} emptyMessage={`No ${PLACE_REFERENCE_OPTIONS.find((option) => option.kind === placeReferenceKind)?.label.toLocaleLowerCase() ?? "references"} yet. Request one for this place.`} error={placeReferencesQuery.error} generating={placeReferenceGenerating} label={PLACE_REFERENCE_OPTIONS.find((option) => option.kind === placeReferenceKind)?.label ?? "References"} loading={placeReferencesQuery.isPending} onClose={closePlaceReferences} onCreate={() => void createPlaceReference()} onDetailClose={() => setSelectedPlaceReference(undefined)} onOpen={setSelectedPlaceReference} onRetry={() => void placeReferencesQuery.refetch()} open={placeReferencesOpen} selected={currentPlaceReference} singularLabel={PLACE_REFERENCE_OPTIONS.find((option) => option.kind === placeReferenceKind)?.singular}>{currentPlaceReference && selectedPlace ? <GeneratedDocumentDetail document={currentPlaceReference} hero={<PlaceReferenceHero onImageError={() => void overviewQuery.refetch()} place={selectedPlace} />} /> : null}</GeneratedDocumentSheets>

    <GeneratedDocumentSheets appendGeneration createLabel="Request new" documents={tripGuidesQuery.data} emptyMessage="No travel guides yet. Request one for this trip." error={tripGuidesQuery.error} generating={tripGuideGenerating} label="Travel guides" loading={tripGuidesQuery.isPending} onClose={closeTripGuides} onCreate={() => void createTripGuide()} onDetailClose={() => setSelectedTripGuide(undefined)} onOpen={setSelectedTripGuide} onRetry={() => void tripGuidesQuery.refetch()} open={tripGuidesOpen} selected={currentTripGuide}>{currentTripGuide ? <GeneratedDocumentDetail document={currentTripGuide} hero={<TripGuideHero places={selectedTrip?.places ?? []} />} /> : null}</GeneratedDocumentSheets>

    <BottomSheet footer={<Button onPress={() => setImageViewerKey(undefined)} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { if (!open) setImageViewerKey(undefined); }} onSwipeLeft={tripImages.length > 1 ? () => focusTripImage(1) : undefined} onSwipeRight={tripImages.length > 1 ? () => focusTripImage(-1) : undefined} open={Boolean(imageViewer)} pageKey={imageViewer?.key} title={imageViewer?.title ?? "Image"}>{imageViewer ? <View style={styles.viewerContent}><View accessibilityActions={tripImages.length > 1 ? [{ name: "decrement", label: "Previous image" }, { name: "increment", label: "Next image" }] : undefined} accessibilityLabel={`${imageViewer.title} trip image`} accessibilityRole="adjustable" accessibilityValue={{ text: `${imageViewerIndex + 1} of ${tripImages.length}` }} onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "decrement") focusTripImage(-1); if (nativeEvent.actionName === "increment") focusTripImage(1); }} style={styles.viewerFrame}><Image contentFit="contain" source={imageViewer.url} style={styles.viewerImage} /></View></View> : null}</BottomSheet>
  </KeyboardAvoidingView>;
}

function PlaceCard({ accessibilityLongPress = false, cardSize, disabled = false, onLongPress, onPress, place, selectable = false, selected = false }: { accessibilityLongPress?: boolean; cardSize?: number; disabled?: boolean; onLongPress?: () => void; onPress: () => void; place: Place; selectable?: boolean; selected?: boolean }) {
  return <View style={[styles.squareCard, selected && styles.squareCardSelected, { width: cardSize, height: cardSize }]}>{place.coverUrl ? <Image cachePolicy="memory-disk" contentFit="cover" priority="high" source={{ uri: place.coverUrl, cacheKey: `compass-place-cover:${place.key}` }} style={StyleSheet.absoluteFill} /> : null}<Button accessibilityActions={accessibilityLongPress ? [{ name: "longpress", label: selected ? `Deselect ${place.name}` : `Select ${place.name}` }] : undefined} accessibilityLabel={`${disabled ? "Saving" : selectable ? selected ? "Deselect" : "Select" : "Open"} ${place.name}, ${place.status === "wishlist" ? "want to go" : "visited"}${place.isFavorite ? ", favorite" : ""}`} accessibilityState={selectable ? { disabled, selected } : undefined} contentMode="raw" disabled={disabled} onAccessibilityAction={accessibilityLongPress ? ({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") onLongPress?.(); } : undefined} onLongPress={onLongPress} onPress={onPress} shape="rounded" size="md" style={[styles.cardMain, place.coverUrl && styles.coveredCardMain]} variant="ghost">{place.coverUrl ? null : place.kind === "country" ? <GlobeIcon size="lg" /> : <LocationPinIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.cardLabel, place.coverUrl && styles.coveredCardLabel]}>{place.name}</Text></Button>{place.isFavorite || place.status === "visited" ? <View pointerEvents="none" style={styles.stateBadges}>{place.isFavorite ? <StarIcon size="sm" variant="accent" /> : null}{place.status === "visited" ? <CheckIcon size="sm" variant="accent" /> : null}</View> : null}{selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View>;
}

function TripPlaceArc({ onFocus, onOpen, places, selectedKey }: { onFocus: (key: string) => void; onOpen: (place: Place) => void; places: Place[]; selectedKey?: string }) {
  const selectedIndex = Math.max(0, places.findIndex(({ key }) => key === selectedKey));
  const focusBy = (offset: number) => {
    const place = places[(selectedIndex + offset + places.length) % places.length];
    if (place) onFocus(place.key);
  };
  const panResponder = useMemo(() => {
    const focus = (offset: number) => {
      const place = places[(selectedIndex + offset + places.length) % places.length];
      if (place) onFocus(place.key);
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderRelease: (_event, gesture) => { if (Math.abs(gesture.dx) >= 32) focus(gesture.dx > 0 ? -1 : 1); },
    });
  }, [onFocus, places, selectedIndex]);
  if (!places.length) return <View accessibilityLabel="Trip has no places" style={styles.tripPlaceArc}><Text style={styles.emptyText}>No places in this trip.</Text></View>;
  const slots = [-1, 0, 1].map((offset) => ({ offset, place: places[(selectedIndex + offset + places.length) % places.length]! }));
  return <View accessibilityLabel="Trip places on globe" style={styles.tripPlaceArc}><View style={styles.tripPlaceArcContent}><Button accessibilityLabel="Previous place" contentMode="raw" iconOnly onPress={() => focusBy(-1)} size="xs" style={styles.tripPlaceArcArrow} variant="secondary"><ChevronLeftIcon size="sm" /></Button><View style={styles.tripPlaceArcCards} {...panResponder.panHandlers}>{slots.map(({ offset, place }, slotIndex) => <Button accessibilityLabel={`Open ${place.name}`} accessibilityState={{ selected: offset === 0 }} contentMode="raw" key={`${offset}-${place.key}`} onPress={() => onOpen(place)} shape="rounded" size="xs" style={[styles.tripPlaceArcCard, place.coverUrl && styles.coveredCardMain, slotIndex > 0 && styles.tripPlaceArcOverlap, offset === 0 ? styles.tripPlaceArcCardCenter : styles.tripPlaceArcCardSide]} variant="secondary">{place.coverUrl ? <Image contentFit="cover" source={place.coverUrl} style={StyleSheet.absoluteFill} /> : <Image contentFit="contain" source={capabilityIconSource.compass} style={styles.tripPlaceArcLogo} />}<Text numberOfLines={1} style={[styles.cardLabel, place.coverUrl && styles.coveredCardLabel]}>{place.name}</Text></Button>)}</View><Button accessibilityLabel="Next place" contentMode="raw" iconOnly onPress={() => focusBy(1)} size="xs" style={styles.tripPlaceArcArrow} variant="secondary"><ChevronRightIcon size="sm" /></Button></View></View>;
}

function QueryFailure({ message, onRetry, sheet = false }: { message: string; onRetry: () => void; sheet?: boolean }) {
  return <View accessibilityRole="alert" style={styles.tableFailure}><Text style={styles.loadFailureText}>{message}</Text><Button onPress={onRetry} size={sheet ? "md" : "sm"} variant="secondary">Retry</Button></View>;
}

function TripCard({ cardSize, onPress, trip }: { cardSize?: number; onPress: () => void; trip: Trip }) {
  return <View style={[styles.squareCard, { width: cardSize, height: cardSize }]}>{trip.coverUrl ? <Image contentFit="cover" source={trip.coverUrl} style={StyleSheet.absoluteFill} /> : null}<Button accessibilityLabel={`Open ${trip.name}, ${trip.status}${trip.isFavorite ? ", favorite" : ""}`} contentMode="raw" onPress={onPress} shape="rounded" size="md" style={[styles.cardMain, trip.coverUrl && styles.coveredCardMain]} variant="ghost">{trip.coverUrl ? null : <GlobeIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.cardLabel, trip.coverUrl && styles.coveredCardLabel]}>{trip.name}</Text></Button>{trip.isFavorite ? <View pointerEvents="none" style={styles.stateBadges}><StarIcon size="sm" variant="accent" /></View> : null}</View>;
}

function BulkToolbar({ count, onClear, onMore }: { count: number; onClear: () => void; onMore: () => void }) {
  return <Tabs accessibilityLabel="Bulk selection toolbar" style={styles.bulkToolbar}><View style={styles.bulkToolbarSelection}><Button accessibilityLabel="Clear selection" contentMode="raw" onPress={onClear} size="xs" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.bulkSelectionText}>{count} selected</Text></View><Button accessibilityLabel="Selected item actions" contentMode="raw" onPress={onMore} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button></Tabs>;
}

function OrderBulkToolbar({ count, onClear, onRemove }: { count: number; onClear: () => void; onRemove: () => void }) {
  return <Tabs accessibilityLabel="Selected trip places" style={styles.bulkToolbar}><View style={styles.bulkToolbarSelection}><Button accessibilityLabel="Clear place selection" contentMode="raw" onPress={onClear} size="md" style={[styles.bulkToolbarClose, styles.sheetSecondary]} variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.bulkSelectionText}>{count} selected</Text></View><Button onPress={onRemove} size="md" style={[styles.bulkRemoveAction, styles.sheetSecondary]} textStyle={styles.bulkRemoveText} variant="secondary">Remove</Button></Tabs>;
}

function AssetCard({ coverUrl, name, onLongPress, onPress, selected, size }: { coverUrl?: string; name: string; onLongPress: () => void; onPress: () => void; selected: boolean; size: number }) {
  return <View style={[styles.assetCard, selected && styles.squareCardSelected, { width: size, height: size }]}>{coverUrl ? <Image contentFit="cover" source={coverUrl} style={StyleSheet.absoluteFill} /> : null}<Button accessibilityActions={[{ name: "longpress", label: selected ? `Unlink ${name}` : `Link ${name}` }]} accessibilityLabel={`Open ${name}`} accessibilityState={{ selected }} contentMode="raw" onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") onLongPress(); }} onLongPress={onLongPress} onPress={onPress} shape="rounded" size="md" style={[styles.cardMain, coverUrl && styles.coveredCardMain]} variant="ghost">{coverUrl ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.cardLabel, coverUrl && styles.coveredCardLabel]}>{name}</Text></Button>{selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View>;
}

function TripGuideHero({ places }: { places: Place[] }) {
  const images = places.flatMap(({ coverUrl, name }) => coverUrl ? [{ coverUrl, name }] : []).slice(0, 4);
  return images.length ? <View accessibilityLabel="Trip place collage" style={[styles.tripGuideCollage, images.length === 2 && styles.tripGuideCollageTwo]}>{images.map(({ coverUrl, name }, index) => <Image accessibilityLabel={name} contentFit="cover" key={`${coverUrl}-${index}`} source={coverUrl} style={[styles.tripGuideCollageImage, images.length === 1 && styles.tripGuideCollageImageSingle, images.length === 2 && styles.tripGuideCollageImageTwo, images.length === 3 && index === 2 && styles.tripGuideCollageImageWide]} />)}</View> : null;
}

function PlaceReferenceHero({ onImageError, place }: { onImageError: () => void; place: Place }) {
  return place.coverUrl ? <Image accessibilityLabel={place.name} contentFit="cover" onError={onImageError} source={place.coverUrl} style={styles.placeReferenceHero} /> : <View accessibilityLabel={place.name} style={styles.placeReferenceHeroFallback}>{place.kind === "country" ? <GlobeIcon size="lg" /> : <LocationPinIcon size="lg" />}</View>;
}

function GeneratedDocumentDetail({ document, hero }: { document: GeneratedDocument; hero?: ReactNode }) {
  const sections = formatGuideContent(document.content);
  return <ScrollView accessibilityLabel={document.name} contentContainerStyle={styles.tripGuideDetail} showsVerticalScrollIndicator={false}>{hero}<Text style={styles.tripGuideDate}>{formatGuideDate(document.updatedAt)}</Text><View style={styles.tripGuideSections}>{sections.map((section, index) => <View key={`${section.heading ?? "section"}-${index}`} style={styles.tripGuideSection}>{section.heading ? <Text style={styles.tripGuideHeading}>{section.heading}</Text> : null}<GuideMarkdownBody body={section.body} /></View>)}</View></ScrollView>;
}

function GuideMarkdownBody({ body }: { body: string }) {
  return <View style={styles.tripGuideBody}>{formatGuideBody(body).map((line, lineIndex) => line.runs.length || line.marker ? <View key={lineIndex} style={styles.tripGuideBodyLine}>{line.marker ? <Text style={styles.tripGuideMarker}>{line.marker}</Text> : null}<Text style={styles.tripGuideBodyText}>{line.runs.map((run, runIndex) => <Text key={runIndex} style={guideRunStyle(run)}>{run.text}</Text>)}</Text></View> : <View key={lineIndex} style={styles.tripGuideParagraphGap} />)}</View>;
}

function guideRunStyle(run: GuideTextRun) {
  if (run.style === "strong") return styles.tripGuideStrong;
  if (run.style === "emphasis") return styles.tripGuideEmphasis;
  if (run.style === "code") return styles.tripGuideCode;
  if (run.style === "strikethrough") return styles.tripGuideStrikethrough;
  return undefined;
}

function GeneratedDocumentSheets<T extends GeneratedDocument>({ appendGeneration = false, children, createLabel = "Create new", documents, emptyMessage, error, generating, label, loading, onClose, onCreate, onDetailClose, onOpen, onRetry, open, selected, singularLabel }: { appendGeneration?: boolean; children?: ReactNode; createLabel?: string; documents?: T[]; emptyMessage: string; error: unknown; generating: boolean; label: string; loading: boolean; onClose: () => void; onCreate: () => void; onDetailClose: () => void; onOpen: (document: T) => void; onRetry: () => void; open: boolean; selected?: T; singularLabel?: string }) {
  const { showToast } = useToast();
  const [selectedDocumentKeys, setSelectedDocumentKeys] = useState<string[]>([]);
  const [removedDocumentKeys, setRemovedDocumentKeys] = useState<string[]>([]);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const longPressedDocument = useRef<string | undefined>(undefined);
  const singular = singularLabel ?? (label.endsWith("s") ? label.slice(0, -1) : label);
  const closeDetail = selected ? onDetailClose : onClose;
  const visibleDocuments = documents?.filter(({ key }) => !removedDocumentKeys.includes(key));
  const activeSelectedKeys = selectedDocumentKeys.filter((key) => visibleDocuments?.some((document) => document.key === key));
  const toggleSelection = (key: string) => setSelectedDocumentKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  const handleLongPress = (key: string) => {
    if (!appendGeneration) return;
    longPressedDocument.current = key;
    setTimeout(() => { if (longPressedDocument.current === key) longPressedDocument.current = undefined; }, 50);
    toggleSelection(key);
    void Haptics.selectionAsync();
  };
  const handlePress = (document: T) => {
    const longPress = longPressedDocument.current;
    longPressedDocument.current = undefined;
    if (longPress === document.key) return;
    if (appendGeneration && activeSelectedKeys.length) toggleSelection(document.key);
    else onOpen(document);
  };
  const closeList = () => { setSelectedDocumentKeys([]); setRemoveConfirmOpen(false); onClose(); };
  const removeSelected = async () => {
    if (!appendGeneration || activeSelectedKeys.length === 0) return;
    const keys = [...activeSelectedKeys];
    setRemoving(true);
    try {
      const outcomes = await Promise.allSettled(keys.map((key) => deleteContentDocument(key)));
      const removed = keys.filter((_, index) => outcomes[index]?.status === "fulfilled");
      const failed = keys.filter((_, index) => outcomes[index]?.status === "rejected");
      setRemovedDocumentKeys((current) => [...new Set([...current, ...removed])]);
      setSelectedDocumentKeys(failed);
      setRemoveConfirmOpen(false);
      if (removed.length) showToast({ title: removed.length === 1 ? `${singular} removed` : `${removed.length} ${label.toLocaleLowerCase()} removed`, duration: 2_000 });
      if (failed.length) showToast({ title: failed.length === 1 ? `${singular} could not be removed` : `${failed.length} ${label.toLocaleLowerCase()} could not be removed`, duration: 2_000 });
      onRetry();
    } finally {
      setRemoving(false);
    }
  };
  return <>
    <BottomSheet footer={<View style={styles.sheetFooter}><Button disabled={generating || removing} onPress={onCreate} size="md" variant="primary">{createLabel}</Button><Button disabled={generating || removing} onPress={closeList} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen && open && !generating && !selected) closeList(); }} open={open && (!generating || appendGeneration)} title={label}>
      <ScrollView accessibilityLabel={label} accessibilityLiveRegion="polite" accessibilityState={{ busy: loading || generating || removing }} contentContainerStyle={[styles.tripGuideList, !loading && !generating && (Boolean(error) || !visibleDocuments?.length) && styles.tripGuideEmpty]} showsVerticalScrollIndicator={false}>{activeSelectedKeys.length ? <Tabs style={styles.bulkToolbar}><View style={styles.bulkToolbarSelection}><Button accessibilityLabel="Clear reference selection" contentMode="raw" disabled={removing} onPress={() => setSelectedDocumentKeys([])} size="md" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.bulkSelectionText}>{activeSelectedKeys.length} selected</Text></View><Button disabled={removing} onPress={() => setRemoveConfirmOpen(true)} size="md" style={styles.bulkRemoveAction} textStyle={styles.bulkRemoveText} variant="secondary">Remove</Button></Tabs> : null}{loading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.tripGuidePillSkeleton} />) : error ? <QueryFailure message={errorMessage(error)} onRetry={onRetry} sheet /> : visibleDocuments?.map((document) => { const documentSelected = activeSelectedKeys.includes(document.key); return <Button accessibilityActions={appendGeneration ? [{ name: "longpress", label: documentSelected ? `Deselect ${document.name}` : `Select ${document.name}` }] : undefined} accessibilityLabel={activeSelectedKeys.length ? `${documentSelected ? "Deselect" : "Select"} ${document.name}` : `Open ${document.name}`} accessibilityState={appendGeneration ? { selected: documentSelected } : undefined} contentMode="raw" disabled={removing} key={document.key} onAccessibilityAction={appendGeneration ? ({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") toggleSelection(document.key); } : undefined} onLongPress={appendGeneration ? () => handleLongPress(document.key) : undefined} onPress={() => handlePress(document)} shape="pill" size="md" style={[styles.tripGuidePill, styles.sheetSecondary, documentSelected && styles.tripGuidePillSelected]} variant="secondary"><Text ellipsizeMode="tail" numberOfLines={1} style={styles.tripGuidePillName}>{document.name}</Text><View style={styles.tripGuidePillAccessory}><ChevronRightIcon size="sm" /></View></Button>; })}{appendGeneration && !loading && generating ? <Skeleton accessibilityLabel={`Generating ${singular.toLocaleLowerCase()}`} accessibilityRole="progressbar" style={styles.tripGuidePillSkeleton} /> : null}{!loading && !generating && !error && !visibleDocuments?.length ? <Text style={styles.emptyText}>{emptyMessage}</Text> : null}</ScrollView>
    </BottomSheet>
    <BottomSheet footer={<Button onPress={closeDetail} size="md" style={styles.sheetSecondary} variant="secondary">Close</Button>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen && open && ((!appendGeneration && generating) || selected)) closeDetail(); }} open={open && ((!appendGeneration && generating) || Boolean(selected))} title={generating && !appendGeneration ? `Creating ${singular.toLocaleLowerCase()}` : selected?.name ?? singular}>
      {generating && !appendGeneration ? <View accessibilityLabel={`Generating ${singular.toLocaleLowerCase()}`} accessibilityRole="progressbar" style={styles.tripGuideGenerationLoading}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.tripGuidePillSkeleton} />)}</View> : children}
    </BottomSheet>
    <BottomSheet dismissible={!removing} onOpenChange={(nextOpen) => { if (!nextOpen) setRemoveConfirmOpen(false); }} open={open && appendGeneration && activeSelectedKeys.length > 0 && removeConfirmOpen} title={`Remove ${activeSelectedKeys.length === 1 ? singular.toLocaleLowerCase() : `${activeSelectedKeys.length} ${label.toLocaleLowerCase()}`}?`}><View style={styles.sheetFooter}><Button disabled={removing} loading={removing} onPress={() => void removeSelected()} size="md" variant="primary">Remove</Button><Button disabled={removing} onPress={() => setRemoveConfirmOpen(false)} size="md" variant="secondary">Close</Button></View></BottomSheet>
  </>;
}

function GuideLoading({ label, text }: { label: string; text: string }) {
  return <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.countryDetailSkeleton}><LoadingText text={text} /><Skeleton style={[styles.skeletonBlock, styles.skeletonHero]} /><Skeleton style={[styles.skeletonBlock, styles.skeletonText]} /></View>;
}

function GuideHero({ detail, image, onImageError }: { detail: Pick<CityDetail, "summary" | "culture" | "food" | "whyVisit">; image?: PlaceImageResponse["image"]; onImageError: () => void }) {
  const sections = [["summary", detail.summary], ["culture", detail.culture], ["food", detail.food], ["whyVisit", detail.whyVisit]] as const;
  return <View accessibilityLabel={image ? "Destination hero" : "Generating destination hero"} accessibilityRole={!image ? "progressbar" : undefined} style={styles.guideHero}>{!image ? <LoadingText text="Generating image..." /> : null}<PlaceImageFrame image={image} key={image?.url ?? "hero"} onError={onImageError} /><View style={styles.guideSections}>{sections.map(([key, section]) => <Text key={key} style={styles.guideText}>{section}</Text>)}</View></View>;
}

function PlaceImageFrame({ image, onError }: { image?: PlaceImageResponse["image"]; onError: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return <View style={styles.imageFrame}>{image ? <Image accessibilityLabel={image.title} cachePolicy="none" contentFit="cover" onError={() => { setLoaded(false); onError(); }} onLoad={() => setLoaded(true)} source={{ uri: image.url }} style={styles.placeImage} transition={250} /> : null}{!loaded ? <Skeleton style={styles.imageSkeleton} /> : null}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: palette.hairline, borderBottomWidth: 1, backgroundColor: palette.page, zIndex: 4 },
  workspaceViewport: { flex: 1, minHeight: 0, gap: spacing.sm, paddingTop: spacing.md },
  titleRow: { minHeight: 40, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  detailHeaderActions: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  workspaceTitle: { flex: 1, minWidth: 0, color: palette.silver50, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  workspaceSearch: { minHeight: 44, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  workspaceSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  rootActions: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  rootSearch: { minHeight: 44, flex: 1, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  searchHistoryButton: { width: 44, height: 44 },
  globe: { flex: 1, minHeight: 0, overflow: "hidden", borderRadius: radii.xl, backgroundColor: palette.voidBlack },
  tripGlobe: { flex: 1, minHeight: 0, position: "relative", overflow: "hidden", borderRadius: radii.xl, backgroundColor: palette.voidBlack },
  tripPlaceArc: { position: "absolute", right: 0, bottom: 0, left: 0, height: 132, justifyContent: "flex-end", backgroundColor: "transparent" },
  tripPlaceArcContent: { width: "100%", height: 124, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xs },
  tripPlaceArcCards: { minWidth: 0, flex: 1, height: 118, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  tripPlaceArcArrow: { width: 32, height: 32, minHeight: 32, paddingHorizontal: 0, zIndex: 4 },
  tripPlaceArcCard: { width: 86, height: 86, overflow: "hidden", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, borderColor: palette.hairlineBright, backgroundColor: palette.panelRaised },
  tripPlaceArcCardSide: { zIndex: 1, transform: [{ translateY: -12 }, { scale: 0.9 }] },
  tripPlaceArcCardCenter: { zIndex: 3, borderColor: palette.silver50, borderWidth: 2, transform: [{ translateY: 10 }] },
  tripPlaceArcOverlap: { marginLeft: -13 },
  tripPlaceArcLogo: { width: 48, height: 48 },
  tableView: { flex: 1, minHeight: 0, position: "relative", gap: spacing.sm },
  filteredTripEmpty: { position: "absolute", top: 116, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: palette.voidBlack, zIndex: 2 },
  rootTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  rootTab: { flex: 1 },
  cardGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP, paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  imageGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP, paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  imageCard: { overflow: "hidden", padding: 0, borderRadius: radii.md },
  squareCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  squareCardSelected: { borderColor: palette.silver50, shadowColor: palette.silver50, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.62, shadowRadius: 5, elevation: 4 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  stateBadges: { position: "absolute", top: 6, left: 6, minHeight: 24, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, backgroundColor: palette.panelRaised },
  cardMain: { width: "100%", height: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xs },
  coveredCardMain: { justifyContent: "flex-end", paddingBottom: 10 },
  cardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  coveredCardLabel: { paddingHorizontal: 5, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: "rgba(0, 0, 0, 0.68)", color: "#FFFFFF" },
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
  sheetAction: { justifyContent: "center", backgroundColor: palette.voidBlack },
  sheetSecondary: { backgroundColor: palette.voidBlack },
  sheetContent: { gap: 6, paddingBottom: 6 },
  fullSheetScroll: { flex: 1 },
  countryDetailSkeleton: { gap: spacing.md, paddingVertical: spacing.md },
  skeletonBlock: { backgroundColor: palette.hairlineBright, opacity: 0.72 },
  skeletonHero: { width: "100%", aspectRatio: 1.5 },
  skeletonText: { width: "76%", height: 14 },
  countryDetailFailure: { flex: 1, minHeight: 360, alignItems: "center", justifyContent: "center", gap: spacing.md },
  countryDetail: { gap: spacing.md, paddingTop: spacing.md },
  savedPlaceDetail: { gap: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  guideHero: { marginBottom: spacing.sm, gap: spacing.sm },
  imageFrame: { width: "100%", aspectRatio: 1.15, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  imageSkeleton: { position: "absolute", width: "100%", height: "100%", backgroundColor: palette.hairlineBright, opacity: 0.72 },
  placeImage: { width: "100%", height: "100%" },
  guideSections: { gap: spacing.sm },
  guideText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
  popularCitiesTitle: { marginTop: spacing.sm, color: palette.silver300, fontFamily: fonts.medium, fontSize: 14 },
  cityList: { gap: spacing.xs, paddingBottom: spacing.xl },
  countryCityList: { paddingBottom: 0 },
  cityPill: { minHeight: 44, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: spacing.sm, borderRadius: radii.md },
  cityPillSkeleton: { width: "100%", height: 44, borderRadius: 999 },
  cityName: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  createPlaceContent: { flex: 1, minHeight: 0, gap: spacing.md },
  sheetSearchClear: { width: 28, height: 28, minHeight: 28, paddingHorizontal: 0, paddingVertical: 0 },
  namingForm: { gap: spacing.sm, paddingTop: spacing.sm },
  inputLabel: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  tripDescriptionInput: { minHeight: 120 },
  bulkToolbar: { width: "100%", minHeight: 36, marginBottom: spacing.xs, padding: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkToolbarClose: { height: 30, minHeight: 30, width: 30, paddingHorizontal: 0, paddingVertical: 0 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  bulkRemoveAction: { height: 30, minHeight: 30, minWidth: 68, paddingHorizontal: 12, paddingVertical: 0 },
  bulkRemoveText: { fontFamily: fonts.regular, fontSize: 11, letterSpacing: 0.4 },
  orderList: { gap: spacing.sm, paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  editOrderList: { gap: spacing.sm, paddingBottom: spacing.sm },
  orderPill: { height: 48, flexDirection: "row", alignItems: "center", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, backgroundColor: palette.page },
  outlineSelected: { borderWidth: 2, borderColor: palette.silver50 },
  orderMain: { minWidth: 0, flex: 1, height: 46, minHeight: 46, justifyContent: "flex-start", gap: spacing.sm, paddingLeft: spacing.xs, paddingRight: spacing.sm },
  editOrderMain: { flexDirection: "row", alignItems: "center" },
  orderHero: { width: 32, height: 32, borderRadius: 16 },
  orderHeroFallback: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: palette.panel },
  orderName: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  orderButtons: { flexDirection: "row", gap: 4, paddingRight: spacing.xs },
  orderControl: { width: 32, height: 32, minHeight: 32, paddingHorizontal: 0, paddingVertical: 0 },
  switchRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  filterSheet: { gap: 6 },
  filterSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  filterSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
  sheetEmptyContent: { flexGrow: 1, alignContent: "center", alignItems: "center", justifyContent: "center" },
  tripDetailsForm: { gap: spacing.lg, paddingBottom: spacing.xs },
  tripDetailsCoverControl: { width: 88, height: 88, position: "relative", alignSelf: "flex-start" },
  tripDetailsCoverButton: { width: 88, height: 88, paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  tripDetailsCoverRemove: { width: 42, height: 42, minHeight: 42, paddingHorizontal: 0, paddingVertical: 0, position: "absolute", right: -12, top: -12 },
  tripCover: StyleSheet.absoluteFill,
  assetTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  assetTab: { flex: 1, height: 28, minHeight: 28, paddingVertical: 0 },
  assetTabText: { fontSize: 10, letterSpacing: 0.8, lineHeight: 12 },
  assetGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP, paddingVertical: spacing.md, paddingBottom: spacing.xl },
  assetCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  assetList: { gap: spacing.xs, paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  assetRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  assetBody: { minWidth: 0, flex: 1, justifyContent: "flex-start", gap: spacing.sm },
  assetName: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  tripGuideList: { flexGrow: 1, gap: spacing.sm, paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  tripGuideEmpty: { alignItems: "center", justifyContent: "center" },
  tripGuidePill: { width: "100%", minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", paddingHorizontal: spacing.md },
  tripGuidePillSelected: { borderColor: palette.silver50, borderWidth: 2 },
  tripGuidePillName: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
  tripGuidePillAccessory: { marginLeft: "auto", flexShrink: 0 },
  tripGuidePillSkeleton: { width: "100%", height: 44, borderRadius: 999 },
  tripGuideGenerationLoading: { gap: spacing.sm, paddingVertical: spacing.sm },
  tripGuideDetail: { gap: spacing.md, paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  tripGuideCollage: { width: "100%", aspectRatio: 1.45, overflow: "hidden", flexDirection: "row", flexWrap: "wrap", gap: 2, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  tripGuideCollageTwo: { aspectRatio: 2.9 },
  tripGuideCollageImage: { width: "49.5%", height: "49.5%" },
  tripGuideCollageImageSingle: { width: "100%", height: "100%" },
  tripGuideCollageImageTwo: { height: "100%" },
  tripGuideCollageImageWide: { width: "100%" },
  placeReferenceHero: { width: "100%", aspectRatio: 1.45, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  placeReferenceHeroFallback: { width: "100%", aspectRatio: 1.45, alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  tripGuideDate: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  tripGuideSections: { gap: spacing.lg },
  tripGuideSection: { gap: spacing.xs },
  tripGuideHeading: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 20, lineHeight: 26 },
  tripGuideBody: { gap: 3 },
  tripGuideBodyLine: { minWidth: 0, flexDirection: "row", alignItems: "flex-start" },
  tripGuideMarker: { width: 24, flexShrink: 0, color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  tripGuideBodyText: { minWidth: 0, flex: 1, color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  tripGuideParagraphGap: { height: spacing.xs },
  tripGuideStrong: { color: palette.silver100, fontFamily: fonts.medium },
  tripGuideEmphasis: { fontStyle: "italic" },
  tripGuideCode: { color: palette.silver100, backgroundColor: palette.panelRaised },
  tripGuideStrikethrough: { textDecorationLine: "line-through" },
  documentContent: { paddingVertical: spacing.md, paddingBottom: spacing.xl },
  documentText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  collectionGrid: { flexDirection: "row", flexWrap: "wrap", gap: "2%", paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  collectionImage: { width: "23.5%", aspectRatio: 1, overflow: "hidden", marginBottom: 6, padding: 0, borderRadius: radii.sm },
  viewerContent: { flex: 1, justifyContent: "center", gap: spacing.md },
  viewerFrame: { width: "100%", aspectRatio: 3 / 2, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  viewerImage: { width: "100%", height: "100%" },
});
