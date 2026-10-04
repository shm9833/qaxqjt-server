(function() {
  'use strict';

  function updateYearPlaceholders() {
    var currentYear = new Date().getFullYear();
    var yearPattern = /\{year\}/g;

    function replaceInTextNodes(element) {
      var nodes = element.childNodes;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.nodeType === Node.TEXT_NODE) {
          if (yearPattern.test(node.nodeValue)) {
            node.nodeValue = node.nodeValue.replace(yearPattern, currentYear);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
            replaceInTextNodes(node);
          }
        }
      }
    }

    if (document.body) {
      replaceInTextNodes(document.body);
    }

    var allElements = document.querySelectorAll('*');
    for (var j = 0; j < allElements.length; j++) {
      var elem = allElements[j];
      var attrs = elem.attributes;
      for (var k = 0; k < attrs.length; k++) {
        var attr = attrs[k];
        if (yearPattern.test(attr.value)) {
          attr.value = attr.value.replace(yearPattern, currentYear);
        }
      }
    }

    if (document.title && yearPattern.test(document.title)) {
      document.title = document.title.replace(yearPattern, currentYear);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateYearPlaceholders);
  } else {
    updateYearPlaceholders();
  }

  window.YearLite = {
    getYear: function() {
      return new Date().getFullYear();
    },
    update: updateYearPlaceholders
  };
})();
