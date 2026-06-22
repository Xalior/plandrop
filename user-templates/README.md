# Operator drop-in templates

Drop a folder here per custom template; it is served at `/.plandrop/user/<name>/`
and selectable as `--template user/<name>`. A folder needs at least a
`template.html` (the assembled starter `newdoc` fetches); add `header.html`,
`footer.html` and any assets as you like. This mount is kept separate from the
built-in theme volume, so re-seeding the built-ins never wipes it.
