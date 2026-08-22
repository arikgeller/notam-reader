/* NOTAM Reader — UI wiring. */
(function () {
  'use strict';
  var APP_VERSION = '3.6';
  document.getElementById('ver').textContent = 'v' + APP_VERSION;
  document.getElementById('foot').textContent =
    'FP Reader v' + APP_VERSION + ' — עזר קריאה בלבד. המסמך הרשמי הוא ה‑OFP.';

  var S = { pages: null, parsed: null, ofp: null, ref: {}, flightIdx: -1,
           newDays: 14, showInfo: false, showFir: false, crew: {} };

  var $ = function (id) { return document.getElementById(id); };
  var drop = $('drop'), dz = $('dz'), fileIn = $('file'), err = $('err');
  var dzTitle = dz.querySelector('h2'), dzSub = dz.querySelector('p');
  var DZ_TITLE = dzTitle.textContent, DZ_SUB = dzSub.textContent;

  /* ---------- file intake ---------- */
  $('pick').onclick = function () { fileIn.click(); };
  fileIn.onchange = function () { if (fileIn.files[0]) load(fileIn.files[0]); };
  ['dragenter', 'dragover'].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); dz.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); dz.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (ev) {
    var f = ev.dataTransfer.files[0]; if (f) load(f);
  });
  $('reset').onclick = function () {
    S.parsed = null; fileIn.value = '';
    $('app').classList.add('hidden'); drop.classList.remove('hidden');
    $('hdr').classList.add('hidden'); err.textContent = '';
    window.scrollTo(0, 0);
  };

  function ready() {
    return window.pdfjsLib ? Promise.resolve()
      : new Promise(function (r) { window.addEventListener('pdfjs-ready', r, { once: true }); });
  }

  // reference tables ride along with the app; failure here must not block parsing
  var refReady = Promise.all([
    fetch('data/dow.json').then(function (r) { return r.json(); })
      .then(function (j) { S.ref.dow = j; }).catch(function () { S.ref.dow = null; }),
    fetch('data/limits.json').then(function (r) { return r.json(); })
      .then(function (j) { S.ref.limits = j; }).catch(function () { S.ref.limits = null; })
  ]);

  async function load(file) {
    err.textContent = '';
    dz.classList.add('busy');
    dzTitle.textContent = 'קורא את הקובץ…';
    dzSub.textContent = 'רגע אחד';
    try {
      await ready();
      var buf = await file.arrayBuffer();
      S.pages = await window.PdfLoad.extract(buf, function (i, n) {
        dzTitle.textContent = 'קורא עמוד ' + i + ' מתוך ' + n + '…';
        dzSub.textContent = Math.round(i / n * 100) + '%';
      });
      await refReady;
      S.parsed = window.NotamParser.parse(S.pages);
      S.ofp = window.OfpData.parse(S.pages);
      if (S.parsed.error) throw new Error(S.parsed.error);
      if (!S.parsed.notams.length) throw new Error('נמצא מקטע NOTAM אך לא זוהו הודעות בתוכו');
      S.flightIdx = S.parsed.flights.length ? 0 : -1;
      drop.classList.add('hidden');
      $('app').classList.remove('hidden');
      $('hdr').classList.remove('hidden');
      buildFlightSeg();
      render();
    } catch (e) {
      err.textContent = 'שגיאה: ' + (e && e.message ? e.message : e);
    } finally {
      dz.classList.remove('busy');
      dzTitle.textContent = DZ_TITLE;
      dzSub.textContent = DZ_SUB;
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
  seg($('segFir'), function (v) { S.showFir = v === '1'; render(); }, 'data-v');

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

  var STATUS_ORDER = { fail: 0, warn: 1, info: 2, ok: 3, skip: 4 };
  var ROLE_HE = { dep: 'מוצא', dest: 'יעד', altn: 'חלופי' };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function findCheck(res, id) {
    return res.filter(function (r) { return r.id === id; })[0] || null;
  }
  function alertLine(chk) {
    if (!chk || chk.status === 'ok' || chk.status === 'info') return '';
    return '<div class="alert a-' + chk.status + '">' + esc(chk.headline) + '</div>';
  }

  function render() {
    var P = S.parsed, fl = P.flights;
    var w0 = null, w1 = null;
    var flight = null;
    if (fl.length) {
      if (S.flightIdx >= 0 && fl[S.flightIdx]) {
        flight = fl[S.flightIdx]; w0 = flight.off; w1 = flight.on;
      } else { w0 = fl[0].off; w1 = fl[fl.length - 1].on; }
    }
    $('fInfo').textContent = flight
      ? 'STD ' + hhmm(flight.off) + ' · STA ' + hhmm(flight.on)
      : (w0 ? 'חלון מאוחד ' + hhmm(w0) + '–' + hhmm(w1) : '');

    var leg = null;
    if (S.ofp && S.ofp.legs.length) {
      if (flight) leg = S.ofp.legs.filter(function (l) { return l.flightNo === flight.number; })[0];
      if (!leg) leg = S.ofp.legs[0];
    }
    var res = leg ? window.Checks.run(leg, S.ref, { crew: leg && S.crew[leg.flightNo] }) : [];

    var rows = window.NotamParser.filter(P.notams, {
      windowFrom: w0, windowTo: w1, newDays: S.newDays,
      now: w0 || new Date(), showInfo: S.showInfo, showFir: S.showFir
    });
    var vis = rows.filter(function (r) { return r.visible; });

    // ICAO codes seen in this document stay in capitals in the plain-English text
    S.icaos = {};
    P.notams.forEach(function (n) { if (n.station) S.icaos[n.station.icao] = 1; });
    if (leg) { S.icaos[leg.dep] = 1; S.icaos[leg.dest] = 1; if (leg.altn) S.icaos[leg.altn] = 1; }

    // Park the live filter controls outside #brief before wiping it, otherwise
    // innerHTML destroys the element and its listeners along with it.
    var ctl = $('notamCtl');
    if (ctl) $('notamCtlHome').appendChild(ctl);

    $('brief').innerHTML =
      secPlan(leg, res) + secDispatch(leg, res) + secWx(leg, res) + secNotam(vis, rows, res);

    var slot = $('notamCtlSlot');
    if (slot && ctl) { ctl.hidden = false; slot.parentNode.replaceChild(ctl, slot); }

    bindToggles();
    bindPicker();
  }

  /* ---------- 1. flight plan ---------- */

  function sec(n, title, right, inner, extraClass) {
    return '<section class="sec' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<h3><span class="n">' + n + '</span>' + esc(title) +
      (right ? '<span class="rt">' + esc(right) + '</span>' : '') + '</h3>' +
      inner + '</section>';
  }

  function facts(list) {
    return '<dl class="facts">' + list.map(function (f) {
      return '<dt>' + esc(f[0]) + '</dt><dd' + (f[2] ? ' class="' + f[2] + '"' : '') + '>' +
             esc(f[1]) + '</dd>';
    }).join('') + '</dl>';
  }

  function secPlan(leg, res) {
    if (!leg) return sec(1, 'תוכנית הטיסה', '', '<p class="none">לא זוהתה תוכנית טיסה</p>');
    var dow = findCheck(res, 'dow');
    var fuelChecks = ['fuelsum', 'taxi', 'contingency'].map(function (id) { return findCheck(res, id); })
      .filter(function (c) { return c && (c.status === 'fail' || c.status === 'warn'); });

    var f = leg.fuel || {};
    var rowsF = [
      ['תוכנית טיסה', (leg.flightNo || '—') + (leg.ofpNo !== undefined && leg.ofpNo !== null
        ? '   OFP ' + leg.ofpNo : '')],
      ['תאריך', leg.dateStr || '—'],
      ['נתיב', leg.dep + ' → ' + leg.dest + (leg.altn ? '   ALTN ' + leg.altn : '')],
      ['מטוס', (leg.reg || '—') + '   ' + (leg.acType || '')],
      ['STD', (leg.std ? leg.std + 'Z' : '—') + (leg.sta ? '   STA ' + leg.sta + 'Z' : '')],
      ['DOW', (leg.dow && leg.dow.est ? leg.dow.est + ' kg' : '—'),
        dow && dow.status === 'fail' ? 'bad' : '']
    ];
    // Same three fuel figures as before — one per line rather than run together.
    var bad = fuelChecks.length ? 'bad' : '';
    function fq(x) {
      if (!x) return '—';
      return x.kg.toLocaleString('en-US') + ' kg' + (x.min !== null && x.min !== undefined
        ? '   ' + mins(x.min) : '');
    }
    rowsF.push(['דלק', fq(f.total), bad]);
    rowsF.push(['TRIP', fq(f.trip), bad]);
    rowsF.push(['EXTRA', fq(f.extra), bad]);
    var body = facts(rowsF);
    if (dow && dow.status !== 'ok') body += alertLine(dow) + detailBox(dow);
    if (dow && dow.needCrew) body += crewPicker(leg, dow);
    else if (dow && dow.manualCrew) body += crewChosen(leg, dow.manualCrew);
    fuelChecks.forEach(function (c) { body += alertLine(c) + detailBox(c); });
    return sec(1, 'תוכנית הטיסה', leg.flightNo, body);
  }

  /* ---------- crew picker ---------- */
  // Two wheels, as specified: flight crew 2-4, cabin crew 5-10.

  var FLT_OPTS = [2, 3, 4];
  var CAB_OPTS = [5, 6, 7, 8, 9, 10];
  var WHEEL_H = 44;

  function wheel(id, opts, sel) {
    var items = opts.map(function (o) {
      return '<div class="it' + (o === sel ? ' on' : '') + '" data-v="' + o + '">' + o + '</div>';
    }).join('');
    return '<div class="wheel" id="' + id + '" data-sel="' + (sel === null ? '' : sel) + '">' +
      '<div class="sp"></div>' + items + '<div class="sp"></div></div>';
  }

  function crewPicker(leg, chk) {
    var cur = S.crew[leg.flightNo] || '';
    // A wheel always has a value under the band, so seed the selection with it —
    // an apparently-centred number that counts as "nothing chosen" is a trap.
    var parts = cur.split('/');
    var f = parts[0] ? +parts[0] : FLT_OPTS[0];
    var c = (parts[1] !== undefined && parts[1] !== '') ? +parts[1] : CAB_OPTS[0];
    return '<div class="picker" data-leg="' + esc(leg.flightNo) + '">' +
      '<div class="pk-h">בחר הרכב צוות</div>' +
      '<div class="wheels">' +
        '<div class="wcol"><span class="wl">טייסים</span>' + wheel('wFlt', FLT_OPTS, f) + '</div>' +
        '<span class="wsep">/</span>' +
        '<div class="wcol"><span class="wl">דיילים</span>' + wheel('wCab', CAB_OPTS, c) + '</div>' +
        '<div class="band"></div>' +
      '</div>' +
      '<div class="pk-f"><span class="pk-v" id="pkVal">' + (cur || (f + '/' + c)) + '</span>' +
      '<button type="button" class="btn-primary" id="pkGo">בדוק</button>' +
      (cur ? '<button type="button" class="pk-clr" id="pkClr">נקה</button>' : '') + '</div></div>';
  }

  function crewChosen(leg, crew) {
    return '<div class="chosen">הרכב צוות <b>' + esc(crew) + '</b> נבחר ידנית — לא מופיע ב-OFP' +
      '<button type="button" class="pk-clr" id="pkClr">שנה</button></div>';
  }

  function bindPicker() {
    var box = $('brief').querySelector('.picker');
    var clr = $('pkClr');
    if (clr) clr.onclick = function () {
      var leg = currentLeg(); if (leg) { delete S.crew[leg.flightNo]; render(); }
    };
    if (!box) return;

    var legNo = box.getAttribute('data-leg');
    var wf = $('wFlt'), wc = $('wCab');

    function centre(w, opts) {
      var sel = w.getAttribute('data-sel');
      if (sel === '') return;
      var i = opts.indexOf(+sel);
      if (i >= 0) w.scrollTop = i * WHEEL_H;
    }
    function readout(w, opts) {
      var i = Math.round(w.scrollTop / WHEEL_H);
      i = Math.max(0, Math.min(opts.length - 1, i));
      var v = opts[i];
      w.setAttribute('data-sel', v);
      [].forEach.call(w.querySelectorAll('.it'), function (el) {
        el.classList.toggle('on', +el.getAttribute('data-v') === v);
      });
      return v;
    }
    function sync() {
      var a = wf.getAttribute('data-sel'), b = wc.getAttribute('data-sel');
      var ok = a !== '' && b !== '';
      $('pkVal').textContent = ok ? a + '/' + b : '—';
      $('pkGo').disabled = !ok;
    }
    var t1, t2;
    wf.addEventListener('scroll', function () {
      clearTimeout(t1); t1 = setTimeout(function () { readout(wf, FLT_OPTS); sync(); }, 90);
    });
    wc.addEventListener('scroll', function () {
      clearTimeout(t2); t2 = setTimeout(function () { readout(wc, CAB_OPTS); sync(); }, 90);
    });
    // tapping a value is quicker than scrolling to it
    [[wf, FLT_OPTS], [wc, CAB_OPTS]].forEach(function (pair) {
      pair[0].addEventListener('click', function (ev) {
        var it = ev.target.closest('.it'); if (!it) return;
        pair[0].scrollTo({ top: pair[1].indexOf(+it.getAttribute('data-v')) * WHEEL_H,
                           behavior: 'smooth' });
      });
    });
    centre(wf, FLT_OPTS); centre(wc, CAB_OPTS); sync();

    $('pkGo').onclick = function () {
      var a = wf.getAttribute('data-sel'), b = wc.getAttribute('data-sel');
      if (a === '' || b === '') return;
      S.crew[legNo] = a + '/' + b;
      render();
    };
  }

  function currentLeg() {
    if (!S.ofp || !S.ofp.legs.length) return null;
    var fl = S.parsed.flights;
    var flight = (S.flightIdx >= 0 && fl[S.flightIdx]) ? fl[S.flightIdx] : null;
    var leg = flight && S.ofp.legs.filter(function (l) { return l.flightNo === flight.number; })[0];
    return leg || S.ofp.legs[0];
  }

  function mins(m) {
    if (m === null || m === undefined) return '';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ':' + (r < 10 ? '0' : '') + r;
  }

  function detailBox(chk) {
    if (!chk.detail || !chk.detail.length) return chk.note ? '<p class="hint">' + esc(chk.note) + '</p>' : '';
    return '<details class="more-d"><summary>פרטים</summary>' +
      '<dl class="facts mono">' + chk.detail.map(function (d) {
        return '<dt>' + esc(d.k) + '</dt><dd>' + esc(d.v) + '</dd>';
      }).join('') + '</dl>' +
      (chk.note ? '<p class="hint">' + esc(chk.note) + '</p>' : '') + '</details>';
  }

  /* ---------- 2. dispatch notes ---------- */

  function secDispatch(leg, res) {
    var b = leg && leg.briefing;
    if (!b) return sec(2, 'Dispatch Notes', '', '<p class="none">אין עמוד תדריך מוקדן</p>');
    var mel = findCheck(res, 'mel');
    var body = '';
    if (b.mel && b.mel.length) {
      body += '<div class="mel"><div class="mel-h">' + b.mel.length + ' פריטי MEL פתוחים</div>' +
        b.mel.map(function (m) { return '<div class="mel-i">' + esc(m) + '</div>'; }).join('') + '</div>';
    } else {
      body += '<p class="clean">' + (b.melClear ? 'MEL: NONE — אין תקלות פתוחות' : 'לא צוינו פריטי MEL') + '</p>';
    }
    var notes = [];
    if (b.extraFuelReason) notes.push(['דלק נוסף', b.extraFuelReason]);
    if (b.crew) notes.push(['צוות', b.crew]);
    if (b.enrAlt && b.enrAlt.length) notes.push(['ENR ALT', b.enrAlt.join(', ')]);
    (b.airportNotes || []).forEach(function (n) { notes.push([n.icao, n.text]); });
    if (notes.length) body += facts(notes);
    return sec(2, 'Dispatch Notes', '', body);
  }

  /* ---------- 3. significant weather ---------- */

  function secWx(leg, res) {
    var w = leg && leg.weather;
    if (!w) return sec(3, 'מזג אוויר חריג', '', '<p class="none">אין מקטע מזג אוויר</p>');

    var want = { dep: 1, dest: 1, altn: 1 };
    var sts = w.stations.filter(function (s) { return want[s.role]; }).map(window.Wx.station);

    var body = '', anything = false;
    sts.forEach(function (st) {
      var head = '<div class="wx-st"><span class="wx-i">' + esc(st.icao) + '</span>' +
                 '<span class="wx-r">' + (ROLE_HE[st.role] || st.role) + '</span>';
      if (st.clean) {
        body += head + '<span class="wx-ok">ללא חריגים</span></div>';
        return;
      }
      anything = true;
      body += head + '</div><ul class="wx-l">';
      if (st.metar && st.metar.hits.length) {
        st.metar.hits.forEach(function (h) {
          body += '<li><span class="wx-tag">METAR</span>' + esc(h.text) + '</li>';
        });
      }
      st.tafHits.forEach(function (sg) {
        var lbl = sg.label === 'base' ? 'TAF' : 'TAF ' + sg.label;
        sg.hits.forEach(function (h) {
          body += '<li><span class="wx-tag">' + esc(lbl) + '</span>' + esc(h.text) +
                  (sg.periodText ? '<span class="wx-p">' + esc(sg.periodText) + '</span>' : '') + '</li>';
        });
      });
      body += '</ul>';
      body += '<details class="more-d"><summary>METAR / TAF מקוריים</summary><pre class="raw2">' +
        esc(st.rawMetar.concat(st.rawTaf).join('\n')) + '</pre></details>';
    });

    // The route gets a line either way — silence must not read as "not checked".
    var sig = findCheck(res, 'sigmet');
    var sigHead = '<div class="wx-st"><span class="wx-i">בנתיב</span><span class="wx-r">SIGMET</span>';
    if (sig && sig.status === 'warn') {
      anything = true;
      body += sigHead + '</div><ul class="wx-l">';
      sig.detail.forEach(function (d) {
        body += '<li><span class="wx-tag">' + esc(d.k.split(' · ')[0]) + '</span>' +
                esc(d.k.split(' · ')[1] || '') + ' — ' + esc(d.v.slice(0, 180)) + '</li>';
      });
      body += '</ul>';
    } else if (sig && sig.status === 'ok') {
      body += sigHead + '<span class="wx-ok">אין SIGMET פעיל</span></div>';
    } else {
      body += sigHead + '<span class="wx-na">' + esc(sig ? sig.headline : 'לא נבדק') + '</span></div>';
    }
    if (!body) body = '<p class="clean">אין חריגים</p>';
    return sec(3, 'מזג אוויר חריג', 'רוח >15kt · ענן <2000ft · CB/TCU · משקעים · ראות <9999', body);
  }

  /* ---------- 4. NOTAMs ---------- */

  var SEC_ORDER = ['בית ויעד', 'שדה בית', 'שדה יעד', 'שדה משנה',
                   'שדות בנתיב', 'שדות בנתיב (נוספים)',
                   'מרחב סביב הבית', 'מרחב סביב היעד', 'מרחב מורחב בית-יעד',
                   'מרחב בנתיב בית-יעד', 'מרחב בנתיב יעד-משנה'];
  var ROLE = {
    'בית ויעד': 'בית / יעד', 'שדה בית': 'שדה בית', 'שדה יעד': 'שדה יעד',
    'שדה משנה': 'שדה משנה', 'שדות בנתיב': 'שדה בנתיב', 'שדות בנתיב (נוספים)': 'שדה בנתיב',
    'מרחב מורחב בית-יעד': 'מרחב', 'מרחב בנתיב בית-יעד': 'מרחב', 'מרחב בנתיב יעד-משנה': 'מרחב',
    'מרחב סביב הבית': 'מרחב', 'מרחב סביב היעד': 'מרחב'
  };

  function secNotam(vis, rows, res) {
    var c = { 1: 0, 2: 0, 3: 0, n: 0 };
    vis.forEach(function (r) { c[r.tier]++; if (r.isNew) c.n++; });
    var right = c[1] + ' קריטי · ' + c[2] + ' חשוב' + (c.n ? ' · ' + c.n + ' חדש' : '') +
                '   (' + vis.length + '/' + rows.length + ')';

    var groups = {}, order = [];
    function bucket(secL, st) {
      var key = secL + '||' + (st ? st.icao : '—');
      if (!groups[key]) { groups[key] = { sec: secL, st: st, items: [] }; order.push(key); }
      return groups[key];
    }
    S.parsed.notams.forEach(function (r) { if (r.scope === 'primary') bucket(r.sectionLabel, r.station); });
    vis.forEach(function (r) { bucket(r.sectionLabel, r.station).items.push(r); });
    order.sort(function (a, b) {
      return SEC_ORDER.indexOf(groups[a].sec) - SEC_ORDER.indexOf(groups[b].sec);
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
        '<span class="icao">' + (g.st ? esc(g.st.icao) : '—') + '</span>' +
        '<span class="nm">' + esc(g.st && g.st.name ? g.st.name : '') + '</span>' +
        '<span class="role">' + esc(ROLE[g.sec] || g.sec) + '</span></div>';
      if (g.items.length) g.items.forEach(function (r) { html += card(r); });
      else html += '<div class="empty">אין NOTAM להצגה</div>';
      html += '</div>';
    });
    return sec(4, 'NOTAM', right,
      '<div id="notamCtlSlot"></div>' + (html || '<p class="none">אין NOTAMים להצגה</p>'),
      'sec-notam');
  }

  function card(r) {
    var v = r.valid;
    var dates = v
      ? fmt(v.from) + '  →  ' + (v.perm ? 'PERM' : fmt(v.to)) + (v.est ? ' EST' : '')
      : 'טווח תוקף לא זוהה';
    var p = window.NotamPlain.plain(r, S.icaos);
    return '<div class="card t' + r.tier + '">' +
      '<div class="chead">' +
        '<span class="tag">' + esc(r.tag) + '</span>' +
        (r.isNew ? '<span class="badge-new">חדש</span>' : '') +
        '<span class="nid">' + esc(r.id) + '</span>' +
      '</div>' +
      (p.headline ? '<div class="nhead">' + esc(p.headline) + '</div>' : '') +
      '<div class="gist">' + esc(p.body) + '</div>' +
      '<div class="dates">' + esc(dates) + '</div>' +
      '<button class="rawbtn" type="button">הצג NOTAM מקורי</button>' +
      '<div class="raw">' + esc(r.body) + '</div>' +
    '</div>';
  }

  function bindToggles() {
    [].forEach.call($('brief').querySelectorAll('.rawbtn'), function (b) {
      b.onclick = function () {
        var card = b.parentNode;
        var open = card.classList.toggle('open');
        b.textContent = open ? 'הסתר מקור' : 'הצג NOTAM מקורי';
      };
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {});
    });
  }
})();
