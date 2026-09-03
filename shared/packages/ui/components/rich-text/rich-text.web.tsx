import { createElement, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { isSafeRichTextUrl, parseRichText, type RichTextBlock, type RichTextInline } from "./rich-text-parser";

export type RichTextStyles = Partial<Record<"root" | "paragraph" | "heading" | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6" | "bold" | "italic" | "strikethrough" | "link" | "inlineCode" | "codeBlockContainer" | "codeBlock" | "blockquote" | "blockquoteText" | "unorderedList" | "orderedList" | "listItem" | "listMarker" | "thematicBreak" | "tableScroll" | "table" | "tableRow" | "tableHeaderCell" | "tableHeaderText" | "tableCell" | "tableCellText", CSSProperties>>;
export type RichTextClassNames = Partial<Record<keyof RichTextStyles, string>>;
export type RichTextProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & { content: string; styles?: RichTextStyles; classNames?: RichTextClassNames; onLinkPress?: (url: string) => void };

const classes = (base: string, extra?: string) => [base, extra].filter(Boolean).join(" ");

function Inlines({ nodes, styles, classNames, onLinkPress, prefix }: { nodes: RichTextInline[]; styles: RichTextStyles; classNames: RichTextClassNames; onLinkPress?: (url: string) => void; prefix: string }) {
  return nodes.map((node, index): ReactNode => {
    const key = `${prefix}-${index}`;
    if (node.type === "text") return node.text;
    if (node.type === "break") return <br key={key} />;
    if (node.type === "inlineCode") return <code className={classes("vui-rich-text-inline-code", classNames.inlineCode)} key={key} style={styles.inlineCode}>{node.text}</code>;
    const children = <Inlines nodes={node.children} styles={styles} classNames={classNames} onLinkPress={onLinkPress} prefix={key} />;
    if (node.type === "strong") return <strong className={classNames.bold} key={key} style={styles.bold}>{children}</strong>;
    if (node.type === "emphasis") return <em className={classNames.italic} key={key} style={styles.italic}>{children}</em>;
    if (node.type === "strikethrough") return <del className={classNames.strikethrough} key={key} style={styles.strikethrough}>{children}</del>;
    if (!isSafeRichTextUrl(node.href)) return children;
    return <a className={classes("vui-rich-text-link", classNames.link)} href={node.href} key={key} onClick={onLinkPress ? (event) => { event.preventDefault(); onLinkPress(node.href); } : undefined} rel="noreferrer noopener" style={styles.link} target="_blank">{children}</a>;
  });
}

function Blocks({ blocks, styles, classNames, onLinkPress, prefix, quote = false }: { blocks: RichTextBlock[]; styles: RichTextStyles; classNames: RichTextClassNames; onLinkPress?: (url: string) => void; prefix: string; quote?: boolean }) {
  return blocks.map((block, index): ReactNode => {
    const key = `${prefix}-${index}`;
    if (block.type === "paragraph") return <p className={classes(classes("vui-rich-text-paragraph", classNames.paragraph), quote ? classNames.blockquoteText : undefined)} key={key} style={{ ...(quote ? styles.blockquoteText : {}), ...styles.paragraph }}><Inlines nodes={block.children} styles={styles} classNames={classNames} onLinkPress={onLinkPress} prefix={key} /></p>;
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, block.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
      const levelName = `heading${level}` as const;
      return createElement(`h${level}`, { className: classes(classes("vui-rich-text-heading", classNames.heading), classNames[levelName]), key, style: { ...styles.heading, ...styles[levelName] } }, <Inlines nodes={block.children} styles={styles} classNames={classNames} onLinkPress={onLinkPress} prefix={key} />);
    }
    if (block.type === "code") return <pre className={classes("vui-rich-text-code-block", classNames.codeBlockContainer)} key={key} style={styles.codeBlockContainer}><code className={classNames.codeBlock} style={styles.codeBlock}>{block.text}</code></pre>;
    if (block.type === "blockquote") return <blockquote className={classes("vui-rich-text-blockquote", classNames.blockquote)} key={key} style={styles.blockquote}><Blocks blocks={block.children} styles={styles} classNames={classNames} onLinkPress={onLinkPress} prefix={key} quote /></blockquote>;
    if (block.type === "thematicBreak") return <hr className={classes("vui-rich-text-thematic-break", classNames.thematicBreak)} key={key} style={styles.thematicBreak} />;
    if (block.type === "list") {
      const listChildren = block.items.map((item, itemIndex) => <li className={classes("vui-rich-text-list-item", classNames.listItem)} key={`${key}-${itemIndex}`} style={styles.listItem}><span aria-hidden="true" className={classes("vui-rich-text-list-marker", classNames.listMarker)} style={styles.listMarker}>{block.ordered ? `${block.start + itemIndex}.` : "•"}</span><div><Blocks blocks={item} styles={styles} classNames={classNames} onLinkPress={onLinkPress} prefix={`${key}-${itemIndex}`} /></div></li>);
      return block.ordered ? <ol className={classNames.orderedList} key={key} start={block.start} style={styles.orderedList}>{listChildren}</ol> : <ul className={classNames.unorderedList} key={key} style={styles.unorderedList}>{listChildren}</ul>;
    }
    return <div className={classes("vui-rich-text-table-scroll", classNames.tableScroll)} key={key} style={styles.tableScroll}><table className={classes("vui-rich-text-table", classNames.table)} style={styles.table}><thead><tr className={classNames.tableRow} style={styles.tableRow}>{block.header.map((cell, cellIndex) => <th className={classNames.tableHeaderCell} key={`${key}-h-${cellIndex}`} style={{ textAlign: block.align[cellIndex] ?? undefined, ...styles.tableHeaderCell }}><span className={classNames.tableHeaderText} style={styles.tableHeaderText}><Inlines nodes={cell} styles={styles} classNames={classNames} onLinkPress={onLinkPress} prefix={`${key}-h-${cellIndex}`} /></span></th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr className={classNames.tableRow} key={`${key}-r-${rowIndex}`} style={styles.tableRow}>{row.map((cell, cellIndex) => <td className={classNames.tableCell} key={`${key}-${rowIndex}-${cellIndex}`} style={{ textAlign: block.align[cellIndex] ?? undefined, ...styles.tableCell }}><span className={classNames.tableCellText} style={styles.tableCellText}><Inlines nodes={cell} styles={styles} classNames={classNames} onLinkPress={onLinkPress} prefix={`${key}-${rowIndex}-${cellIndex}`} /></span></td>)}</tr>)}</tbody></table></div>;
  });
}

export function RichText({ content, styles = {}, classNames = {}, onLinkPress, className, style, ...props }: RichTextProps) {
  return <div className={classes("vui-rich-text", className)} style={{ ...styles.root, ...style }} {...props}><Blocks blocks={parseRichText(content)} styles={styles} classNames={classNames} onLinkPress={onLinkPress} prefix="rich-text" /></div>;
}
