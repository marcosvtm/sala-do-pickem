const icon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 11 8-5m-8 7 8 5"/><circle cx="5.5" cy="12" r="2.7"/><circle cx="18" cy="5" r="2.7"/><circle cx="18" cy="19" r="2.7"/></svg>';
function fallback(url, title) {
  const dlg = document.createElement('dialog'),
    label = document.createElement('label'),
    input = document.createElement('input'),
    close = document.createElement('button');
  dlg.setAttribute('aria-label', title);
  label.textContent = title;
  input.readOnly = true;
  input.value = url;
  label.append(input);
  close.className = 'outline';
  close.textContent = 'Fechar';
  close.onclick = () => dlg.close();
  dlg.append(label, close);
  dlg.onclose = () => dlg.remove();
  document.body.append(dlg);
  dlg.showModal();
  input.select();
}
export function shareButton(path, title) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'share-icon';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = icon;
  btn.onclick = async () => {
    const url = new URL(path, location.origin).href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      let note = document.getElementById('copyNotice');
      if (!note) {
        note = document.createElement('div');
        note.id = 'copyNotice';
        note.setAttribute('role', 'status');
        document.body.append(note);
      }
      note.textContent = 'Link copiado.';
      clearTimeout(note.timer);
      note.timer = setTimeout(() => (note.textContent = ''), 2500);
    } catch (e) {
      if (e.name !== 'AbortError') fallback(url, title);
    }
  };
  return btn;
}
