/* eslint-disable react/no-unknown-property */
import { useEffect, useMemo, useRef, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { AccessibilityInfo } from "react-native";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { Canvas } from "@/components/three/Canvas";
import {
  COUNTRIES,
  createCountryBoundaryGeometry,
  findCountryAtCoordinates,
  type CountryFeature,
} from "@/lib/globe-data";
import { latLonToVector, vectorToLatLon } from "@/lib/globe-math";
import { createEarthTextures } from "@/lib/earth-textures";
import { createRandom } from "@/lib/random";

const GLOBE_RADIUS = 1;
const DRAG_THRESHOLD = 14;
const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;
const ATMOSPHERE_FRAGMENT_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    float rim = pow(1.0 - max(dot(vNormal, vViewDirection), 0.0), 2.4);
    gl_FragColor = vec4(0.24, 0.56, 0.82, rim * 0.48);
  }
`;

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
  active: boolean;
  pointerId: number;
  start: THREE.Vector2;
  startScreen: THREE.Vector2;
  previous: THREE.Vector3;
  moved: boolean;
  lastTime: number;
};

function trackballVector(pointer: THREE.Vector2): THREE.Vector3 {
  const vector = new THREE.Vector3(pointer.x, pointer.y, 0);
  const squared = pointer.lengthSq();
  if (squared <= 1) vector.z = Math.sqrt(1 - squared);
  else vector.normalize();
  return vector;
}

function screenPoint(event: ThreeEvent<PointerEvent>) {
  const source = (event as unknown as { sourceEvent?: { offsetX?: number; offsetY?: number } }).sourceEvent;
  return new THREE.Vector2(source?.offsetX ?? event.pointer.x * 100, source?.offsetY ?? event.pointer.y * 100);
}

function createStars(): THREE.BufferGeometry {
  const random = createRandom(110);
  const positions = new Float32Array(120 * 3);
  for (let index = 0; index < 120; index += 1) {
    const longitude = random() * 360 - 180;
    const latitude = Math.asin(random() * 2 - 1) * 180 / Math.PI;
    const point = latLonToVector(latitude, longitude, 3.2 + random() * 1.8);
    positions.set([point.x, point.y, point.z], index * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function PlacePin({ place, onPress, selected }: { place: GlobePlace; onPress?: (place: GlobePlace) => void; selected: boolean }) {
  const normal = useMemo(() => {
    const value = latLonToVector(place.latitude, place.longitude);
    return new THREE.Vector3(value.x, value.y, value.z).normalize();
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
        onPress?.(place);
      }}
    >
      <mesh position={[0, 0.065, 0]} userData={{ placeId: place.id }}>
        <sphereGeometry args={[0.065, 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.07, 6]} />
        <meshBasicMaterial color={place.status === "visited" ? "#e5edf2" : "#9aa7af"} />
      </mesh>
      {place.status === "visited" ? (
        <mesh position={[0, 0.085, 0]}>
          <sphereGeometry args={[0.025, 12, 8]} />
          <meshStandardMaterial color="#f4f8fa" emissive="#8da9b8" emissiveIntensity={0.45} />
        </mesh>
      ) : (
        <mesh position={[0, 0.085, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.027, 0.007, 8, 16]} />
          <meshStandardMaterial color="#8f9ba3" emissive="#4f5960" emissiveIntensity={0.3} />
        </mesh>
      )}
      {selected ? <mesh position={[0, 0.086, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.045, 0.006, 8, 20]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh> : null}
    </group>
  );
}

function GlobeScene({ places, onPlacePress, onCountryPress, reducedMotion, selectedCountryCode, selectedPlaceId }: Required<Pick<InteractiveGlobeProps, "places">> & Omit<InteractiveGlobeProps, "places" | "style">) {
  const globeRef = useRef<THREE.Group>(null);
  const inertiaRef = useRef(new THREE.Vector3());
  const invalidate = useThree((state) => state.invalidate);
  const gestureRef = useRef<PointerGesture>({
    active: false,
    pointerId: -1,
    start: new THREE.Vector2(),
    startScreen: new THREE.Vector2(),
    previous: new THREE.Vector3(),
    moved: false,
    lastTime: 0,
  });
  const boundaryGeometry = useMemo(() => createCountryBoundaryGeometry(), []);
  const earthTextures = useMemo(() => createEarthTextures(), []);
  const selectedBoundaryGeometry = useMemo(() => {
    const feature = COUNTRIES.features.find(({ properties }) => properties.countryCode === selectedCountryCode);
    return feature ? createCountryBoundaryGeometry({ type: "FeatureCollection", features: [feature] }, 1.024) : undefined;
  }, [selectedCountryCode]);
  const starGeometry = useMemo(() => createStars(), []);
  const deltaQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const axis = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => () => {
    boundaryGeometry.dispose();
    starGeometry.dispose();
    earthTextures.surface.dispose();
    earthTextures.elevation.dispose();
  }, [boundaryGeometry, earthTextures, starGeometry]);
  useEffect(() => () => selectedBoundaryGeometry?.dispose(), [selectedBoundaryGeometry]);

  useFrame((_, delta) => {
    const globe = globeRef.current;
    const velocity = inertiaRef.current;
    if (!globe || gestureRef.current.active || reducedMotion || velocity.lengthSq() < 0.00001) return;

    const speed = velocity.length();
    deltaQuaternion.setFromAxisAngle(axis.copy(velocity).normalize(), speed * delta);
    globe.quaternion.premultiply(deltaQuaternion).normalize();
    velocity.multiplyScalar(Math.exp(-4.5 * delta));
    if (velocity.lengthSq() >= 0.00001) invalidate();
  });

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const pointer = event.pointer.clone();
    const gesture = gestureRef.current;
    gesture.active = true;
    gesture.pointerId = event.pointerId;
    gesture.start.copy(pointer);
    gesture.startScreen.copy(screenPoint(event));
    gesture.previous.copy(trackballVector(pointer));
    gesture.moved = false;
    gesture.lastTime = performance.now();
    inertiaRef.current.set(0, 0, 0);
    const target = event.currentTarget as unknown as { setPointerCapture?: (id: number) => void };
    target.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    const gesture = gestureRef.current;
    const globe = globeRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId || !globe) return;
    event.stopPropagation();

    const pointer = event.pointer.clone();
    const current = trackballVector(pointer);
    deltaQuaternion.setFromUnitVectors(gesture.previous, current);
    globe.quaternion.premultiply(deltaQuaternion).normalize();
    invalidate();

    const now = performance.now();
    const elapsed = Math.max((now - gesture.lastTime) / 1000, 1 / 120);
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(deltaQuaternion.w, -1, 1));
    if (angle > 0.0001) {
      axis.set(deltaQuaternion.x, deltaQuaternion.y, deltaQuaternion.z).normalize();
      inertiaRef.current.copy(axis).multiplyScalar(Math.min(angle / elapsed, 5));
    }
    gesture.previous.copy(current);
    gesture.lastTime = now;
    gesture.moved ||= screenPoint(event).distanceTo(gesture.startScreen) > DRAG_THRESHOLD;
  };

  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    gesture.active = false;
    const target = event.currentTarget as unknown as { releasePointerCapture?: (id: number) => void };
    target.releasePointerCapture?.(event.pointerId);

    if (gesture.moved && reducedMotion) inertiaRef.current.set(0, 0, 0);
    else invalidate();
  };

  const selectCountry = (event: ThreeEvent<MouseEvent>) => {
    if (gestureRef.current.moved) return;
    const globe = globeRef.current;
    if (!globe) return;
    const localPoint = globe.worldToLocal(event.point.clone()).normalize();
    const coordinates = vectorToLatLon(localPoint);
    onCountryPress?.(
      findCountryAtCoordinates(COUNTRIES, coordinates.latitude, coordinates.longitude),
      coordinates,
    );
  };

  return (
    <>
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#c7e7ff", "#172027", 0.52]} />
      <directionalLight position={[3.5, 2.2, 4]} intensity={2.65} color="#fff5df" />
      <pointLight position={[-3, -1, 2]} intensity={0.34} color="#54738b" />
      <points geometry={starGeometry}>
        <pointsMaterial color="#d7e0e5" size={0.012} transparent opacity={0.4} depthWrite={false} />
      </points>
      <group
        ref={globeRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { gestureRef.current.active = false; inertiaRef.current.set(0, 0, 0); }}
        onLostPointerCapture={() => { gestureRef.current.active = false; inertiaRef.current.set(0, 0, 0); }}
      >
        <mesh onClick={selectCountry}>
          <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
          <meshStandardMaterial
            map={earthTextures.surface}
            bumpMap={earthTextures.elevation}
            bumpScale={0.035}
            displacementMap={earthTextures.elevation}
            displacementScale={0.018}
            metalness={0.08}
            roughness={0.94}
            roughnessMap={earthTextures.elevation}
          />
        </mesh>
        <lineSegments geometry={boundaryGeometry}>
          <lineBasicMaterial color="#92a2ab" transparent opacity={0.52} />
        </lineSegments>
        {selectedBoundaryGeometry ? <lineSegments geometry={selectedBoundaryGeometry}>
          <lineBasicMaterial color="#f2f7fa" transparent opacity={0.96} />
        </lineSegments> : null}
        {places.map((place) => <PlacePin key={place.id} place={place} onPress={onPlacePress} selected={place.id === selectedPlaceId} />)}
      </group>
      <mesh scale={1.055}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 40]} />
        <shaderMaterial
          vertexShader={ATMOSPHERE_VERTEX_SHADER}
          fragmentShader={ATMOSPHERE_FRAGMENT_SHADER}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
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

  useEffect(() => {
    if (reducedMotion !== undefined) return;
    void AccessibilityInfo.isReduceMotionEnabled().then(setSystemReducedMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setSystemReducedMotion);
    return () => subscription.remove();
  }, [reducedMotion]);

  return (
    <Canvas
      style={style}
      camera={{ position: [0, 0, 2.75], fov: 42, near: 0.1, far: 20 }}
      frameloop="demand"
      gl={{ antialias: false, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#030507"]} />
      <GlobeScene
        places={places}
        onPlacePress={onPlacePress}
        onCountryPress={onCountryPress}
        reducedMotion={reducedMotion ?? systemReducedMotion}
        selectedCountryCode={selectedCountryCode}
        selectedPlaceId={selectedPlaceId}
      />
    </Canvas>
  );
}
