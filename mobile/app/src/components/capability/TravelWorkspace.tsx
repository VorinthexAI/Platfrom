import { randomUUID } from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { CalendarIcon, CheckIcon, GlobeIcon, LocationPinIcon, PlusIcon, SearchIcon, SendIcon, TrashIcon } from "@vorinthex/shared/ui/icons-mobile";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { ChromeIcon } from "@/components/ChromeIcon";
import { InteractiveGlobe } from "@/components/three/InteractiveGlobe";
import { assistantIconSource } from "@/data/capability-icons";
import { COUNTRIES, type CountryFeature } from "@/lib/globe-data";
import {
  addPlaceToTrip,
  askTravelAssistant,
  createPlace,
  createTrip,
  fetchTravelOverview,
  getTravelContext,
  markPlaceVisited,
  removePlaceFromTrip,
  tripContainsPlace,
  type Place,
  type Trip,
} from "@/lib/travel-client";
import { getContentContext } from "@/lib/content-client";
import { compassQueryKeys, invalidateAssistantChanges, patchCompassOverview } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

export type CountrySelection = {
  countryCode: string;
  name: string;
  continent: string;
  latitude: number;
  longitude: number;
};

type WorkspaceSheet = "actions" | "explore" | "newTrip" | "chooseTrip" | "trips" | "confirmRemove";
const CORE_PROMPTS = [
  "Plan a quiet week in Kyoto",
  "Build a route through Portugal",
  "What should I see in Copenhagen?",
] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "That change could not be completed.";
}

function dateRange(trip: Trip) {
  if (!trip.startDate && !trip.endDate) return "Dates not set";
  return [trip.startDate, trip.endDate].filter(Boolean).join(" to ");
}

export function TravelWorkspace() {
  const queryClient = useQueryClient();
  const travelContext = getTravelContext();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [places, setPlaces] = useState<Place[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<CountrySelection>();
  const [selectedPlace, setSelectedPlace] = useState<Place>();
  const [selectedTrip, setSelectedTrip] = useState<Trip>();
  const [activeSheet, setActiveSheet] = useState<WorkspaceSheet>("actions");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tripName, setTripName] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [pendingRemoval, setPendingRemoval] = useState<{ trip: Trip; place: Place }>();
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [assistantFailed, setAssistantFailed] = useState(false);
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const overviewQuery = useQuery({ queryKey: compassQueryKeys.overview(travelContext), queryFn: fetchTravelOverview });

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const overview = await queryClient.fetchQuery({ queryKey: compassQueryKeys.overview(travelContext), queryFn: fetchTravelOverview });
      setPlaces(overview.places);
      setTrips(overview.trips);
      setError(undefined);
    } catch (failure) {
      setLoadError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, [queryClient, travelContext.organizationKey, travelContext.scopeKey]);

  useEffect(() => {
    const overview = overviewQuery.data;
    if (overview) {
      setPlaces(overview.places);
      setTrips(overview.trips);
      setError(undefined);
      setLoadError(undefined);
      setLoading(false);
    } else if (overviewQuery.error) {
      setLoadError(errorMessage(overviewQuery.error));
      setLoading(false);
    }
  }, [overviewQuery.data, overviewQuery.error]);

  function openSheet(sheet: WorkspaceSheet) {
    if (!loadError) setError(undefined);
    setActiveSheet(sheet);
    setSheetOpen(true);
  }

  function selectCountry(country: CountrySelection | null) {
    setSelectedCountry(country ?? undefined);
    setSelectedPlace(country ? places.find((place) => place.kind === "country" && place.countryCode === country.countryCode) : undefined);
    setError(undefined);
  }

  function selectPlace(place: Place | null) {
    setSelectedPlace(place ?? undefined);
    if (place) {
      setSelectedCountry({
        countryCode: place.countryCode ?? "--",
        name: place.country ?? place.name,
        continent: place.continent ?? "Saved place",
        latitude: place.latitude,
        longitude: place.longitude,
      });
    }
    setError(undefined);
  }

  async function pinCountry() {
    if (!selectedCountry) return;
    setBusy(true);
    setError(undefined);
    try {
      const place = await createPlace({
        kind: "country",
        name: selectedCountry.name,
        latitude: selectedCountry.latitude,
        longitude: selectedCountry.longitude,
        countryCode: selectedCountry.countryCode,
        country: selectedCountry.name,
        continent: selectedCountry.continent,
        wishlist: true,
      });
      setPlaces((current) => [...current.filter(({ key }) => key !== place.key), place]);
      patchCompassOverview(queryClient, travelContext, place);
      setSelectedPlace(place);
      setSheetOpen(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function visitPlace() {
    if (!selectedPlace) return;
    setBusy(true);
    setError(undefined);
    try {
      const place = await markPlaceVisited(selectedPlace.key);
      setPlaces((current) => current.map((item) => item.key === place.key ? place : item));
      patchCompassOverview(queryClient, travelContext, place);
      setSelectedPlace(place);
      setSheetOpen(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function submitTrip() {
    setBusy(true);
    setError(undefined);
    try {
      const trip = await createTrip({
        name: tripName,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setTrips((current) => [...current.filter(({ key }) => key !== trip.key), trip]);
      setSelectedTrip(trip);
      const savedTrip = selectedPlace ? await addPlaceToTrip(trip.key, { placeKey: selectedPlace.key }) : trip;
      setTrips((current) => [...current.filter(({ key }) => key !== savedTrip.key), savedTrip]);
      patchCompassOverview(queryClient, travelContext, savedTrip);
      setSelectedTrip(savedTrip);
      setTripName("");
      setStartDate("");
      setEndDate("");
      setActiveSheet("trips");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function addToTrip(trip: Trip) {
    if (!selectedPlace) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await addPlaceToTrip(trip.key, {
        placeKey: selectedPlace.key,
      });
      setTrips((current) => current.map((item) => item.key === updated.key ? updated : item));
      patchCompassOverview(queryClient, travelContext, updated);
      setSelectedTrip(updated);
      setActiveSheet("trips");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function removeFromTrip(trip: Trip, placeKey: string) {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await removePlaceFromTrip(trip.key, placeKey);
      setTrips((current) => current.map((item) => item.key === updated.key ? updated : item));
      patchCompassOverview(queryClient, travelContext, updated);
      setSelectedTrip(updated);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestRemoveFromTrip(trip: Trip, place: Place) {
    setPendingRemoval({ trip, place });
    openSheet("confirmRemove");
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
      await invalidateAssistantChanges(queryClient, getContentContext(), response.changes);
    } catch (failure) {
      setAssistantMessage(errorMessage(failure));
      setAssistantFailed(true);
    } finally {
      setAssistantBusy(false);
    }
  }

  const panelTitle = selectedPlace?.name ?? selectedCountry?.name;
  const panelMeta = selectedPlace
    ? [selectedPlace.city, selectedPlace.continent, selectedPlace.country].filter(Boolean).join(" · ")
    : selectedCountry ? `${selectedCountry.continent} · ${selectedCountry.countryCode}` : undefined;
  const itinerary = selectedTrip?.itinerary ?? [];
  const visibleCountries = useMemo(() => {
    const normalized = countryQuery.trim().toLowerCase();
    return COUNTRIES.features
      .filter(({ properties }) => !normalized || properties.name.toLowerCase().includes(normalized) || properties.countryCode.toLowerCase().includes(normalized))
      .sort((left, right) => left.properties.name.localeCompare(right.properties.name));
  }, [countryQuery]);
  const panelWidth = Math.min(width - Math.max(insets.left, spacing.md) - Math.max(insets.right, spacing.md), 600);
  const sheetTitle = activeSheet === "actions" ? "Place actions"
    : activeSheet === "newTrip" ? "Create trip"
      : activeSheet === "chooseTrip" ? "Choose a trip"
        : activeSheet === "explore" ? "Explore places"
          : activeSheet === "confirmRemove" ? "Remove stop?"
            : selectedTrip ? selectedTrip.name : "Trips";
  const fullHeightSheet = activeSheet === "explore" || activeSheet === "newTrip" || activeSheet === "chooseTrip" || activeSheet === "trips";

  return (
    <KeyboardAvoidingView behavior="height" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
        <WorkspaceAppSwitcher active="compass" />
      </View>

      <View style={styles.globe}>
        <InteractiveGlobe />
        {!loadError ? <View style={[styles.globeActions, { right: Math.max(insets.right, spacing.md) }]}>
          <Button accessibilityLabel="Choose a country or saved place" contentMode="raw" disabled={loading} onPress={() => openSheet("explore")} size="md" variant="icon"><SearchIcon size="sm" /></Button>
          <Button accessibilityLabel="Show trips" contentMode="raw" disabled={loading} onPress={() => { setSelectedTrip(undefined); openSheet("trips"); }} size="md" variant="icon"><CalendarIcon size="sm" /></Button>
        </View> : null}
        {loading ? <View accessibilityLabel="Loading places" accessibilityRole="progressbar" style={[styles.selectionSkeleton, { bottom: 0, left: (width - panelWidth) / 2, width: panelWidth }]} /> : null}
        {loadError && !loading ? <View style={styles.loadFailure}><GlobeIcon size="lg" variant="muted" /><Text style={styles.loadFailureText}>{loadError}</Text><Button onPress={() => void loadOverview()} size="sm" variant="secondary">Retry</Button></View> : null}
      </View>

      {error && !sheetOpen && !loadError ? <View accessibilityLiveRegion="polite" style={[styles.inlineError, styles.workspaceError]}><Text style={styles.errorText}>{error}</Text></View> : null}

      {!loading && panelTitle && !loadError ? <View style={[styles.selectionPanel, { bottom: 0, left: (width - panelWidth) / 2, width: panelWidth }]}>
        <View style={styles.panelIcon}><LocationPinIcon size="md" /></View>
        <View style={styles.panelCopy}>
          <Text numberOfLines={1} style={styles.panelTitle}>{panelTitle}</Text>
          <Text numberOfLines={1} style={styles.panelMeta}>{panelMeta}</Text>
        </View>
        {selectedPlace?.visited ? <View style={styles.visited}><CheckIcon size="sm" variant="inverse" /></View> : null}
        <Button accessibilityLabel={`Actions for ${panelTitle}`} contentMode="raw" onPress={() => openSheet("actions")} size="md" variant="icon"><PlusIcon size="sm" /></Button>
      </View> : !loading && !loadError ? <View pointerEvents="none" style={[styles.hint, { bottom: 0 }]}><GlobeIcon size="sm" variant="muted" /><Text style={styles.hintText}>Rotate freely or search for a place</Text></View> : null}

      {!loadError ? <CoreComposer
        accessibilityLabel="Ask Core about travel"
        disabled={assistantBusy}
        editable={!assistantBusy}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        loading={assistantBusy}
        message={assistantMessage ? <View style={assistantFailed ? styles.inlineError : styles.inlineNotice}><Text style={styles.errorText}>{assistantMessage}</Text></View> : null}
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

      <BottomSheet description={activeSheet === "newTrip" ? "Use ISO dates in YYYY-MM-DD format." : undefined} dismissible={!busy} height={fullHeightSheet ? "full" : undefined} onOpenChange={setSheetOpen} open={sheetOpen} title={sheetTitle}>
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={[fullHeightSheet && styles.fullSheetScroll, { maxHeight: fullHeightSheet ? undefined : height * 0.58 }]}>
          {error ? <View accessibilityLiveRegion="assertive" style={styles.inlineError}><Text style={styles.errorText}>{error}</Text></View> : null}

          {activeSheet === "explore" ? <>
            <View style={styles.countrySearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search countries" onChangeText={setCountryQuery} placeholder="Search countries" style={styles.countrySearchInput} value={countryQuery} /></View>
            {places.length ? <><Text style={styles.listLabel}>SAVED PLACES</Text>{places.map((place) => <BottomSheetItem key={place.key} disabled={busy} icon={<LocationPinIcon size="md" />} onPress={() => { selectPlace(place); setSheetOpen(false); }}>{place.name}</BottomSheetItem>)}</> : null}
            <Text style={styles.listLabel}>COUNTRIES</Text>
            {visibleCountries.map((country: CountryFeature) => <BottomSheetItem key={country.properties.countryCode} disabled={busy} icon={<GlobeIcon size="md" />} onPress={() => { selectCountry(country.properties); setSheetOpen(false); }}>{country.properties.name}</BottomSheetItem>)}
          </> : null}

          {activeSheet === "actions" ? <>
            <BottomSheetItem disabled={busy || !selectedCountry || Boolean(selectedPlace)} icon={<LocationPinIcon size="md" />} loading={busy && !selectedPlace} onPress={() => void pinCountry()}>Pin selected country</BottomSheetItem>
            <BottomSheetItem disabled={busy || !selectedPlace || selectedPlace.visited} icon={<CheckIcon size="md" />} loading={busy && Boolean(selectedPlace)} onPress={() => void visitPlace()}>Mark place visited</BottomSheetItem>
            <BottomSheetItem disabled={busy || !selectedPlace} icon={<PlusIcon size="md" />} onPress={() => openSheet("chooseTrip")}>Add selected place to trip</BottomSheetItem>
            <BottomSheetItem disabled={busy} icon={<CalendarIcon size="md" />} onPress={() => openSheet("newTrip")}>Create trip</BottomSheetItem>
            <BottomSheetItem disabled={busy} icon={<GlobeIcon size="md" />} onPress={() => openSheet("explore")}>Browse countries and saved places</BottomSheetItem>
            <BottomSheetItem disabled={busy} icon={<CalendarIcon size="md" />} onPress={() => { setSelectedTrip(undefined); openSheet("trips"); }}>View trips and itineraries</BottomSheetItem>
          </> : null}

          {activeSheet === "newTrip" ? <View style={styles.form}>
            <TextInput accessibilityLabel="Trip name" autoFocus editable={!busy} onChangeText={setTripName} placeholder="Trip name" value={tripName} />
            <View style={[styles.dateRow, width < 380 && styles.dateRowCompact]}>
              <TextInput accessibilityLabel="Trip start date" editable={!busy} onChangeText={setStartDate} placeholder="Start YYYY-MM-DD" style={styles.dateInput} value={startDate} />
              <TextInput accessibilityLabel="Trip end date" editable={!busy} onChangeText={setEndDate} placeholder="End YYYY-MM-DD" style={styles.dateInput} value={endDate} />
            </View>
            <Button disabled={busy || !tripName.trim()} loading={busy} onPress={() => void submitTrip()} size="md" variant="primary">Create trip</Button>
          </View> : null}

          {activeSheet === "chooseTrip" ? <>
            {trips.map((trip) => <BottomSheetItem key={trip.key} disabled={busy || Boolean(selectedPlace && tripContainsPlace(trip, selectedPlace.key))} icon={<CalendarIcon size="md" />} loading={busy} onPress={() => void addToTrip(trip)}>{trip.name}</BottomSheetItem>)}
            {trips.length === 0 ? <Text style={styles.emptyText}>Create a trip before adding this place.</Text> : null}
            <BottomSheetItem disabled={busy} icon={<PlusIcon size="md" />} onPress={() => openSheet("newTrip")}>Create a new trip</BottomSheetItem>
          </> : null}

          {activeSheet === "trips" && !selectedTrip ? <>
            {trips.map((trip) => <BottomSheetItem key={trip.key} contentMode="raw" disabled={busy} icon={<CalendarIcon size="md" />} onPress={() => setSelectedTrip(trip)}><View style={styles.tripCopy}><Text style={styles.tripName}>{trip.name}</Text><Text style={styles.tripMeta}>{dateRange(trip)} · {trip.itinerary.length} stops</Text></View></BottomSheetItem>)}
            {trips.length === 0 ? <Text style={styles.emptyText}>Your first itinerary starts with a new trip.</Text> : null}
            <BottomSheetItem disabled={busy} icon={<PlusIcon size="md" />} onPress={() => openSheet("newTrip")}>Create trip</BottomSheetItem>
          </> : null}

          {activeSheet === "trips" && selectedTrip ? <View style={styles.itinerary}>
            <Button disabled={busy} onPress={() => setSelectedTrip(undefined)} size="sm" variant="ghost">All trips</Button>
            <Text style={styles.tripMeta}>{dateRange(selectedTrip)}</Text>
            {itinerary.map((item) => {
              const place = item.place;
              return <View key={item.key} style={styles.stop}>
                <View style={styles.stopIndex}><Text style={styles.stopIndexText}>{item.position}</Text></View>
                <View style={styles.tripCopy}><Text style={styles.tripName}>{place?.name ?? "Saved place"}</Text><Text style={styles.tripMeta}>{[item.arrivalDate, item.departureDate].filter(Boolean).join(" to ") || place?.country || "Dates not set"}</Text></View>
                <Button accessibilityLabel={`Remove ${place.name} from trip`} contentMode="raw" disabled={busy} onPress={() => requestRemoveFromTrip(selectedTrip, place)} size="md" variant="icon"><TrashIcon size="sm" variant="danger" /></Button>
              </View>;
            })}
            {itinerary.length === 0 ? <Text style={styles.emptyText}>No places have been added to this itinerary.</Text> : null}
          </View> : null}

          {activeSheet === "confirmRemove" && pendingRemoval ? <View style={styles.form}>
            <Text style={styles.confirmText}>Remove {pendingRemoval.place.name} from {pendingRemoval.trip.name}?</Text>
            <Button disabled={busy} onPress={() => { setPendingRemoval(undefined); setActiveSheet("trips"); }} size="md" variant="secondary">Cancel</Button>
            <Button disabled={busy} icon={<TrashIcon size="sm" variant="inverse" />} loading={busy} onPress={() => void removeFromTrip(pendingRemoval.trip, pendingRemoval.place.key).then((removed) => { if (removed) { setPendingRemoval(undefined); setActiveSheet("trips"); } })} size="md" variant="danger">Remove stop</Button>
          </View> : null}
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
  visited: { width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: palette.silver100 },
  hint: { position: "absolute", alignSelf: "center", paddingHorizontal: 14, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, backgroundColor: "rgba(10,14,19,0.86)" },
  hintText: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 11, letterSpacing: tracking.micro },
  workspaceError: { position: "absolute", top: 92, left: spacing.md, right: spacing.md, zIndex: 3 },
  inlineError: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "rgba(176,74,74,0.45)", borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" },
  inlineNotice: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  errorText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  sheetContent: { gap: 6, paddingBottom: 6 },
  fullSheetScroll: { flex: 1 },
  countrySearch: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  countrySearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  listLabel: { marginTop: 10, marginBottom: 2, color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  form: { gap: 14 },
  dateRow: { flexDirection: "row", gap: 8 },
  dateRowCompact: { flexDirection: "column" },
  dateInput: { minWidth: 0, flex: 1, fontSize: 13 },
  emptyText: { paddingVertical: 18, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  tripCopy: { minWidth: 0, flex: 1 },
  tripName: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15 },
  tripMeta: { marginTop: 3, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  itinerary: { gap: 10 },
  stop: { minHeight: 56, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: palette.hairline },
  stopIndex: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: palette.panelRaised },
  stopIndexText: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 11 },
  confirmText: { paddingVertical: 8, color: palette.silver100, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
