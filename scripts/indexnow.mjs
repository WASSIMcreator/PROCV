// Tell Bing (and the other IndexNow engines: Yandex, Seznam, Naver…) that pages changed.
// Run AFTER the deploy is live:
//   node scripts/indexnow.mjs                 -> sends every URL in sitemap.xml
//   node scripts/indexnow.mjs <url> [<url>…]  -> sends only these URLs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'procv.store';
const KEY = '78123617520796874f5a36a42934bba1';
const keyLocation = `https://${HOST}/${KEY}.txt`;

const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [...readFileSync(join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

// The key file must be live first, or IndexNow rejects the request (403).
const live = await fetch(keyLocation).then(r => r.ok && r.text()).catch(() => '');
if (String(live).trim() !== KEY) {
  console.error(`Key file not live yet at ${keyLocation}. Push and wait for the deploy, then run again.`);
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation, urlList: urls }),
});
// 200 = received, 202 = received and the key is still being checked.
console.log(`IndexNow answered ${res.status} ${res.statusText} for ${urls.length} URL(s)`);
if (!res.ok) { console.error(await res.text()); process.exit(1); }
