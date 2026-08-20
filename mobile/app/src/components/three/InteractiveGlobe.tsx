/* eslint-disable react/no-unknown-property */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const IDLE_DELAY_MS = 1400;
const IDLE_ROTATION_SPEED = 0.075;
const MIN_CAMERA_DISTANCE = 2.15;
const MAX_CAMERA_DISTANCE = 5.2;
const WEB_TOUCH_STYLE = { touchAction: "none" } as unknown as ViewStyle;
const disableRaycast: THREE.Object3D["raycast"] = () => {};

export type GlobePlace = Readonly<{
  id: string;
  latitude: number;
  longitude: number;
  status: "visited" | "planned";
}>;

export type InteractiveGlobeProps = {
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
      position={normal.clone().multiplyScalar(1.025)}
      quaternion={orientation}
      onClick={(event) => {
        event.stopPropagation();
        if (canSelect()) onPress?.(place);
      }}
    >
      <mesh position={[0, 0.055, 0]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]} raycast={disableRaycast}>
        <cylinderGeometry args={[0.006, 0.006, 0.06, 6]} />
        <meshBasicMaterial color={place.status === "visited" ? "#dce8ed" : "#7f9099"} />
      </mesh>
      <mesh position={[0, 0.07, 0]} raycast={disableRaycast} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[selected ? 0.035 : 0.023, selected ? 0.007 : 0.005, 8, 18]} />
        <meshBasicMaterial color={selected ? "#ffffff" : place.status === "visited" ? "#dce8ed" : "#7f9099"} />
      </mesh>
    </group>
  );
}

type GlobeSceneProps = Required<Pick<InteractiveGlobeProps, "places">> & Omit<InteractiveGlobeProps, "places" | "style"> & {
  controlsRef: { current: GlobeControls | null };
};

function GlobeScene({
  controlsRef,
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
  const lastInteractionAt = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boundaries = useMemo(() => createCountryBoundaryGeometry(), []);
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
  const rotationDelta = useMemo(() => new THREE.Quaternion(), []);
  const worldYAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const scheduleIdleRotation = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (!reducedMotion) idleTimer.current = setTimeout(() => invalidate(), IDLE_DELAY_MS);
  }, [invalidate, reducedMotion]);

  useEffect(() => () => boundaries.dispose(), [boundaries]);
  useEffect(() => () => selectedBoundaries?.dispose(), [selectedBoundaries]);
  useEffect(() => () => selectedFill?.dispose(), [selectedFill]);
  useEffect(() => {
    lastInteractionAt.current = performance.now();
    scheduleIdleRotation();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [scheduleIdleRotation]);
  useEffect(() => {
    const element = renderer.domElement as unknown as { addEventListener?: (type: string, listener: (event: WheelEvent) => void, options?: AddEventListenerOptions) => void; removeEventListener?: (type: string, listener: (event: WheelEvent) => void) => void };
    if (!element.addEventListener || !element.removeEventListener) return;
    const preventPageScroll = (event: WheelEvent) => event.preventDefault();
    element.addEventListener("wheel", preventPageScroll, { passive: false });
    return () => element.removeEventListener?.("wheel", preventPageScroll);
  }, [renderer]);

  useFrame((_, delta) => {
    const globe = globeRef.current;
    const gesture = gestureRef.current;
    if (
      !globe
      || reducedMotion
      || gesture.pointers.size > 0
      || performance.now() - lastInteractionAt.current < IDLE_DELAY_MS
    ) return;

    rotationDelta.setFromAxisAngle(worldYAxis, IDLE_ROTATION_SPEED * delta);
    globe.quaternion.premultiply(rotationDelta).normalize();
    invalidate();
  });

  const updateZoom = (nextDistance: number) => {
    cameraRef.current.position.z = clampGlobeZoom(nextDistance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    lastInteractionAt.current = performance.now();
    invalidate();
    scheduleIdleRotation();
  };

  useEffect(() => {
    controlsRef.current = {
      rotateBy(radians) {
        const globe = globeRef.current;
        if (!globe) return;
        rotationDelta.setFromAxisAngle(worldYAxis, radians);
        globe.quaternion.premultiply(rotationDelta).normalize();
        lastInteractionAt.current = performance.now();
        invalidate();
        scheduleIdleRotation();
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
    lastInteractionAt.current = performance.now();
    scheduleIdleRotation();

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
    lastInteractionAt.current = performance.now();

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
    lastInteractionAt.current = performance.now();
    scheduleIdleRotation();
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
    lastInteractionAt.current = performance.now();
    scheduleIdleRotation();
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
