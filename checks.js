/* FP Reader — the briefer's checklist.
   Each check takes the parsed OFP leg + reference data and returns a result.
   Pure functions, no DOM. Exposed as window.Checks. */
(function (root) {
  'use strict';

  // status: 'fail' needs action · 'warn' look at it · 'ok' verified · 'info' just telling you
  //         'skip' could not be checked, and says why
  function R(id, title, status, headline, detail, extra) {
    var r = { id: id, title: title, status: status, headline: headline, detail: detail || [] };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  var CHECKS = [];
  function define(id, title, fn) { CHECKS.push({ id: id, title: title, fn: fn }); }

  /* ---------- 1. DOW against the weight & balance tables ---------- */

  define('dow', 'משקל ריק תפעולי (DOW)', function (leg, ref) {
    var data = ref && ref.dow;
    if (!data) return R('dow', 'DOW', 'skip', 'טבלאות המשקל לא נטענו');

    var reg = leg.reg;
    var tables = data.dow[reg];
    if (!tables) return R('dow', 'DOW', 'skip', 'אין טבלת משקל לרישום ' + (reg || '—'));

    var crew = leg.briefing && leg.briefing.crew;
    if (!crew) return R('dow', 'DOW', 'skip', 'הרכב הצוות לא מופיע בתדריך המוקדן');

    var ofpDow = leg.dow && leg.dow.est;
    if (!ofpDow) return R('dow', 'DOW', 'skip', 'לא נמצא DOW ב-OFP');

    // expected pantry code, from the destination
    var pcTable = data.pantryCodes[reg];
    if (!pcTable) {
      Object.keys(data.pantryCodes).some(function (k) {
        var t = data.pantryCodes[k];
        if (t._regs && t._regs.indexOf(reg) >= 0) { pcTable = t; return true; }
        return false;
      });
    }
    var destIata = leg.destIata;
    var expectedCode = null;
    if (pcTable && destIata) {
      pcTable.codes.some(function (c) {
        if (c.dest && c.dest.indexOf(destIata) >= 0) { expectedCode = c.code; return true; }
        return false;
      });
    }

    // every (variant, code) whose table value equals the OFP figure
    var matches = [];
    Object.keys(tables).forEach(function (variant) {
      if (variant.charAt(0) === '_') return;
      var t = tables[variant];
      var row = t.rows[crew];
      if (!row) return;
      t.codes.forEach(function (code, i) {
        if (row[i][0] === ofpDow) matches.push({ variant: variant, code: code, doi: row[i][1] });
      });
    });

    var std = tables.STANDARD;
    var stdRow = std && std.rows[crew];
    var expectedDow = null, expectedDoi = null;
    if (stdRow && expectedCode) {
      var ci = std.codes.indexOf(expectedCode);
      if (ci >= 0) { expectedDow = stdRow[ci][0]; expectedDoi = stdRow[ci][1]; }
    }

    var detail = [
      { k: 'ב-OFP', v: ofpDow + ' kg' },
      { k: 'מטוס / צוות', v: reg + ' · ' + crew },
      { k: 'יעד', v: leg.dest + (destIata ? ' / ' + destIata : '') }
    ];
    if (expectedCode) detail.push({ k: 'קוד pantry לפי היעד', v: expectedCode });
    if (expectedDow) detail.push({ k: 'לפי הטבלה (STANDARD)', v: expectedDow + ' kg · DOI ' + expectedDoi });

    if (!stdRow) {
      return R('dow', 'DOW', 'skip', 'אין שורה לצוות ' + crew + ' בטבלת ' + reg, detail);
    }
    if (!expectedCode) {
      if (matches.length) {
        return R('dow', 'DOW', 'warn',
          'היעד ' + (destIata || leg.dest) + ' לא מופיע באף קוד pantry, אבל ה-DOW תואם לקוד ' +
          matches.map(function (m) { return m.code + (m.variant === 'STANDARD' ? '' : '/' + m.variant); }).join(' או '),
          detail);
      }
      return R('dow', 'DOW', 'warn', 'היעד ' + (destIata || leg.dest) + ' לא מופיע באף קוד pantry — לא ניתן לגזור DOW צפוי', detail);
    }
    if (expectedDow === ofpDow) {
      return R('dow', 'DOW', 'ok', 'תואם — ' + ofpDow + ' kg, קוד ' + expectedCode + ', צוות ' + crew, detail);
    }
    // mismatch: say exactly what the tables do match, so a bad transcription is obvious
    var alt = matches.length
      ? 'הערך שב-OFP כן תואם ל' + matches.map(function (m) {
          return 'קוד ' + m.code + ' (' + m.variant + ')'; }).join(' / ')
      : 'הערך שב-OFP לא תואם לאף תא בטבלת ' + reg + ' עבור צוות ' + crew;
    detail.push({ k: 'פער', v: (ofpDow - expectedDow > 0 ? '+' : '') + (ofpDow - expectedDow) + ' kg' });
    return R('dow', 'DOW', 'fail',
      'אי-התאמה: ב-OFP ' + ofpDow + ' kg, לפי הטבלה ' + expectedDow + ' kg',
      detail, { note: alt });
  });

  /* ---------- 2. weight margins ---------- */

  define('weights', 'מרווחי משקל', function (leg) {
    var rows = [
      ['ZFW', leg.zfw], ['TOW', leg.tow], ['LDW', leg.ldw]
    ].filter(function (r) { return r[1] && r[1].est && r[1].max; });
    if (!rows.length) return R('weights', 'משקלים', 'skip', 'לא נמצאו משקלים מתוכננים מול מקסימום');

    var detail = rows.map(function (r) {
      var m = r[1].max - r[1].est;
      return { k: r[0], v: r[1].est + ' / ' + r[1].max + ' kg   (מרווח ' + m + ')' };
    });
    var over = rows.filter(function (r) { return r[1].est > r[1].max; });
    if (over.length) {
      return R('weights', 'משקלים', 'fail',
        'חריגה ממקסימום: ' + over.map(function (r) { return r[0]; }).join(', '), detail);
    }
    var tightest = rows.reduce(function (a, b) {
      return (a[1].max - a[1].est) <= (b[1].max - b[1].est) ? a : b;
    });
    return R('weights', 'משקלים', 'info',
      'המרווח הקטן ביותר: ' + tightest[0] + ' — ' + (tightest[1].max - tightest[1].est) + ' kg',
      detail);
  });

  /* ---------- 3. aircraft defects ---------- */

  define('mel', 'תקלות במטוס', function (leg) {
    var b = leg.briefing;
    if (!b) return R('mel', 'MEL', 'skip', 'אין תדריך מוקדן');
    var items = (b.mel || []).concat((leg.impacts && leg.impacts.mel) || []);
    if (!items.length) {
      return R('mel', 'MEL', b.melClear ? 'ok' : 'info',
        b.melClear ? 'MEL: NONE — אין תקלות פתוחות' : 'לא צוינו פריטי MEL');
    }
    return R('mel', 'MEL', 'warn', items.length + ' פריטי MEL פתוחים',
      items.map(function (t, i) { return { k: '#' + (i + 1), v: t }; }));
  });

  /* ---------- 4. significant enroute weather ---------- */

  define('sigmet', 'מזג אוויר חריג', function (leg) {
    var w = leg.weather;
    if (!w) return R('sigmet', 'SIGMET', 'skip', 'אין מקטע מזג אוויר לטיסה זו');
    if (!w.sigmets.length) return R('sigmet', 'SIGMET', 'ok', 'אין SIGMET פעיל בנתיב');
    var LABEL = { ws: 'SIGMET', tc: 'ציקלון טרופי', va: 'אפר וולקני' };
    return R('sigmet', 'SIGMET', 'warn', w.sigmets.length + ' התרעות פעילות',
      w.sigmets.map(function (s) {
        return { k: (LABEL[s.kind] || s.kind) + ' · ' + s.fir, v: s.text };
      }));
  });

  /* ---------- runner ---------- */

  function run(leg, ref) {
    return CHECKS.map(function (c) {
      try { return c.fn(leg, ref) || R(c.id, c.title, 'skip', 'הבדיקה לא החזירה תוצאה'); }
      catch (e) { return R(c.id, c.title, 'skip', 'שגיאה בבדיקה: ' + (e && e.message)); }
    }).map(function (r, i) { r.title = CHECKS[i].title; return r; });
  }

  root.Checks = { run: run, define: define, list: CHECKS };
})(typeof window !== 'undefined' ? window : globalThis);
