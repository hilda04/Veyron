(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const links = document.querySelectorAll('.nav-links a');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (href === currentPath || (currentPath === '' && href === 'index.html')) {
        link.classList.add('active');
      }
    });

    const yearSpans = document.querySelectorAll('[data-current-year]');
    yearSpans.forEach((span) => {
      span.textContent = new Date().getFullYear();
    });
  });
})();
