// Owner-only native controls. Preview uses text nodes and never fetches a destination.
const cards = document.querySelector('#cards');
if (cards) {
  const base = cards.dataset.base;
  const output = document.querySelector('main > .message');
  async function request(path, data) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'Could not save this change.');
    return value;
  }
  const message = error => { output.textContent = error.message || String(error); };
  for (const [id, status] of [['manual', 'draft'], ['feature', 'published']]) {
    document.querySelector('#' + id).addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector('button');
      button.disabled = true;
      try {
        await request('/api/cards', { ...Object.fromEntries(new FormData(form)), status });
        location.reload();
      } catch (error) { message(error); button.disabled = false; }
    });
  }
  for (const form of cards.querySelectorAll('[data-edit-card]')) {
    const status = form.querySelector('[data-edit-message]');
    const preview = form.querySelector('[data-card-preview]');
    form.querySelector('[data-preview-card]').addEventListener('click', () => {
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      try {
        const url = new URL(data.url);
        if (url.protocol !== 'https:' || url.username || url.password)
          throw Error('Use a public HTTPS destination.');
        const link = preview.querySelector('a');
        link.href = url.href;
        link.querySelector('strong').textContent = data.title;
        link.querySelector('span').textContent = data.description;
        link.querySelector('small').textContent = url.hostname;
        preview.hidden = false;
        status.textContent = 'Preview updated. Nothing has been saved.';
      } catch (error) { status.textContent = error.message; preview.hidden = true; }
    });
    form.addEventListener('input', () => { preview.hidden = true; status.textContent = ''; });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        await request('/api/cards', {
          id: form.closest('[data-card]').dataset.card,
          ...Object.fromEntries(new FormData(form)),
        });
        location.reload();
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  }
  let busy = false;
  cards.addEventListener('click', async event => {
    const button = event.target.closest('button[data-move], button[data-status], button[data-delete]');
    if (!button || busy) return;
    const row = button.closest('[data-card]');
    if (button.dataset.delete && !confirm('Remove this card from the collection? Its source photo is unaffected.')) return;
    busy = true;
    const controls = [...cards.querySelectorAll('button')];
    controls.forEach(control => { control.disabled = true; });
    try {
      if (button.dataset.move) {
        const other = button.dataset.move === 'up' ? row.previousElementSibling : row.nextElementSibling;
        if (!other) return;
        const order = [...cards.children], index = order.indexOf(row), next = order.indexOf(other);
        [order[index], order[next]] = [order[next], order[index]];
        await request('/api/reorder', { ids: order.map(card => card.dataset.card) });
        if (button.dataset.move === 'up') cards.insertBefore(row, other);
        else cards.insertBefore(other, row);
        output.textContent = 'Collection order saved.';
      } else {
        await request('/api/cards', { id: row.dataset.card, status: button.dataset.status, delete: !!button.dataset.delete });
        location.reload();
      }
    } catch (error) { message(error); }
    finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
      if (button.isConnected) button.focus();
    }
  });
}
