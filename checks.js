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

  define('dow', 'משקל ריק תפעולי (DOW)', function (leg, ref, over) {
    // A missing input is itself a finding: without it the DOW cannot be verified,
    // so warn rather than skip quietly.
    var data = ref && ref.dow;
    if (!data) return R('dow', 'DOW', 'warn', 'לא ניתן לבדוק DOW — טבלאות המשקל לא נטענו');

    var reg = leg.reg;
    var tables = data.dow[reg];
    if (!tables) return R('dow', 'DOW', 'warn',
      'לא ניתן לבדוק DOW — אין טבלת משקל לרישום ' + (reg || 'לא מזוהה'),
      [{ k: 'רישום ב-OFP', v: reg || '—' },
       { k: 'רישומים בטבלה', v: Object.keys(data.dow).join(', ') }]);

    // Crew comes from Dispatch Briefing Info. When the OFP omits it the pilot may
    // pick it by hand; the result then says so, because it rests on that input.
    var crewFromOfp = leg.briefing && leg.briefing.crew;
    var crew = crewFromOfp || (over && over.crew) || null;
    var manual = !crewFromOfp && !!crew;
    if (!crew) return R('dow', 'DOW', 'warn',
      'לא ניתן לבדוק DOW — הרכב הצוות חסר',
      [{ k: 'מקור הנתון', v: 'Dispatch Briefing Info' },
       { k: 'מטוס', v: reg || '—' },
       { k: 'DOW ב-OFP', v: (leg.dow && leg.dow.est ? leg.dow.est + ' kg' : 'לא נמצא') }],
      { note: 'שורת CREW אינה מופיעה בעמוד Dispatch Briefing Info של רגל זו. ' +
              'בחר את הרכב הצוות כדי לבדוק, או בדוק ידנית מול ה-OFP.',
        needCrew: true });

    var ofpDow = leg.dow && leg.dow.est;
    if (!ofpDow) return R('dow', 'DOW', 'warn', 'לא ניתן לבדוק DOW — הערך לא נמצא ב-OFP',
      [{ k: 'מטוס / צוות', v: (reg || '—') + ' · ' + crew }]);

    // expected pantry code, from the destination
    var pcTable = data.pantryCodes[reg];
    if (!pcTable) {
      Object.keys(data.pantryCodes).some(function (k) {
        var t = data.pantryCodes[k];
        if (t._regs && t._regs.indexOf(reg) >= 0) { pcTable = t; return true; }
        return false;
      });
    }
    function codeFor(iata) {
      var hit = null;
      if (pcTable && iata) {
        pcTable.codes.some(function (c) {
          if (c.dest && c.dest.indexOf(iata) >= 0) { hit = c.code; return true; }
          return false;
        });
      }
      return hit;
    }
    // The pantry code belongs to the away station. On a leg back to base the
    // destination is home and appears in no code list, so the code is the one
    // of the outbound leg — read it off the departure airport instead.
    var destIata = leg.destIata;
    var codeAirport = destIata, inbound = false;
    var expectedCode = codeFor(destIata);
    if (!expectedCode && leg.depIata && codeFor(leg.depIata)) {
      expectedCode = codeFor(leg.depIata);
      codeAirport = leg.depIata;
      inbound = true;
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
      { k: 'מטוס / צוות', v: reg + ' · ' + crew + (manual ? '  (נבחר ידנית)' : '') },
      { k: 'יעד', v: leg.dest + (destIata ? ' / ' + destIata : '') }
    ];
    if (expectedCode) detail.push({
      k: inbound ? 'קוד pantry לפי שדה המוצא' : 'קוד pantry לפי היעד',
      v: expectedCode + ' (' + codeAirport + ')' + (inbound ? '  — רגל חזרה לבסיס' : '') });
    if (expectedDow) detail.push({ k: 'לפי הטבלה (STANDARD)', v: expectedDow + ' kg · DOI ' + expectedDoi });

    if (!stdRow) {
      return R('dow', 'DOW', 'warn',
        'אין שורה להרכב צוות ' + crew + ' בטבלת ' + reg, detail,
        { needCrew: true, manualCrew: manual ? crew : null,
          note: 'הרכבי הצוות שקיימים בטבלה: ' + Object.keys(std ? std.rows : {}).join(', ') });
    }
    if (!expectedCode) {
      if (matches.length) {
        return R('dow', 'DOW', 'warn',
          'היעד ' + (destIata || leg.dest) + ' לא מופיע באף קוד pantry, אבל ה-DOW תואם לקוד ' +
          matches.map(function (m) { return m.code + (m.variant === 'STANDARD' ? '' : '/' + m.variant); }).join(' או '),
          detail, { manualCrew: manual ? crew : null });
      }
      return R('dow', 'DOW', 'warn',
        'לא ניתן לגזור קוד pantry — ' + (destIata || leg.dest) + ' ו-' +
        (leg.depIata || leg.dep) + ' אינם מופיעים באף קוד',
        detail, { manualCrew: manual ? crew : null });
    }
    if (expectedDow === ofpDow) {
      return R('dow', 'DOW', 'ok',
        'תואם — ' + ofpDow + ' kg, קוד ' + expectedCode + ', צוות ' + crew, detail,
        manual ? { manualCrew: crew,
                   note: 'הרכב הצוות נבחר ידנית ואינו מופיע ב-OFP. הבדיקה תקפה רק אם הבחירה נכונה.' }
               : null);
    }
    // Mismatch. The registration + crew row is what governs, so show that whole
    // row: the wrongly-taken column then stands out at a glance.
    detail.push({ k: 'פער', v: (ofpDow - expectedDow > 0 ? '+' : '') + (ofpDow - expectedDow) + ' kg' });
    detail.push({ k: 'השורה בטבלה', v: std.codes.map(function (c, i) {
      var w = stdRow[i][0];
      var mark = w === ofpDow ? ' \u2190 ב-OFP' : (c === expectedCode ? ' \u2190 הנכון' : '');
      return c + '=' + w + mark;
    }).join('   ') });

    var because = inbound
      ? 'אבל הנתיב מול ' + codeAirport + ' מחייב קוד ' + expectedCode + ' (רגל חזרה לבסיס)'
      : 'אבל היעד ' + codeAirport + ' מחייב קוד ' + expectedCode;
    var alt = matches.length
      ? 'הערך שב-OFP תואם לקוד ' + matches.map(function (m) {
          return m.code + (m.variant === 'STANDARD' ? '' : ' (' + m.variant + ')'); }).join(' / ') +
        ', ' + because + '.'
      : 'הערך שב-OFP לא תואם לאף קוד בשורת ' + crew + ' של ' + reg + '.';
    return R('dow', 'DOW', 'fail',
      'DOW שגוי בתוכנית הטיסה — צריך להיות ' + expectedDow + ' kg, בפועל ' + ofpDow + ' kg',
      detail, { manualCrew: manual ? crew : null,
                note: alt + ' הקובע הוא הרישום ' + reg + ' והרכב הצוות ' + crew + '.' +
                      (manual ? ' הרכב הצוות נבחר ידנית ואינו מופיע ב-OFP.' : '') });
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
        var brief = (root.Wx && root.Wx.sigmetSummary) ? root.Wx.sigmetSummary(s.text) : s.text;
        return { k: (LABEL[s.kind] || s.kind) + ' · ' + s.fir, v: brief, raw: s.text };
      }));
  });

  /* ---------- 5. fuel arithmetic (OM-A 10.12.1) ---------- */
  // REQUIRED = TRIP + CONTINGENCY + ALTERNATE + FINAL RESERVE
  // TAKEOFF  = REQUIRED + EXTRA
  // TOTAL    = TAKEOFF + TAXI

  define('fuelsum', 'הרכב הדלק', function (leg) {
    var f = leg.fuel || {};
    var need = ['trip', 'contgcy', 'mlf', 'altn', 'required', 'takeoff', 'taxi', 'total'];
    var missing = need.filter(function (k) { return !f[k]; });
    if (missing.length) {
      return R('fuelsum', 'הרכב הדלק', 'warn',
        'לא ניתן לאמת את סיכומי הדלק — שורות חסרות',
        [{ k: 'חסר', v: missing.join(', ').toUpperCase() }]);
    }
    var sumReq = f.trip.kg + f.contgcy.kg + f.mlf.kg + f.altn.kg;
    var sumTo  = f.required.kg + f.extra ? f.required.kg + (f.extra ? f.extra.kg : 0) : f.required.kg;
    var sumTot = f.takeoff.kg + f.taxi.kg;

    var lines = [
      { label: 'REQUIRED', got: f.required.kg, want: sumReq,
        how: 'TRIP ' + f.trip.kg + ' + CONT ' + f.contgcy.kg + ' + MLF ' + f.mlf.kg + ' + ALTN ' + f.altn.kg },
      { label: 'TAKEOFF', got: f.takeoff.kg, want: sumTo,
        how: 'REQUIRED ' + f.required.kg + ' + EXTRA ' + (f.extra ? f.extra.kg : 0) },
      { label: 'TOTAL', got: f.total.kg, want: sumTot,
        how: 'TAKEOFF ' + f.takeoff.kg + ' + TAXI ' + f.taxi.kg }
    ];
    var bad = lines.filter(function (l) { return l.got !== l.want; });
    var detail = lines.map(function (l) {
      return { k: l.label, v: l.got + ' kg   (' + l.how + ' = ' + l.want + ')' +
                              (l.got === l.want ? '' : '   \u2718') };
    });
    if (bad.length) {
      return R('fuelsum', 'הרכב הדלק', 'fail',
        'סיכומי הדלק לא מסתדרים: ' + bad.map(function (l) { return l.label; }).join(', '), detail);
    }
    return R('fuelsum', 'הרכב הדלק', 'ok', 'כל הסיכומים מסתדרים', detail);
  });

  /* ---------- 6. taxi fuel (OM-A 10.12.3) ---------- */

  define('taxi', 'דלק נסיעה קרקעית', function (leg, ref) {
    var lim = ref && ref.limits && ref.limits.taxiFuel;
    var f = leg.fuel && leg.fuel.taxi;
    if (!lim) return R('taxi', 'TAXI', 'warn', 'לא ניתן לבדוק — טבלת המגבלות לא נטענה');
    if (!f) return R('taxi', 'TAXI', 'warn', 'לא נמצאה שורת TAXI ב-OFP');

    var fam = /^A3[12]/.test(leg.acType || '') || /^A21N|^A320|^A321/.test(leg.acType || '')
      ? 'Airbus Family' : (/^E19/.test(leg.acType || '') ? 'E195' : null);
    if (!fam) return R('taxi', 'TAXI', 'warn',
      'לא ניתן לבדוק — סוג מטוס לא מוכר: ' + (leg.acType || '—'),
      [{ k: 'ב-OFP', v: f.kg + ' kg' }]);

    var want = lim[fam];
    var detail = [{ k: 'ב-OFP', v: f.kg + ' kg' },
                  { k: 'לפי OM-A 10.12.3', v: want + ' kg (' + fam + ')' },
                  { k: 'סוג מטוס', v: leg.acType }];
    if (f.kg === want) return R('taxi', 'TAXI', 'ok', 'תקין — ' + f.kg + ' kg', detail);
    return R('taxi', 'TAXI', 'warn',
      'חריגה מהתקן: ' + f.kg + ' kg במקום ' + want + ' kg', detail,
      { note: 'לפעולה ממושכת בקרקע (מעל שעתיים) יש להוסיף APU: Airbus 130 ק"ג לשעה, E195 100 ק"ג לשעה.' });
  });

  /* ---------- 7. contingency fuel (OM-A 10.12.2) ---------- */

  define('contingency', 'דלק מילואים (Contingency)', function (leg) {
    var f = leg.fuel || {};
    if (!f.contgcy || !f.trip) return R('contingency', 'CONT', 'warn', 'לא נמצאו שורות CONT / TRIP ב-OFP');

    var detail = [
      { k: 'ב-OFP', v: f.contgcy.kg + ' kg   (' + f.contgcy.basis + ')' },
      { k: 'TRIP', v: f.trip.kg + ' kg' }
    ];
    if (f.contgcy.pct) {
      var want = Math.round(f.trip.kg * f.contgcy.pct / 100);
      detail.push({ k: 'חישוב', v: f.contgcy.pct + '% \u00d7 ' + f.trip.kg + ' = ' + want + ' kg' });
      if (Math.abs(want - f.contgcy.kg) > 1) {
        return R('contingency', 'CONT', 'fail',
          'לא תואם: ' + f.contgcy.kg + ' kg, לפי ' + f.contgcy.pct + '% היה צריך ' + want + ' kg', detail);
      }
      if (f.contgcy.pct === 3) {
        return R('contingency', 'CONT', 'warn',
          'מתוכנן על 3% — מחייב שדה חלופי בנתיב שעומד בקריטריון', detail,
          { note: 'OM-A 10.12.2: 3% מותר רק כשקיים ENR ALT במעגל שמרכזו על הנתיב, במרחק מהיעד שאינו עולה על ' +
                  '25% מסך מרחק הטיסה, או 20% + 50NM — הגדול מביניהם; רדיוס המעגל 20% מסך המרחק. ' +
                  (leg.briefing && leg.briefing.enrAlt && leg.briefing.enrAlt.length
                    ? 'ENR ALT בתדריך: ' + leg.briefing.enrAlt.join(', ') + ' — ודא שהקריטריון מתקיים.'
                    : 'לא צוין ENR ALT בתדריך המוקדן.') });
      }
      return R('contingency', 'CONT', 'ok', 'תקין — ' + f.contgcy.kg + ' kg (' + f.contgcy.pct + '% מה-TRIP)', detail);
    }
    return R('contingency', 'CONT', 'info',
      'מתוכנן לפי מינימום חברה (' + f.contgcy.basis + ') — ' + f.contgcy.kg + ' kg', detail,
      { note: 'OM-A 10.12.2: ה-contingency הוא הגדול מבין 5% מה-TRIP (או 3% בתנאים) לבין דלק ל-5 דקות המתנה ' +
              'ב-1,500 רגל מעל שדה היעד. כאן נבחר המינימום — ודא שהוא אכן הגדול.' });
  });

  /* ---------- 8. landing weight margin (OM-A 10.12.5) ---------- */

  define('ldwmargin', 'מרווח למשקל נחיתה', function (leg) {
    var l = leg.ldw;
    if (!l || !l.est || !l.max) return R('ldwmargin', 'LDW', 'warn', 'לא נמצא משקל נחיתה מתוכנן מול מקסימום');
    var margin = l.max - l.est;
    var onePct = Math.round(l.max * 0.01);
    var detail = [
      { k: 'LDW מתוכנן', v: l.est + ' kg' },
      { k: 'MLW', v: l.max + ' kg' },
      { k: 'מרווח', v: margin + ' kg' },
      { k: '1% מ-MLW', v: onePct + ' kg' }
    ];
    if (margin < 0) return R('ldwmargin', 'LDW', 'fail', 'חריגה מ-MLW ב-' + (-margin) + ' kg', detail);
    if (margin < onePct) {
      return R('ldwmargin', 'LDW', 'warn',
        'מרווח קטן מ-1% מה-MLW — ' + margin + ' kg', detail,
        { note: 'OM-A 10.12.5: כשהמשקל קרוב למגבלה יש לשמור מרווח של 1% ממשקל הנחיתה המרבי הצפוי, ' +
                'כדי לאפשר שינויים של הרגע האחרון. תאם את נתוני הדלק עם ה-FOO.' });
    }
    return R('ldwmargin', 'LDW', 'ok', 'מרווח ' + margin + ' kg (מעל 1% מה-MLW)', detail);
  });

  /* ---------- runner ---------- */

  function run(leg, ref, over) {
    return CHECKS.map(function (c) {
      try { return c.fn(leg, ref, over) || R(c.id, c.title, 'skip', 'הבדיקה לא החזירה תוצאה'); }
      catch (e) { return R(c.id, c.title, 'skip', 'שגיאה בבדיקה: ' + (e && e.message)); }
    }).map(function (r, i) { r.title = CHECKS[i].title; return r; });
  }

  root.Checks = { run: run, define: define, list: CHECKS };
})(typeof window !== 'undefined' ? window : globalThis);
