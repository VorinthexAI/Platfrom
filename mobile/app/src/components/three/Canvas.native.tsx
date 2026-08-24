import { Canvas as FiberCanvas, type RootState } from "@react-three/fiber/native";
import type { ComponentProps } from "react";

type CanvasProps = ComponentProps<typeof FiberCanvas>;

/** Native three.js canvas backed by expo-gl. */
export function Canvas({ onCreated, ...props }: CanvasProps) {
  function handleCreated(state: RootState) {
    const context = state.gl.getContext();
    const pixelStorei = context.pixelStorei.bind(context);
    context.pixelStorei = (parameter, value) => {
      // Expo GL ignores these WebGL browser flags and logs for every texture upload.
      if (parameter === context.UNPACK_PREMULTIPLY_ALPHA_WEBGL || parameter === context.UNPACK_COLORSPACE_CONVERSION_WEBGL) return;
      pixelStorei(parameter, value);
    };
    onCreated?.(state);
  }

  return <FiberCanvas {...props} onCreated={handleCreated} />;
}
