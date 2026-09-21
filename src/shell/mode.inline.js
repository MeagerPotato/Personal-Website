/* Picks PLAIN or UNIVERSE mode before first paint. Shipped verbatim as the only inline script
   (its sha256 goes into the CSP at postbuild). ES5 on purpose. Spec: docs/PLAN.md section 5.2.
   No attribute at all (JS off) also means plain, because the base CSS is the plain layout. */
(function () {
  var root = document.documentElement;
  var mode = 'universe';
  var reason = 'default';

  function read(store, key) {
    try {
      return window[store].getItem(key);
    } catch (error) {
      return null;
    }
  }
  function write(store, key, value) {
    try {
      if (value === null) window[store].removeItem(key);
      else window[store].setItem(key, value);
    } catch (error) {
      /* storage blocked: the choice simply does not persist */
    }
  }
  function hasParam(name) {
    return new RegExp('[?&]' + name + '(?:[=&]|$)').test(location.search);
  }

  var reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) {
    /* no matchMedia: assume full motion */
  }

  var saved = read('localStorage', 'mode');

  if (root.hasAttribute('data-plain-only')) {
    mode = 'plain';
    reason = 'page';
  } else if (!('WebGL2RenderingContext' in window)) {
    /* Feature-test only. Creating a real context here would stall first paint on phones. */
    mode = 'plain';
    reason = 'no-webgl2';
  } else if (hasParam('plain')) {
    mode = 'plain';
    reason = 'query';
    write('sessionStorage', 'mode', 'plain');
  } else if (hasParam('universe')) {
    reason = 'query';
    write('sessionStorage', 'mode', null);
    write('localStorage', 'mode', 'universe');
  } else if (read('sessionStorage', 'mode') === 'plain') {
    mode = 'plain';
    reason = 'session';
  } else if (saved === 'plain' || saved === 'universe') {
    mode = saved;
    reason = 'saved';
  } else if (reduced) {
    mode = 'plain';
    reason = 'reduced-motion';
  }

  root.setAttribute('data-mode', mode);
  root.setAttribute('data-mode-reason', reason);
  root.setAttribute('data-motion', reduced ? 'reduced' : 'full');
})();
