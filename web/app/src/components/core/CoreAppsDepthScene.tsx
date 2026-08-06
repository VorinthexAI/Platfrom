"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { CORE_CAPABILITIES } from "@/lib/core";

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
    const textures: THREE.Texture[] = [];
    const gates: Array<{
      emblemMaterial: THREE.SpriteMaterial;
      group: THREE.Group;
      materials: THREE.MeshBasicMaterial[];
    }> = [];
    CORE_CAPABILITIES.forEach((capability, index) => {
      const gate = new THREE.Group();
      gate.position.set(index % 2 === 0 ? 2.6 : -2.6, 0, 0);
      gate.rotation.z = index * 0.18;

      const outerMaterial = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index % 2 === 0 ? 0xd9bc91 : 0xcbd5da,
        depthWrite: false,
        opacity: 0,
        transparent: true,
      });
      const innerMaterial = outerMaterial.clone();

      const outerRing = new THREE.Mesh(
        new THREE.TorusGeometry(6.2, 0.022, 5, 128),
        outerMaterial,
      );
      const innerRing = new THREE.Mesh(
        new THREE.TorusGeometry(4.65, 0.012, 4, 96),
        innerMaterial,
      );
      innerRing.rotation.x = 0.42;
      innerRing.rotation.y = 0.28;
      gate.add(outerRing, innerRing);

      const texture = new THREE.TextureLoader().load(capability.icon);
      texture.colorSpace = THREE.SRGBColorSpace;
      textures.push(texture);
      const emblemMaterial = new THREE.SpriteMaterial({
        map: texture,
        opacity: 0,
        transparent: true,
        depthWrite: false,
      });
      const emblem = new THREE.Sprite(emblemMaterial);
      emblem.scale.set(2.7, 2.7, 1);
      emblem.rotation.z = -gate.rotation.z;
      gate.add(emblem);
      tunnel.add(gate);
      gates.push({
        emblemMaterial,
        group: gate,
        materials: [outerMaterial, innerMaterial],
      });
    });

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const steps = Array.from(
      journey.querySelectorAll<HTMLElement>("[data-core-app-step]"),
    );
    let targetProgress = 0;
    let progress = 0;
    const clock = new THREE.Clock();
    const render = () => {
      const elapsed = clock.getElapsedTime();
      progress = reducedMotion.matches
        ? targetProgress
        : THREE.MathUtils.lerp(progress, targetProgress, 0.065);
      camera.position.z = 12 - progress * 5;
      camera.position.x = Math.sin(progress * Math.PI * 4) * 0.65;
      camera.position.y = Math.cos(progress * Math.PI * 3) * 0.32;
      camera.lookAt(camera.position.x * 0.15, camera.position.y * 0.15, camera.position.z - 12);
      if (!reducedMotion.matches) {
        tunnel.rotation.z = Math.sin(elapsed * 0.11) * 0.045;
      }
      gates.forEach((gate, index) => {
        const stepRect = steps[index]?.getBoundingClientRect();
        const distance = stepRect
          ? Math.abs(stepRect.top + stepRect.height / 2 - window.innerHeight / 2)
          : window.innerHeight;
        const strength = THREE.MathUtils.smoothstep(
          1 - distance / (window.innerHeight * 0.72),
          0,
          1,
        );
        gate.group.visible = strength > 0.01;
        gate.materials[0]!.opacity = strength * 0.17;
        gate.materials[1]!.opacity = strength * 0.1;
        gate.emblemMaterial.opacity = strength * 0.11;
      });
      renderer.render(scene, camera);
    };
    const updateProgress = () => {
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      steps.forEach((step, index) => {
        const rect = step.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      const activeRect = steps[closestIndex]?.getBoundingClientRect();
      const localProgress = activeRect
        ? THREE.MathUtils.clamp(
            (window.innerHeight / 2 - activeRect.top) / activeRect.height,
            0,
            1,
          )
        : 0;
      targetProgress = localProgress;
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
      gates.forEach((gate) => gate.materials.forEach((material) => material.dispose()));
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} />;
}
