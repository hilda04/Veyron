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

  function normalizeImageSource(value) {
    if (
      window.productStore &&
      typeof window.productStore.normalizeImageSource === 'function'
    ) {
      return window.productStore.normalizeImageSource(value);
    }
    const raw = (value || '').toString().trim();
    if (!raw) return '';
    if (raw.startsWith('//')) {
      if (typeof window !== 'undefined' && window.location && window.location.protocol) {
        return `${window.location.protocol}${raw}`;
      }
      return `https:${raw}`;
    }
    if (/^https?:\/\//i.test(raw)) {
      if (
        typeof window !== 'undefined' &&
        window.location &&
        window.location.protocol === 'https:' &&
        /^http:\/\//i.test(raw)
      ) {
        return raw.replace(/^http:\/\//i, 'https://');
      }
      return raw;
    }
    return raw;
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
      const value = normalizeImageSource(src);
      if (value && !sources.includes(value)) {
        sources.push(value);
      }
    });
    return sources.slice(0, MAX_IMAGES);
  }

  function normalizeApiProduct(item, category) {
    if (!item) return null;
    if (item.ProductId || item.Category || item.Images) {
      const images = Array.isArray(item.Images)
        ? item.Images.filter(Boolean).map((src) => src.toString())
        : Array.isArray(item.images)
        ? item.images.filter(Boolean).map((src) => src.toString())
        : [];
      return {
        id: item.ProductId || item.id || null,
        name: item.Name || item.name || '',
        description: item.Description || item.description || '',
        price: Number(typeof item.Price !== 'undefined' ? item.Price : item.price) || 0,
        unitLabel: item.UnitLabel || item.unitLabel || '',
        images,
        image: images[0] || item.image || null,
        category: item.Category || item.category || category,
      };
    }
    return item;
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

  function createImageCarousel(item) {
    const images = collectImages(item);
    if (!images.length) return null;
    let index = 0;

    const container = document.createElement('div');
    container.className = 'image-carousel';

    const viewport = document.createElement('button');
    viewport.type = 'button';
    viewport.className = 'image-carousel__viewport';
    viewport.setAttribute('aria-label', `View images of ${item.name}`);
    const img = document.createElement('img');
    img.src = images[0];
    img.alt = '';
    viewport.appendChild(img);
    viewport.addEventListener('click', () => {
      if (window.productGallery && typeof window.productGallery.open === 'function') {
        window.productGallery.open(images, item.name);
      }
    });
    container.appendChild(viewport);

    const controls = document.createElement('div');
    controls.className = 'image-carousel__controls';
    const counter = document.createElement('span');
    counter.className = 'image-carousel__counter';
    counter.textContent = `${Math.min(index + 1, images.length)} / ${images.length}`;
    controls.appendChild(counter);

    if (images.length > 1) {
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'image-carousel__nav image-carousel__nav--prev';
      prev.setAttribute('aria-label', 'Show previous photo');
      prev.textContent = '‹';

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'image-carousel__nav image-carousel__nav--next';
      next.setAttribute('aria-label', 'Show next photo');
      next.textContent = '›';

      function update(newIndex) {
        index = (newIndex + images.length) % images.length;
        img.src = images[index];
        counter.textContent = `${index + 1} / ${images.length}`;
      }

      prev.addEventListener('click', () => {
        update(index - 1);
      });

      next.addEventListener('click', () => {
        update(index + 1);
      });

      controls.insertBefore(prev, counter);
      controls.appendChild(next);
    }

    container.appendChild(controls);
    return container;
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

      const imageCarousel = createImageCarousel(item);
      if (imageCarousel) {
        card.appendChild(imageCarousel);
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

    const { category } = window.shopConfig;
    const fallbackDataUrl =
      window.shopConfig.fallbackDataUrl ||
      window.shopConfig.dataUrl ||
      window.shopConfig.dataURL ||
      '';
    const explicitApiUrl = window.shopConfig.apiUrl || window.shopConfig.apiURL;
    const apiBaseUrl =
      explicitApiUrl ||
      (window.siteConfig && window.siteConfig.apiBaseUrl) ||
      (window.shopConfig && window.shopConfig.apiBaseUrl) ||
      '';
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

      const combined = [...mergedRemote, ...draftItems, ...orphanOverrides];
      const deduped = [];
      const seen = new Map();

      combined.forEach((item) => {
        if (!item || typeof item !== 'object') {
          return;
        }
        const id = (item.id || '').toString();
        if (!id) {
          deduped.push(item);
          return;
        }
        if (seen.has(id)) {
          deduped[seen.get(id)] = item;
        } else {
          seen.set(id, deduped.length);
          deduped.push(item);
        }
      });

      baseItems = deduped;
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
      } else if (sortValue === 'price-asc') {
        filtered = filtered.slice().sort((a, b) => a.price - b.price);
      } else if (sortValue === 'price-desc') {
        filtered = filtered.slice().sort((a, b) => b.price - a.price);
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

    const remoteUrl = (() => {
      if (!apiBaseUrl) return '';
      if (apiBaseUrl.includes('?')) {
        return apiBaseUrl;
      }
      const trimmed = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
      return `${trimmed}/products?category=${encodeURIComponent(category)}`;
    })();

    if (remoteUrl || fallbackDataUrl) {
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

      const sources = [];
      if (remoteUrl) {
        sources.push({ url: remoteUrl, type: 'remote' });
      }
      if (fallbackDataUrl && fallbackDataUrl !== remoteUrl) {
        sources.push({ url: fallbackDataUrl, type: 'fallback' });
      }

      const fetchSequentially = (index = 0) => {
        if (index >= sources.length) {
          remoteItems = initialItems.slice();
          rebuildBaseItems({ resetPage: true });
          if (grid && !remoteItems.length) {
            grid.innerHTML = '';
            const empty = document.createElement('div');
            empty.className = 'product-empty';
            empty.textContent = 'No products available right now. Please check back soon.';
            grid.appendChild(empty);
          }
          return;
        }

        const { url, type } = sources[index];
        fetch(url)
          .then((response) => {
            if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
            return response.json();
          })
          .then((payload) => {
            const rawItems = Array.isArray(payload?.items)
              ? payload.items
              : Array.isArray(payload)
              ? payload
              : [];
            const normalised = rawItems
              .map((item) => normalizeApiProduct(item, category))
              .filter(Boolean);
            remoteItems = sanitizeItems(normalised, category, 'catalogue');
            rebuildBaseItems({ resetPage: true });
          })
          .catch((error) => {
            console.error(`Failed to load catalogue from ${url}`, error);
            if (type === 'remote') {
              fetchSequentially(index + 1);
            } else {
              remoteItems = initialItems.slice();
              rebuildBaseItems({ resetPage: true });
              if (grid) {
                grid.innerHTML = '';
                const failure = document.createElement('div');
                failure.className = 'product-empty';
                failure.textContent = 'Unable to load products right now. Please refresh to try again.';
                grid.appendChild(failure);
              }
            }
          });
      };

      fetchSequentially();
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
