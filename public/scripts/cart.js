(function () {
  const CART_KEY = 'veyron-cart-v1';
  const currencyFormatter = new Intl.NumberFormat('en-ZW', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });

  let cartItems = loadCart();

  function loadCart() {
    try {
      const stored = localStorage.getItem(CART_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item.id === 'string');
    } catch (error) {
      console.error('Failed to parse cart from storage', error);
      return [];
    }
  }

  function persist() {
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    emitUpdate();
  }

  function emitUpdate() {
    document.dispatchEvent(
      new CustomEvent('cart:updated', {
        detail: {
          items: cartItems.slice(),
          total: getCartTotal(),
          count: getCartCount(),
        },
      })
    );
  }

  function formatCurrency(value) {
    return currencyFormatter.format(value);
  }

  function getCartItems() {
    return cartItems.slice();
  }

  function getCartCount() {
    return cartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }

  function getCartTotal() {
    return cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  function addItem(newItem) {
    if (!newItem || !newItem.id) return;
    const existing = cartItems.find((item) => item.id === newItem.id);
    if (existing) {
      existing.quantity += newItem.quantity;
    } else {
      cartItems.push({ ...newItem });
    }
    persist();
  }

  function updateQuantity(id, quantity) {
    const item = cartItems.find((entry) => entry.id === id);
    if (!item) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      removeItem(id);
      return;
    }
    item.quantity = qty;
    persist();
  }

  function removeItem(id) {
    cartItems = cartItems.filter((item) => item.id !== id);
    persist();
  }

  function clearCart() {
    cartItems = [];
    persist();
  }

  function showCartAlert(message, type = 'error') {
    const alerts = document.querySelectorAll('[data-cart-alert]');
    alerts.forEach((alert) => {
      alert.textContent = message;
      alert.classList.remove('success', 'error');
      alert.classList.add(type === 'success' ? 'success' : 'error', 'alert');
      alert.style.display = 'block';
    });
    if (message) {
      setTimeout(() => {
        alerts.forEach((alert) => {
          alert.style.display = 'none';
        });
      }, 4000);
    }
  }

  function handleSubmitOrderClick(event) {
    event.preventDefault();
    if (!getCartCount()) {
      showCartAlert('Add at least one item to your cart before submitting your order.');
      return;
    }
    window.location.href = 'order.html';
  }

  function setupSubmitButtons() {
    const buttons = document.querySelectorAll('[data-submit-order]');
    buttons.forEach((button) => {
      button.addEventListener('click', handleSubmitOrderClick);
    });
  }

  function renderCartDrawer() {
    const drawer = document.querySelector('[data-cart-drawer]');
    if (!drawer) return;

    const countElement = document.querySelector('[data-cart-count]');
    if (countElement) {
      countElement.textContent = getCartCount();
    }

    const totalElement = drawer.querySelector('[data-cart-total]');
    if (totalElement) {
      totalElement.textContent = formatCurrency(getCartTotal());
    }

    const itemsContainer = drawer.querySelector('[data-cart-items]');
    if (!itemsContainer) return;

    itemsContainer.innerHTML = '';
    if (!cartItems.length) {
      const empty = document.createElement('div');
      empty.className = 'cart-empty';
      empty.textContent = 'Your cart is currently empty.';
      itemsContainer.appendChild(empty);
      return;
    }

    cartItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <strong>${item.name}</strong>
          <div class="cart-meta">${formatCurrency(item.price)} each</div>
          <div class="cart-controls">
            <label>
              Qty
              <input type="number" min="1" step="1" value="${item.quantity}" data-cart-quantity="${item.id}" />
            </label>
            <button class="remove-btn" type="button" data-remove-item="${item.id}">Remove</button>
          </div>
        </div>
        <div><strong>${formatCurrency(item.price * item.quantity)}</strong></div>
      `;
      itemsContainer.appendChild(row);
    });
  }

  function focusDrawer() {
    const drawer = document.querySelector('[data-cart-drawer]');
    if (!drawer) return;
    const panel = drawer.querySelector('.cart-panel');
    const focusTarget = panel || drawer;
    if (panel && !panel.hasAttribute('tabindex')) {
      panel.setAttribute('tabindex', '-1');
    } else if (!panel && !drawer.hasAttribute('tabindex')) {
      drawer.setAttribute('tabindex', '-1');
    }
    if (focusTarget && typeof focusTarget.focus === 'function') {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch (error) {
        focusTarget.focus();
      }
    }
  }

  function openDrawer() {
    const drawer = document.querySelector('[data-cart-drawer]');
    if (!drawer) return;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    focusDrawer();
  }

  function closeDrawer({ restoreFocus = true } = {}) {
    const drawer = document.querySelector('[data-cart-drawer]');
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (restoreFocus) {
      const toggle = document.querySelector('[data-toggle-cart]');
      if (toggle && typeof toggle.focus === 'function') {
        toggle.focus();
      }
    }
  }

  function handleDrawerKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      closeDrawer();
    }
  }

  function setupDrawer() {
    const toggle = document.querySelector('[data-toggle-cart]');
    const close = document.querySelector('[data-close-cart]');
    const drawer = document.querySelector('[data-cart-drawer]');

    if (toggle) {
      toggle.addEventListener('click', () => {
        const isOpen = drawer?.classList.contains('open');
        if (isOpen) {
          closeDrawer({ restoreFocus: false });
        } else {
          openDrawer();
        }
      });
    }

    if (close) {
      close.addEventListener('click', () => {
        closeDrawer();
      });
    }

    if (drawer) {
      drawer.addEventListener('keydown', handleDrawerKeydown);
      drawer.addEventListener('click', (event) => {
        if (event.target === drawer) {
          closeDrawer();
        }
      });

      drawer.addEventListener('input', (event) => {
        const target = event.target;
        if (target.matches('[data-cart-quantity]')) {
          const id = target.getAttribute('data-cart-quantity');
          updateQuantity(id, target.value);
        }
      });

      drawer.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-item]');
        if (button) {
          const id = button.getAttribute('data-remove-item');
          removeItem(id);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupDrawer();
    setupSubmitButtons();
    renderCartDrawer();
  });

  document.addEventListener('cart:updated', renderCartDrawer);

  emitUpdate();

  window.cart = {
    addItem,
    updateQuantity,
    removeItem,
    clear: clearCart,
    getItems: getCartItems,
    getTotal: getCartTotal,
    getCount: getCartCount,
    formatCurrency,
    notify: showCartAlert,
  };
})();
