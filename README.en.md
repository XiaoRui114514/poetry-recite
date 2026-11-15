# Chinese Poetry Recitation · 上海初高古诗文背诵

[简体中文](README.md) · English

An offline-capable study tool for classical Chinese poetry and prose, aimed at Chinese middle/high-school learners, especially Shanghai curricula. It includes 199 works, sentence-aligned modern Chinese translations, recall exercises, mistakes and review scheduling. The interface and study material are in Chinese; translations are modern Chinese, not English.

## Use

Download [the standalone HTML](https://github.com/XiaoRui114514/poetry-recite/raw/refs/heads/main/dist/上海初高古诗文背诵.html) and open it in a modern browser. No account, server or API key is required. Alternatively, serve this repository's modular `index.html` as static files; PWA installation requires HTTP(S).

Select a school stage and works, study the text with sentence hiding, then practice recall. Exercises include preceding/following lines, keywords, whole sentences and translation-to-original recall. You can compare spelling, mark results, revisit sentence-level mistakes, and print practice sheets.

Progress is stored in browser storage. Export learning data before clearing storage, switching browsers or changing the hosting domain. Hosted deployments can optionally configure the shared learning-account backend; only signed-in use with that backend synchronizes the documented learning data. Standalone HTML stays local.

## Accuracy and reuse

Text variants depend on the textbook edition. Check the source edition when reporting a difference; focus marks and summaries are study aids, not guarantees about an examination. For a correction, include the work, exact sentence, expected text and source edition/page when available.

The [custom license](LICENSE) permits personal free study with attribution and restricts commercial use and redistribution. Classical source texts and the application's organization/annotations have different rights; consult the complete terms.

## Development

```sh
npm ci
npm run test:unit
npm run test:data
npm run test:cloud
npm run test:trans
npm run meta:check
npm run build
npx playwright install chromium
npm run test:e2e
```

Modify source files in `js/`, `assets/` and `data/`, then rebuild the standalone file. Keep original text, translations and sentence indices aligned. See the [Chinese guide](README.md) for schema and backup details. Report defects through [Issues](https://github.com/XiaoRui114514/poetry-recite/issues); exclude personal backups and account credentials.

The optional `cloud-sync-backend/` has its own lockfile and test command. Its local emulator tests do not deploy a service or modify production accounts.
