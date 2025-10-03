(function () {
  const MAX_QUANTITY = 10;

  function createQuantitySelect() {
    const select = document.createElement('select');
    select.className = 'quantity-select';
    for (let i = 1; i <= MAX_QUANTITY; i += 1) {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = i;
      select.appendChild(option);
    }
    return select;
  }

  function renderProducts(container, items, category) {
    container.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'product-empty';
      empty.textContent = 'No products match your search yet. Try a different keyword.';
      container.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'product-card';

      if (item.image) {
        const figure = document.createElement('div');
        figure.className = 'product-image';
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = item.name;
        figure.appendChild(img);
        card.appendChild(figure);
      }

      const title = document.createElement('h3');
      title.textContent = item.name;
      card.appendChild(title);

      const description = document.createElement('p');
      description.textContent = item.description;
      card.appendChild(description);

      const priceRow = document.createElement('div');
      priceRow.className = 'product-price';
      const priceLabel = item.unitLabel || 'per package';
      priceRow.innerHTML = `<span>${window.cart.formatCurrency(item.price)}</span><span>${priceLabel}</span>`;
      card.appendChild(priceRow);

      const actions = document.createElement('div');
      actions.className = 'product-actions';

      const select = createQuantitySelect();
      actions.appendChild(select);

      const button = document.createElement('button');
      button.className = 'add-btn';
      button.type = 'button';
      button.textContent = 'Add to cart';
      button.addEventListener('click', () => {
        const quantity = Number(select.value);
        if (!quantity || quantity < 1) {
          window.cart.notify('Please choose a quantity before adding to cart.', 'error');
          return;
        }
        window.cart.addItem({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity,
          category,
        });
        window.cart.notify(`${item.name} x${quantity} added to cart.`, 'success');
      });
      actions.appendChild(button);

      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!window.shopConfig || !window.cart) {
      return;
    }

    const grid = document.querySelector('[data-product-grid]');
    if (!grid) return;

    const searchInput = document.querySelector('[data-product-search]');
    const sortSelect = document.querySelector('[data-product-sort]');

    const { items, category } = window.shopConfig;
    const baseItems = Array.isArray(items) ? items.slice() : [];

    function applyFilters() {
      const term = (searchInput?.value || '').toString().trim().toLowerCase();
      const sortValue = (sortSelect?.value || 'default').toString();

      let filtered = baseItems.filter((item) => {
        if (!term) return true;
        return [item.name, item.description]
          .filter(Boolean)
          .some((value) => value.toString().toLowerCase().includes(term));
      });

      if (sortValue === 'az') {
        filtered = filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
      }

      renderProducts(grid, filtered, category);
      if (typeof grid.scrollTo === 'function') {
        grid.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        grid.scrollLeft = 0;
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', applyFilters);
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', applyFilters);
    }

    applyFilters();
  });
})();
