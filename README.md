# PROCV
## PRO CV News (SEO)

Articles live in `news-src/*.html` (a JSON header in `<!-- -->`, then the article HTML; `<!--CTA-->` places the order box mid-article).
To add one: copy an existing file, change the header (slug, title, description, date…), write the text, then run:

    node scripts/build-news.mjs

It writes `news/<slug>/index.html`, `news/index.html` and `sitemap.xml`. Commit all of them.
