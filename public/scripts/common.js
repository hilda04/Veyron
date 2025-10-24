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

    const navigation = document.getElementById('primary-navigation');
    const navToggle = document.querySelector('.nav-toggle');
    if (navigation && navToggle) {
      const label = navToggle.querySelector('.nav-toggle__label');
      const mobileQuery = window.matchMedia('(max-width: 720px)');
      const OPEN_TEXT = 'Hide menu';
      const CLOSED_TEXT = 'Show menu';

      const setExpandedState = (expanded) => {
        const isExpanded = Boolean(expanded);
        navToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        navigation.dataset.visible = isExpanded ? 'true' : 'false';
        navToggle.classList.toggle('is-collapsed', !isExpanded);
        if (label) {
          label.textContent = isExpanded ? OPEN_TEXT : CLOSED_TEXT;
        }
      };

      setExpandedState(true);

      navToggle.addEventListener('click', () => {
        const expanded = navToggle.getAttribute('aria-expanded') === 'true';
        setExpandedState(!expanded);
      });

      navigation.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
          if (mobileQuery.matches) {
            setExpandedState(false);
          }
        });
      });

      const syncToViewport = (event) => {
        if (!event.matches) {
          setExpandedState(true);
        }
      };

      if (mobileQuery.addEventListener) {
        mobileQuery.addEventListener('change', syncToViewport);
      } else if (mobileQuery.addListener) {
        mobileQuery.addListener(syncToViewport);
      }
    }

    const yearSpans = document.querySelectorAll('[data-current-year]');
    yearSpans.forEach((span) => {
      span.textContent = new Date().getFullYear();
    });
  });
})();
