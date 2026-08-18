/* PDF -> text, reconstructing the true visual layout from glyph coordinates.
   pdf.js reading order scrambles this OFP (VALID lines drift away from their
   NOTAM), so we rebuild each page as a character grid instead. */
(function (root) {
  'use strict';

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.floor(s.length / 2)];
  }

  function pageToText(items) {
    var glyphs = [];
    var widths = [];
    items.forEach(function (it) {
      var s = it.str;
      if (!s) return;
      var x = it.transform[4], y = it.transform[5];
      glyphs.push({ x: x, y: y, s: s, w: it.width });
      if (s.trim().length) widths.push(it.width / s.length);
    });
    if (!glyphs.length) return '';
    var cw = median(widths) || 6;

    // bucket glyphs into visual lines by baseline
    glyphs.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [], cur = null;
    glyphs.forEach(function (g) {
      if (!cur || Math.abs(cur.y - g.y) > 2.5) { cur = { y: g.y, items: [] }; lines.push(cur); }
      cur.items.push(g);
    });

    var minX = Math.min.apply(null, glyphs.map(function (g) { return g.x; }));

    return lines.map(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var row = [];
      ln.items.forEach(function (g) {
        var col = Math.round((g.x - minX) / cw);
        for (var i = 0; i < g.s.length; i++) {
          var c = g.s[i];
          if (c === ' ' && row[col + i] !== undefined) continue;
          row[col + i] = c;
        }
      });
      var out = '';
      for (var i = 0; i < row.length; i++) out += (row[i] === undefined ? ' ' : row[i]);
      return out.replace(/\s+$/, '');
    }).join('\n');
  }

  async function extract(arrayBuffer, onProgress) {
    var pdfjs = root.pdfjsLib;
    var task = pdfjs.getDocument({ data: arrayBuffer });
    var doc = await task.promise;
    var pages = [];
    for (var i = 1; i <= doc.numPages; i++) {
      var page = await doc.getPage(i);
      var tc = await page.getTextContent();
      pages.push(pageToText(tc.items));
      if (onProgress) onProgress(i, doc.numPages);
    }
    return pages;
  }

  root.PdfLoad = { extract: extract, pageToText: pageToText };
})(window);
