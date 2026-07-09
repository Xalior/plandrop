// Type declarations for the template generator (a plain runnable .mjs script).

export interface GenerateOptions {
  /** The skeleton template folder whose parts are reused for every theme. */
  skeletonDir: string;
  /** The installed bootswatch package root (contains dist/<theme>/). */
  bootswatchDir: string;
  /** Where the generated theme folders are written. */
  outDir: string;
}

/** The native Bootstrap appearance a theme renders in. */
export type Scheme = 'light' | 'dark';

/**
 * The theme's native data-bs-theme scheme. bootstrap5 is dual-mode (light
 * default, dark via the toggle); every Bootswatch theme is single-appearance.
 */
export function nativeScheme(theme: string): Scheme;

/** Strip the dual-mode theme-toggle block from a header/footer fragment. */
export function stripToggle(html: string): string;

/** Render the skeleton header for a theme (paths, native scheme, toggle strip). */
export function renderHeader(skeletonHeader: string, theme: string): string;

/** Render the skeleton footer for a theme (toggle-script strip for single-mode). */
export function renderFooter(skeletonFooter: string, theme: string): string;

export function generateTheme(theme: string, options: GenerateOptions): string;
export function bootswatchThemes(bootswatchDir: string): string[];
export function generateAll(options: GenerateOptions): string[];

export interface VendorOptions {
  /** The node_modules root holding the pinned vendor packages. */
  modulesDir: string;
  /** The templates root; bundles land under <outDir>/shared/vendor/. */
  outDir: string;
}

/** Copy the shared enhancement bundles (mermaid, highlight.js) into place. */
export function vendorSharedAssets(options: VendorOptions): void;
