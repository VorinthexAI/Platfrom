import { describe, expect, test } from "bun:test";
import { capturedImageCoordinates } from "./image-coordinates";

describe("captured image coordinates", () => {
  test("reads signed decimal GPS values", () => {
    expect(capturedImageCoordinates({ uri: "image", width: 1, height: 1, latitude: 59.3293, longitude: 18.0686 })).toEqual({ latitude: 59.3293, longitude: 18.0686 });
  });

  test("converts EXIF degrees, minutes, and seconds with hemisphere references", () => {
    expect(capturedImageCoordinates({ uri: "image", width: 1, height: 1, exif: { GPSLatitude: [33, 51, 35.2], GPSLatitudeRef: "S", GPSLongitude: [151, 12, 40], GPSLongitudeRef: "E" } })).toEqual({ latitude: -(33 + 51 / 60 + 35.2 / 3_600), longitude: 151 + 12 / 60 + 40 / 3_600 });
  });

  test("rejects incomplete and out-of-range coordinates", () => {
    expect(capturedImageCoordinates({ uri: "image", width: 1, height: 1, latitude: 91, longitude: 0 })).toBeUndefined();
    expect(capturedImageCoordinates({ uri: "image", width: 1, height: 1, exif: { GPSLatitude: [1, 2, 3] } })).toBeUndefined();
  });
});
