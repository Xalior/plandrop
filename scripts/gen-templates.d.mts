// Type declarations for the template generator (a plain runnable .mjs script).

export interface GenerateOptions {
  /** The skeleton template folder whose parts are reused for every theme. */
  skeletonDir: string;
  /** The installed bootswatch package root (contains dist/<theme>/). */
  bootswatchDir: string;
  /** Where the generated theme folders are written. */
  outDir: string;
}

export function generateTheme(theme: string, options: GenerateOptions): string;
export function bootswatchThemes(bootswatchDir: string): string[];
export function generateAll(options: GenerateOptions): string[];
