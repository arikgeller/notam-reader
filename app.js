/* NOTAM Reader — UI wiring. */
(function () {
  'use strict';
  var APP_VERSION = '1.2';
  document.getElementById('ver').textContent = 'v' + APP_VERSION;
  document.getElementById('foot').textContent =
    'NOTAM Reader v' + APP_VERSION + ' — עזר קריאה בלבד. המסמך הרשמי הוא ה‑OFP.';

  var S = { pages: null, parsed: null, flightIdx: -1, newDays: 14, showInfo: false };

  var $ = function (id) { return document.getElementById(id); };
  var drop = $('drop'), fileIn = $('file'), err = $('err');

  /* ---------- file intake ---------- */
  $('pick').onclick = function () { fileIn.click(); };
  fileIn.onchange = function () { if (fileIn.files[0]) load(fileIn.files[0]); };
  ['dragenter', 'dragover'].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (ev) {
    var f = ev.dataTransfer.files[0]; if (f) load(f);
  });
  $('reset').onclick = function () {
    S.parsed = null; fileIn.value = '';
    $('app').classList.add('hidden'); drop.classList.remove('hidden');
    $('reset').classList.add('hidden'); err.textContent = '';
  };

  function ready() {
    return window.pdfjsLib ? Promise.resolve()
      : new Promise(function (r) { window.addEventListener('pdfjs-ready', r, { once: true }); });
  }

  async function load(file) {
    err.textContent = '';
    drop.querySelector('h2').textContent = 'קורא את הקובץ…';
    try {
      await ready();
      var buf = await file.arrayBuffer();
      S.pages = await window.PdfLoad.extract(buf, function (i, n) {
        drop.querySelector('h2').textContent = 'קורא עמוד ' + i + ' מתוך ' + n + '…';
      });
      S.parsed = window.NotamParser.parse(S.pages);
      if (S.parsed.error) throw new Error(S.parsed.error);
      if (!S.parsed.notams.length) throw new Error('נמצא מקטע NOTAM אך לא זוהו הודעות בתוכו');
      S.flightIdx = S.parsed.flights.length ? 0 : -1;
      drop.classList.add('hidden');
      $('app').classList.remove('hidden');
      $('reset').classList.remove('hidden');
      buildFlightSeg();
      render();
    } catch (e) {
      err.textContent = 'שגיאה: ' + (e && e.message ? e.message : e);
    } finally {
      drop.querySelector('h2').textContent = 'גרור לכאן את ה‑OFP';
    }
  }

  /* ---------- controls ---------- */
  function seg(el, onPick, attr) {
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      [].forEach.call(el.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      onPick(b.getAttribute(attr));
    });
  }
  seg($('segNew'), function (v) { S.newDays = +v; render(); }, 'data-d');
  seg($('segInfo'), function (v) { S.showInfo = v === '1'; render(); }, 'data-v');

  function buildFlightSeg() {
    var el = $('segFlight'), fl = S.parsed.flights;
    el.innerHTML = '';
    if (!fl.length) { el.innerHTML = '<button aria-pressed="true">לא זוהתה</button>'; return; }
    fl.forEach(function (f, i) {
      var b = document.createElement('button');
      b.textContent = f.number + ' ' + f.dep + '→' + f.dest;
      b.setAttribute('data-i', i);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      el.appendChild(b);
    });
    if (fl.length > 1) {
      var b = document.createElement('button');
      b.textContent = 'שתיהן'; b.setAttribute('data-i', '-1');
      b.setAttribute('aria-pressed', 'false'); el.appendChild(b);
    }
    seg(el, function (v) { S.flightIdx = +v; render(); }, 'data-i');
  }

  /* ---------- formatting ---------- */
  var MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  function fmt(d) {
    if (!d) return '—';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getUTCDate()) + MON[d.getUTCMonth()] + String(d.getUTCFullYear()).slice(2) +
           ' ' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + 'Z';
  }
  function hhmm(d) {
    if (!d) return '—';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getUTCHours()) + p(d.getUTCMinutes()) + 'Z';
  }
  // Short readable summary: keep taking sentences until we have something with
  // actual content. A lead-in like "ANTALYA AD SEE NOTAM:" says nothing alone.
  function gistOf(body) {
    var one = body.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (one.length <= 90) return one;
    var out = '', rest = one;
    while (rest.length) {
      var m = /^(.*?[.:])(\s+|$)/.exec(rest);
      var piece = m ? m[1] : rest;
      if (out && (out + ' ' + piece).length > 170) break;
      out = out ? out + ' ' + piece : piece;
      rest = m ? rest.slice(m[0].length) : '';
      if (out.length >= 45 && !/:$/.test(out)) break;
    }
    if (!out) out = one.slice(0, 150);
    return out.length < one.length ? out : one;
  }

  var ROLE = {
    'בית ויעד': 'בית / יעד', 'שדה בית': 'שדה בית', 'שדה יעד': 'שדה יעד',
    'שדה משנה': 'שדה משנה', 'שדות בנתיב': 'שדה בנתיב', 'שדות בנתיב (נוספים)': 'שדה בנתיב',
    'מרחב מורחב בית-יעד': 'מרחב', 'מרחב בנתיב בית-יעד': 'מרחב', 'מרחב בנתיב יעד-משנה': 'מרחב',
    'מרחב סביב הבית': 'מרחב', 'מרחב סביב היעד': 'מרחב'
  };
  var SEC_ORDER = ['בית ויעד', 'שדה בית', 'שדה יעד', 'שדה משנה',
                   'שדות בנתיב', 'שדות בנתיב (נוספים)',
                   'מרחב סביב הבית', 'מרחב סביב היעד', 'מרחב מורחב בית-יעד',
                   'מרחב בנתיב בית-יעד', 'מרחב בנתיב יעד-משנה'];

  /* ---------- render ---------- */
  function render() {
    var P = S.parsed, fl = P.flights;
    var w0 = null, w1 = null, info = '';
    if (fl.length) {
      if (S.flightIdx >= 0 && fl[S.flightIdx]) {
        var f = fl[S.flightIdx];
        w0 = f.off; w1 = f.on;
        info = 'STD ' + hhmm(f.off) + ' · STA ' + hhmm(f.on) + ' · ' + f.dateStr +
               (f.altn ? ' · ALTN ' + f.altn : '');
      } else {
        w0 = fl[0].off; w1 = fl[fl.length - 1].on;
        info = 'חלון מאוחד ' + hhmm(w0) + '–' + hhmm(w1) + ' · ' + fl[0].dateStr;
      }
    }
    $('fInfo').textContent = info;

    var rows = window.NotamParser.filter(P.notams, {
      windowFrom: w0, windowTo: w1, newDays: S.newDays,
      now: w0 || new Date(), showInfo: S.showInfo
    });

    var vis = rows.filter(function (r) { return r.visible; });
    var c = { 1: 0, 2: 0, 3: 0, n: 0 };
    vis.forEach(function (r) { c[r.tier]++; if (r.isNew) c.n++; });
    var dropped = rows.length - vis.length;

    $('sum').innerHTML =
      '<span class="pill p1">' + c[1] + ' קריטי</span>' +
      '<span class="pill p2">' + c[2] + ' חשוב</span>' +
      (S.showInfo ? '<span class="pill p3">' + c[3] + ' לידיעה</span>' : '') +
      (c.n ? '<span class="pill pn">' + c.n + ' חדש</span>' : '') +
      '<span class="pill p3">' + dropped + ' סוננו מתוך ' + rows.length + '</span>';

    // group by section, then station
    var groups = {}, order = [];
    function bucket(sec, st) {
      var key = sec + '||' + (st ? st.icao : '—');
      if (!groups[key]) { groups[key] = { sec: sec, st: st, items: [] }; order.push(key); }
      return groups[key];
    }
    // Primary stations always get a group. A departure or destination field that
    // silently vanishes (everything expired or filtered) reads as "not parsed";
    // say so explicitly instead.
    P.notams.forEach(function (r) {
      if (r.scope === 'primary') bucket(r.sectionLabel, r.station);
    });
    vis.forEach(function (r) { bucket(r.sectionLabel, r.station).items.push(r); });
    order.sort(function (a, b) {
      var ga = groups[a], gb = groups[b];
      var d = SEC_ORDER.indexOf(ga.sec) - SEC_ORDER.indexOf(gb.sec);
      return d || 0;
    });

    var html = '';
    order.forEach(function (k) {
      var g = groups[k];
      g.items.sort(function (a, b) {
        if (a.tier !== b.tier) return a.tier - b.tier;
        if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
        var av = a.valid && a.valid.from ? a.valid.from.getTime() : 0;
        var bv = b.valid && b.valid.from ? b.valid.from.getTime() : 0;
        return bv - av;
      });
      html += '<div class="grp"><div class="grp-h">' +
        '<span class="icao">' + (g.st ? g.st.icao : '—') + '</span>' +
        '<span class="nm">' + esc(g.st && g.st.name ? g.st.name : '') + '</span>' +
        '<span class="role">' + (ROLE[g.sec] || g.sec) + '</span></div>';

      if (g.items.length) {
        g.items.forEach(function (r) { html += card(r); });
      } else {
        html += '<div class="empty">אין NOTAM להצגה — הכל פג תוקף לחלון הטיסה או מסווג "לידיעה"</div>';
      }
      html += '</div>';
    });

    $('list').innerHTML = html || '<div class="bar">אין NOTAMים להצגה בהגדרות הנוכחיות.</div>';
    [].forEach.call($('list').querySelectorAll('.card:not(.flat) .chead'), function (h) {
      h.onclick = function () { h.parentNode.classList.toggle('open'); };
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function card(r) {
    var v = r.valid;
    var dates = v
      ? fmt(v.from) + '  →  ' + (v.perm ? 'PERM' : fmt(v.to)) + (v.est ? ' EST' : '')
      : '<span class="exp">לא זוהה טווח תוקף — קרא את המקור</span>';
    var gist = gistOf(r.body);
    // only offer "expand" when the full text actually says more than the gist
    var flat = r.body.replace(/\s+/g, ' ').trim();
    var hasMore = flat.length > gist.replace(/\s+/g, ' ').trim().length + 2;
    return '<div class="card t' + r.tier + (hasMore ? '' : ' flat') + '">' +
      '<div class="chead">' +
        '<span class="tag">' + esc(r.tag) + '</span>' +
        (r.isNew ? '<span class="badge-new">חדש</span>' : '') +
        '<span class="nid">' + esc(r.id) + '</span>' +
        '<span class="spc"></span>' +
        (hasMore ? '<span class="chev">▾</span>' : '') +
      '</div>' +
      '<div class="gist">' + esc(gist) + '</div>' +
      '<div class="dates">' + dates + '</div>' +
      (hasMore ? '<div class="raw">' + esc(r.body) + '</div>' : '') +
    '</div>';
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {});
    });
  }
})();
