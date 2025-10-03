(function () {
  const ORDER_STORE_KEY = 'veyron-admin-orders-v1';

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
    alert.classList.remove('error', 'success');
    alert.classList.add(type === 'success' ? 'success' : 'error', 'alert');
    alert.style.display = message ? 'block' : 'none';
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

  function handleSubmit(event) {
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

    saveOrder(orderRecord);

    showOrderAlert('Your order has been queued for our team. We will reach out soon to confirm fulfilment.', 'success');
    window.cart.clear();
    form.reset();
    renderSummary();
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
