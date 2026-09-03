import { describe, expect, test } from "bun:test";
import { isSafeRichTextUrl, parseRichText } from "../../../../shared/packages/ui/components/rich-text/rich-text-parser";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [mobile, web, packageSource, components, composer] = await Promise.all([
  read("../../../../shared/packages/ui/components/rich-text/rich-text.mobile.tsx"),
  read("../../../../shared/packages/ui/components/rich-text/rich-text.web.tsx"),
  read("../../../../shared/package.json"),
  read("../../../../shared/packages/ui/components.ts"),
  read("../components/PersistentCoreComposer.tsx"),
]);

describe("shared rich text parser", () => {
  test("normalizes GFM blocks and nested inline formatting", () => {
    const blocks = parseRichText("# Title\n\nA **bold _nested_** value.\n\n> Quote\n\n3. Three\n4. Four\n\n| Name | Value |\n|:--|--:|\n| A | *B* |\n\n```ts\nconst x = 1;\n```");
    expect(blocks.map(({ type }) => type)).toEqual(["heading", "paragraph", "blockquote", "list", "table", "code"]);
    expect(blocks[0]).toMatchObject({ type: "heading", depth: 1, children: [{ type: "text", text: "Title" }] });
    expect(blocks[1]?.type).toBe("paragraph");
    if (blocks[1]?.type !== "paragraph") throw new Error("Expected paragraph block.");
    expect(blocks[1].children[1]).toMatchObject({ type: "strong", children: [{ type: "text", text: "bold " }, { type: "emphasis" }] });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true, start: 3 });
    expect(blocks[4]).toMatchObject({ type: "table", align: ["left", "right"], rows: [[[expect.any(Object)], [{ type: "emphasis" }]]] });
    expect(blocks[5]).toMatchObject({ type: "code", language: "ts", text: "const x = 1;" });
  });

  test("keeps raw HTML and images inert and tolerates incomplete streamed syntax", () => {
    const html = JSON.stringify(parseRichText('<div onclick="alert(1)">raw</div>\n\n![tracker](https://example.com/pixel.gif)'));
    expect(html).toContain('<div onclick=\\"alert(1)\\">raw</div>');
    expect(html).toContain("tracker");
    expect(html).not.toContain("pixel.gif");
    expect(() => parseRichText("Partial **bold\n\n```ts\nconst pending = true")).not.toThrow();
  });

  test("allows only absolute HTTP links", () => {
    expect(isSafeRichTextUrl("https://vorinthex.com/path")).toBe(true);
    expect(isSafeRichTextUrl("http://localhost:3000")).toBe(true);
    for (const value of ["javascript:alert(1)", "data:text/html,x", "file:///secret", "/relative", "not a url"]) expect(isSafeRichTextUrl(value)).toBe(false);
  });
});

test("exports paired renderers with independently styleable semantic elements", () => {
  const pkg = JSON.parse(packageSource);
  expect(pkg.exports["./ui/rich-text"]).toEqual({ "react-native": "./packages/ui/components/rich-text/rich-text.mobile.tsx", default: "./packages/ui/components/rich-text/rich-text.web.tsx" });
  expect(pkg.dependencies.marked).toBe("^16.4.1");
  expect(components).toContain("./components/rich-text");
  for (const slot of ["paragraph", "heading", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "bold", "italic", "strikethrough", "link", "inlineCode", "codeBlockContainer", "codeBlock", "blockquote", "blockquoteText", "unorderedList", "orderedList", "listItem", "listMarker", "thematicBreak", "tableScroll", "table", "tableRow", "tableHeaderCell", "tableHeaderText", "tableCell", "tableCellText"]) {
    expect(mobile).toContain(`${slot}?:`);
    expect(web).toContain(`\"${slot}\"`);
  }
});

test("renders semantic web elements and horizontally scrollable native tables without HTML injection", () => {
  for (const element of ["<p", "<strong", "<em", "<del", "<a", "<pre", "<blockquote", "<ol", "<ul", "<table", "<thead", "<tbody", "<th", "<td"]) expect(web).toContain(element);
  expect(web).not.toContain("dangerouslySetInnerHTML");
  expect(mobile).toContain("<ScrollView horizontal key={key} nestedScrollEnabled");
  expect(mobile).toContain('heading: { fontSize: 14, lineHeight: 20, fontWeight: "700" }');
  expect(composer).toContain('import { RichText } from "@vorinthex/shared/ui/rich-text";');
  expect(composer).toContain('<RichText content={message.content} />');
});
