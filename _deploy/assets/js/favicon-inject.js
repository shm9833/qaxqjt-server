(function() {
  'use strict';
  var FAVICON_KEY = 'qaxqjt_custom_favicon';
  var saved = null;
  try {
    var raw = localStorage.getItem(FAVICON_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; }
  if (!saved) return;

  var href = '';
  if (saved.type === 'svg') {
    href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(saved.content);
  } else if (saved.type === 'image') {
    href = 'data:' + (saved.mime || 'image/png') + ';base64,' + saved.content;
  } else {
    return;
  }

  var rels = [
    { rel: 'icon', sizes: null, type: saved.type === 'svg' ? 'image/svg+xml' : (saved.mime || 'image/png') },
    { rel: 'shortcut icon', sizes: null, type: saved.type === 'svg' ? 'image/svg+xml' : (saved.mime || 'image/png') },
    { rel: 'apple-touch-icon', sizes: '180x180', type: null }
  ];

  rels.forEach(function(r) {
    var link = document.querySelector('link[data-custom-favicon="' + r.rel + '"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = r.rel;
      link.setAttribute('data-custom-favicon', r.rel);
      if (r.sizes) link.setAttribute('sizes', r.sizes);
      if (r.type) link.setAttribute('type', r.type);
      document.head.appendChild(link);
    }
    link.href = href;
  });

  try {
    if (typeof module !== 'undefined' && module.exports) module.exports = { applyFavicon: function(){} };
  } catch (e) {}
})();
