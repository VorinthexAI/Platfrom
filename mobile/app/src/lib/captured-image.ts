import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";

export type CapturedImage = { uri: string; width: number; height: number };

export async function normalizeCapturedJpeg(image: CapturedImage, options: { maxSide: number; compress: number }) {
  const longestSide = Math.max(image.width, image.height);
  const actions: ImageManipulator.Action[] = longestSide > options.maxSide
    ? [{ resize: image.width >= image.height ? { width: options.maxSide } : { height: options.maxSide } }]
    : [];
  const output = await ImageManipulator.manipulateAsync(image.uri, actions, { compress: options.compress, format: ImageManipulator.SaveFormat.JPEG });
  const file = new File(output.uri);
  return { uri: output.uri, width: output.width, height: output.height, sizeBytes: file.size, mimeType: "image/jpeg" as const, extension: "jpg" as const };
}
