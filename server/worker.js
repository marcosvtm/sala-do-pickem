import { cardsApi } from './api.js';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await cardsApi(request, env.DB);
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
      : url.pathname === '/cartoes' || url.pathname === '/cartoes/'
        ? '/cartoes.html'
        : url.pathname;
    const file = PUBLIC_FILES[path];
    if (!file || !['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 404 });
    const body =
      request.method === 'HEAD'
        ? null
        : Uint8Array.from(atob(file[1]), (c) => c.charCodeAt(0));
    return new Response(body, {
      headers: { 'Content-Type': file[0], 'Cache-Control': 'no-cache' },
    });
  },
};
