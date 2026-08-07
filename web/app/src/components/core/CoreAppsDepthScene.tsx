"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { CORE_CAPABILITIES } from "@/lib/core";

const GATE_SPACING = 18;

export function CoreAppsDepthScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const journey = host?.parentElement?.parentElement;
    if (!host || !journey) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020406, 0.026);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
    camera.position.set(0, 0, 12);

    const mobileAtMount = window.innerWidth <= 640;
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !mobileAtMount,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const tunnel = new THREE.Group();
    scene.add(tunnel);
    const textures: THREE.Texture[] = [];
    const outerGeometry = new THREE.TorusGeometry(6.2, 0.022, 5, 96);
    const innerGeometry = new THREE.TorusGeometry(4.65, 0.012, 4, 72);
    const gates: Array<{
      emblemMaterial: THREE.SpriteMaterial;
      group: THREE.Group;
      materials: THREE.MeshBasicMaterial[];
    }> = [];
    let disposed = false;

    CORE_CAPABILITIES.forEach((capability, index) => {
      const gate = new THREE.Group();
      gate.position.z = -index * GATE_SPACING;
      gate.rotation.z = index * 0.18;

      const outerMaterial = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index % 2 === 0 ? 0xdce4e8 : 0xcbd5da,
        depthWrite: false,
        opacity: 0,
        transparent: true,
      });
      const innerMaterial = outerMaterial.clone();
      const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
      const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);
      innerRing.rotation.x = 0.42;
      innerRing.rotation.y = 0.28;
      gate.add(outerRing, innerRing);

      const emblemMaterial = new THREE.SpriteMaterial({
        opacity: 0,
        transparent: true,
        depthWrite: false,
      });
      const texture = new THREE.TextureLoader().load(capability.icon, (loaded) => {
        if (disposed) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        emblemMaterial.map = loaded;
        emblemMaterial.needsUpdate = true;
        render();
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      textures.push(texture);
      emblemMaterial.map = texture;
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
    const strengths = gates.map(() => 0);
    let targetProgress = 0;
    let progress = 0;
    let isIntersecting = false;
    let isMobile = mobileAtMount;
    let measurementFrame = 0;
    let lastFrameTime = 0;

    function render(time = performance.now()) {
      const delta = lastFrameTime
        ? Math.min((time - lastFrameTime) / 1000, 0.05)
        : 1 / 60;
      lastFrameTime = time;
      progress = reducedMotion.matches
        ? 0
        : THREE.MathUtils.damp(progress, targetProgress, 5.5, delta);
      camera.position.z = 12 - progress * GATE_SPACING * (gates.length - 1);
      camera.position.x = reducedMotion.matches ? 0 : Math.sin(progress * Math.PI * 4) * (isMobile ? 0.18 : 0.72);
      camera.position.y = (isMobile ? 0.75 : 0) + (reducedMotion.matches ? 0 : Math.cos(progress * Math.PI * 3) * (isMobile ? 0.12 : 0.3));
      camera.lookAt(camera.position.x * 0.12, isMobile ? 0.85 : camera.position.y * 0.12, camera.position.z - 12);
      tunnel.rotation.z = reducedMotion.matches ? 0 : Math.sin(time * 0.00011) * 0.04;

      gates.forEach((gate, index) => {
        const strength = reducedMotion.matches
          ? 0
          : strengths[index] ?? 0;
        gate.group.visible = strength > 0.01;
        gate.materials[0]!.opacity = strength * 0.22;
        gate.materials[1]!.opacity = strength * 0.13;
        gate.emblemMaterial.opacity = strength * 0.18;
      });
      renderer.render(scene, camera);
    }

    const measure = () => {
      measurementFrame = 0;
      if (steps.length === 0) return;
      const viewportCenter = window.innerHeight / 2;
      const centers = steps.map((step) => {
        const rect = step.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      const firstCenter = centers[0] ?? viewportCenter;
      const lastCenter = centers.at(-1) ?? firstCenter;
      targetProgress = THREE.MathUtils.clamp(
        (viewportCenter - firstCenter) / Math.max(lastCenter - firstCenter, 1),
        0,
        1,
      );
      centers.forEach((center, index) => {
        strengths[index] = THREE.MathUtils.smoothstep(
          1 - Math.abs(center - viewportCenter) / (window.innerHeight * 0.82),
          0,
          1,
        );
      });
      if (reducedMotion.matches && isIntersecting) render();
    };
    const scheduleMeasure = () => {
      if (!measurementFrame) measurementFrame = window.requestAnimationFrame(measure);
    };

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      isMobile = width <= 640;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 1.35));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = isMobile ? 66 : 48;
      camera.updateProjectionMatrix();
      gates.forEach((gate, index) => {
        gate.group.position.x = (index % 2 === 0 ? 1 : -1) * (isMobile ? 0.7 : 2.35);
        gate.group.position.y = isMobile ? 1.5 : 0;
        gate.group.scale.setScalar(isMobile ? 0.62 : 1);
      });
      scheduleMeasure();
    };
    const syncAnimation = () => {
      lastFrameTime = 0;
      renderer.setAnimationLoop(isIntersecting && !reducedMotion.matches ? render : null);
      if (isIntersecting) render();
    };
    const handleMotionChange = () => {
      progress = targetProgress;
      measure();
      syncAnimation();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    reducedMotion.addEventListener("change", handleMotionChange);

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isIntersecting = Boolean(entry?.isIntersecting);
      if (isIntersecting) measure();
      syncAnimation();
    }, { rootMargin: "120px" });
    intersectionObserver.observe(journey);
    resize();
    measure();
    render();

    return () => {
      disposed = true;
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleMeasure);
      reducedMotion.removeEventListener("change", handleMotionChange);
      if (measurementFrame) window.cancelAnimationFrame(measurementFrame);
      renderer.setAnimationLoop(null);
      textures.forEach((texture) => texture.dispose());
      gates.forEach((gate) => {
        gate.emblemMaterial.dispose();
        gate.materials.forEach((material) => material.dispose());
      });
      outerGeometry.dispose();
      innerGeometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} />;
}
