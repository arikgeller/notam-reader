/* NOTAM Reader — parsing + classification engine.
   Pure functions, no DOM. Exposed as window.NotamParser. */
(function (root) {
  'use strict';

  var MONTHS = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6,
                 AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };

  /* ---------- date helpers ---------- */

  // "29-JAN-26 1632" -> Date (UTC).  Returns null if unparseable.
  function parseStamp(s) {
    var m = /^(\d{1,2})-([A-Z]{3})-(\d{2})\s+(\d{2})(\d{2})$/.exec(s.trim());
    if (!m) return null;
    var mon = MONTHS[m[2]];
    if (mon === undefined) return null;
    return new Date(Date.UTC(2000 + +m[3], mon, +m[1], +m[4], +m[5]));
  }

  // "2601291632" (YYMMDDHHMM) -> Date (UTC)
  function parseCompact(s) {
    var m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s.trim());
    if (!m) return null;
    return new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  }

  function parseAny(s) { return parseStamp(s) || parseCompact(s); }

  // Two bulletin dialects seen in Arkia OFPs:
  //   VALID: 29-JAN-26 1632 - 31-AUG-26 2359 EST
  //   VALID: 2601291632 - 2608312359 EST      (LIDO compact)
  var STAMP = '(?:\\d{1,2}-[A-Z]{3}-\\d{2}\\s+\\d{4}|\\d{10})';
  var RE_VALID = new RegExp('VALID:\\s*(' + STAMP + ')\\s*-\\s*(PERM|UFN|' + STAMP + ')(\\s+EST)?');

  function parseValid(line) {
    var m = RE_VALID.exec(line);
    if (!m) return null;
    var to = /^(PERM|UFN)$/.test(m[2].trim()) ? null : parseAny(m[2]);
    return { from: parseAny(m[1]), to: to, perm: to === null, est: !!m[3] };
  }

  /* ---------- classification ---------- */
  // Ordered — first match wins. tier: 1 critical, 2 important, 3 info.
  var RULES = [
    { id:'minima',    tier:1, he:'שינוי מינימה',        test:/OCA\(H\)|\bMINIMA\b|MNM\s+(RVR|VIS)\b|\bRVR\b[^\n]{0,40}(U\/S|UNSERVICEABLE|NOT AVBL)/ },
    { id:'rwy_clsd',  tier:1, he:'מסלול סגור',          test:/\bRWY\b[^.\n]{0,60}\b(CLSD|CLOSED)\b|\b(CLSD|CLOSED)\b[^.\n]{0,30}\bRWY\b/ },
    { id:'intx_to',   tier:1, he:'המראה מהצטלבות',      test:/INTERSECTION\s+(TAKE\s?OFF|T\/O|DEP)/ },
    { id:'ils',       tier:1, he:'ILS / LOC',           test:/\b(ILS|LLZ|LOCALIZER|GLIDE\s?PATH)\b[^\n]{0,90}(U\/S|OUT OF USABLE|UNSERVICEABLE|NOT AVBL|DOWNGRAD)/ },
    { id:'proc_susp', tier:1, he:'הליך גישה מושעה',     test:/\b(APCH|APPROACH|RNP|RNAV|LPV|LNAV|VNAV|SID|STAR)\b[^\n]{0,60}(SUSPENDED|WITHDRAWN|NOT AVBL|CANCELLED)/ },
    { id:'twy_clsd',  tier:1, he:'TWY סגור',            test:/\bTWY\b[^.\n]{0,60}\b(CLSD|CLOSED)\b/ },
    { id:'papi',      tier:1, he:'PAPI / VASI',         test:/\b(PAPI|VASI|APAPI|PLASI)\b/ },
    { id:'apch_lgt',  tier:1, he:'תאורת גישה',          test:/\b(APCH|APPROACH)\s+LIGHT|\bALS\b|\bRAIL\b|\bSALS\b|\bSSALR\b/ },
    { id:'cat',       tier:1, he:'שינוי CAT',           test:/\bCAT\s?(I|II|III)\b(?!\s?I?\s?ACFT)/ },
    { id:'gradient',  tier:1, he:'שיפוע טיפוס',         test:/(CMB|CLIMB)\s+GRADIENT/ },
    { id:'alt_rstr',  tier:1, he:'הגבלת גובה',          test:/AT OR (BELOW|ABOVE)\s+(FL|\d)|LEVEL\s+RESTRICTION|MAINTAIN\s+FL\d{3}/ },
    { id:'closed_as', tier:1, he:'איסור טיסה / מרחב סגור', test:/\bFORBIDDEN\b|\bPROHIBITED\b|AIRSPACE\s+(CLSD|CLOSED)|\bAD\s+(CLSD|CLOSED)\b|(RESTRICTED|DANGER|PROHIBITED)\s+AREA/ },
    { id:'military',  tier:1, he:'פעילות צבאית',        test:/\bMILITARY\b|NAVIGATIONAL WARNING|\bUNMANNED\b|\bUAV\b|\bFIRING\b|EXERCISE\s+(AREA|ACTIVIT|WILL|TAKE)|\bLIVE FIRE\b/ },

    { id:'gps',       tier:2, he:'GPS / GNSS',          test:/\b(GPS|GNSS|RAIM)\b|SPOOF|JAMMING|INTRP TO AIRBORNE/ },
    { id:'navaid',    tier:2, he:'אמצעי ניווט U/S',     test:/\b(VOR|DME|NDB|TACAN|VORTAC|LOC)\b[^\n]{0,90}(U\/S|UNSERVICEABLE|NOT AVBL)|\d+(\.\d+)?\s?(KHZ|MHZ)[^\n]{0,40}(U\/S|UNSERVICEABLE|NOT AVBL)/ },
    { id:'radar',     tier:2, he:'רדאר U/S',            test:/\b(RADAR|MSSR|PSR|SSR|TAR)\b[^\n]{0,60}(U\/S|UNSERVICEABLE|NOT AVBL)/ },

    { id:'obstacle',  tier:3, he:'מכשולים / עבודות',    test:/\bCRANE\b|\bOBST\b|\bOBSTACLE\b|\bWIP\b|WORK IN PROGRESS|MOBILE EQPT/ },
    { id:'birds',     tier:3, he:'ציפורים',             test:/\bBIRD|\bGULL|\bFALCON|\bSTORK|WILDLIFE/ },
    { id:'stands',    tier:3, he:'חניות / רחבה',        test:/\b(STAND|PRKG|PARKING|APRON|TAXILANE)\b/ },
    { id:'acdm',      tier:3, he:'A-CDM / נהלים',       test:/A-?CDM|\bTOBT\b|\bTSAT\b|\bASAT\b|\bA-VDGS\b/ },
    { id:'pavement',  tier:3, he:'PCR / PCN',           test:/\bPCR\b|\bPCN\b/ },
    { id:'fire',      tier:3, he:'שריפות',              test:/FOREST FIRE|\bFIRE\b/ }
  ];

  var FALLBACK = { id:'other', tier:3, he:'כללי' };

  function classify(text) {
    var up = text.toUpperCase();
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].test.test(up)) return RULES[i];
    }
    return FALLBACK;
  }

  /* ---------- scope of a section header ---------- */
  // primary = departure / destination / destination-alternate -> show all tiers
  // secondary = enroute airports + FIR areas          -> show tier 1 only
  // primary   = departure / destination / destination-alternate  -> every tier
  // secondary = enroute airports                                 -> tier 1 only
  // area      = FIR / airspace blocks                            -> off by default
  function scopeOf(header) {
    var h = header.toUpperCase();
    // Airspace blocks first: "AREA ENROUTE DESTINATION - DESTINATION ALTERNATE(S)"
    // is a FIR block, not an alternate field, and must not match the rule below.
    if (/^(EXTENDED\s+)?AREA\b/.test(h)) return 'area';
    if (/DEPARTURE\s*\/\s*DESTINATION AIRPORTS/.test(h)) return 'primary';
    if (/^DEPARTURE AIRPORT/.test(h)) return 'primary';
    if (/^DESTINATION AIRPORT/.test(h)) return 'primary';
    if (/DESTINATION ALTERNATE/.test(h)) return 'primary';
    if (/AIRPORT/.test(h)) return 'secondary';
    if (/AREA/.test(h)) return 'area';
    return 'secondary';
  }

  function sectionLabel(header) {
    var h = header.toUpperCase().trim();
    var map = {
      'DEPARTURE / DESTINATION AIRPORTS': 'בית ויעד',
      'DEPARTURE AIRPORT': 'שדה בית',
      'DESTINATION AIRPORT': 'שדה יעד',
      'DESTINATION ALTERNATE(S)': 'שדה משנה',
      'ADDITIONAL ENROUTE AIRPORT(S)': 'שדות בנתיב (נוספים)',
      'EXTENDED AREA AROUND DEPARTURE': 'מרחב סביב הבית',
      'EXTENDED AREA AROUND DESTINATION': 'מרחב סביב היעד',
      'DESTINATION ALTERNATE AIRPORT(S)': 'שדה משנה',
      'ENROUTE AIRPORT(S)': 'שדות בנתיב',
      'EXTENDED AREA AROUND DEPARTURE - DESTINATION': 'מרחב מורחב בית-יעד',
      'AREA ENROUTE DEPARTURE - DESTINATION': 'מרחב בנתיב בית-יעד',
      'AREA ENROUTE DESTINATION - DESTINATION ALTERNATE(S)': 'מרחב בנתיב יעד-משנה'
    };
    return map[h] || header.trim();
  }

  /* ---------- OFP header (flights) ---------- */

  function parseFlights(pages) {
    var seen = {}, out = [];
    pages.forEach(function (page) {
      var m = /^[ \t]*AIZ\s+(\d+)\/(\d{1,2}[A-Za-z]{3}\d{2})\/([A-Z]{4})-([A-Z]{4})/m.exec(page);
      if (!m) return;
      var key = m[1] + '/' + m[2];
      if (seen[key]) return;
      var std = /\bSTD\s+(\d{4})Z/.exec(page);
      var sta = /\bSTA\s+(\d{4})Z/.exec(page);
      if (!std || !sta) return;                    // header page only
      seen[key] = true;
      var d = /^(\d{1,2})([A-Za-z]{3})(\d{2})$/.exec(m[2]);
      var day = d ? Date.UTC(2000 + +d[3], MONTHS[d[2].toUpperCase()], +d[1]) : null;
      function at(hhmm) {
        if (day === null) return null;
        return new Date(day + (+hhmm.slice(0,2)) * 3600e3 + (+hhmm.slice(2)) * 60e3);
      }
      var off = at(std[1]), on = at(sta[1]);
      if (off && on && on < off) on = new Date(on.getTime() + 864e5); // crosses midnight
      out.push({
        number: 'IZ' + m[1], dateStr: m[2],
        dep: m[3], dest: m[4], off: off, on: on,
        altn: (/\bALTN\s+([A-Z]{4})\b/.exec(page) || [])[1] || null
      });
    });
    return out;
  }

  /* ---------- main ---------- */

  var RE_ID     = /^(\d[A-Z]\d+\/\d{2})(\s+OR)?\b/;
  var RE_NOISE  = /^(Page \d+ of \d+|AIZ\s+\d+\/.*)$/;
  var RE_EQ     = /^={6,}$/;
  var RE_DASH   = /^-{6,}$/;
  var RE_PLUS   = /^\+{3,}\s*(.+?)\s*\+{3,}$/;
  var RE_STATION= /^([A-Z]{4})\s*\/?\s*([A-Z]{3})?\s+(.*\S)?$/;

  function parse(pages) {
    var flights = parseFlights(pages);
    var all = pages.join('\n').split('\n');

    // Isolate the NOTAM block: from a bare "NOTAM" line until the OFP resumes.
    var start = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].trim() === 'NOTAM') { start = i + 1; break; }
    }
    if (start < 0) return { flights: flights, notams: [], error: 'לא נמצא מקטע NOTAM בקובץ' };
    // The block runs to the end of the file. It cannot stop at the first OFP
    // page header: in the LIDO dialect every NOTAM page carries one.
    var end = all.length;

    var lines = all.slice(start, end)
      .map(function (l) { return l.replace(/\s+$/, ''); })
      .filter(function (l) { return !RE_NOISE.test(l.trim()); });

    var notams = [], section = null, station = null, category = null, cur = null;

    function flush() {
      if (!cur) return;
      var body = cur.bodyLines.join('\n').trim();
      var valid = null;
      // VALID: may sit on the id line, the next line, or after the body text.
      for (var k = 0; k < cur.rawLines.length && !valid; k++) valid = parseValid(cur.rawLines[k]);
      body = body.replace(/^\s*VALID:.*$/gm, '')      // VALID on its own line
                 .replace(/\s{2,}VALID:.*$/gm, '')      // VALID trailing a text line
                 .replace(/[ \t]+$/gm, '')
                 .replace(/\n{2,}/g, '\n').trim();
      var rule = classify(body || cur.id);
      notams.push({
        id: cur.id, body: body, valid: valid,
        section: cur.section, sectionLabel: sectionLabel(cur.section),
        scope: scopeOf(cur.section),
        station: cur.station, category: cur.category,
        tier: rule.tier, tag: rule.he, tagId: rule.id
      });
      cur = null;
    }

    for (var n = 0; n < lines.length; n++) {
      var line = lines[n], t = line.trim();
      if (!t) { if (cur) cur.bodyLines.push(''); continue; }

      // ==== SECTION ====
      if (RE_EQ.test(t) && lines[n+1] && RE_EQ.test((lines[n+2]||'').trim())) {
        flush(); section = lines[n+1].trim(); station = null; category = null; n += 2; continue;
      }
      // STATION followed by ----
      if (RE_DASH.test((lines[n+1] || '').trim()) && RE_STATION.test(t) && !RE_ID.test(t)) {
        flush();
        var sm = RE_STATION.exec(t);
        var nm = (sm[3] || '').replace(/\s*[-\/]\s*(DETAILED INFO|ENR AP)\s*$/i, '').trim();
        station = { icao: sm[1], iata: sm[2] || null, name: nm };
        category = null; n += 1; continue;
      }
      if (RE_DASH.test(t) || RE_EQ.test(t)) continue;
      // +++ CATEGORY +++
      var pm = RE_PLUS.exec(t);
      if (pm) { flush(); category = pm[1].trim(); continue; }
      // NOTAM id
      var im = RE_ID.exec(t);
      if (im && section) {
        flush();
        cur = { id: im[1], section: section, station: station, category: category,
                rawLines: [t], bodyLines: [t.slice(im[0].length).trim()] };
        continue;
      }
      if (cur) { cur.rawLines.push(t); cur.bodyLines.push(t); }
    }
    flush();

    // The OFP reprints shared FIR/area blocks once per flight leg; keep one copy.
    var seenN = {}, uniq = [];
    notams.forEach(function (n) {
      var k = n.id + '|' + n.section + '|' + (n.station ? n.station.icao : '');
      if (seenN[k]) return;
      seenN[k] = true; uniq.push(n);
    });

    return { flights: flights, notams: uniq, error: null };
  }

  /* ---------- filtering ---------- */

  function filter(notams, opts) {
    // opts: { windowFrom, windowTo, newDays, now, showInfo, showFir }
    var newCutoff = opts.now ? new Date(opts.now.getTime() - opts.newDays * 864e5) : null;
    return notams.map(function (nt) {
      var o = Object.create(nt);
      // expired / not yet effective relative to the flight window
      o.outOfWindow = false;
      if (opts.windowFrom && opts.windowTo && nt.valid) {
        if (nt.valid.to && nt.valid.to < opts.windowFrom) o.outOfWindow = true;
        if (nt.valid.from && nt.valid.from > opts.windowTo) o.outOfWindow = true;
      }
      o.isNew = !!(newCutoff && nt.valid && nt.valid.from && nt.valid.from >= newCutoff);
      // scope gate: enroute airports show critical only; FIR blocks are off
      // unless asked for, and then still critical only.
      o.hiddenByScope =
        (nt.scope === 'secondary' && nt.tier > 1) ||
        (nt.scope === 'area' && (!opts.showFir || nt.tier > 1));
      o.visible = !o.outOfWindow && !o.hiddenByScope &&
                  (opts.showInfo || nt.tier <= 2);
      return o;
    });
  }

  root.NotamParser = { parse: parse, filter: filter, classify: classify,
                       parseValid: parseValid, parseFlights: parseFlights, RULES: RULES };
})(typeof window !== 'undefined' ? window : globalThis);
