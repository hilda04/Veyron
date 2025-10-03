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
        .map((item) => sanitizeProduct(item, { category: item.category || 'Groceries', source: 'custom', skipPersist: true }));
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

  function sanitizeImages(rawImages) {
    const unique = [];
    (Array.isArray(rawImages) ? rawImages : [rawImages]).forEach((image) => {
      if (!image) return;
      const source = image.toString();
      if (source && !unique.includes(source)) {
        unique.push(source);
      }
    });
    return unique.slice(0, MAX_IMAGES);
  }

  function sanitizeProduct(product, { category = 'Groceries', source = 'custom', skipPersist = false } = {}) {
    if (!product || typeof product !== 'object') return null;
    const images = sanitizeImages([
      product.image,
      ...(Array.isArray(product.images) ? product.images : []),
    ]);
    const cleaned = {
      id: product.id || `${slugify(product.name || category)}-${Date.now()}`,
      name: (product.name || '').toString().trim(),
      description: (product.description || '').toString().trim(),
      price: Number(product.price) || 0,
      unitLabel: (product.unitLabel || product.unit || '').toString().trim(),
      category,
      source,
      images,
      image: images[0] || null,
      createdAt: product.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!cleaned.name) {
      return null;
    }
    if (!skipPersist && source === 'custom') {
      cleaned.source = 'custom';
    }
    return cleaned;
  }

  function getCustomProducts() {
    return customProducts.map((item) => ({
      ...item,
      images: item.images ? item.images.slice() : [],
    }));
  }

  function getCustomProductsByCategory(category) {
    if (!category) return getCustomProducts();
    const match = category.toString().toLowerCase();
    return getCustomProducts().filter((item) => (item.category || '').toString().toLowerCase() === match);
  }

  function addProduct(product) {
    const category = (product.category || 'Groceries').toString();
    const baseId = slugify(product.name || category);
    let idCandidate = baseId;
    let counter = 1;
    const existing = new Set(customProducts.map((item) => item.id));
    while (existing.has(idCandidate)) {
      idCandidate = `${baseId}-${counter}`;
      counter += 1;
    }
    const sanitized = sanitizeProduct(
      {
        ...product,
        id: idCandidate,
      },
      { category, source: 'custom' }
    );
    if (!sanitized) {
      throw new Error('Invalid product payload. Please include a name and price.');
    }
    persistCustomProducts([...customProducts, sanitized]);
    return sanitized;
  }

  function removeProduct(id) {
    if (!id) return false;
    const next = customProducts.filter((item) => item.id !== id);
    if (next.length === customProducts.length) return false;
    persistCustomProducts(next);
    return true;
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
    removeProduct,
    subscribe,
    toJSON: () => getCustomProducts(),
  };

  window.productGallery = {
    open: openGallery,
    close: closeGallery,
  };
})();
