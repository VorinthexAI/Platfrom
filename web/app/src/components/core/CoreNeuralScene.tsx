"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function CoreNeuralScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.3, 14);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xbec8d0, 1.4));
    const keyLight = new THREE.PointLight(0xffe4bc, 42, 22, 1.8);
    keyLight.position.set(3.5, 3.8, 6);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0xa9c7da, 28, 18, 2);
    rimLight.position.set(-4, -1, 5);
    scene.add(rimLight);

    const chrome = new THREE.MeshPhysicalMaterial({
      color: 0xbfc5c8,
      metalness: 1,
      roughness: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    const darkChrome = new THREE.MeshPhysicalMaterial({ color: 0x090b0d, metalness: 0.92, roughness: 0.18, clearcoat: 1 });
    const warmLine = new THREE.LineBasicMaterial({ color: 0xe7d1ad, transparent: true, opacity: 0.58, blending: THREE.AdditiveBlending });
    const silverLine = new THREE.LineBasicMaterial({ color: 0xc9d2d7, transparent: true, opacity: 0.46, blending: THREE.AdditiveBlending });

    const disc = new THREE.Mesh(new THREE.SphereGeometry(1.18, 64, 32), darkChrome);
    disc.scale.z = 0.34;
    root.add(disc);
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.105, 16, 96), chrome);
    root.add(outerRing);
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.025, 10, 96), chrome);
    root.add(innerRing);

    const emblem = new THREE.Group();
    const bladeGeometry = new THREE.CylinderGeometry(0.035, 0.055, 1.25, 8);
    const addBlade = (x: number, rotation: number, y: number) => {
      const blade = new THREE.Mesh(bladeGeometry, chrome);
      blade.position.set(x, y, 0.43);
      blade.rotation.z = rotation;
      emblem.add(blade);
    };
    addBlade(-0.36, -0.45, 0.03);
    addBlade(-0.1, -0.28, -0.08);
    addBlade(0.18, 0.37, -0.08);
    addBlade(0.42, 0.5, 0.04);
    root.add(emblem);

    const random = seededRandom(7319);
    const nodePositions: number[] = [];
    const branchGroup = new THREE.Group();
    for (let branch = 0; branch < 54; branch += 1) {
      const angle = (branch / 54) * Math.PI * 2 + (random() - 0.5) * 0.18;
      const downward = Math.sin(angle) < -0.42;
      const length = downward ? 3.6 + random() * 1.8 : 3.1 + random() * 3.2;
      const start = new THREE.Vector3(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, -0.08);
      const end = new THREE.Vector3(
        Math.cos(angle) * length,
        Math.sin(angle) * length * (downward ? 1.18 : 0.82) + (downward ? -0.7 : 0.45),
        -0.5 + random() * 1.2,
      );
      const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0).multiplyScalar((random() - 0.5) * 2.4);
      const midpoint = start.clone().lerp(end, 0.52).add(tangent);
      midpoint.z += 0.25 + random() * 0.65;
      const curve = new THREE.CatmullRomCurve3([start, midpoint, end]);
      const points = curve.getPoints(42);
      branchGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), branch % 3 === 0 ? warmLine : silverLine));
      for (let point = 12 + Math.floor(random() * 10); point < points.length; point += 10 + Math.floor(random() * 10)) {
        const position = points[point]!;
        nodePositions.push(position.x, position.y, position.z + 0.05);
      }
    }
    root.add(branchGroup);

    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(nodePositions, 3));
    const nodes = new THREE.Points(nodeGeometry, new THREE.PointsMaterial({
      color: 0xffe6bf,
      size: 0.075,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }));
    root.add(nodes);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.12, 4.2, 10), chrome);
    stem.position.y = -3.1;
    root.add(stem);
    const floor = new THREE.Group();
    floor.position.y = -5.18;
    floor.rotation.x = Math.PI / 2.36;
    for (let index = 0; index < 8; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.2 + index * 0.55, 0.008, 6, 96),
        new THREE.MeshBasicMaterial({ color: index % 2 ? 0x8d7658 : 0x8a969b, transparent: true, opacity: 0.3 - index * 0.025 }),
      );
      floor.add(ring);
    }
    root.add(floor);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clock = new THREE.Clock();
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();
      if (!reducedMotion.matches) {
        branchGroup.rotation.z = Math.sin(elapsed * 0.16) * 0.015;
        outerRing.rotation.z = elapsed * 0.035;
        nodes.material.opacity = 0.72 + Math.sin(elapsed * 1.45) * 0.2;
        keyLight.intensity = 38 + Math.sin(elapsed * 1.1) * 6;
      }
      renderer.render(scene, camera);
    });

    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) object.geometry.dispose();
      });
      chrome.dispose();
      darkChrome.dispose();
      warmLine.dispose();
      silverLine.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div aria-hidden="true" ref={hostRef} />;
}
