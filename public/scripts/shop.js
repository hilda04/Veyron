(function () {
  const MAX_QUANTITY = 10;
  const MAX_IMAGES = 5;

  function slugify(value) {
    return (
      value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'item'
    );
  }

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

  function collectImages(item) {
    const sources = [];
    [item.image, ...(Array.isArray(item.images) ? item.images : [])].forEach((src) => {
      if (!src) return;
      const value = src.toString();
      if (value && !sources.includes(value)) {
        sources.push(value);
      }
    });
    return sources.slice(0, MAX_IMAGES);
  }

  function sanitizeItems(rawItems, category, source) {
    if (!Array.isArray(rawItems)) return [];
    return rawItems
      .filter((item) => item && item.name)
      .map((item, index) => {
        const images = collectImages(item);
        const safePrice = Number(item.price) || 0;
        const id = item.id || `${slugify(item.name || category)}-${index + 1}`;
        return {
          ...item,
          id,
          category: item.category || category,
          price: safePrice,
          unitLabel: item.unitLabel || item.unit || '',
          description: item.description || '',
          images,
          image: images[0] || null,
          source: source || item.source || 'catalogue',
        };
      });
  }

  function createImageButton(item) {
    const images = collectImages(item);
    if (!images.length) return null;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'product-image';
    button.setAttribute('aria-label', `View images of ${item.name}`);

    const img = document.createElement('img');
    img.src = images[0];
    img.alt = '';
    button.appendChild(img);

    if (images.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'product-image__badge';
      badge.textContent = `${images.length} photos`;
      button.appendChild(badge);
    }

    if (window.productGallery && typeof window.productGallery.open === 'function') {
      button.addEventListener('click', () => {
        window.productGallery.open(images, item.name);
      });
    } else {
      button.disabled = true;
      button.title = 'Image preview unavailable in this browser.';
    }

    return button;
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
      card.dataset.productId = item.id;

      const imageButton = createImageButton(item);
      if (imageButton) {
        card.appendChild(imageButton);
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
    const pagination = document.querySelector('[data-pagination]');

    const { category, dataUrl } = window.shopConfig;
    const initialItems = sanitizeItems(window.shopConfig.items || [], category, 'catalogue');
    const pageSize = Math.max(1, Number(window.shopConfig.pageSize) || 12);

    let remoteItems = initialItems;
    let baseItems = [];
    let filteredItems = [];
    let currentPage = 1;

    function rebuildBaseItems({ resetPage = true } = {}) {
      const adjustments =
        window.productStore && typeof window.productStore.getInventoryState === 'function'
          ? window.productStore.getInventoryState()
          : { overrides: [], removed: [], drafts: [] };

      const categoryMatch = (item) =>
        (item?.category || '').toString().toLowerCase() === category.toString().toLowerCase();

      const overrideMap = new Map(
        (adjustments.overrides || [])
          .filter((item) => categoryMatch(item) && item.overrideOf)
          .map((item) => [item.overrideOf, item])
      );

      const removedSet = new Set(
        (adjustments.removed || [])
          .filter((item) => categoryMatch(item) && item.overrideOf)
          .map((item) => item.overrideOf)
      );

      const draftItems = sanitizeItems(
        (adjustments.drafts || []).filter((item) => categoryMatch(item)),
        category,
        'custom'
      );

      const mergedRemote = remoteItems
        .filter((item) => !removedSet.has(item.id))
        .map((item) => {
          if (!overrideMap.has(item.id)) {
            return item;
          }
          const override = overrideMap.get(item.id);
          overrideMap.delete(item.id);
          const merged = {
            ...item,
            ...override,
            id: item.id,
            images:
              override.images && override.images.length ? override.images.slice() : item.images.slice(),
          };
          const [sanitizedOverride] = sanitizeItems([merged], category, 'custom');
          return sanitizedOverride || item;
        });

      const orphanOverrides = sanitizeItems(
        Array.from(overrideMap.entries()).map(([catalogueId, item]) => ({
          ...item,
          id: catalogueId || item.id,
        })),
        category,
        'custom'
      );

      baseItems = [...mergedRemote, ...draftItems, ...orphanOverrides];
      applyFilters({ resetPage });
    }

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
      pagination.appendChild(createButton('Prev', Math.max(1, currentPage - 1), { disabled: currentPage === 1 }));

      for (let page = 1; page <= totalPagesSafe; page += 1) {
        pagination.appendChild(createButton(page.toString(), page, { active: page === currentPage }));
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
        loading.textContent = 'Loading catalogue…';
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
            throw new Error('Unexpected data format');
          }
          remoteItems = sanitizeItems(data, category, 'catalogue');
          rebuildBaseItems({ resetPage: true });
        })
        .catch((error) => {
          console.error('Failed to load catalogue data', error);
          remoteItems = [];
          rebuildBaseItems({ resetPage: true });
          if (grid) {
            grid.innerHTML = '';
            const failure = document.createElement('div');
            failure.className = 'product-empty';
            failure.textContent = 'Unable to load products right now. Please refresh to try again.';
            grid.appendChild(failure);
          }
        });
    } else {
      rebuildBaseItems({ resetPage: true });
    }

    if (window.productStore && typeof window.productStore.subscribe === 'function') {
      window.productStore.subscribe(() => {
        rebuildBaseItems({ resetPage: false });
      });
    }
  });
})();
