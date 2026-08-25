/* FP Reader — geography: route waypoints from the OFP nav log, closure areas
   from NOTAM text, and a schematic SVG of the two together.
   Orientation aid only — not a navigation chart. Exposed as window.Geo. */
(function (root) {
  'use strict';

  /* ---------- coordinate parsing ---------- */

  // nav log: "N3157.9 E03459.2"  (degrees + decimal minutes)
  var RE_NAV = /\b([NS])(\d{2})(\d{2})\.(\d)\s+([EW])(\d{3})(\d{2})\.(\d)\b/;
  // NOTAM: "335900N 0323447E" (d/m/s) or "3359N 03234E" (d/m)
  var RE_DMS = /\b(\d{2})(\d{2})(\d{2})([NS])\s*[- ]?\s*(\d{3})(\d{2})(\d{2})([EW])\b/g;
  var RE_DM  = /\b(\d{2})(\d{2})([NS])\s*[- ]?\s*(\d{3})(\d{2})([EW])\b/g;

  function navPoint(line) {
    var m = RE_NAV.exec(line);
    if (!m) return null;
    return {
      lat: (+m[2] + (+m[3] + (+m[4]) / 10) / 60) * (m[1] === 'N' ? 1 : -1),
      lon: (+m[6] + (+m[7] + (+m[8]) / 10) / 60) * (m[5] === 'E' ? 1 : -1)
    };
  }

  function areaPoints(text) {
    var pts = [], m;
    RE_DMS.lastIndex = 0;
    while ((m = RE_DMS.exec(text))) {
      pts.push({ lat: (+m[1] + +m[2] / 60 + +m[3] / 3600) * (m[4] === 'N' ? 1 : -1),
                 lon: (+m[5] + +m[6] / 60 + +m[7] / 3600) * (m[8] === 'E' ? 1 : -1) });
    }
    if (pts.length) return pts;
    RE_DM.lastIndex = 0;
    while ((m = RE_DM.exec(text))) {
      pts.push({ lat: (+m[1] + +m[2] / 60) * (m[3] === 'N' ? 1 : -1),
                 lon: (+m[4] + +m[5] / 60) * (m[6] === 'E' ? 1 : -1) });
    }
    return pts;
  }

  /* ---------- the planned route ---------- */

  function route(pages, flightNo) {
    var out = [], seen = {};
    pages.forEach(function (page) {
      // The leg-to-alternate log lives on its own pages; including it would draw
      // the track continuing past the destination to the alternate.
      if (/ROUTE TO ALTERNATE/.test(page)) return;
      // in a merged OFP keep only the pages of the leg being briefed
      if (flightNo) {
        var m = /^[ \t]*AIZ\s+(\d+)\//m.exec(page);
        if (m && 'IZ' + m[1] !== flightNo) return;
      }
      var lines = page.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var p = navPoint(lines[i]);
        if (!p) continue;
        // the fix name sits on the line above its coordinates
        var name = (/^\s*([A-Z][A-Z0-9]{1,6})\b/.exec(lines[i - 1] || '') || [])[1] || null;
        var key = p.lat.toFixed(3) + ',' + p.lon.toFixed(3);
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({ lat: p.lat, lon: p.lon, name: name });
      }
    });
    return out;
  }

  /* ---------- closures worth drawing ---------- */

  var DRAW_TAGS = { closed_as: 1, military: 1, gps: 1 };

  function closures(notams) {
    var out = [];
    notams.forEach(function (n) {
      if (!DRAW_TAGS[n.tagId]) return;
      var pts = areaPoints(n.body);
      if (!pts.length) return;
      var rad = /(\d{1,3})\s?NM\s+RADIUS/i.exec(n.body);
      out.push({
        id: n.id, tag: n.tag, tier: n.tier, station: n.station ? n.station.icao : null,
        points: pts,
        radiusNm: rad ? +rad[1] : null,
        kind: pts.length >= 3 ? 'polygon' : 'circle'
      });
    });
    return out;
  }

  /* ---------- projection + drawing ---------- */

  function draw(opts) {
    var route = opts.route || [], areas = opts.areas || [], coast = opts.coast || null;
    var W = opts.width || 700, H = opts.height || 460, PAD = 26;

    var all = route.slice();
    areas.forEach(function (a) {
      a.points.forEach(function (p) {
        if (a.kind === 'circle' && a.radiusNm) {
          var d = a.radiusNm / 60;
          all.push({ lat: p.lat + d, lon: p.lon + d / Math.cos(p.lat * Math.PI / 180) });
          all.push({ lat: p.lat - d, lon: p.lon - d / Math.cos(p.lat * Math.PI / 180) });
        } else all.push(p);
      });
    });
    if (!all.length) return null;

    var la = all.map(function (p) { return p.lat; }), lo = all.map(function (p) { return p.lon; });
    var la0 = Math.min.apply(null, la), la1 = Math.max.apply(null, la);
    var lo0 = Math.min.apply(null, lo), lo1 = Math.max.apply(null, lo);
    var mLat = (la1 - la0) * 0.12 + 0.6, mLon = (lo1 - lo0) * 0.12 + 0.6;
    la0 -= mLat; la1 += mLat; lo0 -= mLon; lo1 += mLon;

    // equirectangular, longitudes squeezed by the mid-latitude so shapes stay sane
    var k = Math.cos((la0 + la1) / 2 * Math.PI / 180);
    var spanX = (lo1 - lo0) * k, spanY = (la1 - la0);
    var sc = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    var offX = (W - spanX * sc) / 2, offY = (H - spanY * sc) / 2;
    function X(lon) { return offX + (lon - lo0) * k * sc; }
    function Y(lat) { return offY + (la1 - lat) * sc; }

    var s = [];
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" class="mapsvg">');
    s.push('<rect width="' + W + '" height="' + H + '" class="m-sea"/>');

    if (coast) {
      var seg = [];
      coast.lines.forEach(function (line) {
        var d = '', on = false, prev = null;
        line.forEach(function (pt) {
          var inside = pt[0] >= lo0 - 6 && pt[0] <= lo1 + 6 && pt[1] >= la0 - 6 && pt[1] <= la1 + 6;
          if (!inside && !prev) { on = false; return; }
          d += (on ? 'L' : 'M') + X(pt[0]).toFixed(1) + ' ' + Y(pt[1]).toFixed(1);
          on = true; prev = inside ? pt : null;
          if (!inside) on = false;
        });
        if (d) seg.push(d);
      });
      if (seg.length) s.push('<path class="m-coast" d="' + seg.join('') + '"/>');
    }

    areas.forEach(function (a) {
      if (a.kind === 'polygon') {
        var d = a.points.map(function (p, i) {
          return (i ? 'L' : 'M') + X(p.lon).toFixed(1) + ' ' + Y(p.lat).toFixed(1);
        }).join('') + 'Z';
        s.push('<path class="m-area t' + a.tier + '" d="' + d + '"/>');
      } else {
        var p0 = a.points[0];
        var r = (a.radiusNm ? a.radiusNm / 60 : 0.35) * sc;
        s.push('<circle class="m-area t' + a.tier + '" cx="' + X(p0.lon).toFixed(1) +
               '" cy="' + Y(p0.lat).toFixed(1) + '" r="' + Math.max(4, r).toFixed(1) + '"/>');
      }
    });

    if (route.length > 1) {
      s.push('<path class="m-route" d="' + route.map(function (p, i) {
        return (i ? 'L' : 'M') + X(p.lon).toFixed(1) + ' ' + Y(p.lat).toFixed(1);
      }).join('') + '"/>');
    }
    var ends = [[route[0], opts.depName], [route[route.length - 1], opts.destName]];
    ends.forEach(function (pair, i) {
      var p = pair[0];
      if (!p) return;
      var label = pair[1] || p.name;
      s.push('<circle class="m-end" cx="' + X(p.lon).toFixed(1) + '" cy="' + Y(p.lat).toFixed(1) + '" r="5"/>');
      if (label) s.push('<text class="m-lbl" x="' + (X(p.lon) + (i ? 9 : -9)).toFixed(1) +
        '" y="' + (Y(p.lat) - 9).toFixed(1) + '" text-anchor="' + (i ? 'start' : 'end') + '">' +
        label + '</text>');
    });

    s.push('</svg>');
    return s.join('');
  }

  root.Geo = { route: route, closures: closures, draw: draw,
               areaPoints: areaPoints, navPoint: navPoint };
})(typeof window !== 'undefined' ? window : globalThis);
