(function () {
  const ORDER_STORE_KEY = 'veyron-admin-orders-v1';
  const STATUS_OPTIONS = ['Open', 'In Progress', 'Completed'];
  const currencyFormatter = new Intl.NumberFormat('en-ZW', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });

  let orders = [];

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
  });

  document.addEventListener('orders:updated', () => {
    orders = loadOrders();
    renderOrders();
  });
})();
