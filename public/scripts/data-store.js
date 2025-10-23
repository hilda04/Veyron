(function () {
  const CUSTOM_PRODUCTS_KEY = 'veyron-custom-products-v1';
  const MAX_IMAGES = 5;
  const listeners = new Set();
  let customProducts = loadCustomProducts();
  let lastFocusedElement = null;
  let galleryElements = null;
  let galleryState = {
    title: '',
    index: 0,
    images: [],
  };

  function loadCustomProducts() {
    try {
      const stored = localStorage.getItem(CUSTOM_PRODUCTS_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) =>
          sanitizeProduct(item, {
            category: item.category || 'Groceries',
            source: item.source || 'custom',
            skipPersist: true,
          })
        )
        .filter(Boolean);
    } catch (error) {
      console.error('Failed to load custom products from storage', error);
      return [];
    }
  }

  function persistCustomProducts(items) {
    customProducts = items.slice();
    try {
      localStorage.setItem(CUSTOM_PRODUCTS_KEY, JSON.stringify(customProducts));
    } catch (error) {
      console.error('Unable to persist custom products', error);
    }
    notifyListeners();
  }

  function notifyListeners() {
    const snapshot = getCustomProducts();
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('productStore subscriber failed', error);
      }
    });
    document.dispatchEvent(
      new CustomEvent('products:updated', {
        detail: snapshot,
      })
    );
  }

  function slugify(value) {
    return (
      value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 64) || 'item'
    );
  }

  function generateProductId(name, category) {
    const base = slugify(name || category || 'item');
    const existing = new Set(customProducts.map((item) => item.id));
    if (!existing.has(base)) {
      return base;
    }
    let counter = 1;
    let candidate = `${base}-${counter}`;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = `${base}-${counter}`;
    }
    return candidate;
  }

  function normalizeImageSource(value) {
    if (!value && value !== 0) return '';

    if (typeof value === 'object') {
      const isFile = typeof File !== 'undefined' && value instanceof File;
      const isBlob = typeof Blob !== 'undefined' && value instanceof Blob;
      if (isFile || isBlob) {
        return '';
      }
      if (typeof value.url !== 'undefined') {
        return normalizeImageSource(value.url);
      }
      if (typeof value.src !== 'undefined') {
        return normalizeImageSource(value.src);
      }
      if (typeof value.path !== 'undefined') {
        return normalizeImageSource(value.path);
      }
      return '';
    }

    const raw = value.toString().trim();
    if (!raw) return '';
    if (/^\[object\s/i.test(raw)) return '';

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

  function sanitizeImages(rawImages) {
    const unique = [];
    (Array.isArray(rawImages) ? rawImages : [rawImages]).forEach((image) => {
      const source = normalizeImageSource(image);
      if (source && !unique.includes(source)) {
        unique.push(source);
      }
    });
    return unique.slice(0, MAX_IMAGES);
  }

  function sanitizeProduct(
    product,
    { category = 'Groceries', source = 'custom', skipPersist = false } = {}
  ) {
    if (!product || typeof product !== 'object') return null;
    const baseCategory = (product.category || category || 'Groceries').toString();
    const modeRaw = (product.mode || (product.overrideOf ? 'override' : 'draft')).toString();
    const mode = ['draft', 'override', 'tombstone'].includes(modeRaw)
      ? modeRaw
      : 'draft';
    const overrideOf = product.overrideOf ? product.overrideOf.toString() : null;

    const images = sanitizeImages([
      product.image,
      ...(Array.isArray(product.images) ? product.images : []),
    ]);

    const cleaned = {
      id: product.id || `${slugify(product.name || baseCategory)}-${Date.now()}`,
      name: (product.name || '').toString().trim(),
      description: (product.description || '').toString().trim(),
      price: Number(product.price) || 0,
      unitLabel: (product.unitLabel || product.unit || '').toString().trim(),
      category: baseCategory,
      source,
      images,
      image: images[0] || null,
      createdAt: product.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode,
      overrideOf,
      deletedAt: null,
    };

    if (mode === 'tombstone') {
      cleaned.deletedAt = product.deletedAt || new Date().toISOString();
      cleaned.name = cleaned.name || (overrideOf ? `Removed item ${overrideOf}` : 'Removed item');
      cleaned.images = [];
      cleaned.image = null;
      return cleaned;
    }

    if (!cleaned.name) {
      return null;
    }
    if (!skipPersist && source === 'custom') {
      cleaned.source = 'custom';
    }
    return cleaned;
  }

  function getCustomProducts() {
    return customProducts
      .filter((item) => item.mode !== 'tombstone')
      .map((item) => ({
        ...item,
        images: item.images ? item.images.slice() : [],
      }));
  }

  function getCustomProductsByCategory(category) {
    if (!category) return getCustomProducts();
    const match = category.toString().toLowerCase();
    return getCustomProducts().filter(
      (item) =>
        (item.category || '').toString().toLowerCase() === match &&
        item.mode !== 'tombstone'
    );
  }

  function addProduct(product) {
    const category = (product.category || 'Groceries').toString();
    const baseId = slugify(product.name || category);
    const providedId = (product.id || '').toString().trim();
    let idCandidate = providedId || baseId;
    const existing = new Set(customProducts.map((item) => item.id));
    if (existing.has(idCandidate)) {
      if (!providedId) {
        let counter = 1;
        let candidate = `${baseId}-${counter}`;
        while (existing.has(candidate)) {
          counter += 1;
          candidate = `${baseId}-${counter}`;
        }
        idCandidate = candidate;
      } else {
        let counter = 1;
        let candidate = `${idCandidate}-${counter}`;
        while (existing.has(candidate)) {
          counter += 1;
          candidate = `${idCandidate}-${counter}`;
        }
        idCandidate = candidate;
      }
    }
    const sanitized = sanitizeProduct(
      {
        ...product,
        id: idCandidate,
        category,
        mode: product.mode || 'draft',
      },
      { category, source: 'custom' }
    );
    if (!sanitized) {
      throw new Error('Invalid product payload. Please include a name and price.');
    }
    persistCustomProducts([...customProducts, sanitized]);
    return sanitized;
  }

  function updateProduct(id, updates) {
    if (!id) {
      throw new Error('A product id is required to update.');
    }
    const index = customProducts.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error(`No product found with id ${id}`);
    }
    const existing = customProducts[index];
    const category = updates.category || existing.category || 'Groceries';
    const sanitized = sanitizeProduct(
      {
        ...existing,
        ...updates,
        id,
        category,
        mode: existing.mode,
        overrideOf: existing.overrideOf,
        createdAt: existing.createdAt,
      },
      { category, source: existing.source || 'custom' }
    );
    if (!sanitized) {
      throw new Error('Invalid product update payload.');
    }
    customProducts[index] = sanitized;
    persistCustomProducts(customProducts.slice());
    return sanitized;
  }

  function overrideCatalogueProduct(catalogueId, product) {
    if (!catalogueId) {
      throw new Error('A catalogue id is required to create an override.');
    }
    const existingIndex = customProducts.findIndex(
      (item) => item.mode === 'override' && item.overrideOf === catalogueId
    );
    const baseCategory = product.category || customProducts[existingIndex]?.category || 'Groceries';
    const basePayload = {
      id:
        existingIndex > -1
          ? customProducts[existingIndex].id
          : `override-${slugify(catalogueId)}-${Date.now()}`,
      overrideOf: catalogueId,
      mode: 'override',
      category: baseCategory,
      createdAt: existingIndex > -1 ? customProducts[existingIndex].createdAt : undefined,
    };
    const sanitized = sanitizeProduct(
      {
        ...basePayload,
        ...product,
        category: baseCategory,
        source: 'custom',
      },
      { category: baseCategory, source: 'custom' }
    );
    if (!sanitized) {
      throw new Error('Invalid override payload.');
    }
    if (existingIndex > -1) {
      customProducts[existingIndex] = sanitized;
    } else {
      customProducts.push(sanitized);
    }
    persistCustomProducts(customProducts.slice());
    return sanitized;
  }

  function removeProduct(id) {
    if (!id) return false;
    const next = customProducts.filter((item) => item.id !== id);
    if (next.length === customProducts.length) return false;
    persistCustomProducts(next);
    return true;
  }

  function removeCatalogueOverride(catalogueId) {
    if (!catalogueId) return false;
    const next = customProducts.filter(
      (item) => !(item.mode === 'override' && item.overrideOf === catalogueId)
    );
    const changed = next.length !== customProducts.length;
    if (changed) {
      persistCustomProducts(next);
    }
    return changed;
  }

  function markCatalogueRemoved(catalogueId, metadata = {}) {
    if (!catalogueId) {
      throw new Error('A catalogue id is required to remove an item.');
    }
    const existingIndex = customProducts.findIndex(
      (item) => item.mode === 'tombstone' && item.overrideOf === catalogueId
    );
    const baseCategory = metadata.category || customProducts[existingIndex]?.category || 'Groceries';
    const payload = {
      id:
        existingIndex > -1
          ? customProducts[existingIndex].id
          : `removed-${slugify(catalogueId)}-${Date.now()}`,
      overrideOf: catalogueId,
      mode: 'tombstone',
      category: baseCategory,
      name: metadata.name || customProducts[existingIndex]?.name || catalogueId,
      unitLabel: metadata.unitLabel || customProducts[existingIndex]?.unitLabel || '',
      price: metadata.price || customProducts[existingIndex]?.price || 0,
      createdAt: existingIndex > -1 ? customProducts[existingIndex].createdAt : undefined,
      deletedAt: new Date().toISOString(),
    };
    const sanitized = sanitizeProduct(payload, {
      category: baseCategory,
      source: 'custom',
    });
    if (!sanitized) {
      throw new Error('Unable to mark catalogue item as removed.');
    }
    if (existingIndex > -1) {
      customProducts[existingIndex] = sanitized;
    } else {
      customProducts.push(sanitized);
    }
    persistCustomProducts(customProducts.slice());
    return sanitized;
  }

  function restoreCatalogueItem(catalogueId) {
    if (!catalogueId) return false;
    const next = customProducts.filter(
      (item) => !(item.mode === 'tombstone' && item.overrideOf === catalogueId)
    );
    const changed = next.length !== customProducts.length;
    if (changed) {
      persistCustomProducts(next);
    }
    return changed;
  }

  function getInventoryState() {
    const snapshot = customProducts.map((item) => ({
      ...item,
      images: item.images ? item.images.slice() : [],
    }));
    return {
      items: snapshot,
      drafts: snapshot.filter((item) => item.mode === 'draft'),
      overrides: snapshot.filter((item) => item.mode === 'override'),
      removed: snapshot.filter((item) => item.mode === 'tombstone'),
    };
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function ensureGallery() {
    if (galleryElements) return galleryElements;

    const wrapper = document.createElement('div');
    wrapper.className = 'product-gallery';
    wrapper.hidden = true;

    wrapper.innerHTML = `
      <div class="product-gallery__backdrop" data-gallery-close></div>
      <div class="product-gallery__dialog" role="dialog" aria-modal="true">
        <button type="button" class="product-gallery__close" data-gallery-close aria-label="Close gallery">×</button>
        <figure class="product-gallery__figure">
          <img data-gallery-image alt="" />
          <figcaption data-gallery-caption></figcaption>
        </figure>
        <div class="product-gallery__controls">
          <button type="button" class="product-gallery__nav" data-gallery-prev aria-label="Previous image">‹</button>
          <span class="product-gallery__counter" data-gallery-counter></span>
          <button type="button" class="product-gallery__nav" data-gallery-next aria-label="Next image">›</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);

    const closeButtons = wrapper.querySelectorAll('[data-gallery-close]');
    closeButtons.forEach((button) => {
      button.addEventListener('click', closeGallery);
    });
    wrapper.addEventListener('click', (event) => {
      if (event.target === wrapper) {
        closeGallery();
      }
    });
    wrapper.querySelector('[data-gallery-prev]').addEventListener('click', showPreviousImage);
    wrapper.querySelector('[data-gallery-next]').addEventListener('click', showNextImage);

    galleryElements = {
      wrapper,
      image: wrapper.querySelector('[data-gallery-image]'),
      caption: wrapper.querySelector('[data-gallery-caption]'),
      counter: wrapper.querySelector('[data-gallery-counter]'),
      dialog: wrapper.querySelector('.product-gallery__dialog'),
      prev: wrapper.querySelector('[data-gallery-prev]'),
      next: wrapper.querySelector('[data-gallery-next]'),
      close: wrapper.querySelector('.product-gallery__close'),
    };

    return galleryElements;
  }

  function updateGallery() {
    if (!galleryElements) return;
    const { images, index, title } = galleryState;
    const { image, caption, counter } = galleryElements;
    const current = images[index];
    if (current) {
      image.src = current;
      image.alt = title || 'Product image';
    }
    caption.textContent = title || '';
    counter.textContent = images.length > 1 ? `${index + 1} / ${images.length}` : '1 / 1';
    galleryElements.prev.disabled = images.length <= 1;
    galleryElements.next.disabled = images.length <= 1;
  }

  function handleKeydown(event) {
    if (!galleryElements || galleryElements.wrapper.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeGallery();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showNextImage();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showPreviousImage();
    }
  }

  function openGallery(images, title, startIndex = 0) {
    const galleryImages = sanitizeImages(images);
    if (!galleryImages.length) return;
    const elements = ensureGallery();
    galleryState = {
      title: title || 'Product image',
      images: galleryImages,
      index: Math.min(Math.max(startIndex, 0), galleryImages.length - 1),
    };
    lastFocusedElement = document.activeElement;
    elements.wrapper.hidden = false;
    elements.wrapper.classList.add('is-visible');
    document.body.classList.add('has-open-gallery');
    updateGallery();
    elements.close.focus({ preventScroll: true });
    document.addEventListener('keydown', handleKeydown);
  }

  function closeGallery() {
    if (!galleryElements) return;
    galleryElements.wrapper.classList.remove('is-visible');
    galleryElements.wrapper.hidden = true;
    document.body.classList.remove('has-open-gallery');
    document.removeEventListener('keydown', handleKeydown);
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus({ preventScroll: true });
    }
  }

  function showNextImage() {
    const { images } = galleryState;
    if (images.length <= 1) return;
    galleryState.index = (galleryState.index + 1) % images.length;
    updateGallery();
  }

  function showPreviousImage() {
    const { images } = galleryState;
    if (images.length <= 1) return;
    galleryState.index = (galleryState.index - 1 + images.length) % images.length;
    updateGallery();
  }

  window.productStore = {
    getCustomProducts,
    getCustomProductsByCategory,
    addProduct,
    updateProduct,
    removeProduct,
    overrideCatalogueProduct,
    removeCatalogueOverride,
    markCatalogueRemoved,
    restoreCatalogueItem,
    getInventoryState,
    subscribe,
    generateProductId,
    normalizeImageSource,
    toJSON: () => getCustomProducts(true),
  };

  window.productGallery = {
    open: openGallery,
    close: closeGallery,
  };
})();
