import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { capturedImageCoordinates, type CapturedImage } from "./image-coordinates";

export type { CapturedImage } from "./image-coordinates";

export async function normalizeCapturedPng(image: CapturedImage, options: { maxSide: number; compress: number }) {
  const coordinates = capturedImageCoordinates(image);
  const longestSide = Math.max(image.width, image.height);
  const actions: ImageManipulator.Action[] = longestSide > options.maxSide
    ? [{ resize: image.width >= image.height ? { width: options.maxSide } : { height: options.maxSide } }]
    : [];
  const output = await ImageManipulator.manipulateAsync(image.uri, actions, { compress: options.compress, format: ImageManipulator.SaveFormat.PNG });
  const file = new File(output.uri);
  return { uri: output.uri, width: output.width, height: output.height, sizeBytes: file.size, mimeType: "image/png" as const, extension: "png" as const, ...coordinates };
}
