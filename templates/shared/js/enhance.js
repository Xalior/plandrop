/*
 * plandrop document enhancement — renders mermaid diagrams and syntax-highlights
 * code blocks in a published document, from the self-hosted vendor bundles under
 * .plandrop/shared/vendor/ (no runtime CDN).
 *
 * Lazy by design: this file only scans the document. mermaid (~3.5MB) and
 * highlight.js (~130KB) are fetched on demand — a document with no diagrams and
 * no code blocks loads nothing beyond this scan.
 *
 * Shared, theme-neutral: one copy lives at .plandrop/shared/js/enhance.js and
 * every template's header references it. Both renderers follow the page's
 * data-bs-theme, live: a theme toggle flips the highlight stylesheet and
 * re-renders the diagrams. A self-update <body> swap re-enhances the fresh
 * content (the swap restores the raw markup, so everything re-renders cleanly).
 */
(function () {
  'use strict';

  // Vendor assets resolve relative to this script's own URL, so the same file
  // works with the hosted documents' relative .plandrop/… paths and the static
  // plandrop.dev documents' absolute ones (including opened via file://, where
  // the assets still load from plandrop.dev — or fail harmlessly offline).
  var script = document.currentScript;
  var src = script && script.src;
  if (!src) {
    return;
  }
  var vendorBase = src.slice(0, src.lastIndexOf('/js/')) + '/vendor/';

  function isDark() {
    return document.documentElement.getAttribute('data-bs-theme') === 'dark';
  }

  // One promise per URL: a second request for the same asset (e.g. after a
  // self-update body swap) reuses the in-flight or completed load.
  var loads = {};
  function loadScript(url) {
    if (!loads[url]) {
      loads[url] = new Promise(function (resolve, reject) {
        var el = document.createElement('script');
        el.src = url;
        el.onload = resolve;
        el.onerror = reject;
        document.head.appendChild(el);
      });
    }
    return loads[url];
  }

  // Both highlight stylesheets are linked once, into <head> (which a body swap
  // never touches); the inactive one is disabled, so a theme flip is a boolean
  // toggle rather than a re-fetch.
  var lightStyle = null;
  var darkStyle = null;
  function addStyle(url) {
    var el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = url;
    el.disabled = true;
    document.head.appendChild(el);
    return el;
  }
  function syncStyles() {
    if (!lightStyle) {
      return;
    }
    lightStyle.disabled = isDark();
    darkStyle.disabled = !isDark();
  }

  // Accept the markdown-conversion idiom <pre><code class="language-mermaid">
  // as well as mermaid's native <pre class="mermaid">: rewrite the former into
  // the latter so a single selector feeds mermaid.run().
  function normalizeMermaid() {
    var codes = document.querySelectorAll('pre > code.language-mermaid');
    for (var i = 0; i < codes.length; i += 1) {
      var pre = codes[i].parentElement;
      var source = codes[i].textContent;
      pre.className = 'mermaid';
      pre.textContent = source;
    }
  }

  function renderMermaid() {
    var nodes = document.querySelectorAll('.mermaid:not([data-processed])');
    if (nodes.length === 0) {
      return;
    }
    for (var i = 0; i < nodes.length; i += 1) {
      // Keep the diagram source: a theme change needs it to re-render, since
      // rendering replaces the element's content with the finished SVG.
      if (!nodes[i].getAttribute('data-plandrop-source')) {
        nodes[i].setAttribute('data-plandrop-source', nodes[i].textContent);
      }
    }
    loadScript(vendorBase + 'mermaid/mermaid.min.js')
      .then(function () {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: isDark() ? 'dark' : 'default',
        });
        return window.mermaid.run();
      })
      .catch(function () {
        // A diagram that fails to parse (or a failed asset load) leaves its
        // source text visible — better than a blank hole in the document.
      });
  }

  // Re-render every diagram in the other theme: restore each element's source,
  // clear mermaid's processed marker, and run again.
  function rerenderMermaid() {
    if (!window.mermaid) {
      return;
    }
    var nodes = document.querySelectorAll('.mermaid[data-processed]');
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].textContent = nodes[i].getAttribute('data-plandrop-source');
      nodes[i].removeAttribute('data-processed');
    }
    renderMermaid();
  }

  function highlightCode() {
    var blocks = document.querySelectorAll('pre code:not(.hljs)');
    if (blocks.length === 0) {
      return;
    }
    if (!lightStyle) {
      lightStyle = addStyle(vendorBase + 'highlight/styles/github.min.css');
      darkStyle = addStyle(vendorBase + 'highlight/styles/github-dark.min.css');
      syncStyles();
    }
    loadScript(vendorBase + 'highlight/highlight.min.js')
      .then(function () {
        for (var i = 0; i < blocks.length; i += 1) {
          // With a language-* class the language is honoured; without one
          // highlight.js auto-detects.
          window.hljs.highlightElement(blocks[i]);
        }
      })
      .catch(function () {
        // Unhighlighted code is still readable; nothing to clean up.
      });
  }

  function enhance() {
    normalizeMermaid();
    renderMermaid();
    highlightCode();
  }

  // Follow the theme live (the bootstrap5 toggle flips data-bs-theme on <html>),
  // and re-enhance after a self-update replaces <body> with fresh raw markup.
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i += 1) {
      if (mutations[i].type === 'attributes') {
        syncStyles();
        rerenderMermaid();
        return;
      }
    }
    enhance();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-bs-theme'],
    childList: true,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }
})();
