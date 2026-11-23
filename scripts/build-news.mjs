// Build the PRO CV News section from news-src/*.html.
// Each source file starts with a JSON block inside <!-- --> (title, slug, …), then the article HTML.
// Writes news/<slug>/index.html, news/index.html and sitemap.xml.
// Run: node scripts/build-news.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://procv.store';
const SRC = join(ROOT, 'news-src');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = s => String(s).replace(/<[^>]+>/g, '');
const fmtDate = (d, lang = 'ar') => new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'fr' ? 'fr-MA' : 'ar-MA', { year: 'numeric', month: 'long', day: 'numeric' });

// Articles are Arabic by default; "lang": "fr" in the header makes a French (left-to-right) page.
const T = {
  ar: { dir: 'rtl', locale: 'ar_MA', nav: 'مقالات PRO CV', order: 'اطلب ملفك · 200 درهم', articles: 'المقالات', toc: 'فهرس المقال',
    faq: 'أسئلة شائعة', sources: 'مصادر رسمية', sourcesNote: 'المبالغ والقوانين تتغير، تحقق دائمًا من الموقع الرسمي قبل أي خطوة.',
    related: 'اقرأ أيضًا', team: 'فريق PRO CV', more: 'اقرأ المقال ←', footTag: 'PRO CV · ملفات ترشيح ألمانية من المغرب', home: 'الصفحة الرئيسية',
    cta: ['بغيتي ملف Bewerbung واجد بلا صداع؟', 'كنوجدو ليك الملف كامل بالألمانية، على حساب المهنة لي باغي.', 'جاهز فـ 24 ساعة', 'تعديلات فابور حتى بعد الدفع', 'الثمن: <span class="price">200 درهم</span> عوض 300', 'عمّر الاستمارة دابا ←'] },
  fr: { dir: 'ltr', locale: 'fr_FR', nav: 'Articles PRO CV', order: 'Commander · 200 DH', articles: 'Articles', toc: 'Sommaire',
    faq: 'Questions fréquentes', sources: 'Sources officielles', sourcesNote: 'Les montants et les règles changent : vérifiez toujours sur le site officiel avant toute démarche.',
    related: 'À lire aussi', team: 'Équipe PRO CV', more: 'Lire l’article →', footTag: 'PRO CV · Dossiers de candidature allemands depuis le Maroc', home: 'Accueil',
    cta: ['Un dossier Bewerbung prêt, sans prise de tête ?', 'Nous rédigeons tout votre dossier en allemand, selon le métier visé.', 'Prêt en 24 h', 'Modifications gratuites, même après paiement', 'Prix : <span class="price">200 DH</span> au lieu de 300', 'Remplir le formulaire →'] },
};

// ---- read articles -------------------------------------------------------
const posts = readdirSync(SRC).filter(f => f.endsWith('.html')).map(f => {
  const raw = readFileSync(join(SRC, f), 'utf8');
  const m = raw.match(/^\s*<!--([\s\S]*?)-->/);
  if (!m) throw new Error(`${f}: missing JSON header`);
  const meta = JSON.parse(m[1]);
  for (const k of ['slug', 'title', 'description', 'h1', 'tag', 'date', 'cover', 'intro']) if (!meta[k]) throw new Error(`${f}: missing ${k}`);
  return { lang: 'ar', ...meta, body: raw.slice(m[0].length).trim() };
}).sort((a, b) => (b.date + (b.order || 0)).localeCompare(a.date + (a.order || 0)));
const bySlug = Object.fromEntries(posts.map(p => [p.slug, p]));

// ---- shared pieces -------------------------------------------------------
const PIXEL = `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','1814127609805768');fbq('track','PageView');
</script>`;

const head = ({ title, description, url, image, type, jsonld, up, lang = 'ar' }) => `<!doctype html>
<html lang="${lang}" dir="${T[lang].dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="PRO CV">
<meta property="og:locale" content="${T[lang].locale}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${up}assets/brand/logo-96.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${up}news/news.css">
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
${PIXEL}
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="wordmark" href="${up}" aria-label="PRO CV"><img src="${up}assets/brand/wordmark.svg" alt="PRO CV" width="120" height="24"></a>
    <span class="sp"></span>
    <a class="nav" href="${up}news/">${T[lang].nav}</a>
    <a class="btn sm" href="${up}formulaire/">${T[lang].order}</a>
  </div>
</header>
`;

const foot = (up, lang = 'ar') => `
<footer>
  <div class="wrap">
    <span>${T[lang].footTag}</span>
    <span class="links"><a href="${up}">${T[lang].home}</a><a href="${up}news/">${T[lang].articles}</a><a href="https://www.instagram.com/procv.ma1/" target="_blank" rel="noopener">Instagram @procv.ma1</a></span>
  </div>
</footer>
</body>
</html>
`;

const ctaBox = (up, lang = 'ar') => { const c = T[lang].cta; return `<aside class="cta-box">
  <h2>${c[0]}</h2>
  <p>${c[1]}</p>
  <ul>
    <li>Deckblatt + Anschreiben + Lebenslauf</li>
    <li>${c[2]}</li>
    <li>${c[3]}</li>
    <li>${c[4]}</li>
  </ul>
  <a class="btn" href="${up}formulaire/">${c[5]}</a>
</aside>`; };

const crumbs = items => `<nav class="crumbs" aria-label="breadcrumb">${items.map(([n, h]) => h ? `<a href="${h}">${esc(n)}</a>` : `<b>${esc(n)}</b>`).join('<span>›</span>')}</nav>`;

// ---- article pages -------------------------------------------------------
for (const p of posts) {
  const up = '../../';
  const L = T[p.lang];
  const url = `${SITE}/news/${p.slug}/`;
  const image = `${SITE}/${p.cover}`;
  const h2s = [...p.body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(m => [m[1], strip(m[2])]);
  const body = p.body.replace('<!--CTA-->', ctaBox(up, p.lang));
  const faq = p.faq || [];
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: p.h1, description: p.description, image, datePublished: p.date, dateModified: p.updated || p.date, inLanguage: p.lang, mainEntityOfPage: url,
      author: { '@type': 'Organization', name: 'PRO CV', url: SITE + '/' }, publisher: { '@type': 'Organization', name: 'PRO CV', logo: { '@type': 'ImageObject', url: SITE + '/assets/brand/logo-512.png' } } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'PRO CV', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: L.articles, item: SITE + '/news/' },
      { '@type': 'ListItem', position: 3, name: p.h1, item: url }] },
  ];
  if (faq.length) jsonld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: strip(a) } })) });

  const related = (p.related || []).map(s => bySlug[s]).filter(Boolean);
  const html = head({ title: p.title, description: p.description, url, image, type: 'article', jsonld, up, lang: p.lang }) + `
<main class="wrap">
  ${crumbs([['PRO CV', up], [L.articles, up + 'news/'], [p.tag]])}
  <article class="post">
    <header>
      <h1>${p.h1}</h1>
      <p class="meta">${L.team} · <time datetime="${p.updated || p.date}">${fmtDate(p.updated || p.date, p.lang)}</time></p>
      <p class="intro">${p.intro}</p>
    </header>
    ${h2s.length > 2 ? `<nav class="toc"><b>${L.toc}</b><ol>${h2s.map(([id, t]) => `<li><a href="#${id}">${esc(t)}</a></li>`).join('')}</ol></nav>` : ''}
    <div class="content">
${body}
${faq.length ? `<h2 id="faq">${L.faq}</h2>\n<div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('\n')}</div>` : ''}
${ctaBox(up, p.lang)}
${(p.sources || []).length ? `<section class="sources"><h2 id="sources">${L.sources}</h2><ul>${p.sources.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(n)}</a></li>`).join('')}</ul><p>${L.sourcesNote}</p></section>` : ''}
    </div>
    ${related.length ? `<section class="related"><h2>${L.related}</h2><ul>${related.map(r => `<li><a href="../${r.slug}/">${esc(r.h1)}</a></li>`).join('')}</ul></section>` : ''}
  </article>
</main>` + foot(up, p.lang);
  mkdirSync(join(ROOT, 'news', p.slug), { recursive: true });
  writeFileSync(join(ROOT, 'news', p.slug, 'index.html'), html);
}

// ---- listing page --------------------------------------------------------
{
  const up = '../';
  const url = `${SITE}/news/`;
  const title = 'مقالات PRO CV · سيرة ذاتية بالألمانية، اوسبيلدونغ والعمل في ألمانيا';
  const description = 'دليل المغاربة للعمل والتكوين في ألمانيا: نموذج سيرة ذاتية بالألمانية (Lebenslauf)، رسالة تحفيزية Anschreiben، اوسبيلدونغ التمريض، فيزا Ausbildung وChancenkarte. Guides CV allemand en français.';
  const jsonld = [{ '@context': 'https://schema.org', '@type': 'Blog', name: 'مقالات PRO CV', url, inLanguage: 'ar',
    blogPost: posts.map(p => ({ '@type': 'BlogPosting', headline: p.h1, url: `${SITE}/news/${p.slug}/`, datePublished: p.date })) }];
  const html = head({ title, description, url, image: `${SITE}/assets/brand/logo-512.png`, type: 'website', jsonld, up }) + `
<main class="wrap">
  ${crumbs([['PRO CV', up], ['المقالات']])}
  <section class="hero">
    <h1>مقالات PRO CV</h1>
    <p>كل ما تحتاج تعرفه باش توجد ملف ترشيح ألماني مقبول: Lebenslauf، Anschreiben، Deckblatt، والـAusbildung فألمانيا، بشرح واضح وأمثلة.</p>
  </section>
  <section class="grid">
${posts.map(p => `    <a class="card" href="${p.slug}/"${p.lang !== 'ar' ? ` lang="${p.lang}" dir="ltr"` : ''}>
      <div class="thumb" style="background-image:url(../${p.cover});background-position:center ${p.coverPos || 'top'}" role="img" aria-label="${esc(p.coverAlt || p.h1)}"></div>
      <div class="body"><span class="tag">${esc(p.tag)}</span><h2>${p.h1}</h2><p>${esc(p.description)}</p><span class="more">${T[p.lang].more}</span></div>
    </a>`).join('\n')}
  </section>
</main>` + foot(up);
  writeFileSync(join(ROOT, 'news', 'index.html'), html);
}

// ---- sitemap -------------------------------------------------------------
{
  const latest = posts.map(p => p.updated || p.date).sort().pop();
  // Home page: today if it has uncommitted edits, otherwise the date of its last commit.
  const today = new Date().toISOString().slice(0, 10);
  const fileDate = f => { try {
    if (execSync(`git status --porcelain -- ${f}`, { cwd: ROOT }).toString().trim()) return today;
    return execSync(`git log -1 --format=%cs -- ${f}`, { cwd: ROOT }).toString().trim() || latest;
  } catch { return latest; } };
  const urls = [[`${SITE}/`, fileDate('index.html'), '1.0'], [`${SITE}/news/`, latest, '0.8'], ...posts.map(p => [`${SITE}/news/${p.slug}/`, p.updated || p.date, '0.7'])];
  writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d, pr]) => `  <url><loc>${u}</loc><lastmod>${d}</lastmod><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`);
}

console.log(`built ${posts.length} articles: ${posts.map(p => p.slug).join(', ')}`);
