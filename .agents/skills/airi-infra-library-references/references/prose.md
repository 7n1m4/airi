# Docs prose (translation-friendly)

- **Limits**: ~20 words procedural, ~25 descriptive; one command per step, condition before command.
- **Modals**: `can` (ability), `will` (future), `must` (requirement). One word, one meaning; expand acronyms on first use.
- **Untouchables**: never rewrite code, paths, key names, or error strings to "simplify" prose.
- **User framing** (release notes): `You can now…` / `Previously… We fixed this so…`; group Users → Developers → Contributors → Upgrade notes. Commit SHAs go in footnotes, not bullets.
- **Mechanics** (YAML keys, locale sync) stay in `airi-i18n-localization` + `scripts/yaml-manager.js`.
