/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  setAuthSessionCookies,
} from "./session-cookies";

describe("web auth session cookies", () => {
  test("applies founder 15-minute access and one-day refresh", () => {
    const writes: Array<{ name: string; value: string; options: { maxAge: number; httpOnly: boolean; secure: boolean } }> = [];
    const response = { cookies: { set(name: string, value: string, options: { maxAge: number; httpOnly: true; secure: boolean }) { writes.push({ name, value, options }); } } };

    setAuthSessionCookies(response, { accessToken: "access", refreshToken: "refresh", accessTokenMaxAgeSeconds: 15 * 60, refreshTokenMaxAgeSeconds: 24 * 60 * 60 }, true);

    expect(writes.map(({ name }) => name)).toEqual([ACCESS_COOKIE, REFRESH_COOKIE]);
    expect(writes.map(({ options }) => options.maxAge)).toEqual([15 * 60, 24 * 60 * 60]);
    expect(writes.every(({ options }) => options.httpOnly && options.secure)).toBe(true);
  });

  test("applies ordinary seven-day access and one-year refresh", () => {
    const writes: Array<{ name: string; options: { maxAge: number } }> = [];
    const response = { cookies: { set(name: string, _value: string, options: { maxAge: number; httpOnly: true; secure: boolean }) { writes.push({ name, options }); } } };

    setAuthSessionCookies(response, { accessToken: "access", refreshToken: "refresh", accessTokenMaxAgeSeconds: 7 * 24 * 60 * 60, refreshTokenMaxAgeSeconds: 365 * 24 * 60 * 60 }, false);

    expect(writes.map(({ options }) => options.maxAge)).toEqual([7 * 24 * 60 * 60, 365 * 24 * 60 * 60]);
  });

  test("refuses to guess a cookie lifetime when backend policy is missing", () => {
    const response = { cookies: { set() {} } };
    expect(() => setAuthSessionCookies(response, { accessToken: "access" }, false)).toThrow("Missing valid vorinthex_access max age");
  });
});
