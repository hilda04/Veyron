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
    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'product-card';

      const title = document.createElement('h3');
      title.textContent = item.name;
      card.appendChild(title);

      const description = document.createElement('p');
      description.textContent = item.description;
      card.appendChild(description);

      const priceRow = document.createElement('div');
      priceRow.className = 'product-price';
      priceRow.innerHTML = `<span>${window.cart.formatCurrency(item.price)}</span><span>per package</span>`;
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

    const { items, category } = window.shopConfig;
    renderProducts(grid, items, category);
  });
})();
