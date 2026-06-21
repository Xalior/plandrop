/*
 * plandrop self-update — a published document polls its own URL and, when the
 * server copy changes, swaps its <body> in place so an already-open page picks
 * up a re-upload without a manual reload.
 *
 * Zero server-side logic: it relies only on Apache's default static handling of
 * conditional requests (ETag / Last-Modified). A discrete file (not inline) so
 * the swap strategy can be changed later without touching every document.
 */
(function () {
  'use strict';

  var POLL_MS = 5000;
  // The document's own URL, without a fragment — what we re-fetch to compare.
  var selfUrl = location.href.split('#')[0];
  // The validators from the initial load, refreshed after every accepted swap.
  var etag = null;
  var lastModified = null;

  function rememberValidators(res) {
    etag = res.headers.get('ETag');
    lastModified = res.headers.get('Last-Modified');
  }

  function swapBody(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.body) {
      document.body.replaceWith(doc.body);
    }
  }

  function poll() {
    var headers = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }
    if (lastModified) {
      headers['If-Modified-Since'] = lastModified;
    }
    fetch(selfUrl, { headers: headers, cache: 'no-store' })
      .then(function (res) {
        // 304 Not Modified: nothing changed, keep the current validators.
        if (res.status === 304) {
          return null;
        }
        if (!res.ok) {
          return null;
        }
        rememberValidators(res);
        return res.text();
      })
      .then(function (html) {
        if (html) {
          swapBody(html);
        }
      })
      .catch(function () {
        // Network blip: ignore and try again on the next tick.
      });
  }

  // Seed the validators from the live copy, then poll on an interval.
  fetch(selfUrl, { cache: 'no-store' })
    .then(function (res) {
      if (res.ok) {
        rememberValidators(res);
      }
    })
    .catch(function () {})
    .finally(function () {
      setInterval(poll, POLL_MS);
    });
})();
