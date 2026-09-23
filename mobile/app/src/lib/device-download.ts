import { File, Paths } from "expo-file-system";
import { EncodingType, writeAsStringAsync } from "expo-file-system/legacy";
import { Platform } from "react-native";
import ReactNativeBlobUtil from "react-native-blob-util";
import { safeFileName, stableDownloadFileName } from "./download-filename";

export async function saveBase64Download(fileName: string, mimeType: string, content: string) {
  const name = safeFileName(fileName);
  if (Platform.OS === "android") {
    const temporaryPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${Date.now()}-${name}`;
    try {
      await ReactNativeBlobUtil.fs.writeFile(temporaryPath, content, "base64");
      await ReactNativeBlobUtil.MediaCollection.copyToMediaStore({
        name,
        parentFolder: "",
        mimeType,
      }, "Download", temporaryPath);
      return "Downloads";
    } finally {
      await ReactNativeBlobUtil.fs.unlink(temporaryPath).catch(() => undefined);
    }
  }

  const file = new File(Paths.document, "Downloads", name);
  file.parentDirectory.create({ idempotent: true, intermediates: true });
  await writeAsStringAsync(file.uri, content, { encoding: EncodingType.Base64 });
  return "Downloads";
}

export async function saveTextDownload(fileName: string, content: string) {
  const name = safeFileName(fileName);
  if (Platform.OS === "android") {
    const temporaryPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${Date.now()}-${name}`;
    try {
      await ReactNativeBlobUtil.fs.writeFile(temporaryPath, content, "utf8");
      await ReactNativeBlobUtil.MediaCollection.copyToMediaStore({
        name,
        parentFolder: "",
        mimeType: "text/plain",
      }, "Download", temporaryPath);
      return "Downloads";
    } finally {
      await ReactNativeBlobUtil.fs.unlink(temporaryPath).catch(() => undefined);
    }
  }

  const file = new File(Paths.document, "Downloads", name);
  file.parentDirectory.create({ idempotent: true, intermediates: true });
  await writeAsStringAsync(file.uri, content, { encoding: EncodingType.UTF8 });
  return "Downloads";
}

export async function saveUrlDownload(url: string, fileName: string, mimeType: string) {
  const name = stableDownloadFileName(fileName, mimeType);
  if (Platform.OS === "android") {
    const temporary = new File(Paths.cache, `${Date.now()}-${name}`);
    try {
      await File.downloadFileAsync(url, temporary, { idempotent: true });
      await ReactNativeBlobUtil.MediaCollection.copyToMediaStore({ name, parentFolder: "", mimeType }, "Download", temporary.uri.replace(/^file:\/\//, ""));
      return "Downloads";
    } finally {
      if (temporary.exists) temporary.delete();
    }
  }

  const file = new File(Paths.document, "Downloads", name);
  file.parentDirectory.create({ idempotent: true, intermediates: true });
  await File.downloadFileAsync(url, file, { idempotent: true });
  return "Downloads";
}

export async function saveTemporaryBase64File(fileName: string, content: string) {
  const file = new File(Paths.cache, `${Date.now()}-${safeFileName(fileName)}`);
  await writeAsStringAsync(file.uri, content, { encoding: EncodingType.Base64 });
  return file;
}

export async function saveTemporaryUrlFile(fileName: string, url: string) {
  const file = new File(Paths.cache, `${Date.now()}-${safeFileName(fileName)}`);
  try {
    await File.downloadFileAsync(url, file, { idempotent: true });
    return file;
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}

export async function openTemporaryBase64File(fileName: string, mimeType: string, content: string) {
  const file = await saveTemporaryBase64File(fileName, content);
  const path = file.uri.replace(/^file:\/\//, "");
  try {
    if (Platform.OS === "android") await ReactNativeBlobUtil.android.actionViewIntent(path, mimeType, `Open ${fileName}`);
    else await ReactNativeBlobUtil.ios.openDocument(path);
    return file;
  } catch (cause) {
    file.delete();
    throw cause;
  }
}
