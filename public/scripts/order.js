(function () {
  const ORDER_STORE_KEY = 'veyron-admin-orders-v1';
  const ORDER_ENDPOINT = '/orders';
  const REQUEST_TIMEOUT_MS = 20000;

  function loadExistingOrders() {
    try {
      const stored = localStorage.getItem(ORDER_STORE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Failed to parse stored orders', error);
      return [];
    }
  }

  function persistOrders(orders) {
    localStorage.setItem(ORDER_STORE_KEY, JSON.stringify(orders));
    document.dispatchEvent(
      new CustomEvent('orders:updated', {
        detail: orders.slice(),
      })
    );
  }

  function saveOrder(order) {
    const orders = loadExistingOrders();
    orders.unshift(order);
    persistOrders(orders);
  }

  function showOrderAlert(message, type = 'error') {
    const alert = document.querySelector('[data-order-alert]');
    if (!alert) return;
    alert.textContent = message;
    alert.classList.remove('error', 'success', 'info');
    alert.classList.add('alert');
    if (type === 'success') {
      alert.classList.add('success');
    } else if (type === 'info') {
      alert.classList.add('info');
    } else {
      alert.classList.add('error');
    }
    alert.style.display = message ? 'block' : 'none';
  }

  function getApiBaseUrl() {
    const siteConfig = window.siteConfig || {};
    const adminConfig = window.adminApiConfig || {};
    const candidates = [siteConfig.apiBaseUrl, adminConfig.baseUrl].map((value) =>
      (value || '').toString().trim()
    );

    const raw = candidates.find((value) => value) || '';
    if (!raw) return '';
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  }

  function buildApiHeaders() {
    const config = window.adminApiConfig || {};
    const headers = {
      'Content-Type': 'application/json',
    };

    if (config.extraHeaders && typeof config.extraHeaders === 'object') {
      Object.entries(config.extraHeaders).forEach(([key, value]) => {
        if (typeof key === 'string' && key) {
          headers[key] = value;
        }
      });
    }

    const authToken = (config.authToken || '').toString().trim();
    if (authToken && !headers.Authorization) {
      headers.Authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
    }

    return headers;
  }

  async function submitOrderToApi(order) {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error('Online order routing is not configured. Please contact us directly to finalise your booking.');
    }

    const endpoint = `${baseUrl}${ORDER_ENDPOINT}`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ order }),
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        let details = null;
        try {
          details = await response.json();
        } catch (error) {
          details = null;
        }
        const message = details?.message || 'We could not submit your order. Please try again.';
        throw new Error(message);
      }

      let payload = {};
      try {
        payload = await response.json();
      } catch (error) {
        payload = {};
      }
      return payload;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  function setSubmittingState(form, isSubmitting) {
    if (!form) return;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = isSubmitting;
      submitButton.textContent = isSubmitting ? 'Sending…' : 'Place Order';
    }
  }

  function renderSummary() {
    const layout = document.querySelector('[data-order-layout]');
    const emptyState = document.querySelector('[data-empty-state]');
    const tbody = document.querySelector('[data-summary-rows]');
    const totalCell = document.querySelector('[data-summary-total]');

    if (!window.cart || !layout || !tbody || !totalCell) return;

    const items = window.cart.getItems();

    if (!items.length) {
      layout.style.display = 'none';
      if (emptyState) {
        emptyState.hidden = false;
      }
      return;
    }

    layout.style.display = '';
    if (emptyState) {
      emptyState.hidden = true;
    }

    tbody.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('tr');
      const title = `${item.name}${item.category ? ` (${item.category})` : ''}`;
      row.innerHTML = `
        <td>${title}</td>
        <td>${item.quantity}</td>
        <td>${window.cart.formatCurrency(item.price * item.quantity)}</td>
      `;
      tbody.appendChild(row);
    });

    totalCell.textContent = window.cart.formatCurrency(window.cart.getTotal());
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!window.cart || !window.cart.getCount()) {
      showOrderAlert('Your cart is empty. Please add items before placing your order.');
      return;
    }

    const form = event.target;
    const formData = new FormData(form);
    const customerName = (formData.get('customerName') || '').toString().trim();
    const customerPhone = (formData.get('customerPhone') || '').toString().trim();
    const address = (formData.get('deliveryAddress') || '').toString().trim();
    const deliveryDate = (formData.get('deliveryDate') || '').toString();
    const deliveryTime = (formData.get('deliveryTime') || '').toString();
    const payment = (formData.get('paymentMethod') || '').toString();

    if (!customerName || !customerPhone || !address || !deliveryDate || !deliveryTime || !payment) {
      showOrderAlert('Please complete all required fields before placing your order.');
      return;
    }

    const email = (formData.get('customerEmail') || '').toString().trim();
    const notes = (formData.get('deliveryNotes') || '').toString().trim();
    const items = window.cart.getItems();
    const total = window.cart.getTotal();

    const orderRecord = {
      id: `order-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'Open',
      customer: {
        name: customerName,
        phone: customerPhone,
        email: email || null,
      },
      delivery: {
        address,
        date: deliveryDate,
        time: deliveryTime,
      },
      payment,
      notes: notes || null,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        category: item.category || null,
        unitPrice: item.price,
        total: item.price * item.quantity,
      })),
      total,
    };

    setSubmittingState(form, true);
    showOrderAlert('Sending your order to our coordination team…', 'info');

    try {
      await submitOrderToApi(orderRecord);
      saveOrder(orderRecord);
      showOrderAlert(
        'Thank you! Your order was delivered to our coordination team. We will reach out soon to confirm fulfilment.',
        'success'
      );
      window.cart.clear();
      form.reset();
      renderSummary();
    } catch (error) {
      console.error('Failed to send order', error);
      const fallbackMessage = 'We could not submit your order right now. Please try again or call +263 78 721 7911.';
      let message = (error && error.message) || fallbackMessage;
      if (/abort/i.test(message)) {
        message = 'The request took too long to complete. Please check your connection and try again.';
      } else if (message === 'Failed to fetch' || message === 'NetworkError when attempting to fetch resource.') {
        message = fallbackMessage;
      }
      showOrderAlert(message, 'error');
    } finally {
      setSubmittingState(form, false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!window.cart) return;
    renderSummary();

    const form = document.getElementById('order-details-form');
    if (form) {
      form.addEventListener('submit', handleSubmit);
    }
  });

  document.addEventListener('cart:updated', renderSummary);
})();
