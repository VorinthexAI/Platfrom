"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { CORE_CAPABILITIES } from "@/lib/core";

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function CoreAppsDepthScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const journey = host?.parentElement?.parentElement;
    if (!host || !journey) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020406, 0.035);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
    camera.position.set(0, 0, 10);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const tunnel = new THREE.Group();
    scene.add(tunnel);
    const random = seededRandom(24081994);
    const ringMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xcbd5da,
      depthWrite: false,
      opacity: 0.14,
      transparent: true,
      wireframe: true,
    });
    const warmRingMaterial = ringMaterial.clone();
    warmRingMaterial.color.set(0xd9bc91);
    warmRingMaterial.opacity = 0.18;

    const textures: THREE.Texture[] = [];
    CORE_CAPABILITIES.forEach((capability, index) => {
      const z = -index * 18;
      const gate = new THREE.Group();
      gate.position.set(index % 2 === 0 ? 1.7 : -1.7, 0, z);
      gate.rotation.z = index * 0.34;

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(5.4 + (index % 2) * 0.7, 0.025, 4, 140),
        index % 2 === 0 ? warmRingMaterial : ringMaterial,
      );
      gate.add(ring);

      for (let orbit = 0; orbit < 3; orbit += 1) {
        const orbitRing = new THREE.Mesh(
          new THREE.TorusGeometry(2.1 + orbit * 1.15, 0.012, 3, 96),
          ringMaterial,
        );
        orbitRing.rotation.x = 0.35 + orbit * 0.22;
        orbitRing.rotation.y = index * 0.25 + orbit * 0.55;
        gate.add(orbitRing);
      }

      const texture = new THREE.TextureLoader().load(capability.icon);
      texture.colorSpace = THREE.SRGBColorSpace;
      textures.push(texture);
      const emblem = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          opacity: 0.2,
          transparent: true,
          depthWrite: false,
        }),
      );
      emblem.scale.set(2.7, 2.7, 1);
      emblem.rotation.z = -gate.rotation.z;
      gate.add(emblem);
      tunnel.add(gate);
    });

    const starPositions: number[] = [];
    for (let index = 0; index < 760; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 2.8 + Math.pow(random(), 0.55) * 16;
      starPositions.push(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        18 - random() * 116,
      );
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(starPositions, 3),
    );
    const starMaterial = new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xdfe5e8,
      depthWrite: false,
      opacity: 0.42,
      size: 0.045,
      sizeAttenuation: true,
      transparent: true,
    });
    scene.add(new THREE.Points(starGeometry, starMaterial));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let targetProgress = 0;
    let progress = 0;
    const clock = new THREE.Clock();
    const render = () => {
      const elapsed = clock.getElapsedTime();
      progress = reducedMotion.matches
        ? targetProgress
        : THREE.MathUtils.lerp(progress, targetProgress, 0.065);
      camera.position.z = 10 - progress * 76;
      camera.position.x = Math.sin(progress * Math.PI * 4) * 0.65;
      camera.position.y = Math.cos(progress * Math.PI * 3) * 0.32;
      camera.lookAt(camera.position.x * 0.15, camera.position.y * 0.15, camera.position.z - 12);
      if (!reducedMotion.matches) {
        tunnel.rotation.z = Math.sin(elapsed * 0.11) * 0.045;
        starMaterial.opacity = 0.36 + Math.sin(elapsed * 0.7) * 0.06;
      }
      renderer.render(scene, camera);
    };
    const updateProgress = () => {
      const rect = journey.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      targetProgress = THREE.MathUtils.clamp(-rect.top / travel, 0, 1);
      if (reducedMotion.matches) render();
    };
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updateProgress();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    window.addEventListener("scroll", updateProgress, { passive: true });
    resize();

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      renderer.setAnimationLoop(
        entry?.isIntersecting && !reducedMotion.matches ? render : null,
      );
      if (entry?.isIntersecting) render();
    }, { rootMargin: "120px" });
    intersectionObserver.observe(journey);
    render();

    return () => {
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("scroll", updateProgress);
      renderer.setAnimationLoop(null);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
        }
        if (object instanceof THREE.Sprite) object.material.dispose();
      });
      textures.forEach((texture) => texture.dispose());
      ringMaterial.dispose();
      warmRingMaterial.dispose();
      starMaterial.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} />;
}
