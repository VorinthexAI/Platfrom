"use client";

import { useEffect } from "react";
import { colors } from "@vorinthex/shared/ui";
import * as THREE from "three";

const SURFACE_SELECTOR = ".chrome-border.card-depth";
const MAX_SURFACES = 18;
const MAX_CRYSTALS = 1600;

interface CrystalDatum {
  x: number;
  y: number;
  size: number;
  stretch: number;
  rotation: number;
  colorIndex: number;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random01(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothNoise(seed: number, value: number) {
  const floor = Math.floor(value);
  const local = value - floor;
  const a = hashString(`${seed}:${floor}`) / 4294967295;
  const b = hashString(`${seed}:${floor + 1}`) / 4294967295;
  const eased = local * local * (3 - 2 * local);
  return a + (b - a) * eased;
}

function resolveTokenColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function surfaceSeed(element: Element, index: number) {
  return hashString(
    [
      element.getAttribute("data-crystal-seed"),
      element.getAttribute("aria-label"),
      element.id,
      element.className,
      index,
    ]
      .filter(Boolean)
      .join(":"),
  );
}

function edgePoint(rect: DOMRect, distance: number) {
  const width = rect.width;
  const height = rect.height;
  const perimeter = width * 2 + height * 2;
  const wrapped = ((distance % perimeter) + perimeter) % perimeter;

  if (wrapped < width) {
    return {
      x: rect.left + wrapped,
      y: rect.top - 1,
      edge: "top" as const,
      cornerBias: Math.min(wrapped, width - wrapped) / Math.max(width, 1),
    };
  }
  if (wrapped < width + height) {
    const y = wrapped - width;
    return {
      x: rect.right + 1,
      y: rect.top + y,
      edge: "right" as const,
      cornerBias: Math.min(y, height - y) / Math.max(height, 1),
    };
  }
  if (wrapped < width * 2 + height) {
    const x = wrapped - width - height;
    return {
      x: rect.right - x,
      y: rect.bottom + 1,
      edge: "bottom" as const,
      cornerBias: Math.min(x, width - x) / Math.max(width, 1),
    };
  }

  const y = wrapped - width * 2 - height;
  return {
    x: rect.left - 1,
    y: rect.bottom - y,
    edge: "left" as const,
    cornerBias: Math.min(y, height - y) / Math.max(height, 1),
  };
}

function crystalRotation(edge: ReturnType<typeof edgePoint>["edge"], jitter: number) {
  const base =
    edge === "top"
      ? 0
      : edge === "right"
        ? Math.PI / 2
        : edge === "bottom"
          ? Math.PI
          : -Math.PI / 2;
  return base + (jitter - 0.5) * 0.8;
}

function collectCrystals() {
  const surfaces = [...document.querySelectorAll(SURFACE_SELECTOR)]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 80 && rect.height > 48;
    })
    .slice(0, MAX_SURFACES);

  const crystals: CrystalDatum[] = [];

  surfaces.forEach((element, surfaceIndex) => {
    const rect = element.getBoundingClientRect();
    const seed = surfaceSeed(element, surfaceIndex);
    const rand = random01(seed);
    const perimeter = rect.width * 2 + rect.height * 2;
    const attempts = Math.min(260, Math.max(32, Math.floor(perimeter / 8)));

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (crystals.length >= MAX_CRYSTALS) return;

      const distance = (attempt / attempts) * perimeter + rand() * 7;
      const point = edgePoint(rect, distance);
      const noise = smoothNoise(seed, distance / 64);
      const cornerWeight = 1 - Math.min(point.cornerBias * 7, 1);
      const surfaceVariation = noise * 0.55 + cornerWeight * 0.28 + rand() * 0.17;

      const size = 4 + surfaceVariation * 7 + cornerWeight * 2.5;
      const offset = 1.5 + rand() * 4.5;
      const x =
        point.edge === "left"
          ? point.x - offset
          : point.edge === "right"
            ? point.x + offset
            : point.x;
      const y =
        point.edge === "top"
          ? point.y - offset
          : point.edge === "bottom"
            ? point.y + offset
            : point.y;

      crystals.push({
        x,
        y,
        size,
        stretch: 0.72 + surfaceVariation * 1.2,
        rotation: crystalRotation(point.edge, rand()),
        colorIndex: surfaceVariation > 0.78 ? 2 : surfaceVariation > 0.32 ? 1 : 0,
      });
    }
  });

  return crystals;
}

export function CrystalChromeLayer() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.zIndex = "60";
    canvas.style.pointerEvents = "none";
    canvas.style.background = "transparent";
    document.body.appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: "low-power",
    });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1000, 1000);
    camera.position.z = 100;

    const group = new THREE.Group();
    scene.add(group);

    const ambientLight = new THREE.AmbientLight(
      resolveTokenColor("--vui-color-crystal-edge-facet", colors.crystalEdgeFacet),
      2.1,
    );
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(
      resolveTokenColor(
        "--vui-color-crystal-edge-highlight",
        colors.crystalEdgeHighlight,
      ),
      1.4,
    );
    keyLight.position.set(-2, -3, 5);
    scene.add(keyLight);

    const geometry = new THREE.OctahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
      color: resolveTokenColor("--vui-color-crystal-edge-facet", colors.crystalEdgeFacet),
      roughness: 0.74,
      metalness: 0.12,
      emissive: resolveTokenColor(
        "--vui-color-crystal-edge-shadow",
        colors.crystalEdgeShadow,
      ),
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.98,
      vertexColors: true,
    });

    let mesh: THREE.InstancedMesh | null = null;
    const dummy = new THREE.Object3D();
    const palette = [
      new THREE.Color(
        resolveTokenColor("--vui-color-crystal-edge-facet", colors.crystalEdgeFacet),
      ),
      new THREE.Color(
        resolveTokenColor(
          "--vui-color-crystal-edge-highlight",
          colors.crystalEdgeHighlight,
        ),
      ),
      new THREE.Color(
        resolveTokenColor(
          "--vui-color-crystal-edge-highlight",
          colors.crystalEdgeHighlight,
        ),
      ),
    ];

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height, false);
      camera.left = 0;
      camera.right = width;
      camera.top = 0;
      camera.bottom = height;
      camera.updateProjectionMatrix();
    }

    function rebuild() {
      const crystals = collectCrystals();
      if (mesh) {
        group.remove(mesh);
        mesh = null;
      }
      if (crystals.length === 0) {
        renderer.render(scene, camera);
        return;
      }

      mesh = new THREE.InstancedMesh(geometry, material, crystals.length);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      crystals.forEach((crystal, index) => {
        dummy.position.set(crystal.x, crystal.y, 0);
        dummy.rotation.set(0.65, 0.24, crystal.rotation);
        dummy.scale.set(
          crystal.size * 0.55,
          crystal.size * crystal.stretch,
          crystal.size * 0.5,
        );
        dummy.updateMatrix();
        mesh?.setMatrixAt(index, dummy.matrix);
        mesh?.setColorAt(index, palette[crystal.colorIndex]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    }

    let animationFrame = 0;
    let frame = 0;
    let needsRebuild = true;

    function animate() {
      frame += 1;
      if (needsRebuild && frame % 8 === 1) {
        resize();
        rebuild();
        needsRebuild = false;
      }
      group.rotation.z = Math.sin(frame * 0.004) * 0.002;
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    }

    animate();
    const markDirty = () => {
      needsRebuild = true;
    };
    const observer = new MutationObserver(markDirty);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class", "style", "data-crystal-seed"],
    });
    const refreshTimer = window.setInterval(markDirty, 1000);

    window.addEventListener("resize", markDirty);
    window.addEventListener("scroll", markDirty, true);
    window.addEventListener("pointerup", markDirty);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearInterval(refreshTimer);
      observer.disconnect();
      window.removeEventListener("resize", markDirty);
      window.removeEventListener("scroll", markDirty, true);
      window.removeEventListener("pointerup", markDirty);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return null;
}
