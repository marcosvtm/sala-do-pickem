// The public card ID is shareable. Only the separate, browser-local key authorizes changes.
const storageKey = (stage, id) => 'card-edit:' + stage.id + ':' + id;

export function editKey(stage, id) {
  try {
    return localStorage.getItem(storageKey(stage, id));
  } catch {
    return null;
  }
}
export function prepareEditKey(stage, id) {
  const existing = editKey(stage, id);
  if (existing) return existing;
  const key = crypto.randomUUID();
  try {
    localStorage.setItem(storageKey(stage, id), key);
  } catch {
    throw Error(
      'Permita o armazenamento neste navegador para guardar a chave do seu cartão.'
    );
  }
  return key;
}
export function forgetCard(stage, id) {
  try {
    localStorage.removeItem(storageKey(stage, id));
    const receiptKey = 'public-card:' + stage.id;
    const receipt = JSON.parse(localStorage.getItem(receiptKey));
    if (receipt?.token === id) localStorage.removeItem(receiptKey);
  } catch {
    /* The server has already removed the card. */
  }
}
