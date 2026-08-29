/**
 * The light / dark / system toggle, for the dual-mode templates.
 *
 * Theme-neutral and shared: the storage key is read from the document's own
 * `data-plandrop-theme` at run time, so one copy serves every theme, and a
 * reader who opens documents in several themes downloads it once.
 *
 * Loaded render-blocking from <head>, because the saved mode has to be on
 * <html> before the first paint or the document shows the wrong appearance
 * and then corrects itself. The click handler is delegated on `document`, so
 * it binds here in <head> before the button is parsed, and survives the whole
 * <body> being replaced by a self-update.
 */
(function () {
  var MODES = ['light', 'dark', 'system'];
  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function storageKey() {
    return 'plandrop:mode:' + root.getAttribute('data-plandrop-theme');
  }

  /** The stored mode, or the appearance the template opens in. */
  function readMode() {
    try {
      return window.localStorage.getItem(storageKey()) || root.getAttribute('data-bs-theme');
    } catch (e) {
      // Storage unavailable (private browsing, blocked cookies, …): the
      // toggle still works, it just forgets the choice on reload.
      return root.getAttribute('data-bs-theme');
    }
  }

  function writeMode(mode) {
    try {
      window.localStorage.setItem(storageKey(), mode);
    } catch (e) {
      // Storage unavailable: the scheme still applies, it just will not
      // survive a reload.
    }
  }

  /** Resolve the mode to a concrete appearance and put it on <html>. */
  function applyScheme() {
    var mode = root.getAttribute('data-bs-theme-mode');
    root.setAttribute('data-bs-theme', mode === 'system' ? (media.matches ? 'dark' : 'light') : mode);
  }

  /**
   * Show the mode on the button. Scoped to the button by tag: this script is
   * marked with the same attribute so the generator can strip both together,
   * and it precedes the button in the document.
   */
  function showMode(mode) {
    var button = document.querySelector('button[data-bs-theme-toggle]');
    if (!button) {
      return;
    }
    button.setAttribute('aria-label', 'Toggle colour scheme, currently ' + mode);
    var label = button.querySelector('[data-bs-theme-toggle-label]');
    if (label) {
      label.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    }
  }

  root.setAttribute('data-bs-theme-mode', readMode());
  applyScheme();
  media.addEventListener('change', applyScheme);

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-bs-theme-toggle]');
    if (!trigger) {
      return;
    }
    var next = MODES[(MODES.indexOf(root.getAttribute('data-bs-theme-mode')) + 1) % MODES.length];
    root.setAttribute('data-bs-theme-mode', next);
    applyScheme();
    writeMode(next);
    showMode(next);
  });

  // The button is not parsed yet when this runs, so the first label sync waits
  // for the document. A self-update replaces <body> without re-running this
  // file, so the swapped-in button is re-synced then too.
  document.addEventListener('DOMContentLoaded', function () {
    showMode(root.getAttribute('data-bs-theme-mode'));
  });
})();
