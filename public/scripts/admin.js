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
    Furniture: 'data/furniture.json',
    Groceries: 'data/groceries.json',
  };
  const MAX_UPLOAD_IMAGES = 5;
  const SYNC_ENDPOINT = '/sync';
  const inventoryState = {
    data: {
      Furniture: [],
      Groceries: [],
    },
    errors: {
      Furniture: null,
      Groceries: null,
    },
  };

  function buildOrderDocument(order) {
    const lines = [];
    lines.push(`Order ID: ${order.id}`);
    lines.push(`Status: ${order.status || 'Open'}`);
    lines.push(`Received: ${formatDate(order.createdAt)}`);
    lines.push('');
    lines.push('Customer');
    lines.push(`  Name: ${order.customer?.name || '—'}`);
    lines.push(`  Phone: ${order.customer?.phone || '—'}`);
    lines.push(`  Email: ${order.customer?.email || '—'}`);
    lines.push('');
    lines.push('Delivery');
    lines.push(`  Address: ${order.delivery?.address || '—'}`);
    lines.push(`  Date: ${order.delivery?.date || '—'}`);
    lines.push(`  Time: ${order.delivery?.time || '—'}`);
    lines.push(`  Payment: ${order.payment || '—'}`);

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
    lines.push(`Order Total: ${formatCurrency(order.total)}`);

    return lines.join('\n');
  }

  function downloadOrderDetails(order) {
    try {
      const contents = buildOrderDocument(order);
      const blob = new Blob([contents], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${order.id || 'order'}-details.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download order', error);
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

      const header = document.createElement('div');
      header.className = 'admin-card__header';
      header.innerHTML = `
        <div>
          <h3>Order <span class="order-id">${order.id}</span></h3>
          <p class="order-meta">Received ${formatDate(order.createdAt)}</p>
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
      `;
      card.appendChild(customerBlock);

      const deliveryBlock = document.createElement('div');
      deliveryBlock.className = 'admin-card__section';
      deliveryBlock.innerHTML = `
        <h4>Delivery</h4>
        <p>${order.delivery?.address || '—'}</p>
        <p>Date: ${order.delivery?.date || '—'}</p>
        <p>Time: ${order.delivery?.time || '—'}</p>
        <p>Payment: ${order.payment || '—'}</p>
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
      total.innerHTML = `Total: <strong>${formatCurrency(order.total)}</strong>`;
      itemsBlock.appendChild(total);
      card.appendChild(itemsBlock);

      if ((order.status || 'Open') === 'Open') {
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

  function loadInventoryData() {
    const loaders = Object.entries(INVENTORY_SOURCES).map(([category, url]) =>
      fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Request for ${category} failed with status ${response.status}`);
          }
          return response.json();
        })
        .then((data) => {
          inventoryState.data[category] = Array.isArray(data) ? data : [];
          inventoryState.errors[category] = null;
        })
        .catch((error) => {
          console.error(`Failed to load inventory for ${category}`, error);
          inventoryState.data[category] = [];
          inventoryState.errors[category] =
            'Unable to load catalogue data. Update the JSON file or check your connection.';
        })
    );
    return Promise.all(loaders);
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

    if (item.images && item.images.length) {
      const galleryNote = document.createElement('p');
      galleryNote.className = 'inventory-item__gallery-note';
      galleryNote.textContent = `${item.images.length} image${item.images.length === 1 ? '' : 's'} available.`;
      card.appendChild(galleryNote);
    }

    const actions = document.createElement('div');
    actions.className = 'inventory-item__actions';

    if (item.images && item.images.length && window.productGallery && typeof window.productGallery.open === 'function') {
      const viewButton = document.createElement('button');
      viewButton.type = 'button';
      viewButton.className = 'inventory-item__btn';
      viewButton.textContent = item.images.length > 1 ? 'View gallery' : 'View image';
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

    if (!combined.length && !removedCards.length) {
      const empty = document.createElement('p');
      empty.className = 'product-empty';
      empty.textContent = `No ${category.toLowerCase()} items available yet.`;
      container.appendChild(empty);
      return;
    }

    combined.forEach((item) => {
      container.appendChild(createInventoryCard(item));
    });

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
    feedback.classList.add(state === 'error' ? 'error' : 'success');
  }

  function readImageFiles(files) {
    return Promise.all(
      files.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            reader.readAsDataURL(file);
          })
      )
    );
  }

  function handleInventorySubmit(form) {
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

    const imagePromise = files.length ? readImageFiles(files.slice(0, MAX_UPLOAD_IMAGES)) : Promise.resolve([]);

    imagePromise
      .then((images) => {
        const combined = [];
        [...imageUrls, ...images].forEach((src) => {
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
          saved = window.productStore.addProduct(payload);
          message = `Saved draft item “${saved.name}”.`;
        }

        showInventoryFeedback(message, 'success');
        renderInventory();

        const previewWrapper = document.querySelector('[data-inventory-preview]');
        const previewCode = document.querySelector('[data-inventory-json]');
        if (previewWrapper && previewCode && saved) {
          previewCode.textContent = JSON.stringify(saved, null, 2);
          previewWrapper.hidden = false;
        }

        resetInventoryForm();
      })
      .catch((error) => {
        console.error('Failed to process inventory item', error);
        showInventoryFeedback('Unable to save this item. Please try again.', 'error');
      });
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
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Sync failed with status ${response.status}`);
        }
        return response.json().catch(() => ({}));
      })
      .then(() => {
        setSyncFeedback('Sync complete! DynamoDB now mirrors your dashboard changes.', 'success');
      })
      .catch((error) => {
        console.error('Inventory sync failed', error);
        setSyncFeedback('Sync failed. Check your API configuration and AWS logs.', 'error');
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

  function initializeInventory() {
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
