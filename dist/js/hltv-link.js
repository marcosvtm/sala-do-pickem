export function hltvMatchLink(href, description) {
  const link = document.createElement('a');
  link.className = 'hltv-button';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = description + ' (abre em nova aba)';
  link.setAttribute('aria-label', link.title);
  return link;
}
