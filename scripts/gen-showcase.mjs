// Regenerate the all-themes "showcase plan" set on a running plandrop stack.
//
// For every template the stack advertises, this scaffolds a fresh doc from that
// template, splices the shared showcase body (examples/showcase-plan.html) into
// its <main>…</main>, and uploads it. The result is one doc per theme, each
// carrying the current template header (so it picks up CSS/header fixes) plus
// the identical rich-markup showcase plan — a quick way to eyeball every theme.
//
// Re-runnable / idempotent: it overwrites each <theme>.html (newdoc --force) and
// re-uploads, so running it again just refreshes the set in place.
//
// Prerequisites:
//   - A built CLI bundle (dist/cli.js). `make showcase` builds it first.
//   - A `.plandrop` in the working directory (--cwd) with the host + passphrase
//     for the tenant to publish into. newdoc/upload read the domain + secret
//     from there; this script only needs the domain to list templates.
//
// Usage:
//   node scripts/gen-showcase.mjs [--domain URL] [--cwd DIR] [--stub FILE] [--cli FILE]
//
//   --domain  Base origin of the stack, e.g. http://localhost:8083. Falls back
//             to $PLANDROP_DOMAIN, then the `domain` field of <cwd>/.plandrop,
//             then http://localhost:8083. NO host is hardcoded.
//   --cwd     Directory holding `.plandrop` and where the per-theme docs are
//             written/uploaded from. Defaults to the current directory.
//   --stub    The showcase body fragment. Defaults to examples/showcase-plan.html.
//   --cli     The CLI bundle to invoke. Defaults to dist/cli.js in this repo.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function parseArgs(argv) {
  const opts = {
    domain: undefined,
    cwd: process.cwd(),
    stub: join(repoRoot, 'examples', 'showcase-plan.html'),
    cli: join(repoRoot, 'dist', 'cli.js'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--domain') opts.domain = argv[++i];
    else if (arg === '--cwd') opts.cwd = argv[++i];
    else if (arg === '--stub') opts.stub = argv[++i];
    else if (arg === '--cli') opts.cli = argv[++i];
    else {
      process.stderr.write(`unknown argument: ${arg}\n`);
      process.exit(2);
    }
  }
  return opts;
}

/** Resolve the stack base origin: --domain, then env, then the dotfile, then a neutral default. */
function resolveDomain(explicit, cwd) {
  if (explicit) return explicit;
  if (process.env.PLANDROP_DOMAIN) return process.env.PLANDROP_DOMAIN;
  const dotfile = join(cwd, '.plandrop');
  if (existsSync(dotfile)) {
    try {
      const parsed = JSON.parse(readFileSync(dotfile, 'utf8'));
      if (typeof parsed.domain === 'string') return parsed.domain;
    } catch {
      // fall through to the default
    }
  }
  return 'http://localhost:8083';
}

/** Splice the stub body into the doc's <main>…</main>, preserving the <main> tag. */
function spliceBody(doc, body) {
  const open = doc.match(/<main\b[^>]*>/i);
  const closeIdx = doc.lastIndexOf('</main>');
  if (!open || closeIdx === -1) {
    throw new Error('scaffolded doc has no <main>…</main> to splice into');
  }
  const openEnd = open.index + open[0].length;
  return `${doc.slice(0, openEnd)}\n${body}\n  ${doc.slice(closeIdx)}`;
}

/** Run the plandrop CLI in the target cwd; throw on non-zero exit. */
function runCli(cli, cwd, args) {
  const res = spawnSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`plandrop ${args.join(' ')} exited ${res.status ?? res.signal}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const domain = resolveDomain(opts.domain, opts.cwd);

  if (!existsSync(opts.cli)) {
    process.stderr.write(`CLI bundle not found at ${opts.cli} — run \`make build\` first\n`);
    process.exit(1);
  }
  const body = readFileSync(opts.stub, 'utf8');

  // Ask the stack which templates exist; one showcase doc per template.
  const res = await fetch(new URL('/api/templates', domain));
  if (!res.ok) throw new Error(`GET ${domain}/api/templates responded ${res.status}`);
  const { templates } = await res.json();
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error('templates endpoint returned no templates');
  }

  process.stdout.write(`generating ${templates.length} showcase doc(s) against ${domain}\n`);
  for (const theme of templates) {
    const filename = `${theme}.html`;
    const path = join(opts.cwd, filename);

    // Re-scaffold from the theme (picks up the current header/CSS), splice the
    // shared body in, then upload. --force makes the scaffold step idempotent.
    runCli(opts.cli, opts.cwd, ['newdoc', filename, '--template', theme, '--force']);
    writeFileSync(path, spliceBody(readFileSync(path, 'utf8'), body));
    runCli(opts.cli, opts.cwd, ['upload', filename]);
  }
  process.stdout.write(`done: ${templates.length} showcase doc(s) uploaded\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
