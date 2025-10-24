(function () {
  const ORDER_STORE_KEY = 'veyron-admin-orders-v1';
  const STATUS_OPTIONS = ['Open', 'In Progress', 'Completed'];
  const currencyFormatter = new Intl.NumberFormat('en-ZW', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });

  let orders = [];
  const INVENTORY_SOURCES = {
    Furniture: { fallback: 'data/furniture.json' },
    Groceries: { fallback: 'data/groceries.json' },
  };
  const MAX_UPLOAD_IMAGES = 5;
  const INVENTORY_PAGE_SIZE = 5;
  const SYNC_ENDPOINT = '/sync';
  const IMAGE_UPLOAD_ENDPOINT = (category, id) =>
    `/products/${encodeURIComponent(category)}/${encodeURIComponent(id)}/images`;
  const inventoryState = {
    data: {
      Furniture: [],
      Groceries: [],
    },
    errors: {
      Furniture: null,
      Groceries: null,
    },
    searchTerm: '',
    displayLimit: {
      Furniture: INVENTORY_PAGE_SIZE,
      Groceries: INVENTORY_PAGE_SIZE,
    },
    totals: {
      Furniture: 0,
      Groceries: 0,
    },
    hasMore: {
      Furniture: false,
      Groceries: false,
    },
  };

  function buildOrderDocument(order) {
    const lines = [];
    lines.push(`Order ID: ${order.id}`);
    if (order.trackingNumber) {
      lines.push(`Tracking Number: ${order.trackingNumber}`);
    }
    lines.push(`Status: ${order.status || 'Open'}`);
    lines.push(`Received: ${formatDate(order.createdAt)}`);
    lines.push('');
    lines.push('Customer');
    lines.push(`  Name: ${order.customer?.name || '—'}`);
    lines.push(`  Phone: ${order.customer?.phone || '—'}`);
    lines.push(`  Email: ${order.customer?.email || '—'}`);
    lines.push(`  City: ${order.customer?.city || order.delivery?.city || '—'}`);
    lines.push('');
    lines.push('Delivery');
    lines.push(`  Address: ${order.delivery?.address || '—'}`);
    lines.push(`  City: ${order.delivery?.city || order.customer?.city || '—'}`);
    lines.push(`  Date: ${order.delivery?.date || '—'}`);
    lines.push(`  Time: ${order.delivery?.time || '—'}`);
    lines.push(`  Payment: ${order.payment || '—'}`);
    const deliveryFee = order.totals?.deliveryFee ?? order.delivery?.fee ?? 0;
    lines.push(`  Delivery Fee: ${formatCurrency(deliveryFee)}`);

    if (order.notes) {
      lines.push('');
      lines.push('Notes');
      lines.push(`  ${order.notes}`);
    }

    lines.push('');
    lines.push('Items');
    if (Array.isArray(order.items) && order.items.length) {
      order.items.forEach((item, index) => {
        const lineTotal = formatCurrency(item.total);
        const unit = formatCurrency(item.unitPrice);
        lines.push(
          `  ${index + 1}. ${item.name}${item.category ? ` (${item.category})` : ''} — ${item.quantity} × ${unit} = ${lineTotal}`
        );
      });
    } else {
      lines.push('  No line items recorded.');
    }

    lines.push('');
    const itemsTotal = order.totals?.items ?? order.itemsTotal ?? order.total ?? 0;
    const grandTotal = order.totals?.grandTotal ?? order.total ?? itemsTotal + deliveryFee;
    lines.push(`Items Subtotal: ${formatCurrency(itemsTotal)}`);
    lines.push(`Delivery Fee: ${formatCurrency(deliveryFee)}`);
    lines.push(`Amount Due: ${formatCurrency(grandTotal)}`);
    if (order.paymentProof?.name) {
      const sizeKb = Math.round((Number(order.paymentProof.size) || 0) / 1024);
      lines.push(`Proof of Payment: ${order.paymentProof.name} (${sizeKb || 0} KB)`);
    }

    return lines.join('\n');
  }

  function downloadOrderDetails(order) {
    try {
      const contents = buildOrderDocument(order);
      const blob = new Blob([contents], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const filename = `${order.trackingNumber || order.id || 'order'}-details.txt`;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download order', error);
    }
  }

  function downloadPaymentProof(order) {
    if (!order?.paymentProof?.dataUrl) return;
    try {
      const anchor = document.createElement('a');
      anchor.href = order.paymentProof.dataUrl;
      anchor.download =
        order.paymentProof.name || `${order.trackingNumber || order.id || 'order'}-payment-proof`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (error) {
      console.error('Failed to download payment proof', error);
    }
  }

  function loadOrders() {
    try {
      const stored = localStorage.getItem(ORDER_STORE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Failed to parse orders', error);
      return [];
    }
  }

  function persistOrders(nextOrders) {
    orders = nextOrders.slice();
    localStorage.setItem(ORDER_STORE_KEY, JSON.stringify(orders));
    document.dispatchEvent(
      new CustomEvent('orders:updated', {
        detail: orders.slice(),
      })
    );
  }

  function formatCurrency(value) {
    return currencyFormatter.format(value || 0);
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      const date = new Date(value);
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      return value;
    }
  }

  function updateOrderStatus(id, status) {
    if (!STATUS_OPTIONS.includes(status)) return;
    const next = orders.map((order) =>
      order.id === id
        ? {
            ...order,
            status,
            updatedAt: new Date().toISOString(),
          }
        : order
    );
    persistOrders(next);
    renderOrders();
  }

  function matchesTerm(order, term) {
    if (!term) return true;
    const haystack = [
      order.customer?.name,
      order.customer?.phone,
      order.customer?.email,
      order.delivery?.address,
      ...(order.items || []).map((item) => item.name),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  }

  function renderOrders() {
    const board = document.querySelector('[data-order-board]');
    const searchInput = document.querySelector('[data-admin-search]');
    const statusFilter = document.querySelector('[data-status-filter]');

    if (!board) return;

    const term = (searchInput?.value || '').toString().trim().toLowerCase();
    const status = (statusFilter?.value || 'all').toString();

    const filtered = orders.filter((order) => {
      const statusMatch = status === 'all' || order.status === status;
      return statusMatch && matchesTerm(order, term);
    });

    board.innerHTML = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'product-empty';
      empty.textContent = 'No orders match your filters right now.';
      board.appendChild(empty);
      return;
    }

    filtered.forEach((order) => {
      const card = document.createElement('article');
      card.className = 'admin-card';
      card.dataset.status = order.status || 'Open';
      card.dataset.orderId = order.id;

      const totals = order.totals || {};
      const itemsTotal = totals.items ?? order.itemsTotal ?? order.total ?? 0;
      const deliveryFee = totals.deliveryFee ?? order.delivery?.fee ?? 0;
      const grandTotal = totals.grandTotal ?? order.total ?? itemsTotal + deliveryFee;
      const displayId = order.trackingNumber || order.id;

      const header = document.createElement('div');
      header.className = 'admin-card__header';
      header.innerHTML = `
        <div>
          <h3>Order <span class="order-id">${displayId}</span></h3>
          <p class="order-meta">Received ${formatDate(order.createdAt)}</p>
          <p class="order-meta order-meta--total">Amount due ${formatCurrency(grandTotal)}</p>
        </div>
      `;

      const statusWrapper = document.createElement('div');
      statusWrapper.className = 'status-wrapper';
      const statusLabel = document.createElement('label');
      statusLabel.textContent = 'Status';
      statusLabel.htmlFor = `${order.id}-status`;
      const select = document.createElement('select');
      select.id = `${order.id}-status`;
      select.className = 'status-select';
      STATUS_OPTIONS.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        if (option === order.status) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
      select.addEventListener('change', (event) => {
        updateOrderStatus(order.id, event.target.value);
      });
      statusWrapper.appendChild(statusLabel);
      statusWrapper.appendChild(select);
      header.appendChild(statusWrapper);
      card.appendChild(header);

      const customerBlock = document.createElement('div');
      customerBlock.className = 'admin-card__section';
      customerBlock.innerHTML = `
        <h4>Customer</h4>
        <p><strong>${order.customer?.name || 'Unknown'}</strong></p>
        <p>Phone: ${order.customer?.phone || '—'}</p>
        <p>Email: ${order.customer?.email || '—'}</p>
        <p>City: ${order.customer?.city || order.delivery?.city || '—'}</p>
      `;
      card.appendChild(customerBlock);

      const deliveryBlock = document.createElement('div');
      deliveryBlock.className = 'admin-card__section';
      deliveryBlock.innerHTML = `
        <h4>Delivery</h4>
        <p>${order.delivery?.address || '—'}</p>
        <p>City: ${order.delivery?.city || order.customer?.city || '—'}</p>
        <p>Date: ${order.delivery?.date || '—'}</p>
        <p>Time: ${order.delivery?.time || '—'}</p>
        <p>Payment: ${order.payment || '—'}</p>
        <p>Delivery fee: ${formatCurrency(deliveryFee)}</p>
      `;
      card.appendChild(deliveryBlock);

      if (order.notes) {
        const notesBlock = document.createElement('div');
        notesBlock.className = 'admin-card__section';
        notesBlock.innerHTML = `
          <h4>Notes</h4>
          <p>${order.notes}</p>
        `;
        card.appendChild(notesBlock);
      }

      const itemsBlock = document.createElement('div');
      itemsBlock.className = 'admin-card__section';
      itemsBlock.innerHTML = '<h4>Items</h4>';
      const list = document.createElement('ul');
      list.className = 'order-items';
      (order.items || []).forEach((item) => {
        const li = document.createElement('li');
        const lineTotal = formatCurrency(item.total);
        li.innerHTML = `<span>${item.name}${item.category ? ` <small>(${item.category})</small>` : ''}</span><span>${item.quantity} × ${formatCurrency(item.unitPrice)}</span><span>${lineTotal}</span>`;
        list.appendChild(li);
      });
      itemsBlock.appendChild(list);
      const total = document.createElement('p');
      total.className = 'order-total';
      total.innerHTML = `Amount due: <strong>${formatCurrency(grandTotal)}</strong> <span class="order-total__breakdown">(${formatCurrency(itemsTotal)} + ${formatCurrency(deliveryFee)} delivery)</span>`;
      itemsBlock.appendChild(total);
      card.appendChild(itemsBlock);

      const actions = document.createElement('div');
      actions.className = 'admin-card__actions';
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'download-order-btn';
      downloadBtn.textContent = 'Download order details';
      downloadBtn.addEventListener('click', () => {
        downloadOrderDetails(order);
      });
      actions.appendChild(downloadBtn);

      if (order.paymentProof?.dataUrl) {
        const proofBtn = document.createElement('button');
        proofBtn.type = 'button';
        proofBtn.className = 'download-order-btn';
        proofBtn.textContent = 'Download proof of payment';
        proofBtn.addEventListener('click', () => {
          downloadPaymentProof(order);
        });
        actions.appendChild(proofBtn);
      }

      if (actions.children.length) {
        card.appendChild(actions);
      }

      board.appendChild(card);
    });
  }

  function sanitizeInventoryItem(item, category, source) {
    if (!item || !item.name) return null;
    const images = [];
    [item.image, ...(Array.isArray(item.images) ? item.images : [])].forEach((src) => {
      if (!src) return;
      const value = src.toString();
      if (value && !images.includes(value)) {
        images.push(value);
      }
    });
    const limited = images.slice(0, MAX_UPLOAD_IMAGES);
    return {
      ...item,
      id:
        item.id ||
        `${category.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}-${Date.now().toString().slice(-4)}`,
      name: item.name,
      description: item.description || '',
      price: Number(item.price) || 0,
      unitLabel: item.unitLabel || item.unit || '',
      images: limited,
      image: limited[0] || null,
      category,
      source,
      storeId: item.storeId || item.id,
      mode: item.mode || (source === 'catalogue' ? 'catalogue' : 'draft'),
      overrideOf: item.overrideOf || null,
    };
  }

  function createRemovedInventoryCard(item, tombstone) {
    const card = document.createElement('article');
    card.className = 'inventory-item inventory-item--removed';
    card.dataset.category = item.category;
    card.dataset.mode = 'removed';

    const header = document.createElement('header');
    header.className = 'inventory-item__header';
    const title = document.createElement('h4');
    title.textContent = item.name || tombstone?.name || item.catalogueId || 'Hidden item';
    header.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'inventory-badge inventory-badge--removed';
    badge.textContent = 'Hidden locally';
    header.appendChild(badge);
    card.appendChild(header);

    const meta = document.createElement('p');
    meta.className = 'inventory-item__description';
    meta.textContent =
      'This listing is hidden from the live storefront. Restore it to make it visible again.';
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'inventory-item__actions';

    const restoreButton = document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.className = 'inventory-item__btn';
    restoreButton.textContent = 'Restore item';
    restoreButton.addEventListener('click', () => {
      const confirmed = window.confirm('Restore this item to the storefront?');
      if (!confirmed) return;
      const catalogueId = item.catalogueId || item.id || tombstone?.overrideOf;
      const restored =
        window.productStore && typeof window.productStore.restoreCatalogueItem === 'function'
          ? window.productStore.restoreCatalogueItem(catalogueId)
          : false;
      if (restored) {
        renderInventory();
        showInventoryFeedback(`Restored “${item.name}” to the storefront.`, 'success');
      }
    });
    actions.appendChild(restoreButton);

    card.appendChild(actions);
    return card;
  }

  function normalizeApiInventoryItem(item, category) {
    if (!item) return null;
    const normalisedCategory = (item.Category || item.category || category || '').toString();
    const priceValue = typeof item.Price !== 'undefined' ? item.Price : item.price;
    const images = Array.isArray(item.Images)
      ? item.Images.filter(Boolean).map((src) => src.toString())
      : Array.isArray(item.images)
      ? item.images.filter(Boolean).map((src) => src.toString())
      : [];
    const uniqueImages = Array.from(new Set(images));
    return {
      id: item.ProductId || item.id || null,
      name: (item.Name || item.name || '').toString(),
      description: (item.Description || item.description || '').toString(),
      price: Number(priceValue) || 0,
      unitLabel: (item.UnitLabel || item.unitLabel || '').toString(),
      images: uniqueImages,
      image: uniqueImages[0] || item.image || null,
      category: normalisedCategory,
      source: 'catalogue',
      updatedAt: item.UpdatedAt || item.updatedAt || new Date().toISOString(),
      statusLabel: item.Status || 'Published',
    };
  }

  function extractInventoryPayload(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (payload && Array.isArray(payload.items)) {
      return payload.items;
    }
    if (payload && Array.isArray(payload.data)) {
      return payload.data;
    }
    return [];
  }

  function resetInventoryDisplay(category) {
    inventoryState.displayLimit[category] = INVENTORY_PAGE_SIZE;
    inventoryState.hasMore[category] = false;
    inventoryState.totals[category] = 0;
  }

  function resetAllInventoryDisplays() {
    Object.keys(INVENTORY_SOURCES).forEach((category) => {
      resetInventoryDisplay(category);
    });
  }

  function matchesInventorySearch(item, term) {
    if (!term) return true;
    const haystack = [item.name, item.description, item.unitLabel]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  }

  function loadInventoryData() {
    const config = getApiConfig();
    const baseUrl = config.baseUrl;
    const loaders = Object.entries(INVENTORY_SOURCES).map(([category, source]) => {
      const fallbackUrl = source?.fallback || '';
      const remoteUrl = baseUrl
        ? `${baseUrl}/products?category=${encodeURIComponent(category)}`
        : '';
      const urls = [remoteUrl, fallbackUrl].filter((value) => value && value.length);

      if (!urls.length) {
        inventoryState.data[category] = [];
        inventoryState.errors[category] =
          'No data source configured. Provide an API URL or a fallback JSON file.';
        return Promise.resolve();
      }

      const attemptFetch = (index = 0, lastError = null) => {
        if (index >= urls.length) {
          console.error(`Failed to load inventory for ${category}`, lastError);
          inventoryState.data[category] = [];
          inventoryState.errors[category] =
            'Unable to load catalogue data. Check your API configuration or fallback files.';
          return Promise.resolve();
        }
        const url = urls[index];
        return fetch(url)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Request for ${category} failed with status ${response.status}`);
            }
            return response.json();
          })
          .then((payload) => {
            const rawItems = extractInventoryPayload(payload);
            const normalised = rawItems
              .map((item) => normalizeApiInventoryItem(item, category))
              .map((item) =>
                sanitizeInventoryItem(
                  {
                    ...item,
                    id: item?.id,
                    mode: 'catalogue',
                  },
                  category,
                  'catalogue'
                )
              )
              .filter(Boolean);
            inventoryState.data[category] = normalised;
            inventoryState.errors[category] = null;
          })
          .catch((error) => {
            if (index + 1 < urls.length) {
              return attemptFetch(index + 1, error);
            }
            console.error(`Failed to load inventory for ${category}`, error);
            inventoryState.data[category] = [];
            inventoryState.errors[category] =
              'Unable to load catalogue data. Check your API configuration or fallback files.';
          });
      };

      return attemptFetch();
    });

    return Promise.all(loaders).then(() => {
      resetAllInventoryDisplays();
    });
  }

  function createImageCarousel(images, title) {
    const normalise =
      window.productStore && typeof window.productStore.normalizeImageSource === 'function'
        ? window.productStore.normalizeImageSource
        : (value) => (value || '').toString().trim();
    const uniqueSources = [];
    (Array.isArray(images) ? images : []).forEach((src) => {
      const value = normalise(src);
      if (value && !uniqueSources.includes(value)) {
        uniqueSources.push(value);
      }
    });
    if (!uniqueSources.length) return null;
    let index = 0;

    const container = document.createElement('div');
    container.className = 'image-carousel';

    const viewport = document.createElement('button');
    viewport.type = 'button';
    viewport.className = 'image-carousel__viewport';
    if (title) {
      viewport.setAttribute('aria-label', `View images of ${title}`);
    }
    const img = document.createElement('img');
    img.src = uniqueSources[0];
    img.alt = '';
    viewport.appendChild(img);
    viewport.addEventListener('click', () => {
      if (window.productGallery && typeof window.productGallery.open === 'function') {
        window.productGallery.open(uniqueSources, title || 'Product image');
      }
    });
    container.appendChild(viewport);

    const controls = document.createElement('div');
    controls.className = 'image-carousel__controls';
    const counter = document.createElement('span');
    counter.className = 'image-carousel__counter';
    counter.textContent = `${Math.min(index + 1, uniqueSources.length)} / ${uniqueSources.length}`;
    controls.appendChild(counter);

    if (uniqueSources.length > 1) {
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'image-carousel__nav image-carousel__nav--prev';
      prev.setAttribute('aria-label', 'Show previous image');
      prev.textContent = '‹';

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'image-carousel__nav image-carousel__nav--next';
      next.setAttribute('aria-label', 'Show next image');
      next.textContent = '›';

      function update(newIndex) {
        index = (newIndex + uniqueSources.length) % uniqueSources.length;
        img.src = uniqueSources[index];
        counter.textContent = `${index + 1} / ${uniqueSources.length}`;
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

  function createInventoryCard(item) {
    const card = document.createElement('article');
    card.className = 'inventory-item';
    card.dataset.category = item.category;
    card.dataset.source = item.source || 'catalogue';
    if (item.mode) {
      card.dataset.mode = item.mode;
    }

    const header = document.createElement('header');
    header.className = 'inventory-item__header';
    const title = document.createElement('h4');
    title.textContent = item.name;
    header.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'inventory-badge';
    const statusLabel = item.statusLabel ||
      (item.mode === 'override'
        ? 'Override (local)'
        : item.mode === 'draft'
        ? 'Draft (local)'
        : 'Published');
    if (item.mode === 'draft') {
      badge.classList.add('inventory-badge--draft');
    } else if (item.mode === 'override') {
      badge.classList.add('inventory-badge--override');
    }
    badge.textContent = statusLabel;
    header.appendChild(badge);
    card.appendChild(header);

    const carousel = createImageCarousel(item.images, item.name);
    if (carousel) {
      carousel.classList.add('inventory-item__carousel');
      card.appendChild(carousel);
    }

    const meta = document.createElement('p');
    meta.className = 'inventory-item__meta';
    const unit = item.unitLabel ? `<span>${item.unitLabel}</span>` : '';
    meta.innerHTML = `<strong>${formatCurrency(item.price)}</strong>${unit}`;
    card.appendChild(meta);

    if (item.description) {
      const description = document.createElement('p');
      description.className = 'inventory-item__description';
      description.textContent = item.description;
      card.appendChild(description);
    }

    const actions = document.createElement('div');
    actions.className = 'inventory-item__actions';

    if (
      item.images &&
      item.images.length &&
      window.productGallery &&
      typeof window.productGallery.open === 'function'
    ) {
      const viewButton = document.createElement('button');
      viewButton.type = 'button';
      viewButton.className = 'inventory-item__btn';
      viewButton.textContent = item.images.length > 1 ? 'Open full gallery' : 'View image';
      viewButton.addEventListener('click', () => {
        window.productGallery.open(item.images, item.name);
      });
      actions.appendChild(viewButton);
    }

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'inventory-item__btn';
    editButton.textContent = 'Edit item';
    editButton.addEventListener('click', () => {
      populateInventoryForm(item);
    });
    actions.appendChild(editButton);

    if (item.mode === 'draft' && window.productStore && typeof window.productStore.removeProduct === 'function') {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'inventory-item__btn inventory-item__btn--danger';
      removeButton.textContent = 'Delete draft';
      removeButton.addEventListener('click', () => {
        const confirmed = window.confirm(`Delete the draft “${item.name}”? This cannot be undone.`);
        if (!confirmed) return;
        const removed = window.productStore.removeProduct(item.storeId || item.id);
        if (removed) {
          renderInventory();
          showInventoryFeedback(`Deleted draft item “${item.name}”.`, 'success');
          resetInventoryForm();
        }
      });
      actions.appendChild(removeButton);
    }

    if (item.mode === 'override' && window.productStore && typeof window.productStore.removeCatalogueOverride === 'function') {
      const revertButton = document.createElement('button');
      revertButton.type = 'button';
      revertButton.className = 'inventory-item__btn inventory-item__btn--secondary';
      revertButton.textContent = 'Revert to published';
      revertButton.addEventListener('click', () => {
        const confirmed = window.confirm(
          `Remove local edits for “${item.name}” and restore the published version?`
        );
        if (!confirmed) return;
        const reverted = window.productStore.removeCatalogueOverride(item.catalogueId || item.id);
        if (reverted) {
          renderInventory();
          showInventoryFeedback(`Restored published version of “${item.name}”.`, 'success');
          resetInventoryForm();
        }
      });
      actions.appendChild(revertButton);
    }

    if (item.mode === 'catalogue' && window.productStore && typeof window.productStore.markCatalogueRemoved === 'function') {
      const hideButton = document.createElement('button');
      hideButton.type = 'button';
      hideButton.className = 'inventory-item__btn inventory-item__btn--danger';
      hideButton.textContent = 'Hide from storefront';
      hideButton.addEventListener('click', () => {
        const confirmed = window.confirm(
          `Hide “${item.name}” from the storefront? You can restore it later from the admin panel.`
        );
        if (!confirmed) return;
        try {
          window.productStore.markCatalogueRemoved(item.catalogueId || item.id, {
            name: item.name,
            category: item.category,
            unitLabel: item.unitLabel,
            price: item.price,
          });
          renderInventory();
          showInventoryFeedback(`Hidden “${item.name}” from the storefront.`, 'success');
          resetInventoryForm();
        } catch (error) {
          console.error('Failed to hide catalogue item', error);
          showInventoryFeedback('Unable to hide this item. Please try again.', 'error');
        }
      });
      actions.appendChild(hideButton);
    }

    if (actions.childElementCount) {
      card.appendChild(actions);
    }

    return card;
  }

  function renderInventoryForCategory(category, storeState) {
    const container = document.querySelector(`[data-inventory-list="${category}"]`);
    if (!container) return;
    container.innerHTML = '';

    const errorMessage = inventoryState.errors[category];
    if (errorMessage) {
      const error = document.createElement('p');
      error.className = 'product-empty';
      error.textContent = errorMessage;
      container.appendChild(error);
      return;
    }

    if (!inventoryState.displayLimit[category]) {
      resetInventoryDisplay(category);
    }

    const catalogueItems = (inventoryState.data[category] || []).filter(Boolean);
    const storeSnapshot = storeState || { drafts: [], overrides: [], removed: [] };
    const overrides = new Map(
      (storeSnapshot.overrides || [])
        .filter((item) => (item.category || '').toLowerCase() === category.toLowerCase())
        .map((item) => [item.overrideOf, item])
    );
    const removed = new Map(
      (storeSnapshot.removed || [])
        .filter((item) => (item.category || '').toLowerCase() === category.toLowerCase())
        .map((item) => [item.overrideOf, item])
    );
    const drafts = (storeSnapshot.drafts || []).filter(
      (item) => (item.category || '').toLowerCase() === category.toLowerCase()
    );

    const combined = [];
    const removedCards = [];

    catalogueItems.forEach((catalogueItem) => {
      const base = sanitizeInventoryItem(
        {
          ...catalogueItem,
          mode: 'catalogue',
          storeId: null,
          overrideOf: null,
        },
        category,
        'catalogue'
      );
      if (!base) return;
      base.catalogueId = base.id;
      base.mode = 'catalogue';

      if (removed.has(base.id)) {
        removedCards.push(createRemovedInventoryCard(base, removed.get(base.id)));
        return;
      }

      if (overrides.has(base.id)) {
        const override = overrides.get(base.id);
        const merged = sanitizeInventoryItem(
          {
            ...base,
            ...override,
            id: base.id,
            images: override.images && override.images.length ? override.images : base.images,
            mode: 'override',
            storeId: override.id,
            overrideOf: base.id,
          },
          category,
          'override'
        );
        if (merged) {
          merged.catalogueId = base.id;
          merged.storeId = override.id;
          merged.mode = 'override';
          merged.statusLabel = 'Override (local)';
          combined.push(merged);
        }
        return;
      }

      base.statusLabel = 'Published';
      combined.push(base);
    });

    drafts.forEach((draft) => {
      const sanitized = sanitizeInventoryItem(
        {
          ...draft,
          storeId: draft.id,
          mode: 'draft',
        },
        category,
        'custom'
      );
      if (sanitized) {
        sanitized.storeId = draft.id;
        sanitized.mode = 'draft';
        sanitized.statusLabel = 'Draft (local)';
        combined.push(sanitized);
      }
    });

    const term = (inventoryState.searchTerm || '').toString().toLowerCase();
    const filtered = combined
      .filter((item) => matchesInventorySearch(item, term))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const displayLimit = Math.max(
      INVENTORY_PAGE_SIZE,
      inventoryState.displayLimit[category] || INVENTORY_PAGE_SIZE
    );
    const visibleCount = Math.min(displayLimit, filtered.length);
    const visibleItems = filtered.slice(0, visibleCount);

    inventoryState.totals[category] = filtered.length;
    inventoryState.hasMore[category] = visibleCount < filtered.length;

    if (!visibleItems.length && !removedCards.length) {
      const empty = document.createElement('p');
      empty.className = 'product-empty';
      empty.textContent = term
        ? `No ${category.toLowerCase()} items match “${inventoryState.searchTerm}”.`
        : `No ${category.toLowerCase()} items available yet.`;
      container.appendChild(empty);
      return;
    }

    visibleItems.forEach((item) => {
      container.appendChild(createInventoryCard(item));
    });

    if (inventoryState.hasMore[category]) {
      const hint = document.createElement('p');
      hint.className = 'inventory-load-hint';
      hint.textContent = 'Scroll to load more items…';
      container.appendChild(hint);
    }

    removedCards.forEach((card) => {
      container.appendChild(card);
    });
  }

  function renderInventory() {
    const storeState =
      window.productStore && typeof window.productStore.getInventoryState === 'function'
        ? window.productStore.getInventoryState()
        : { drafts: [], overrides: [], removed: [] };
    Object.keys(INVENTORY_SOURCES).forEach((category) => {
      renderInventoryForCategory(category, storeState);
    });
  }

  function handleInventoryScroll(event) {
    const container = event.currentTarget;
    const category = container?.dataset?.inventoryList;
    if (!category) return;
    if (!inventoryState.hasMore[category]) return;

    const rawThreshold = container.scrollHeight - container.clientHeight - 48;
    if (rawThreshold <= 0) {
      if (inventoryState.hasMore[category]) {
        const currentLimit = Math.max(
          INVENTORY_PAGE_SIZE,
          inventoryState.displayLimit[category] || INVENTORY_PAGE_SIZE
        );
        const totalItems = inventoryState.totals[category] || 0;
        const nextLimit = Math.min(totalItems, currentLimit + INVENTORY_PAGE_SIZE);
        if (nextLimit > currentLimit) {
          inventoryState.displayLimit[category] = nextLimit;
          renderInventory();
        }
      }
      return;
    }
    const threshold = Math.max(0, rawThreshold);
    if (container.scrollTop >= threshold) {
      const currentLimit = Math.max(
        INVENTORY_PAGE_SIZE,
        inventoryState.displayLimit[category] || INVENTORY_PAGE_SIZE
      );
      const totalItems = inventoryState.totals[category] || 0;
      const nextLimit = Math.min(totalItems, currentLimit + INVENTORY_PAGE_SIZE);
      if (nextLimit > currentLimit) {
        inventoryState.displayLimit[category] = nextLimit;
        renderInventory();
      }
    }
  }

  function setupInventoryScroll() {
    const containers = document.querySelectorAll('[data-inventory-list]');
    containers.forEach((container) => {
      container.addEventListener('scroll', handleInventoryScroll, { passive: true });
    });
  }

  function setupInventorySearch() {
    const input = document.querySelector('[data-inventory-search]');
    if (!input) return;
    input.addEventListener('input', () => {
      inventoryState.searchTerm = input.value.trim();
      Object.keys(INVENTORY_SOURCES).forEach((category) => {
        resetInventoryDisplay(category);
      });
      renderInventory();
    });
  }

  function getInventoryFormElements() {
    const form = document.querySelector('[data-inventory-form]');
    if (!form) return null;
    return {
      form,
      category: form.querySelector('select[name="category"]'),
      name: form.querySelector('input[name="name"]'),
      price: form.querySelector('input[name="price"]'),
      unit: form.querySelector('input[name="unit"]'),
      description: form.querySelector('textarea[name="description"]'),
      imageInput: form.querySelector('input[name="images"]'),
      imageUrls: form.querySelector('textarea[name="imageUrls"]'),
      submit: form.querySelector('button[type="submit"]'),
      mode: form.querySelector('[data-inventory-editor-mode]'),
      storeId: form.querySelector('[data-inventory-product-id]'),
      catalogueId: form.querySelector('[data-inventory-catalogue-id]'),
      editingBanner: form.querySelector('[data-inventory-editing-banner]'),
      editingLabel: form.querySelector('[data-inventory-editing-label]'),
      cancelEdit: form.querySelector('[data-inventory-cancel-edit]'),
    };
  }

  function setInventoryFormState(state) {
    const refs = getInventoryFormElements();
    if (!refs) return;
    const modeValue = state?.mode || '';
    const name = state?.name || '';
    const modeLabel =
      modeValue === 'catalogue'
        ? 'Published item'
        : modeValue === 'override'
        ? 'Published override'
        : modeValue === 'draft'
        ? 'Draft item'
        : '';

    if (refs.mode) {
      refs.mode.value = modeValue;
    }
    if (refs.storeId) {
      refs.storeId.value = state?.storeId || '';
    }
    if (refs.catalogueId) {
      refs.catalogueId.value = state?.catalogueId || '';
    }

    if (refs.submit) {
      refs.submit.textContent = modeValue ? 'Save changes' : 'Save draft item';
    }

    if (refs.editingBanner && refs.editingLabel) {
      if (modeValue) {
        refs.editingBanner.hidden = false;
        refs.editingLabel.textContent = name
          ? `Editing “${name}” (${modeLabel || 'Item'})`
          : 'Editing catalogue item';
      } else {
        refs.editingBanner.hidden = true;
        refs.editingLabel.textContent = '';
      }
    }
  }

  function resetInventoryForm() {
    const refs = getInventoryFormElements();
    if (!refs) return;
    const selectedCategory = refs.category?.value || 'Groceries';
    refs.form.reset();
    if (refs.category) {
      refs.category.value = selectedCategory;
    }
    if (refs.imageInput) {
      refs.imageInput.value = '';
    }
    if (refs.imageUrls) {
      refs.imageUrls.value = '';
    }
    setInventoryFormState(null);
  }

  function populateInventoryForm(item) {
    const refs = getInventoryFormElements();
    if (!refs || !item) return;
    const mode = item.mode === 'catalogue' ? 'catalogue' : item.mode || 'draft';
    const catalogueId =
      mode === 'catalogue' ? item.catalogueId || item.id : item.catalogueId || null;

    if (refs.category) {
      refs.category.value = item.category || refs.category.value || 'Groceries';
    }
    if (refs.name) {
      refs.name.value = item.name || '';
    }
    if (refs.price) {
      refs.price.value = Number(item.price || 0);
    }
    if (refs.unit) {
      refs.unit.value = item.unitLabel || '';
    }
    if (refs.description) {
      refs.description.value = item.description || '';
    }
    if (refs.imageInput) {
      refs.imageInput.value = '';
    }
    if (refs.imageUrls) {
      refs.imageUrls.value = (item.images || []).join('\n');
    }

    setInventoryFormState({
      mode,
      storeId: mode === 'draft' || mode === 'override' ? item.storeId || item.id : '',
      catalogueId: catalogueId || '',
      name: item.name,
    });

    showInventoryFeedback(
      `Editing “${item.name}”. Save your changes or cancel to discard edits.`,
      'success'
    );
  }

  function showInventoryFeedback(message, state = 'success') {
    const feedback = document.querySelector('[data-inventory-feedback]');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.remove('error', 'success', 'info');
    if (state === 'error') {
      feedback.classList.add('error');
    } else if (state === 'info') {
      feedback.classList.add('info');
    } else {
      feedback.classList.add('success');
    }
  }

  function buildAuthorisedHeaders(config) {
    const headers = {
      ...(config.extraHeaders || {}),
    };
    if (config.authToken) {
      headers.Authorization = config.authToken.startsWith('Bearer ')
        ? config.authToken
        : `Bearer ${config.authToken}`;
    }
    return headers;
  }

  function requestImageUpload(config, category, productId, file) {
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorisedHeaders(config),
    };
    return fetch(`${config.baseUrl}${IMAGE_UPLOAD_ENDPOINT(category, productId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || 'image/jpeg',
      }),
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`Upload URL request failed with status ${response.status}`);
      }
      return response.json();
    });
  }

  function uploadFileToS3(uploadUrl, file) {
    return fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`S3 upload failed with status ${response.status}`);
      }
      return response;
    });
  }

  async function uploadInventoryFiles(files, { category, productId, config }) {
    if (!files.length) return [];
    if (!config.baseUrl) {
      throw new Error('API base URL is required to upload images.');
    }
    const uploads = [];
    for (const file of files) {
      const { uploadUrl, publicUrl } = await requestImageUpload(config, category, productId, file);
      await uploadFileToS3(uploadUrl, file);
      uploads.push(publicUrl);
    }
    return uploads;
  }

  async function handleInventorySubmit(form) {
    const formData = new FormData(form);
    const refs = getInventoryFormElements();
    const mode = refs?.mode?.value || '';
    const editingId = refs?.storeId?.value || '';
    const catalogueId = refs?.catalogueId?.value || '';
    const category = (formData.get('category') || 'Groceries').toString();
    const name = (formData.get('name') || '').toString().trim();
    const priceRaw = formData.get('price');
    const price = Number(priceRaw);
    const unitLabel = (formData.get('unit') || '').toString().trim();
    const description = (formData.get('description') || '').toString().trim();
    const fileInput = form.querySelector('input[name="images"]');
    const files = fileInput?.files ? Array.from(fileInput.files) : [];
    const imageUrlsRaw = refs?.imageUrls?.value || '';
    const imageUrls = imageUrlsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (!name) {
      showInventoryFeedback('Please provide a product name before saving.', 'error');
      return;
    }

    if (Number.isNaN(price)) {
      showInventoryFeedback('Please enter a valid price in USD.', 'error');
      return;
    }

    if (files.length > MAX_UPLOAD_IMAGES) {
      showInventoryFeedback(
        `Please upload a maximum of ${MAX_UPLOAD_IMAGES} images per item.`,
        'error'
      );
      return;
    }

    if (imageUrls.length > MAX_UPLOAD_IMAGES) {
      showInventoryFeedback(
        `Please provide up to ${MAX_UPLOAD_IMAGES} image URLs per item.`,
        'error'
      );
      return;
    }

    const config = getApiConfig();
    const limitedFiles = files.slice(0, MAX_UPLOAD_IMAGES);

    if (limitedFiles.length && !config.baseUrl) {
      showInventoryFeedback(
        'Configure your API base URL before uploading product images.',
        'error'
      );
      return;
    }

    let targetId = '';
    if (mode === 'catalogue' && catalogueId) {
      targetId = catalogueId;
    } else if ((mode === 'draft' || mode === 'override') && editingId) {
      targetId = editingId;
    } else if (
      window.productStore &&
      typeof window.productStore.generateProductId === 'function'
    ) {
      targetId = window.productStore.generateProductId(name, category);
    } else {
      targetId = `${category.toLowerCase()}-${Date.now()}`;
    }

    let uploadedUrls = [];
    try {
      if (limitedFiles.length) {
        showInventoryFeedback('Uploading images…', 'info');
        uploadedUrls = await uploadInventoryFiles(limitedFiles, {
          category,
          productId: targetId,
          config,
        });
      }
    } catch (error) {
      console.error('Image upload failed', error);
      showInventoryFeedback('Unable to upload product images. Please try again.', 'error');
      return;
    }

    const combined = [];
    [...imageUrls, ...uploadedUrls].forEach((src) => {
      const value = (src || '').toString();
      if (value && !combined.includes(value)) {
        combined.push(value);
      }
    });
    const limitedImages = combined.slice(0, MAX_UPLOAD_IMAGES);
    const payload = {
      category,
      name,
      price,
      unitLabel,
      description,
      images: limitedImages,
    };

    let saved;
    let message = '';
    try {
      if (mode === 'draft' && editingId) {
        saved = window.productStore.updateProduct(editingId, payload);
        message = `Updated draft item “${saved.name}”.`;
      } else if (mode === 'override' && editingId) {
        saved = window.productStore.updateProduct(editingId, {
          ...payload,
          mode: 'override',
        });
        message = `Updated local override for “${saved.name}”.`;
      } else if (mode === 'catalogue' && catalogueId) {
        saved = window.productStore.overrideCatalogueProduct(catalogueId, payload);
        message = `Saved local edits for “${saved.name}”.`;
      } else {
        saved = window.productStore.addProduct({ ...payload, id: targetId });
        message = `Saved draft item “${saved.name}”.`;
      }
    } catch (error) {
      console.error('Failed to persist inventory item', error);
      showInventoryFeedback('Unable to save this item. Please try again.', 'error');
      return;
    }

    showInventoryFeedback(message, 'success');
    resetInventoryDisplay(category);
    renderInventory();

    const previewWrapper = document.querySelector('[data-inventory-preview]');
    const previewCode = document.querySelector('[data-inventory-json]');
    if (previewWrapper && previewCode && saved) {
      previewCode.textContent = JSON.stringify(saved, null, 2);
      previewWrapper.hidden = false;
    }

    resetInventoryForm();
  }

  function setupInventoryForm() {
    const form = document.querySelector('[data-inventory-form]');
    if (!form) return;

    if (!window.productStore || typeof window.productStore.addProduct !== 'function') {
      const submit = form.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = true;
      }
      showInventoryFeedback('Local catalogue storage unavailable. Ensure scripts/data-store.js is loaded.', 'error');
      return;
    }

    resetInventoryForm();

    const refs = getInventoryFormElements();
    if (refs?.cancelEdit) {
      refs.cancelEdit.addEventListener('click', () => {
        resetInventoryForm();
        showInventoryFeedback('Editing cancelled. No changes were saved.', 'success');
      });
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      handleInventorySubmit(form);
    });
  }

  function getApiConfig() {
    const config = window.adminApiConfig || {};
    const baseUrlRaw = (config.baseUrl || '').toString().trim();
    const baseUrl = baseUrlRaw.endsWith('/') ? baseUrlRaw.slice(0, -1) : baseUrlRaw;
    return {
      baseUrl,
      authToken: (config.authToken || '').toString().trim(),
      extraHeaders:
        config.extraHeaders && typeof config.extraHeaders === 'object'
          ? { ...config.extraHeaders }
          : {},
    };
  }

  function setSyncFeedback(message, state = 'info') {
    const feedback = document.querySelector('[data-inventory-sync-feedback]');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.remove('error', 'success', 'info');
    if (state === 'success') {
      feedback.classList.add('success');
    } else if (state === 'error') {
      feedback.classList.add('error');
    } else {
      feedback.classList.add('info');
    }
  }

  function normalizeItemForSync(item, { status = 'PUBLISHED' } = {}) {
    if (!item) return null;
    const images = Array.isArray(item.images) ? item.images.slice(0, MAX_UPLOAD_IMAGES) : [];
    return {
      id: item.overrideOf || item.id,
      sourceId: item.id,
      name: item.name,
      description: item.description || '',
      category: item.category,
      price: Number(item.price) || 0,
      unitLabel: item.unitLabel || item.unit || '',
      images,
      status,
      updatedAt: item.updatedAt || new Date().toISOString(),
    };
  }

  function buildSyncPayload() {
    const storeState =
      window.productStore && typeof window.productStore.getInventoryState === 'function'
        ? window.productStore.getInventoryState()
        : { overrides: [], drafts: [], removed: [] };

    const published = Object.entries(inventoryState.data || {}).flatMap(([categoryName, items]) =>
      (Array.isArray(items) ? items : [])
        .map((item) => normalizeItemForSync({ ...item, category: categoryName }, { status: 'PUBLISHED' }))
        .filter(Boolean)
    );

    const overrides = (storeState.overrides || [])
      .map((item) => normalizeItemForSync(item, { status: 'PUBLISHED_OVERRIDE' }))
      .filter(Boolean);

    const drafts = (storeState.drafts || [])
      .map((item) => normalizeItemForSync(item, { status: 'DRAFT' }))
      .filter(Boolean);

    const removed = (storeState.removed || []).map((item) => ({
      id: item.overrideOf || item.id,
      category: item.category,
      deletedAt: item.deletedAt || new Date().toISOString(),
    }));

    return { published, overrides, drafts, removed };
  }

  function handleInventorySync(button) {
    const config = getApiConfig();
    if (!config.baseUrl) {
      setSyncFeedback('Set scripts/config.js with your API Gateway baseUrl before syncing.', 'error');
      return;
    }

    const payload = buildSyncPayload();
    setSyncFeedback('Sync in progress…', 'info');
    if (button) {
      button.disabled = true;
    }

    const headers = {
      'Content-Type': 'application/json',
      ...config.extraHeaders,
    };
    if (config.authToken) {
      headers.Authorization = config.authToken.startsWith('Bearer ')
        ? config.authToken
        : `Bearer ${config.authToken}`;
    }

    fetch(`${config.baseUrl}${SYNC_ENDPOINT}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        let text = '';
        try {
          text = await response.text();
        } catch (readError) {
          console.warn('Unable to read sync response body', readError);
        }

        let data = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (parseError) {
            data = text;
          }
        }

        if (!response.ok) {
          const detail =
            data && typeof data === 'object' ? data.detail || data.message || '' : typeof data === 'string' ? data : '';
          const error = new Error(
            detail
              ? `Sync failed with status ${response.status}: ${detail}`
              : `Sync failed with status ${response.status}`
          );
          error.status = response.status;
          error.responseBody = data;
          throw error;
        }

        return data && typeof data === 'object' ? data : {};
      })
      .then((result) => {
        const upserted = typeof result.upserted === 'number' ? result.upserted : 0;
        const removed = typeof result.removed === 'number' ? result.removed : 0;
        const summaryParts = [];
        if (upserted) summaryParts.push(`${upserted} item${upserted === 1 ? '' : 's'} updated`);
        if (removed) summaryParts.push(`${removed} item${removed === 1 ? '' : 's'} removed`);
        const summary = summaryParts.length ? ` (${summaryParts.join(', ')})` : '';
        setSyncFeedback(`Sync complete! DynamoDB now mirrors your dashboard changes${summary}.`, 'success');
      })
      .catch((error) => {
        console.error('Inventory sync failed', error);
        const detail =
          error && typeof error === 'object'
            ? error.responseBody && typeof error.responseBody === 'object'
              ? error.responseBody.detail || error.responseBody.message || ''
              : ''
            : '';
        const message = detail || (typeof error.message === 'string' ? error.message : '');
        const feedback = message
          ? `Sync failed. ${message}`
          : 'Sync failed. Check your API configuration and AWS logs.';
        setSyncFeedback(feedback, 'error');
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
        }
      });
  }

  function setupInventorySync() {
    const button = document.querySelector('[data-inventory-sync]');
    if (!button) return;
    const config = getApiConfig();
    if (!config.baseUrl) {
      setSyncFeedback('Sync is disabled until you add your API Gateway URL to scripts/config.js.', 'info');
    }
    button.addEventListener('click', () => {
      handleInventorySync(button);
    });
  }

  function setupAdminTabs() {
    const tabs = document.querySelectorAll('[data-admin-tab]');
    const sections = document.querySelectorAll('[data-admin-section]');
    if (!tabs.length || !sections.length) return;

    function activateTab(tabId) {
      const resolvedTab = tabId || tabs[0].dataset.adminTab;
      sections.forEach((section) => {
        const isActive = section.dataset.adminSection === resolvedTab;
        section.hidden = !isActive;
        section.classList.toggle('is-active', isActive);
        section.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      });
      tabs.forEach((tab) => {
        const isActive = tab.dataset.adminTab === resolvedTab;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
      });
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.adminTab;
        if (!target) return;
        if (window.location.hash !== `#${target}`) {
          window.location.hash = target;
        } else {
          activateTab(target);
        }
      });
      tab.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          tab.click();
        }
      });
    });

    const initialHash = window.location.hash.replace('#', '');
    if (initialHash) {
      activateTab(initialHash);
    } else {
      activateTab(tabs[0].dataset.adminTab);
    }

    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) {
        activateTab(hash);
      }
    });
  }

  function initializeInventory() {
    setupInventorySearch();
    setupInventoryScroll();
    loadInventoryData()
      .catch((error) => {
        console.error('Inventory load failed', error);
      })
      .finally(() => {
        renderInventory();
      });

    setupInventoryForm();
    setupInventorySync();

    if (window.productStore && typeof window.productStore.subscribe === 'function') {
      window.productStore.subscribe(() => {
        renderInventory();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    orders = loadOrders();
    const searchInput = document.querySelector('[data-admin-search]');
    const statusFilter = document.querySelector('[data-status-filter]');

    setupAdminTabs();
    if (searchInput) {
      searchInput.addEventListener('input', renderOrders);
    }

    if (statusFilter) {
      statusFilter.addEventListener('change', renderOrders);
    }

    renderOrders();
    initializeInventory();
  });

  document.addEventListener('orders:updated', () => {
    orders = loadOrders();
    renderOrders();
  });
})();
