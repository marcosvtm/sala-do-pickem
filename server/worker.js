import { cardsApi } from './api.js';
import { withSharePreview } from './share-preview.js';
export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/data/edition-s2.json') {
      try {
        return await cardsApi(request, env.DB, Date.now(), fetch, task => context.waitUntil(task),
          env.PAUSE_STAGE2_PICKS === '1' ? 'sg26-s2-v1' : null);
      } catch (err) {
        console.error('Cards API:', err.message);
        return Response.json(
          { message: 'Mural temporariamente indisponível. Tente novamente.' },
          { status: 503, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }
    const path = [
      '/',
      '/partidas',
      '/partidas/',
      '/modelos',
      '/modelos/',
    ].includes(url.pathname)
      ? '/index.html'
      : ['/cartoes', '/cartoes/', '/cartoes.html', '/ranking', '/ranking/'].includes(url.pathname)
        ? '/ranking.html'
        : url.pathname;
    const file = PUBLIC_FILES[path];
    if (!file || !['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 404 });
    const body =
      request.method === 'HEAD'
        ? null
        : Uint8Array.from(atob(file[1]), (c) => c.charCodeAt(0));
    const content = body && path.endsWith('.html')
      ? withSharePreview(new TextDecoder().decode(body), url)
      : body;
    return new Response(content, {
      headers: { 'Content-Type': file[0], 'Cache-Control': 'no-cache' },
    });
  },
};
