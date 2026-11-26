// Saves every page as finished HTML for search engines.
// Usage: node _build/prerender.js [https://your-domain]   (domain optional; switches the whole site to it)
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), cfg = path.join(__dirname, 'site.txt');
const OLD = fs.readFileSync(cfg, 'utf8').trim().replace(/\/$/, '');
const SITE = (process.argv[2] || OLD).trim().replace(/\/$/, '');
const sources = ['404.html', 'sitemap.xml', 'robots.txt', ...fs.readdirSync(path.join(root, 'assets')).filter(f => f.endsWith('.js')).map(f => 'assets/' + f)];
if (SITE !== OLD) {
  for (const f of sources) { const p = path.join(root, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split(OLD).join(SITE)); }
  fs.writeFileSync(cfg, SITE + '\n'); console.log('domain', OLD, '->', SITE);
}
const shell = fs.readFileSync(path.join(root, '404.html'));
const types = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.xml': 'application/xml' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]); const p = path.join(root, u);
  if (!path.extname(u)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(shell); }
  if (!p.startsWith(root) || !fs.existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
(async () => {
  const base = 'http://localhost:' + server.address().port;
  const routes = [...fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
  const b = await chromium.launch({ channel: 'chrome' }); const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  for (const r of routes) {
    await page.goto(base + r, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(s => setTimeout(s, 60)); } scrollTo(0, 0); });
    await page.waitForTimeout(600);
    let html = await page.evaluate(SITE => {
      const head = document.head, mod = head.querySelector('script[type=module]');
      const titles = [...head.querySelectorAll('title')], reactTitle = titles.length > 1 ? titles[0] : null;
      const after = el => mod.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      const sel = 'title,meta[name=description],meta[name=keywords],meta[property^="og:"],meta[name^="twitter:"],meta[property^="article:"],link[rel=canonical]';
      for (const el of [...head.querySelectorAll(sel)]) {
        const fromPage = el === reactTitle || (el.tagName !== 'TITLE' && after(el));
        if (reactTitle && !fromPage) { el.remove(); continue; }
        if (fromPage) el.setAttribute('data-pre', '');
      }
      for (const el of head.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')) { const c = el.getAttribute('content'); if (c && c.startsWith('/')) el.setAttribute('content', SITE + c); }
      for (const s of [...document.querySelectorAll('script')]) if (s.src && !s.src.includes('/assets/')) s.remove();
      for (const s of [...document.body.querySelectorAll('script:not([src]):not([type])')]) if (s.textContent.includes('[data-pre]')) s.remove();
      const fix = "<script>document.querySelectorAll('[data-pre]').forEach(function(e){e.remove()})</" + "script>";
      const h = '<!doctype html>\n' + document.documentElement.outerHTML, i = h.lastIndexOf('</body>');
      return h.slice(0, i) + fix + h.slice(i);
    }, SITE);
    // a share image that does not exist falls back to /og-image.jpg
    html = html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")([^"]+)"/g, (m, a, u) =>
      fs.existsSync(path.join(root, new URL(u, SITE).pathname)) ? m : a + SITE + '/og-image.jpg"');
    const out = path.join(root, r, 'index.html'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html);
    console.log('saved', r);
  }
  await b.close(); server.close();
})();
