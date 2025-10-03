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
    };
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

    const header = document.createElement('header');
    header.className = 'inventory-item__header';
    const title = document.createElement('h4');
    title.textContent = item.name;
    header.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'inventory-badge';
    if (item.source === 'custom') {
      badge.classList.add('inventory-badge--draft');
      badge.textContent = 'Draft (local)';
    } else {
      badge.textContent = 'Published';
    }
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

    if (item.source === 'custom' && window.productStore && typeof window.productStore.removeProduct === 'function') {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'inventory-item__btn inventory-item__btn--danger';
      removeButton.textContent = 'Remove draft';
      removeButton.addEventListener('click', () => {
        const removed = window.productStore.removeProduct(item.id);
        if (removed) {
          renderInventory();
          showInventoryFeedback(`Removed draft item “${item.name}”.`, 'success');
        }
      });
      actions.appendChild(removeButton);
    }

    if (actions.childElementCount) {
      card.appendChild(actions);
    }

    return card;
  }

  function renderInventoryForCategory(category) {
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

    const catalogueItems = (inventoryState.data[category] || [])
      .map((item) => sanitizeInventoryItem(item, category, 'catalogue'))
      .filter(Boolean);
    const customItems =
      window.productStore && typeof window.productStore.getCustomProductsByCategory === 'function'
        ? (window.productStore.getCustomProductsByCategory(category) || [])
            .map((item) => sanitizeInventoryItem(item, category, 'custom'))
            .filter(Boolean)
        : [];

    const combined = [...catalogueItems, ...customItems];

    if (!combined.length) {
      const empty = document.createElement('p');
      empty.className = 'product-empty';
      empty.textContent = `No ${category.toLowerCase()} items available yet.`;
      container.appendChild(empty);
      return;
    }

    combined.forEach((item) => {
      container.appendChild(createInventoryCard(item));
    });
  }

  function renderInventory() {
    Object.keys(INVENTORY_SOURCES).forEach((category) => {
      renderInventoryForCategory(category);
    });
  }

  function showInventoryFeedback(message, state = 'success') {
    const feedback = document.querySelector('[data-inventory-feedback]');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.remove('error', 'success');
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
    const category = (formData.get('category') || 'Groceries').toString();
    const name = (formData.get('name') || '').toString().trim();
    const priceRaw = formData.get('price');
    const price = Number(priceRaw);
    const unitLabel = (formData.get('unit') || '').toString().trim();
    const description = (formData.get('description') || '').toString().trim();
    const fileInput = form.querySelector('input[name="images"]');
    const files = fileInput?.files ? Array.from(fileInput.files) : [];

    if (!name) {
      showInventoryFeedback('Please provide a product name before saving.', 'error');
      return;
    }

    if (Number.isNaN(price)) {
      showInventoryFeedback('Please enter a valid price in USD.', 'error');
      return;
    }

    if (files.length > MAX_UPLOAD_IMAGES) {
      showInventoryFeedback(`Please upload a maximum of ${MAX_UPLOAD_IMAGES} images per item.`, 'error');
      return;
    }

    const imagePromise = files.length ? readImageFiles(files.slice(0, MAX_UPLOAD_IMAGES)) : Promise.resolve([]);

    imagePromise
      .then((images) => {
        const payload = {
          category,
          name,
          price,
          unitLabel,
          description,
          images,
        };
        const saved = window.productStore.addProduct(payload);
        showInventoryFeedback(`Saved draft item “${saved.name}”.`, 'success');
        renderInventory();

        const previewWrapper = document.querySelector('[data-inventory-preview]');
        const previewCode = document.querySelector('[data-inventory-json]');
        if (previewWrapper && previewCode) {
          previewCode.textContent = JSON.stringify(saved, null, 2);
          previewWrapper.hidden = false;
        }

        const categorySelect = form.querySelector('select[name="category"]');
        form.reset();
        if (categorySelect) {
          categorySelect.value = category;
        }
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

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      handleInventorySubmit(form);
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
