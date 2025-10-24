(function () {
  const ORDER_STORE_KEY = 'veyron-admin-orders-v1';
  const ORDER_ENDPOINT = '/orders';
  const REQUEST_TIMEOUT_MS = 20000;
  const PAYMENT_EMAIL = 'no-reply@veyronenterprises.com';
  const MAX_PROOF_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

  const fallbackCurrencyFormatter = new Intl.NumberFormat('en-ZW', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });

  let lastConfirmedOrder = null;

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

  function formatCurrency(value) {
    if (window.cart && typeof window.cart.formatCurrency === 'function') {
      return window.cart.formatCurrency(value);
    }
    return fallbackCurrencyFormatter.format(Number(value) || 0);
  }

  function getSelectedCity() {
    const select = document.getElementById('deliveryCity');
    return (select?.value || '').toString().trim();
  }

  function calculateInvoice(itemsTotal, city) {
    const cleanCity = (city || '').trim();
    const roundedItemsTotal = Number(itemsTotal) || 0;
    const invoice = {
      city: cleanCity,
      itemsTotal: roundedItemsTotal,
      deliveryFee: 0,
      grandTotal: roundedItemsTotal,
      minimumRequired: 0,
      meetsMinimum: true,
    };

    if (!cleanCity) {
      invoice.meetsMinimum = roundedItemsTotal >= 0;
      invoice.grandTotal = roundedItemsTotal;
      return invoice;
    }

    const isHarare = cleanCity === 'Harare';
    if (isHarare) {
      invoice.minimumRequired = 50;
      invoice.meetsMinimum = roundedItemsTotal >= invoice.minimumRequired;
      if (roundedItemsTotal >= 50 && roundedItemsTotal < 150) {
        invoice.deliveryFee = 4;
      }
    } else {
      invoice.minimumRequired = 150;
      invoice.meetsMinimum = roundedItemsTotal >= invoice.minimumRequired;
      if (roundedItemsTotal > 0) {
        invoice.deliveryFee = 8;
      }
    }

    invoice.grandTotal = roundedItemsTotal + invoice.deliveryFee;
    return invoice;
  }

  function updateOrderNotice(invoice, hasItems) {
    const notice = document.querySelector('[data-order-notice]');
    if (!notice) return;

    if (!hasItems) {
      notice.hidden = true;
      notice.textContent = '';
      return;
    }

    if (!invoice.city) {
      notice.hidden = false;
      notice.textContent = 'Select your delivery city to confirm the minimum order value and delivery fee.';
      return;
    }

    if (!invoice.meetsMinimum) {
      notice.hidden = false;
      notice.textContent = `A minimum order of ${formatCurrency(invoice.minimumRequired)} is required for ${invoice.city}.`;
      return;
    }

    if (invoice.city === 'Harare' && invoice.itemsTotal >= 50 && invoice.itemsTotal < 150) {
      notice.hidden = false;
      notice.textContent = 'Orders between $50 and $149 delivered to Harare include a $4 delivery fee.';
      return;
    }

    if (invoice.city !== 'Harare') {
      notice.hidden = false;
      notice.textContent = 'A flat $8 delivery fee applies to deliveries outside Harare.';
      return;
    }

    notice.hidden = true;
    notice.textContent = '';
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }

  function formatDeliveryDateTime(dateValue, timeValue) {
    if (!dateValue) return 'your selected time';
    const isoString = timeValue ? `${dateValue}T${timeValue}` : `${dateValue}T00:00`;
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return `${dateValue}${timeValue ? ` ${timeValue}` : ''}`;
    }
    const datePart = date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timePart = timeValue
      ? date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    return timePart ? `${datePart} at ${timePart}` : datePart;
  }

  function generateTrackingNumber() {
    const now = new Date();
    const dateStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `VEY-${dateStamp}-${random}`;
  }

  function updatePaymentGuidance() {
    const paymentSelect = document.getElementById('paymentMethod');
    const guidance = document.querySelector('[data-payment-guidance]');
    const proofInput = document.getElementById('paymentProof');
    const method = (paymentSelect?.value || '').toString();
    const shouldShow = Boolean(method && method !== 'Cash');

    if (guidance) {
      guidance.hidden = !shouldShow;
      const label = guidance.querySelector('label');
      if (label) {
        label.textContent = shouldShow
          ? `Upload Proof of Payment (${method}) *`
          : 'Upload Proof of Payment';
      }
    }

    if (proofInput) {
      proofInput.required = shouldShow;
      if (!shouldShow) {
        proofInput.value = '';
      }
    }
  }

  function buildSummaryDocument(order) {
    if (!order) return '';
    const lines = [];
    lines.push('Veyron Enterprises Order Confirmation');
    lines.push(`Tracking Number: ${order.trackingNumber || order.id || 'N/A'}`);
    let createdLabel = order.createdAt || '';
    if (order.createdAt) {
      const createdDate = new Date(order.createdAt);
      if (!Number.isNaN(createdDate.getTime())) {
        createdLabel = createdDate.toLocaleString();
      }
    }
    lines.push(`Order Created: ${createdLabel || '—'}`);
    lines.push('');
    lines.push('Customer Details');
    lines.push(`  Name: ${order.customer?.name || '—'}`);
    lines.push(`  Phone: ${order.customer?.phone || '—'}`);
    lines.push(`  Email: ${order.customer?.email || '—'}`);
    lines.push(`  City: ${order.customer?.city || order.delivery?.city || '—'}`);
    lines.push('');
    lines.push('Delivery');
    lines.push(`  Address: ${order.delivery?.address || '—'}`);
    lines.push(
      `  Scheduled: ${formatDeliveryDateTime(order.delivery?.date, order.delivery?.time)}`
    );
    lines.push(`  Delivery City: ${order.delivery?.city || '—'}`);
    lines.push('');
    lines.push('Items');
    if (Array.isArray(order.items) && order.items.length) {
      order.items.forEach((item, index) => {
        const title = `${item.name}${item.category ? ` (${item.category})` : ''}`;
        lines.push(
          `  ${index + 1}. ${title} — ${item.quantity} × ${formatCurrency(item.unitPrice)} = ${formatCurrency(
            item.total
          )}`
        );
      });
    } else {
      lines.push('  No line items recorded.');
    }
    lines.push('');
    const totals = order.totals || {};
    const itemsTotal = totals.items ?? order.itemsTotal ?? order.total ?? 0;
    const deliveryFee = totals.deliveryFee ?? order.delivery?.fee ?? 0;
    const grandTotal = totals.grandTotal ?? order.total ?? itemsTotal + deliveryFee;
    lines.push(`Items Subtotal: ${formatCurrency(itemsTotal)}`);
    lines.push(`Delivery Fee: ${formatCurrency(deliveryFee)}`);
    lines.push(`Amount Due: ${formatCurrency(grandTotal)}`);
    lines.push(`Payment Method: ${order.payment || '—'}`);
    if (order.notes) {
      lines.push('');
      lines.push('Notes');
      lines.push(`  ${order.notes}`);
    }
    if (order.payment !== 'Cash') {
      lines.push('');
      lines.push('Proof of payment attached for internal review.');
    }
    return lines.join('\n');
  }

  function downloadSummaryDocument() {
    if (!lastConfirmedOrder) return;
    try {
      const contents = buildSummaryDocument(lastConfirmedOrder);
      const blob = new Blob([contents], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const filename = `${lastConfirmedOrder.trackingNumber || lastConfirmedOrder.id || 'order'}-summary.txt`;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download order summary', error);
      showOrderAlert('We could not generate the order summary file. Please try again.', 'error');
    }
  }

  function showConfirmation(order) {
    const confirmationPanel = document.querySelector('[data-confirmation-panel]');
    const message = document.querySelector('[data-confirmation-message]');
    const summary = document.querySelector('[data-confirmation-summary]');
    const layout = document.querySelector('[data-order-layout]');
    const emptyState = document.querySelector('[data-empty-state]');

    if (!confirmationPanel || !message || !summary) return;

    if (layout) {
      layout.style.display = 'none';
    }
    if (emptyState) {
      emptyState.hidden = true;
    }

    const scheduled = formatDeliveryDateTime(order.delivery?.date, order.delivery?.time);
    message.textContent = `Thank you for submitting your order, your order has been confirmed for delivery on: ${scheduled}.`;

    summary.innerHTML = '';

    const detailList = document.createElement('dl');
    const details = [
      ['Tracking number', order.trackingNumber || order.id],
      ['Customer', order.customer?.name || '—'],
      ['Phone', order.customer?.phone || '—'],
      ['Email', order.customer?.email || '—'],
      ['Delivery address', order.delivery?.address || '—'],
      ['Delivery city', order.delivery?.city || '—'],
      ['Payment method', order.payment || '—'],
    ];
    details.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value || '—';
      detailList.appendChild(dt);
      detailList.appendChild(dd);
    });
    summary.appendChild(detailList);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Item</th><th>Qty</th><th>Total</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    (order.items || []).forEach((item) => {
      const row = document.createElement('tr');
      const title = `${item.name}${item.category ? ` (${item.category})` : ''}`;
      row.innerHTML = `
        <td>${title}</td>
        <td>${item.quantity}</td>
        <td>${formatCurrency(item.total)}</td>
      `;
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    const tfoot = document.createElement('tfoot');
    const totals = order.totals || {};
    const itemsTotal = totals.items ?? order.itemsTotal ?? order.total ?? 0;
    const deliveryFee = totals.deliveryFee ?? order.delivery?.fee ?? 0;
    const grandTotal = totals.grandTotal ?? order.total ?? itemsTotal + deliveryFee;
    tfoot.innerHTML = `
      <tr><td colspan="2">Items Subtotal</td><td>${formatCurrency(itemsTotal)}</td></tr>
      <tr><td colspan="2">Delivery Fee</td><td>${formatCurrency(deliveryFee)}</td></tr>
      <tr><td colspan="2">Amount Due</td><td>${formatCurrency(grandTotal)}</td></tr>
    `;
    table.appendChild(tfoot);
    summary.appendChild(table);

    if (order.notes) {
      const notes = document.createElement('p');
      notes.textContent = `Delivery notes: ${order.notes}`;
      summary.appendChild(notes);
    }

    if (order.payment && order.payment !== 'Cash') {
      const reminder = document.createElement('p');
      reminder.textContent = `Your proof of payment has been forwarded to ${PAYMENT_EMAIL}. Our team will verify and reach out if anything else is required.`;
      summary.appendChild(reminder);
    }

    lastConfirmedOrder = order;
    confirmationPanel.hidden = false;
  }

  function resetOrderFlow() {
    const confirmationPanel = document.querySelector('[data-confirmation-panel]');
    const layout = document.querySelector('[data-order-layout]');
    const emptyState = document.querySelector('[data-empty-state]');
    const form = document.getElementById('order-details-form');

    if (confirmationPanel) {
      confirmationPanel.hidden = true;
    }
    if (layout) {
      layout.style.display = '';
    }
    if (emptyState) {
      const hasItems = Boolean(window.cart && window.cart.getCount && window.cart.getCount());
      emptyState.hidden = hasItems;
    }
    if (form) {
      form.reset();
      updatePaymentGuidance();
    }
    lastConfirmedOrder = null;
    renderSummary();
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
    const itemsCell = document.querySelector('[data-summary-items]');
    const deliveryCell = document.querySelector('[data-summary-delivery]');
    const confirmationPanel = document.querySelector('[data-confirmation-panel]');

    if (!window.cart || !tbody || !totalCell) return;

    const items = window.cart.getItems();
    const itemsTotal = window.cart.getTotal();
    const invoice = calculateInvoice(itemsTotal, getSelectedCity());
    const hasConfirmation = confirmationPanel && !confirmationPanel.hidden;

    if (layout) {
      layout.style.display = items.length ? '' : 'none';
    }

    if (!items.length) {
      if (tbody) {
        tbody.innerHTML = '';
      }
      if (itemsCell) {
        itemsCell.textContent = formatCurrency(0);
      }
      if (deliveryCell) {
        deliveryCell.textContent = formatCurrency(0);
      }
      if (totalCell) {
        totalCell.textContent = formatCurrency(invoice.grandTotal);
      }
      if (emptyState) {
        emptyState.hidden = hasConfirmation;
      }
      updateOrderNotice(invoice, false);
      return;
    }

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
        <td>${formatCurrency(item.price * item.quantity)}</td>
      `;
      tbody.appendChild(row);
    });

    if (itemsCell) {
      itemsCell.textContent = formatCurrency(invoice.itemsTotal);
    }
    if (deliveryCell) {
      deliveryCell.textContent = formatCurrency(invoice.deliveryFee);
    }
    if (totalCell) {
      totalCell.textContent = formatCurrency(invoice.grandTotal);
    }
    updateOrderNotice(invoice, true);
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
    const city = (formData.get('deliveryCity') || '').toString().trim();
    const deliveryDate = (formData.get('deliveryDate') || '').toString();
    const deliveryTime = (formData.get('deliveryTime') || '').toString();
    const payment = (formData.get('paymentMethod') || '').toString();

    if (!customerName || !customerPhone || !address || !deliveryDate || !deliveryTime || !payment || !city) {
      showOrderAlert('Please complete all required fields before placing your order.');
      return;
    }

    const email = (formData.get('customerEmail') || '').toString().trim();
    const notes = (formData.get('deliveryNotes') || '').toString().trim();
    const items = window.cart.getItems();
    const total = window.cart.getTotal();
    const invoice = calculateInvoice(total, city);

    if (!invoice.meetsMinimum) {
      showOrderAlert(
        `Orders delivered to ${city} must be at least ${formatCurrency(invoice.minimumRequired)} before delivery. Please add more items to continue.`,
        'error'
      );
      return;
    }

    const requiresProof = payment && payment !== 'Cash';
    const proofFile = formData.get('paymentProof');
    let paymentProof = null;

    if (requiresProof) {
      const proofIsFile = proofFile instanceof File && proofFile.name;
      if (!proofIsFile) {
        showOrderAlert('Upload proof of payment before submitting your order.', 'error');
        return;
      }
      if (proofFile.size > MAX_PROOF_SIZE_BYTES) {
        showOrderAlert('Proof of payment files must be 5MB or smaller.', 'error');
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(proofFile);
        paymentProof = {
          name: proofFile.name,
          size: proofFile.size,
          type: proofFile.type || 'application/octet-stream',
          uploadedAt: new Date().toISOString(),
          dataUrl,
          email: PAYMENT_EMAIL,
        };
      } catch (error) {
        console.error('Failed to read proof of payment', error);
        showOrderAlert('We could not read your proof of payment. Please try again.', 'error');
        return;
      }
    }

    const createdAt = new Date().toISOString();
    const trackingNumber = generateTrackingNumber();

    const orderRecord = {
      id: trackingNumber,
      trackingNumber,
      createdAt,
      status: 'Open',
      customer: {
        name: customerName,
        phone: customerPhone,
        email: email || null,
        city,
      },
      delivery: {
        address,
        city,
        date: deliveryDate,
        time: deliveryTime,
        fee: invoice.deliveryFee,
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
      itemsTotal: invoice.itemsTotal,
      totals: {
        items: invoice.itemsTotal,
        deliveryFee: invoice.deliveryFee,
        grandTotal: invoice.grandTotal,
        minimumRequired: invoice.minimumRequired,
      },
      total: invoice.grandTotal,
    };

    if (paymentProof) {
      orderRecord.paymentProof = paymentProof;
    }

    setSubmittingState(form, true);
    showOrderAlert('Sending your order to our coordination team…', 'info');

    try {
      await submitOrderToApi(orderRecord);
      saveOrder(orderRecord);
      lastConfirmedOrder = orderRecord;
      showOrderAlert('', 'success');
      window.cart.clear();
      form.reset();
      updatePaymentGuidance();
      renderSummary();
      showConfirmation(orderRecord);
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

    const citySelect = document.getElementById('deliveryCity');
    if (citySelect) {
      citySelect.addEventListener('change', renderSummary);
    }

    const paymentSelect = document.getElementById('paymentMethod');
    if (paymentSelect) {
      paymentSelect.addEventListener('change', updatePaymentGuidance);
      updatePaymentGuidance();
    }

    const downloadBtn = document.querySelector('[data-download-summary]');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', downloadSummaryDocument);
    }

    const newOrderBtn = document.querySelector('[data-new-order]');
    if (newOrderBtn) {
      newOrderBtn.addEventListener('click', resetOrderFlow);
    }
  });

  document.addEventListener('cart:updated', renderSummary);
})();
