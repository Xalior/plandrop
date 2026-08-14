import TurndownService from 'turndown';
// turndown-plugin-gfm ships no type declarations; src/turndown-plugin-gfm.d.ts
// states the one export we use.
import { gfm } from 'turndown-plugin-gfm';

/**
 * Convert an HTML document to markdown, losing the machinery and nothing else.
 *
 * The point is a document an agent can read without paying for the markup, so
 * the conversion stays mechanical: no extraction of "the article", no
 * summarising, no reflow. Whatever the author wrote survives, in the order they
 * wrote it, and a reader can check the output against the source line by line.
 *
 * Two element sets are named rather than inferred:
 *
 *   * `script`, `style` and `noscript` are REMOVED — the element and its text
 *     both go. Stripping only the tags (what a tag-eating regex does) leaves a
 *     theme-toggle function sitting in the prose as though the author wrote it.
 *   * `iframe` is KEPT as raw HTML. Turndown has no markdown for it and would
 *     otherwise emit nothing at all: an embedded diagram or sub-document would
 *     vanish with no marker and no URL, which is the one failure a reader
 *     cannot detect. Kept, its `src` survives.
 *
 * A table with no header row is passed through as HTML by the GFM plugin rather
 * than converted. That is deliberate on the plugin's part and the right
 * behaviour here: the cell boundaries stay visible instead of being welded into
 * one ambiguous line.
 */
export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
  });
  turndown.use(gfm);
  turndown.remove(['script', 'style', 'noscript']);
  turndown.keep(['iframe']);
  return `${turndown.turndown(bodyOf(html)).trimEnd()}\n`;
}

/**
 * The document's body, or the whole input when it has no `<body>`. A fragment —
 * a partial or a snippet pasted into a file — converts as it stands rather than
 * being rejected for not looking like a page.
 */
export function bodyOf(html: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return match?.[1] ?? html;
}

/**
 * The document's `<title>`, decoded, or undefined when it has none.
 *
 * The title lives in the head, so the body conversion never sees it. Emitting it
 * as the leading heading is what stops the document's own name going missing
 * from the text — a reader should not have to know it moved somewhere else.
 */
export function titleOf(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const title = decodeEntities(match[1].replace(/\s+/g, ' ')).trim();
  return title === '' ? undefined : title;
}

/** The named and numeric entities a `<title>` realistically carries. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * A whole document as markdown: the title as the leading heading, then the body.
 * The heading is omitted when the body already opens with one carrying the same
 * text, so a document whose `<h1>` repeats its `<title>` is not titled twice.
 */
export function documentToMarkdown(html: string): string {
  const body = htmlToMarkdown(html);
  const title = titleOf(html);
  if (title === undefined) {
    return body;
  }
  const firstHeading = /^#{1,6}\s+(.*)$/m.exec(body);
  if (firstHeading?.[1]?.trim() === title) {
    return body;
  }
  return `# ${title}\n\n${body}`;
}
