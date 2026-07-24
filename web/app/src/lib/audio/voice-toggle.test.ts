import { describe, expect, test } from "bun:test";
import { voiceToggleAction } from "./voice-toggle";

describe("voiceToggleAction", () => {
  test("stops only the currently playing voice and otherwise starts from the top", () => {
    expect(voiceToggleAction("/atlas.mp3", "/atlas.mp3")).toBe("stop");
    expect(voiceToggleAction("/echo.mp3", "/atlas.mp3")).toBe("play");
    expect(voiceToggleAction(null, "/atlas.mp3")).toBe("play");
  });
});
