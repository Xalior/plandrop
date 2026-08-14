// turndown-plugin-gfm ships no type declarations. Only the combined `gfm`
// plugin is used here — it carries the table rules, which are the reason the
// plugin is a dependency at all.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
