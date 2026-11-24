const siteName = "Pick'em dos Broxinhas";
const publicOrigin = 'https://pickem-dos-broxinhas.marcosvtm.chatgpt.site';
const pages = {
  '/': {
    title: siteName + ' · Major de Singapura',
    description: 'Monte seu cartão, simule a chance de fazer cinco acertos e dispute o Pick’em dos Broxas no Major de despedida de FalleN.',
  },
  '/cartoes': {
    title: 'Cartões dos Broxas · ' + siteName,
    description: 'Veja os picks e os modelos da galera para o Major de Singapura e acompanhe os acertos do Stage 1.',
  },
  '/ranking': {
    title: 'Ranking dos Broxas · ' + siteName,
    description: 'Acompanhe quem acertou mais picks no Stage 1 do Major de Singapura.',
  },
  '/modelos': {
    title: 'Modelos · ' + siteName,
    description: 'Compare as previsões de cada confronto e ajuste seu modelo para o Pick’em de Singapura.',
  },
  '/partidas': {
    title: 'Partidas · ' + siteName,
    description: 'Acompanhe o chaveamento suíço do Stage 1 e teste como cada resultado muda os próximos confrontos.',
  },
};

export function withSharePreview(html, url) {
  const route = url.pathname.replace(/\/$/, '').replace(/\.html$/, '') || '/';
  const path = Object.hasOwn(pages, route) ? route : '/';
  const { title, description } = pages[path];
  const canonical = new URL(path, publicOrigin);
  const model = url.searchParams.get('modelo');
  const publicModelId = /^(?:m-)?[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  if (path === '/modelos' && model && publicModelId.test(model))
    canonical.searchParams.set('modelo', model);
  const image = publicOrigin + '/assets/fallen-singapura-social.jpg';
  const alt = 'FalleN ao lado de uma taça imaginada para o Major de Singapura.';
  return html.replace('<!-- share-preview -->', `<meta property="og:type" content="website" />
    <meta property="og:locale" content="pt_BR" />
    <meta property="og:site_name" content="${siteName}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonical.href}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${alt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${image}" />
    <meta name="theme-color" content="#d9f557" />`);
}
