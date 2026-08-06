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

type FlowParticle = {
  curve: THREE.CatmullRomCurve3;
  mesh: THREE.Mesh;
  offset: number;
  speed: number;
};

export function CoreNeuralScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-7, 7, 13, -13, 0.1, 100);
    camera.position.set(0, 0, 20);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    root.position.y = 8.8;
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xc4cbd0, 1.8));
    const warmLight = new THREE.PointLight(0xdce4e8, 54, 22, 1.8);
    warmLight.position.set(2.6, 2.8, 6);
    scene.add(warmLight);
    const coldLight = new THREE.PointLight(0xa9cce1, 34, 18, 2);
    coldLight.position.set(-3.8, -0.7, 5);
    scene.add(coldLight);

    const warmLine = new THREE.LineBasicMaterial({ color: 0xdce4e8, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false });
    const silverLine = new THREE.LineBasicMaterial({ color: 0xd9e0e3, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
    const trunkMaterial = new THREE.MeshBasicMaterial({ color: 0xd8dde0, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });

    const canopy = new THREE.Group();
    const random = seededRandom(19106);
    const curves: THREE.CatmullRomCurve3[] = [];
    const nodePositions: number[] = [];

    for (let branch = 0; branch < 84; branch += 1) {
      const rootBranch = branch < 10;
      const side = branch % 2 === 0 ? -1 : 1;
      const verticalBranch = !rootBranch && branch % 5 === 0;
      const spread = verticalBranch ? 0.25 + random() * 2 : 3.4 + random() * 6.6;
      const end = rootBranch
        ? new THREE.Vector3(
            side * (0.2 + random() * Math.max(0.8, 4.1 - branch * 0.3)),
            -5.4 - branch * 0.92 - random() * 1.8,
            -0.5 + random() * 0.8,
          )
        : new THREE.Vector3(side * spread, verticalBranch ? 5.2 + random() * 2.5 : -0.2 + random() * 5.8, -0.55 + random() * 1.15);
      const direction = end.clone().normalize();
      const start = direction.clone().multiplyScalar(0.08);
      const tangent = new THREE.Vector3(-direction.y, direction.x, 0);
      const bend = side * (0.08 + random() * 0.5);
      const points = [
        start,
        start.clone().lerp(end, 0.32).addScaledVector(tangent, bend).add(new THREE.Vector3(0, rootBranch ? -0.1 : 0.18, 0.18 + random() * 0.28)),
        start.clone().lerp(end, 0.68).addScaledVector(tangent, bend * 0.65).add(new THREE.Vector3(0, rootBranch ? 0 : 0.22, 0.22 + random() * 0.3)),
        end,
      ];
      const curve = new THREE.CatmullRomCurve3(points);
      curves.push(curve);
      const sampled = curve.getPoints(64);
      canopy.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(sampled), branch % 4 === 0 ? warmLine : silverLine));
      if (branch < 16) canopy.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, branch < 10 ? 0.025 : 0.014, 5, false), trunkMaterial));
      for (let index = rootBranch ? 25 : 18 + Math.floor(random() * 12); index < sampled.length; index += rootBranch ? 25 : 14 + Math.floor(random() * 13)) {
        const point = sampled[index]!;
        nodePositions.push(point.x, point.y, point.z + 0.08);
      }
    }
    root.add(canopy);

    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(nodePositions, 3));
    const nodeMaterial = new THREE.PointsMaterial({ color: 0xe5ecef, size: 0.075, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    root.add(new THREE.Points(nodeGeometry, nodeMaterial));

    const particleGeometry = new THREE.SphereGeometry(0.035, 8, 8);
    const particleMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f5f6, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
    const particles: FlowParticle[] = [];
    for (const [index, curve] of curves.entries()) {
      const count = index < 10 ? 1 : index < 24 ? 2 : 1;
      for (let particleIndex = 0; particleIndex < count; particleIndex += 1) {
        const mesh = new THREE.Mesh(particleGeometry, particleMaterial);
        mesh.scale.setScalar(index < 10 ? 1.2 : index < 24 ? 1.35 : 0.9);
        canopy.add(mesh);
        particles.push({ curve, mesh, offset: random(), speed: 0.045 + random() * 0.08 });
      }
    }

    const core = new THREE.Group();
    const logoTexture = new THREE.TextureLoader().load("/logos/vorinthex-mark.png");
    logoTexture.colorSpace = THREE.SRGBColorSpace;
    const logo = new THREE.Sprite(new THREE.SpriteMaterial({ map: logoTexture, transparent: true, depthTest: false }));
    logo.position.z = 0.55;
    logo.scale.set(2.05, 2.05, 1);
    core.add(logo);
    root.add(core);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clock = new THREE.Clock();
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const verticalSpan = 26;
      camera.left = (-verticalSpan * aspect) / 2;
      camera.right = (verticalSpan * aspect) / 2;
      camera.top = verticalSpan / 2;
      camera.bottom = -verticalSpan / 2;
      root.position.x = width > 980 ? Math.min(7, aspect * 5) : 0;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();
      if (!reducedMotion.matches) {
        const breath = 1 + Math.sin(elapsed * 0.7) * 0.012;
        canopy.scale.set(breath, 1 + Math.cos(elapsed * 0.65) * 0.009, 1);
        canopy.rotation.z = Math.sin(elapsed * 0.24) * 0.012;
        core.position.y = Math.sin(elapsed * 0.82) * 0.08;
        nodeMaterial.size = 0.075 + (Math.sin(elapsed * 2.1) + 1) * 0.018;
        warmLight.intensity = 48 + Math.sin(elapsed * 1.4) * 10;
        for (const particle of particles) particle.mesh.position.copy(particle.curve.getPointAt((elapsed * particle.speed + particle.offset) % 1));
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
      warmLine.dispose();
      silverLine.dispose();
      trunkMaterial.dispose();
      nodeMaterial.dispose();
      particleMaterial.dispose();
      logoTexture.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div aria-hidden="true" ref={hostRef} />;
}
