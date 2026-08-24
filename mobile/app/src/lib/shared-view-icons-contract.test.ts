import { expect, test } from "bun:test";

const sharedIconsRoot = new URL("../../../../shared/packages/ui/", import.meta.url);
const webAggregate = await Bun.file(new URL("icons.ts", sharedIconsRoot)).text();
const mobileAggregate = await Bun.file(new URL("icons-mobile.ts", sharedIconsRoot)).text();

const iconSources = await Promise.all(["globe-view", "table-view"].flatMap((name) => [
  Bun.file(new URL(`icons/${name}/${name}.web.tsx`, sharedIconsRoot)).text(),
  Bun.file(new URL(`icons/${name}/${name}.mobile.tsx`, sharedIconsRoot)).text(),
]));

test("exports product-neutral globe and table view icons with web and mobile parity", async () => {
  expect(webAggregate).toContain("export * from './icons/globe-view';");
  expect(webAggregate).toContain("export * from './icons/table-view';");
  expect(mobileAggregate).toContain('export * from "./icons/globe-view/globe-view.mobile";');
  expect(mobileAggregate).toContain('export * from "./icons/table-view/table-view.mobile";');

  for (const name of ["globe-view", "table-view"]) {
    const directoryIndex = await Bun.file(new URL(`icons/${name}/index.ts`, sharedIconsRoot)).text();
    expect(directoryIndex).toContain(`export * from './${name}.web';`);
  }

  for (const source of iconSources) {
    expect(source).toContain('"sm" | "md" | "lg"');
    expect(source).toContain('{ sm: 16, md: 20, lg: 24 }');
    expect(source).toContain('"default"');
    expect(source).toContain('"muted"');
    expect(source).toContain('"accent"');
    expect(source).toContain('"danger"');
    expect(source).toContain('"inverse"');
  }
});

test("uses accessible web SVG contracts and react-native-svg artwork", () => {
  const [globeWeb, globeMobile, tableWeb, tableMobile] = iconSources;
  expect(globeWeb).toContain('aria-hidden="true" focusable="false"');
  expect(tableWeb).toContain('aria-hidden="true" focusable="false"');
  expect(globeMobile).toContain('from "react-native-svg"');
  expect(tableMobile).toContain('from "react-native-svg"');
  expect(globeWeb).toContain('<circle cx="12" cy="12" r="8.5"');
  expect(globeMobile).toContain('<Circle cx={12} cy={12} r={8.5}');
  expect(tableWeb).toContain('M3.5 9h17M3.5 14.5h17M10 9v11');
  expect(tableMobile).toContain('M3.5 9h17M3.5 14.5h17M10 9v11');
});
