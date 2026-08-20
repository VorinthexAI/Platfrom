/* eslint-disable react/no-unknown-property */
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { Canvas } from "@/components/three/Canvas";
import {
  COUNTRIES,
  createCountryBoundaryGeometry,
  createCountryFillGeometry,
  findCountryAtCoordinates,
  type CountryFeature,
} from "@/lib/globe-data";
import {
  clampGlobeZoom,
  exceedsGlobeDragThreshold,
  latLonToVector,
  projectToTrackball,
  vectorToLatLon,
} from "@/lib/globe-math";

const GLOBE_RADIUS = 1;
const DRAG_THRESHOLD = 10;
const FOCUS_DURATION_MS = 700;
const FOCUS_PULSE_DURATION_MS = 2_600;
const MIN_CAMERA_DISTANCE = 2.15;
const MAX_CAMERA_DISTANCE = 5.2;
const WEB_TOUCH_STYLE = { touchAction: "none" } as unknown as ViewStyle;
const disableRaycast: THREE.Object3D["raycast"] = () => {};
const PIN_HIT_GEOMETRY = new THREE.SphereGeometry(0.09, 12, 10);
const PIN_STEM_GEOMETRY = new THREE.ConeGeometry(0.026, 0.07, 12);
const PIN_HEAD_GEOMETRY = new THREE.SphereGeometry(0.056, 18, 14);
const PIN_MARK_GEOMETRY = new THREE.OctahedronGeometry(0.025, 0);
const PIN_DOT_GEOMETRY = new THREE.SphereGeometry(0.007, 10, 8);
const PIN_HIT_MATERIAL = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const PIN_PLANNED_MATERIAL = new THREE.MeshStandardMaterial({ color: "#748c99", metalness: 0.25, roughness: 0.5 });
const PIN_VISITED_MATERIAL = new THREE.MeshStandardMaterial({ color: "#d5e5ea", metalness: 0.18, roughness: 0.42 });
const PIN_SELECTED_MATERIAL = new THREE.MeshStandardMaterial({ color: "#f1f7f9", metalness: 0.12, roughness: 0.4 });
const PIN_MARK_MATERIAL = new THREE.MeshBasicMaterial({ color: "#173846" });
const PIN_DOT_MATERIAL = new THREE.MeshBasicMaterial({ color: "#e8f3f6" });

export type GlobePlace = Readonly<{
  id: string;
  latitude: number;
  longitude: number;
  status: "visited" | "planned";
}>;

export type InteractiveGlobeProps = {
  focusTarget?: Readonly<{ countryCode: string; latitude: number; longitude: number }>;
  places?: readonly GlobePlace[];
  onPlacePress?: (place: GlobePlace) => void;
  onCountryPress?: (country: CountryFeature | undefined, coordinates: { latitude: number; longitude: number }) => void;
  reducedMotion?: boolean;
  selectedCountryCode?: string;
  selectedPlaceId?: string;
  style?: StyleProp<ViewStyle>;
};

type PointerGesture = {
  activePointerId: number | undefined;
  startScreen: THREE.Vector2;
  previousTrackball: THREE.Vector3;
  moved: boolean;
  pointers: Map<number, THREE.Vector2>;
  pinchDistance: number;
  pinchZoom: number;
  resetTrackball: boolean;
};

type GlobeControls = {
  rotateBy: (radians: number) => void;
  zoomBy: (distance: number) => void;
};

type PointerSource = {
  clientX?: number;
  clientY?: number;
  locationX?: number;
  locationY?: number;
  offsetX?: number;
  offsetY?: number;
  pageX?: number;
  pageY?: number;
  preventDefault?: () => void;
  touches?: ArrayLike<{
    identifier?: number;
    clientX?: number;
    clientY?: number;
    locationX?: number;
    locationY?: number;
    pageX?: number;
    pageY?: number;
  }>;
};

function pointerSource(event: ThreeEvent<PointerEvent>): PointerSource | undefined {
  const sources = event as unknown as { sourceEvent?: PointerSource; nativeEvent?: PointerSource };
  return sources.sourceEvent ?? sources.nativeEvent;
}

function eventScreenPoint(event: ThreeEvent<PointerEvent>): THREE.Vector2 {
  const source = pointerSource(event);
  return new THREE.Vector2(
    source?.clientX ?? source?.pageX ?? source?.offsetX ?? source?.locationX ?? event.pointer.x * 100,
    source?.clientY ?? source?.pageY ?? source?.offsetY ?? source?.locationY ?? event.pointer.y * 100,
  );
}

function activeTouchPoints(event: ThreeEvent<PointerEvent>): Map<number, THREE.Vector2> | undefined {
  const touches = pointerSource(event)?.touches;
  if (!touches) return undefined;
  const points = new Map<number, THREE.Vector2>();
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index];
    if (!touch) continue;
    points.set(touch.identifier ?? index, new THREE.Vector2(
      touch.clientX ?? touch.pageX ?? touch.locationX ?? 0,
      touch.clientY ?? touch.pageY ?? touch.locationY ?? 0,
    ));
  }
  return points;
}

function trackballVector(pointer: THREE.Vector2): THREE.Vector3 {
  const projected = projectToTrackball(pointer.x, pointer.y);
  return new THREE.Vector3(projected.x, projected.y, projected.z);
}

function pointerDistance(pointers: Map<number, THREE.Vector2>): number {
  const [first, second] = [...pointers.values()];
  return first && second ? first.distanceTo(second) : 0;
}

function PlaceMarker({
  canSelect,
  onPress,
  place,
  selected,
}: {
  canSelect: () => boolean;
  onPress?: (place: GlobePlace) => void;
  place: GlobePlace;
  selected: boolean;
}) {
  const normal = useMemo(() => {
    const point = latLonToVector(place.latitude, place.longitude);
    return new THREE.Vector3(point.x, point.y, point.z).normalize();
  }, [place.latitude, place.longitude]);
  const orientation = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal),
    [normal],
  );

  return (
    <group
      dispose={null}
      position={normal.clone().multiplyScalar(1.025)}
      quaternion={orientation}
      onClick={(event) => {
        event.stopPropagation();
        if (canSelect()) onPress?.(place);
      }}
    >
      <mesh geometry={PIN_HIT_GEOMETRY} material={PIN_HIT_MATERIAL} position={[0, 0.085, 0]} />
      <mesh geometry={PIN_STEM_GEOMETRY} material={place.status === "visited" ? PIN_VISITED_MATERIAL : PIN_PLANNED_MATERIAL} position={[0, 0.035, 0]} raycast={disableRaycast} rotation={[0, 0, Math.PI]} />
      <mesh geometry={PIN_HEAD_GEOMETRY} material={selected ? PIN_SELECTED_MATERIAL : place.status === "visited" ? PIN_VISITED_MATERIAL : PIN_PLANNED_MATERIAL} position={[0, 0.105, 0]} raycast={disableRaycast} scale={selected ? 1.14 : 1} />
      <mesh geometry={PIN_MARK_GEOMETRY} material={PIN_MARK_MATERIAL} position={[0, 0.158, 0]} raycast={disableRaycast} rotation={[0, Math.PI / 4, 0]} scale={selected ? 1.16 : 1} />
      <mesh geometry={PIN_DOT_GEOMETRY} material={PIN_DOT_MATERIAL} position={[0, 0.164, 0]} raycast={disableRaycast} />
    </group>
  );
}

type GlobeSceneProps = Required<Pick<InteractiveGlobeProps, "places">> & Omit<InteractiveGlobeProps, "places" | "style"> & {
  controlsRef: { current: GlobeControls | null };
};

function GlobeScene({
  controlsRef,
  focusTarget,
  places,
  onPlacePress,
  onCountryPress,
  reducedMotion,
  selectedCountryCode,
  selectedPlaceId,
}: GlobeSceneProps) {
  const globeRef = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const cameraRef = useRef(camera);
  const renderer = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const gestureRef = useRef<PointerGesture>({
    activePointerId: undefined,
    startScreen: new THREE.Vector2(),
    previousTrackball: new THREE.Vector3(),
    moved: false,
    pointers: new Map(),
    pinchDistance: 0,
    pinchZoom: MAX_CAMERA_DISTANCE,
    resetTrackball: false,
  });
  const focusAnimation = useRef<{ from: THREE.Quaternion; to: THREE.Quaternion; startedAt: number } | undefined>(undefined);
  const pulseStartedAt = useRef<number | undefined>(undefined);
  const pulseMaterial = useRef<THREE.LineBasicMaterial>(null);
  const boundaries = useMemo(() => createCountryBoundaryGeometry(), []);
  const focusCountryCode = focusTarget?.countryCode;
  const focusLatitude = focusTarget?.latitude;
  const focusLongitude = focusTarget?.longitude;
  const selectedBoundaries = useMemo(() => {
    const country = COUNTRIES.features.find(({ properties }) => properties.countryCode === selectedCountryCode);
    return country
      ? createCountryBoundaryGeometry({ type: "FeatureCollection", features: [country] }, 1.026)
      : undefined;
  }, [selectedCountryCode]);
  const selectedFill = useMemo(() => {
    const country = COUNTRIES.features.find(({ properties }) => properties.countryCode === selectedCountryCode);
    return country ? createCountryFillGeometry(country) : undefined;
  }, [selectedCountryCode]);
  const highlightedCountryCode = focusCountryCode ?? selectedCountryCode;
  const focusBoundaries = useMemo(() => {
    const country = COUNTRIES.features.find(({ properties }) => properties.countryCode === highlightedCountryCode);
    return country ? createCountryBoundaryGeometry({ type: "FeatureCollection", features: [country] }, 1.032) : undefined;
  }, [highlightedCountryCode]);
  const rotationDelta = useMemo(() => new THREE.Quaternion(), []);
  const worldYAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useEffect(() => () => boundaries.dispose(), [boundaries]);
  useEffect(() => () => selectedBoundaries?.dispose(), [selectedBoundaries]);
  useEffect(() => () => selectedFill?.dispose(), [selectedFill]);
  useEffect(() => () => focusBoundaries?.dispose(), [focusBoundaries]);
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || focusCountryCode === undefined || focusLatitude === undefined || focusLongitude === undefined) {
      focusAnimation.current = undefined;
      return;
    }
    const point = latLonToVector(focusLatitude, focusLongitude);
    const target = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(point.x, point.y, point.z).normalize(),
      new THREE.Vector3(0, 0, 1),
    );
    const startedAt = performance.now();
    if (reducedMotion) globe.quaternion.copy(target);
    else focusAnimation.current = { from: globe.quaternion.clone(), to: target, startedAt };
    invalidate();
  }, [focusCountryCode, focusLatitude, focusLongitude, invalidate, reducedMotion]);
  useEffect(() => {
    pulseStartedAt.current = highlightedCountryCode && !reducedMotion ? performance.now() : undefined;
    invalidate();
  }, [highlightedCountryCode, invalidate, reducedMotion]);
  useEffect(() => {
    const element = renderer.domElement as unknown as { addEventListener?: (type: string, listener: (event: WheelEvent) => void, options?: AddEventListenerOptions) => void; removeEventListener?: (type: string, listener: (event: WheelEvent) => void) => void };
    if (!element.addEventListener || !element.removeEventListener) return;
    const preventPageScroll = (event: WheelEvent) => event.preventDefault();
    element.addEventListener("wheel", preventPageScroll, { passive: false });
    return () => element.removeEventListener?.("wheel", preventPageScroll);
  }, [renderer]);

  useFrame(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const now = performance.now();
    const focus = focusAnimation.current;
    if (focus && gestureRef.current.pointers.size === 0) {
      const progress = Math.min(1, (now - focus.startedAt) / FOCUS_DURATION_MS);
      globe.quaternion.copy(focus.from).slerp(focus.to, 1 - (1 - progress) ** 3).normalize();
      if (progress === 1) focusAnimation.current = undefined;
    }
    const pulseElapsed = pulseStartedAt.current === undefined ? FOCUS_PULSE_DURATION_MS : now - pulseStartedAt.current;
    if (pulseMaterial.current) pulseMaterial.current.opacity = pulseElapsed < FOCUS_PULSE_DURATION_MS ? 0.55 + 0.45 * Math.sin(pulseElapsed / 115) ** 2 : 1;
    if (focusAnimation.current || pulseElapsed < FOCUS_PULSE_DURATION_MS) invalidate();
  });

  const updateZoom = (nextDistance: number) => {
    cameraRef.current.position.z = clampGlobeZoom(nextDistance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    invalidate();
  };

  useEffect(() => {
    controlsRef.current = {
      rotateBy(radians) {
        const globe = globeRef.current;
        if (!globe) return;
        rotationDelta.setFromAxisAngle(worldYAxis, radians);
        globe.quaternion.premultiply(rotationDelta).normalize();
        invalidate();
      },
      zoomBy(distance) { updateZoom(cameraRef.current.position.z + distance); },
    };
    return () => { controlsRef.current = null; };
  });

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const gesture = gestureRef.current;
    const screen = eventScreenPoint(event);
    gesture.pointers.set(event.pointerId, screen);
    focusAnimation.current = undefined;

    if (gesture.pointers.size === 1) {
      gesture.activePointerId = event.pointerId;
      gesture.startScreen.copy(screen);
      gesture.previousTrackball.copy(trackballVector(event.pointer));
      gesture.moved = false;
      gesture.resetTrackball = false;
    } else {
      gesture.moved = true;
      gesture.pinchDistance = pointerDistance(gesture.pointers);
      gesture.pinchZoom = cameraRef.current.position.z;
    }

    const target = event.currentTarget as unknown as { setPointerCapture?: (pointerId: number) => void };
    target.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    const gesture = gestureRef.current;
    const activeTouches = activeTouchPoints(event);
    if (!gesture.pointers.has(event.pointerId) && activeTouches === undefined) return;
    event.stopPropagation();
    const screen = eventScreenPoint(event);
    if (activeTouches && activeTouches.size > 1) gesture.pointers = activeTouches;
    else gesture.pointers.set(event.pointerId, screen);

    if (gesture.pointers.size > 1) {
      const distance = pointerDistance(gesture.pointers);
      if (gesture.pinchDistance > 0 && distance > 0) {
        updateZoom(gesture.pinchZoom * gesture.pinchDistance / distance);
      }
      gesture.moved = true;
      return;
    }

    const globe = globeRef.current;
    if (gesture.resetTrackball && gesture.pointers.size === 1) gesture.activePointerId = event.pointerId;
    if (gesture.activePointerId !== event.pointerId || !globe) return;
    const current = trackballVector(event.pointer);
    if (gesture.resetTrackball) {
      gesture.previousTrackball.copy(current);
      gesture.resetTrackball = false;
      return;
    }
    rotationDelta.setFromUnitVectors(gesture.previousTrackball, current);
    globe.quaternion.premultiply(rotationDelta).normalize();
    invalidate();
    gesture.previousTrackball.copy(current);
    gesture.moved ||= exceedsGlobeDragThreshold(
      gesture.startScreen.x,
      gesture.startScreen.y,
      screen.x,
      screen.y,
      DRAG_THRESHOLD,
    );
  };

  const finishPointer = (event: ThreeEvent<PointerEvent>) => {
    const gesture = gestureRef.current;
    const remainingTouches = activeTouchPoints(event);
    if (!gesture.pointers.has(event.pointerId) && remainingTouches === undefined) return;
    event.stopPropagation();
    if (remainingTouches !== undefined) gesture.pointers = remainingTouches;
    else gesture.pointers.delete(event.pointerId);
    if (gesture.activePointerId === event.pointerId) gesture.activePointerId = undefined;
    if (gesture.pointers.size === 1) {
      gesture.activePointerId = [...gesture.pointers.keys()][0];
      gesture.resetTrackball = true;
      gesture.moved = true;
    }
    const target = event.currentTarget as unknown as { releasePointerCapture?: (pointerId: number) => void };
    target.releasePointerCapture?.(event.pointerId);
  };

  const cancelPointers = () => {
    const gesture = gestureRef.current;
    gesture.pointers.clear();
    gesture.activePointerId = undefined;
    gesture.resetTrackball = false;
    gesture.moved = true;
    focusAnimation.current = undefined;
  };

  const selectCountry = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (gestureRef.current.moved) return;
    const globe = globeRef.current;
    if (!globe) return;
    const coordinates = vectorToLatLon(globe.worldToLocal(event.point.clone()).normalize());
    onCountryPress?.(
      findCountryAtCoordinates(COUNTRIES, coordinates.latitude, coordinates.longitude),
      coordinates,
    );
  };

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 2.5, 4]} intensity={1.25} color="#dceaf0" />
      <group
        ref={globeRef}
        rotation={[0.08, -0.4, -0.04]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointers}
        onWheel={(event) => {
          event.stopPropagation();
          const wheel = event as unknown as { deltaY?: number; nativeEvent?: PointerSource; sourceEvent?: PointerSource };
          wheel.sourceEvent?.preventDefault?.();
          wheel.nativeEvent?.preventDefault?.();
          const deltaY = wheel.deltaY ?? (wheel.nativeEvent as { deltaY?: number } | undefined)?.deltaY ?? 0;
          updateZoom(cameraRef.current.position.z + deltaY * 0.0025);
        }}
      >
        <mesh raycast={disableRaycast}>
          <sphereGeometry args={[GLOBE_RADIUS, 72, 48]} />
          <meshStandardMaterial color="#071016" metalness={0.08} roughness={0.9} />
        </mesh>
        <mesh onClick={selectCountry}>
          <sphereGeometry args={[GLOBE_RADIUS, 24, 16]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
        <lineSegments geometry={boundaries} raycast={disableRaycast}>
          <lineBasicMaterial color="#a9bac2" transparent opacity={0.68} />
        </lineSegments>
        {selectedFill ? <mesh geometry={selectedFill} raycast={disableRaycast}><meshBasicMaterial color="#a9bac2" side={THREE.DoubleSide} transparent opacity={0.42} /></mesh> : null}
        {selectedBoundaries ? (
          <lineSegments geometry={selectedBoundaries} raycast={disableRaycast}>
            <lineBasicMaterial color="#a9bac2" transparent opacity={1} />
          </lineSegments>
        ) : null}
        {focusBoundaries ? (
          <lineSegments geometry={focusBoundaries} raycast={disableRaycast}>
            <lineBasicMaterial ref={pulseMaterial} color="#e7f7fb" transparent opacity={1} />
          </lineSegments>
        ) : null}
        {places.map((place) => (
          <PlaceMarker
            key={place.id}
            canSelect={() => !gestureRef.current.moved}
            onPress={onPlacePress}
            place={place}
            selected={place.id === selectedPlaceId}
          />
        ))}
      </group>
      <mesh scale={1.035}>
        <sphereGeometry args={[GLOBE_RADIUS, 48, 32]} />
        <meshBasicMaterial
          color="#638296"
          side={THREE.BackSide}
          transparent
          opacity={0.11}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

export function InteractiveGlobe({
  focusTarget,
  places = [],
  onPlacePress,
  onCountryPress,
  reducedMotion,
  selectedCountryCode,
  selectedPlaceId,
  style,
}: InteractiveGlobeProps) {
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const controlsRef = useRef<GlobeControls | null>(null);

  useEffect(() => {
    if (reducedMotion !== undefined) return;
    void AccessibilityInfo.isReduceMotionEnabled().then(setSystemReducedMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setSystemReducedMotion);
    return () => subscription.remove();
  }, [reducedMotion]);

  return (
    <View
      accessibilityActions={[
        { name: "increment", label: "Zoom in" },
        { name: "decrement", label: "Zoom out" },
        { name: "activate", label: "Rotate globe" },
      ]}
      accessibilityHint="Drag to rotate, pinch or scroll to zoom, or use the country search button."
      accessibilityLabel="Interactive country globe"
      accessibilityRole="adjustable"
      accessibilityValue={{ text: "World map" }}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "increment") controlsRef.current?.zoomBy(-0.25);
        else if (nativeEvent.actionName === "decrement") controlsRef.current?.zoomBy(0.25);
        else if (nativeEvent.actionName === "activate") controlsRef.current?.rotateBy(Math.PI / 8);
      }}
      style={[styles.root, Platform.OS === "web" && WEB_TOUCH_STYLE, style]}
    >
      <Canvas
      style={styles.canvas}
      camera={{ position: [0, 0, MAX_CAMERA_DISTANCE], fov: 40, near: 0.1, far: 20 }}
      dpr={[1, 2]}
      frameloop="demand"
      gl={{ antialias: Platform.OS !== "android", powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#020609"]} />
      <GlobeScene
        controlsRef={controlsRef}
        focusTarget={focusTarget}
        places={places}
        onPlacePress={onPlacePress}
        onCountryPress={onCountryPress}
        reducedMotion={reducedMotion ?? systemReducedMotion}
        selectedCountryCode={selectedCountryCode}
        selectedPlaceId={selectedPlaceId}
      />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: "100%", height: "100%" },
  canvas: { flex: 1, width: "100%", height: "100%" },
});
