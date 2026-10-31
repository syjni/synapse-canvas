// 개발(vite)·미리보기(vite preview) 서버에서 Cloudflare Pages와 같은 주소로 열리게 한다.
// Pages는 app.html을 /app, privacy.html을 /privacy로 서비스하고 .html 주소는 확장자 없는 주소로 보낸다.
const PAGES = ['app', 'privacy', 'licenses'];

function rewrite(req, _res, next) {
  const [p, q] = (req.url || '').split('?');
  const m = p.match(/^(.*\/)([a-z]+)\/?$/);
  if (m && PAGES.includes(m[2])) req.url = m[1] + m[2] + '.html' + (q ? '?' + q : '');
  next();
}

export default function pages() {
  return {
    name: 'pages-routes',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}
