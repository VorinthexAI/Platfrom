"use client";

import { useEffect, useRef } from "react";
import styles from "./SiteChrome.module.css";

type Point = { x: number; y: number };
type Branch = { start: Point; controlA: Point; controlB: Point; end: Point; warm: boolean };

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function SiteNeuralBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let branches: Branch[] = [];
    let width = 0;
    let height = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const random = seededRandom(width * 37 + height * 71);
      branches = Array.from({ length: width < 640 ? 54 : 92 }, (_, index) => {
        const edge = index % 4;
        const horizontal = edge < 2;
        const start = horizontal
          ? { x: edge === 0 ? -24 : width + 24, y: random() * height }
          : { x: random() * width, y: edge === 2 ? -24 : height + 24 };
        const end = horizontal
          ? { x: width * (0.28 + random() * 0.44), y: height * (0.12 + random() * 0.76) }
          : { x: width * (0.08 + random() * 0.84), y: height * (0.28 + random() * 0.44) };
        const controlA = horizontal
          ? { x: start.x + (end.x - start.x) * (0.24 + random() * 0.16), y: start.y + (random() - 0.5) * height * 0.3 }
          : { x: start.x + (random() - 0.5) * width * 0.3, y: start.y + (end.y - start.y) * (0.24 + random() * 0.16) };
        const controlB = {
          x: start.x + (end.x - start.x) * (0.68 + random() * 0.15),
          y: start.y + (end.y - start.y) * (0.68 + random() * 0.15),
        };
        return { start, controlA, controlB, end, warm: index % 7 === 0 };
      });
    };

    const pointOnBranch = (branch: Branch, progress: number) => {
      const inverse = 1 - progress;
      return {
        x: inverse ** 3 * branch.start.x + 3 * inverse ** 2 * progress * branch.controlA.x + 3 * inverse * progress ** 2 * branch.controlB.x + progress ** 3 * branch.end.x,
        y: inverse ** 3 * branch.start.y + 3 * inverse ** 2 * progress * branch.controlA.y + 3 * inverse * progress ** 2 * branch.controlB.y + progress ** 3 * branch.end.y,
      };
    };

    const draw = (time = 0) => {
      context.clearRect(0, 0, width, height);
      context.lineWidth = 0.65;
      for (const [index, branch] of branches.entries()) {
        const gradient = context.createLinearGradient(branch.start.x, branch.start.y, branch.end.x, branch.end.y);
        const color = branch.warm ? "209, 220, 225" : "190, 204, 212";
        gradient.addColorStop(0, `rgba(${color}, 0)`);
        gradient.addColorStop(0.08, `rgba(${color}, 0.15)`);
        gradient.addColorStop(0.65, `rgba(${color}, 0.09)`);
        gradient.addColorStop(1, `rgba(${color}, 0)`);
        context.strokeStyle = gradient;
        context.beginPath();
        context.moveTo(branch.start.x, branch.start.y);
        context.bezierCurveTo(branch.controlA.x, branch.controlA.y, branch.controlB.x, branch.controlB.y, branch.end.x, branch.end.y);
        context.stroke();

        if (index % 5 === 0) {
          const progress = reducedMotion.matches ? 0.52 : ((time * 0.000025 + index * 0.083) % 0.76) + 0.08;
          const point = pointOnBranch(branch, progress);
          context.fillStyle = branch.warm ? "rgba(226, 235, 239, 0.34)" : "rgba(221, 231, 235, 0.3)";
          context.beginPath();
          context.arc(point.x, point.y, 1.15, 0, Math.PI * 2);
          context.fill();
        }
      }
      if (!reducedMotion.matches) frame = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      aria-hidden="true"
      className={styles.siteNeuralBackdrop}
      data-site-neural-backdrop
      ref={canvasRef}
    />
  );
}
