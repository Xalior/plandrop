// Type declarations for the template generator (a plain runnable .mjs script).

export interface GenerateOptions {
  /** The skeleton template folder whose parts are reused for every theme. */
  skeletonDir: string;
  /** The installed bootswatch package root (contains dist/<theme>/). */
  bootswatchDir: string;
  /** The hand-authored theme source root (contains <name>/theme.json). */
  customDir?: string;
  /** Where the generated theme folders are written. */
  outDir: string;
}

/** The native Bootstrap appearance a theme renders in. */
export type Scheme = 'light' | 'dark';

/** A hand-authored theme's manifest (themes/<name>/theme.json). */
export interface ThemeSpec {
  /** The human name, used in catalogues and in the document credit. */
  label?: string;
  /** The schemes the theme supports, best first; two of them means dual-mode. */
  appearance: Scheme[];
  /** Who the theme is by, and under which license. */
  credit: { name: string; url: string; license: string };
}

/**
 * The theme's native data-bs-theme scheme. bootstrap5 is dual-mode (light
 * default, dark via the toggle); every Bootswatch theme is single-appearance.
 */
export function nativeScheme(theme: string): Scheme;

/** The hand-authored theme names: the folders under customDir with a manifest. */
export function customThemes(customDir?: string): string[];

/** Read and validate a hand-authored theme's manifest. */
export function readThemeSpec(theme: string, customDir?: string): ThemeSpec;

/** Strip the dual-mode theme-toggle block from a header/footer fragment. */
export function stripToggle(html: string): string;

/** Render the skeleton header for a theme (paths, appearance, toggle strip). */
export function renderHeader(skeletonHeader: string, theme: string, spec?: ThemeSpec): string;

/** Render the skeleton footer for a theme (toggle strip, theme credit). */
export function renderFooter(skeletonFooter: string, theme: string, spec?: ThemeSpec): string;

/** Replace the footer's theme-credit span with a hand-authored theme's credit. */
export function renderCredit(footer: string, spec: ThemeSpec): string;

export function generateTheme(theme: string, options: GenerateOptions): string;
export function generateCustomTheme(
  theme: string,
  options: Omit<GenerateOptions, 'bootswatchDir'>,
): string;
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
