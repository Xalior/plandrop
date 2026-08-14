import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, isUrl } from '../src/commands/text';
import { bodyOf, documentToMarkdown, htmlToMarkdown, titleOf } from '../src/text';

/** A dispatch carrying just the params a command reads. */
function dispatch(params: string[]) {
  return { command: 'text' as const, hashOverride: undefined, params };
}

describe('html to markdown', () => {
  it('keeps headings, lists, links and code as markdown', () => {
    const md = htmlToMarkdown(
      '<h2>Scope</h2><ul><li>One</li><li><a href="/x">Two</a></li></ul><pre><code>npm i</code></pre>',
    );
    expect(md).toContain('## Scope');
    expect(md).toMatch(/^-\s+One$/m);
    expect(md).toContain('[Two](/x)');
    expect(md).toContain('```');
    expect(md).toContain('npm i');
  });

  it('drops script and style bodies rather than leaving them as prose', () => {
    // A tag-eating regex removes the tags and keeps the text, so a theme-toggle
    // function arrives in the middle of the document looking like an author's
    // sentence. Removing the element takes its body with it.
    const md = htmlToMarkdown(
      '<p>Real text.</p><script>document.addEventListener("click", go)</script>' +
        '<style>body { color: red }</style><noscript>Enable JS</noscript>',
    );
    expect(md).toContain('Real text.');
    expect(md).not.toContain('addEventListener');
    expect(md).not.toContain('color: red');
    expect(md).not.toContain('Enable JS');
  });

  it('decodes entities', () => {
    expect(htmlToMarkdown('<p>a &lt; b &amp;&amp; c &gt; d</p>')).toContain('a < b && c > d');
  });

  it('gives every table cell a boundary', () => {
    // Welded cells are the one failure a reader cannot detect: two numbers run
    // together read as a third number, with nothing to say a split was lost.
    const md = htmlToMarkdown(
      '<table><thead><tr><th>players</th><th>average_score</th></tr></thead>' +
        '<tbody><tr><td>76</td><td>14</td></tr></tbody></table>',
    );
    // Markdown escaping puts a backslash before the underscore. That is
    // standard and reversible; the point of the test is the cell boundary.
    expect(md).toMatch(/^\| players \| average\\?_score \|$/m);
    expect(md).toContain('| 76 | 14 |');
    expect(md).not.toContain('7614');
  });

  it('passes a header-less table through as HTML rather than flattening it', () => {
    // The GFM plugin will not emit a markdown table without a header row. Raw
    // HTML keeps every cell boundary visible, which beats a silent flattening.
    const md = htmlToMarkdown('<table><tr><td>Host</td><td>example</td></tr></table>');
    expect(md).toContain('<td>Host</td>');
    expect(md).toContain('<td>example</td>');
    expect(md).not.toContain('Hostexample');
  });

  it('keeps an iframe so its src cannot vanish silently', () => {
    // Turndown has no markdown for an iframe and emits nothing for it unless it
    // is kept — an embedded document would disappear without a trace.
    const md = htmlToMarkdown('<iframe src="https://example.com/embed"></iframe>');
    expect(md).toContain('https://example.com/embed');
  });

  it('keeps the text of an element it has no rule for', () => {
    const md = htmlToMarkdown('<plan-widget>Custom element text</plan-widget>');
    expect(md).toContain('Custom element text');
  });
});

describe('document framing', () => {
  it('reads the body and leaves the head behind', () => {
    expect(bodyOf('<html><head><title>T</title></head><body><p>Hi</p></body></html>')).toBe(
      '<p>Hi</p>',
    );
  });

  it('converts a fragment that has no body as it stands', () => {
    expect(bodyOf('<p>Just a fragment</p>')).toBe('<p>Just a fragment</p>');
  });

  it('decodes the title', () => {
    expect(titleOf('<title>Plan &amp; Scope</title>')).toBe('Plan & Scope');
    expect(titleOf('<html><body>none</body></html>')).toBeUndefined();
  });

  it('leads with the title, because the body conversion never sees it', () => {
    const md = documentToMarkdown(
      '<html><head><title>Discovery</title></head><body><p>Body.</p></body></html>',
    );
    expect(md.startsWith('# Discovery\n')).toBe(true);
    expect(md).toContain('Body.');
  });

  it('does not title a document twice when its h1 already says it', () => {
    const md = documentToMarkdown(
      '<html><head><title>Discovery</title></head><body><h1>Discovery</h1><p>B.</p></body></html>',
    );
    expect(md.match(/^# Discovery$/gm)).toHaveLength(1);
  });
});

describe('the text command', () => {
  let dir: string;
  let written: string;
  let errored: string;
  let stdout: typeof process.stdout.write;
  let stderr: typeof process.stderr.write;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plandrop-text-'));
    written = '';
    errored = '';
    stdout = process.stdout.write.bind(process.stdout);
    stderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => {
      written += chunk;
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      errored += chunk;
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints a local document as markdown', async () => {
    const path = join(dir, 'plan.html');
    writeFileSync(path, '<html><head><title>Plan</title></head><body><h2>Goal</h2></body></html>');
    expect(await run(dispatch([path]))).toBe(0);
    expect(written).toContain('# Plan');
    expect(written).toContain('## Goal');
  });

  it('asks for a target rather than guessing one', async () => {
    expect(await run(dispatch([]))).toBe(2);
    expect(errored).toContain('file path or a URL');
  });

  it('reports an unreadable file instead of printing nothing', async () => {
    expect(await run(dispatch([join(dir, 'absent.html')]))).toBe(1);
    expect(errored).toContain('absent.html');
    expect(written).toBe('');
  });

  it('tells a URL from a path', () => {
    expect(isUrl('https://example.com/x.html')).toBe(true);
    expect(isUrl('http://example.com/x.html')).toBe(true);
    expect(isUrl('./plan.html')).toBe(false);
    expect(isUrl('/tmp/plan.html')).toBe(false);
  });
});
