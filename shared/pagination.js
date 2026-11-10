export function setupPagination(container, itemSelector, pageSize = 4) {
  if (!container) return { refresh: () => {} };

  const controls = document.createElement('nav');
  controls.className = 'pagination';
  controls.setAttribute('aria-label', '一覧ページ');
  controls.innerHTML = '<button class="button ghost small" type="button" data-page-previous>前へ</button><span class="pagination-status" aria-live="polite"></span><button class="button ghost small" type="button" data-page-next>次へ</button>';
  container.insertAdjacentElement('afterend', controls);

  const previous = controls.querySelector('[data-page-previous]');
  const next = controls.querySelector('[data-page-next]');
  const status = controls.querySelector('.pagination-status');
  let page = 0;

  const refresh = (resetPage = false) => {
    const items = [...container.querySelectorAll(itemSelector)];
    const availableItems = items.filter((item) => item.dataset.paginationFiltered !== 'true');
    const pageCount = Math.ceil(availableItems.length / pageSize);
    if (resetPage) page = 0;
    page = Math.min(page, Math.max(pageCount - 1, 0));
    const start = page * pageSize;
    const availableIndexes = new Map(availableItems.map((item, index) => [item, index]));
    items.forEach((item) => {
      const itemIndex = availableIndexes.get(item);
      item.classList.toggle('pagination-hidden', itemIndex === undefined || itemIndex < start || itemIndex >= start + pageSize);
    });
    controls.hidden = availableItems.length <= pageSize;
    status.textContent = pageCount ? `${page + 1} / ${pageCount} ページ` : '0 件';
    previous.disabled = page === 0;
    next.disabled = page >= pageCount - 1;
  };

  previous.addEventListener('click', () => {
    page = Math.max(0, page - 1);
    refresh();
  });
  next.addEventListener('click', () => {
    page++;
    refresh();
  });
  refresh();

  return { refresh };
}
