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

      const descriptionText =
        item.description ||
        (category === 'Groceries' ? 'Essential staple supplied by Veyron Enterprises.' : '');
      if (descriptionText) {
        const description = document.createElement('p');
        description.textContent = descriptionText;
        card.appendChild(description);
      }

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

    const { items, category, dataUrl } = window.shopConfig;
    const pageSize = Math.max(1, Number(window.shopConfig.pageSize) || 12);
    let baseItems = Array.isArray(items) ? items.slice() : [];
    let filteredItems = baseItems.slice();
    let currentPage = 1;

    const pagination = document.querySelector('[data-pagination]');

    function renderPagination(totalItems) {
      if (!pagination) return;
      const totalPages = Math.ceil(totalItems / pageSize);
      if (totalPages <= 1) {
        pagination.innerHTML = '';
        pagination.hidden = true;
        return;
      }

      pagination.hidden = false;
      pagination.innerHTML = '';

      const createButton = (label, targetPage, { disabled = false, active = false } = {}) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (disabled) {
          button.disabled = true;
        } else {
          button.addEventListener('click', () => {
            goToPage(targetPage);
          });
        }
        if (active) {
          button.classList.add('is-active');
          button.setAttribute('aria-current', 'page');
        }
        return button;
      };

      const totalPagesSafe = Math.max(1, totalPages);
      pagination.appendChild(
        createButton('Prev', Math.max(1, currentPage - 1), { disabled: currentPage === 1 })
      );

      for (let page = 1; page <= totalPagesSafe; page += 1) {
        pagination.appendChild(
          createButton(page.toString(), page, { active: page === currentPage })
        );
      }

      pagination.appendChild(
        createButton('Next', Math.min(totalPagesSafe, currentPage + 1), {
          disabled: currentPage === totalPagesSafe,
        })
      );
    }

    function renderCurrentPage() {
      const totalItems = filteredItems.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      if (currentPage > totalPages) {
        currentPage = totalPages;
      }
      const startIndex = (currentPage - 1) * pageSize;
      const visibleItems = filteredItems.slice(startIndex, startIndex + pageSize);
      renderProducts(grid, visibleItems, category);
      renderPagination(totalItems);
      if (typeof grid.scrollTo === 'function') {
        grid.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
      } else {
        grid.scrollTop = 0;
        grid.scrollLeft = 0;
      }
    }

    function applyFilters({ resetPage = true } = {}) {
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

      filteredItems = filtered;
      if (resetPage) {
        currentPage = 1;
      }
      renderCurrentPage();
    }

    function goToPage(pageNumber) {
      const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
      const nextPage = Math.min(Math.max(pageNumber, 1), totalPages);
      if (nextPage === currentPage) return;
      currentPage = nextPage;
      renderCurrentPage();
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => applyFilters({ resetPage: true }));
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', () => applyFilters({ resetPage: true }));
    }

    if (dataUrl) {
      if (grid) {
        const loading = document.createElement('div');
        loading.className = 'product-empty';
        loading.textContent = 'Loading groceries…';
        grid.innerHTML = '';
        grid.appendChild(loading);
      }
      if (pagination) {
        pagination.innerHTML = '';
        pagination.hidden = true;
      }

      fetch(dataUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
          return response.json();
        })
        .then((data) => {
          if (!Array.isArray(data)) {
            throw new Error('Unexpected groceries format');
          }
          baseItems = data
            .filter((item) => item && item.name)
            .map((item, index) => ({
              ...item,
              id: item.id || `grocery-${index + 1}`,
              price: Number(item.price) || 0,
            }));
          filteredItems = baseItems.slice();
          currentPage = 1;
          applyFilters({ resetPage: true });
        })
        .catch((error) => {
          console.error('Failed to load groceries data', error);
          if (grid) {
            grid.innerHTML = '';
            const failure = document.createElement('div');
            failure.className = 'product-empty';
            failure.textContent = 'Unable to load groceries right now. Please refresh to try again.';
            grid.appendChild(failure);
          }
          if (pagination) {
            pagination.innerHTML = '';
            pagination.hidden = true;
          }
        });
      return;
    }

    applyFilters({ resetPage: true });
  });
})();
