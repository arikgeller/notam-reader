/* FP Reader — extraction of the non-NOTAM parts of the OFP.
   Pure functions, no DOM. Exposed as window.OfpData.
   Relies on pdfload.js having rebuilt the true column layout. */
(function (root) {
  'use strict';

  var MONTHS = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6,
                 AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };

  // OFP page furniture that must never land inside a parsed value
  var RE_NOISE = /^\s*(Page \d+ of \d+|AIZ\s+\d+\/\d{1,2}[A-Za-z]{3}\d{2}\/.*)\s*$/;
  function clean(text) {
    return text.split('\n').filter(function (l) { return !RE_NOISE.test(l); }).join('\n');
  }

  function num(x) { return x === undefined || x === null ? null : +String(x).replace(/[, ]/g, ''); }
  function grab(re, text, cast) {
    var m = re.exec(text);
    if (!m) return null;
    return cast ? cast(m[1]) : m[1].trim();
  }
  // "04.11" (hh.mm) -> minutes
  function hhdotmm(s) {
    var m = /^(\d{1,3})\.(\d{2})$/.exec(String(s).trim());
    return m ? +m[1] * 60 + +m[2] : null;
  }

  /* ---------------- page 1: dispatch release ---------------- */

  function parseRelease(text) {
    var r = {};
    var hdr = /^OFP\s+(\d+)\s+([A-Z]{2,3}\d+)\s+(\w+)\s+([+-][\d.]+)\s+([A-Z]{4})\/([A-Z]{3})\s*-\s*([A-Z]{4})\/([A-Z]{3})\s+([+-][\d.]+)/m.exec(text);
    if (hdr) {
      r.ofpNo = +hdr[1]; r.flight = hdr[2]; r.rules = hdr[3];
      // "AIZ271" -> operator AIZ, commercial number IZ271
      var fn = /^([A-Z]{2,3})(\d+)$/.exec(hdr[2]);
      r.operator = fn ? fn[1] : null;
      r.flightNo = fn ? (fn[1] === 'AIZ' ? 'IZ' : fn[1]) + fn[2] : hdr[2];
      r.dep = hdr[5]; r.depIata = hdr[6]; r.dest = hdr[7]; r.destIata = hdr[8];
      r.depUtcOffset = hdr[4]; r.destUtcOffset = hdr[9];
    }
    var calc = /CALC\s+(\d{4})Z\s+FOR\s+ETD\s+(\d{4})\s+(\d{1,2}[A-Z]{3}\d{2})/.exec(text);
    if (calc) { r.calcZ = calc[1]; r.etd = calc[2]; r.dateStr = calc[3]; }

    var ac = /^([A-Z0-9]+)\s*-\s*(4X[A-Z]{3})\s+PERF FACTOR\s+([+-][\d.]+)/m.exec(text);
    if (ac) { r.acType = ac[1]; r.reg = ac[2]; r.perfFactor = ac[3]; }

    r.std   = grab(/\bSTD\s+(\d{4})Z/, text);
    r.sta   = grab(/\bSTA\s+(\d{4})Z/, text);
    r.altn  = grab(/\bALTN\s+([A-Z]{4})\b/, text);
    r.altn2 = grab(/2ND ALTN\s+([A-Z]{4})\b/, text);
    r.crzFl = grab(/CRZ FL\s+(FL\d{3})/, text);
    r.ci    = grab(/SPEED\s+CI(\d+)/, text, num);
    r.isaDev= grab(/ISA DEV\s+([+-]\d+)/, text, num);
    r.tropo = grab(/TROPO\s+(\d+)/, text, num);
    r.avWind= grab(/AV WIND\s+([+-]\d+)/, text, num);
    r.avgFF = grab(/AVG FF KG\/H\s+(\d+)/, text, num);

    // weights: "DOW   52394" / "ZFW   71594 75600" (est, max)
    ['DOW','PYLD','ZFW','TOF','TOW','LDW','ULD'].forEach(function (k) {
      var m = new RegExp('^' + k + '\\s+(\\d[\\d,]*)(?:\\s+(\\d[\\d,]*))?', 'm').exec(text);
      if (m) r[k.toLowerCase()] = { est: num(m[1]), max: m[2] ? num(m[2]) : null };
    });

    // fuel block: "TRIP LEBL 11385 04.11 1802NM"
    r.fuel = {};
    var rows = [
      ['trip',     /^TRIP\s+([A-Z]{4})\s+(\d[\d,]*)\s+([\d.]+)(?:\s+(\d+)NM)?/m, true],
      ['contgcy',  /^RR\s*5%\s+(\d[\d,]*)\s+([\d.]+)/m, false],
      ['mlf',      /^MLF\s+(\d[\d,]*)\s+([\d.]+)/m, false],
      ['altn',     /^ALTN\s+([A-Z]{4})\s+(\d[\d,]*)\s+([\d.]+)(?:\s+(\d+)NM)?/m, true],
      ['required', /^REQUIRED\s+(\d[\d,]*)\s+([\d.]+)/m, false],
      ['extra',    /^EXTRA\s+(\d[\d,]*)\s+([\d.]+)/m, false],
      ['takeoff',  /^TAKEOFF\s+(\d[\d,]*)\s+([\d.]+)/m, false],
      ['taxi',     /^TAXI\s+(\d[\d,]*)\s+([\d.]+)/m, false],
      ['total',    /^TOTAL\s+(\d[\d,]*)\s+([\d.]+)/m, false]
    ];
    rows.forEach(function (row) {
      var m = row[1].exec(text);
      if (!m) return;
      r.fuel[row[0]] = row[2]
        ? { to: m[1], kg: num(m[2]), min: hhdotmm(m[3]), nm: m[4] ? num(m[4]) : null }
        : { kg: num(m[1]), min: hhdotmm(m[2]) };
    });
    r.minDivFuel = grab(/MIN DIV FUEL:\s*(\d[\d,]*)\s*KGS/, text, num);

    var route = /^OFP ROUTE:\s*\n([\s\S]*?)\n\s*[A-Z]{4} ATIS:/m.exec(text);
    if (route) r.route = route[1].split('\n').map(function (l) { return l.trim(); })
                                 .filter(Boolean).join(' ');

    // These sit on their own lines, and the trailing SIGNATURE:/TEL: fields
    // share the line, so stop at two spaces or at the next FIELD:.
    function field(name, t) {
      var m = new RegExp(name + ':\\s*(.+)$', 'm').exec(t);
      if (!m) return null;
      // the line also carries SIGNATURE:/TEL:, separated by a run of spaces
      return m[1].split(/\s{2,}/)[0].trim() || null;
    }
    r.pic = field('PILOT IN COMMAND', text);
    r.dispatcher = field('DISPATCHER', text);

    if (r.dateStr && r.std) {
      var d = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(r.dateStr);
      if (d) {
        var day = Date.UTC(2000 + +d[3], MONTHS[d[2]], +d[1]);
        r.offUtc = new Date(day + (+r.std.slice(0,2)) * 3600e3 + (+r.std.slice(2)) * 60e3);
        if (r.sta) {
          var on = new Date(day + (+r.sta.slice(0,2)) * 3600e3 + (+r.sta.slice(2)) * 60e3);
          if (on < r.offUtc) on = new Date(on.getTime() + 864e5);
          r.onUtc = on;
        }
      }
    }
    return r;
  }

  /* ---------------- page 3: operational impacts ---------------- */

  function parseImpacts(text) {
    var o = { mel: [], altnSummary: [] };
    o.tankering = /NO TANKERING RECOMMENDED/.test(text) ? 'none'
                : grab(/-+ TANKERING -+\s*\n([\s\S]*?)\n\s*-{6,}/, text);

    var alt = /DEST ALTN\s+DIST\s+TRK\s+FL\s+COMP\s+TIME\s+FUEL\s+ROUTING\s*\n([\s\S]*?)(?=\n\s*MEL\/CDL|\n\s*-{6,})/.exec(text);
    if (alt) {
      alt[1].split('\n').forEach(function (l) {
        var m = /^\s*([A-Z]{4})\/(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d{4})\s+(\d+)\s*(.*)$/.exec(l);
        if (m) o.altnSummary.push({ icao: m[1], rwy: m[2], distNm: num(m[3]), trk: num(m[4]),
          fl: num(m[5]), comp: m[6], timeMin: (+m[7].slice(0,2)) * 60 + (+m[7].slice(2)),
          fuelKg: num(m[8]), routing: m[9].trim() });
      });
    }
    var mel = /MEL\/CDL ITEMS\s+DESCRIPTION\s+REMARK\s*\n\s*-+\s+-+\s+-+\s*\n([\s\S]*?)$/.exec(text);
    if (mel) {
      var rows = mel[1].split('\n');
      for (var i = 0; i < rows.length; i++) {
        var l = rows[i].trim();
        if (!l) continue;
        if (/^-{6,}$/.test(l)) break;          // end of the table
        if (/^CLEARANCES\b/.test(l)) break;    // next block already started
        o.mel.push(l);
      }
    }
    return o;
  }

  /* ---------------- page 17: dispatch briefing info ---------------- */

  function parseBriefing(text) {
    var b = { notes: [], mel: [], enrAlt: [], crew: null, extraFuelReason: null, raw: null };
    var m = /D\s?I\s?S\s?P\s?A\s?T\s?C\s?H\s+B\s?R\s?I\s?E\s?F\s?I\s?N\s?G\s+I\s?N\s?F\s?O(.*)\n([\s\S]*)$/.exec(text);
    if (!m) return b;
    b.raw = (m[1] + '\n' + m[2]).replace(/\s+$/, '');

    var lines = b.raw.split('\n');
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var t = raw.trim();
      if (!t) continue;
      // an indented line continues the note above it
      if (cur && /^\s{2,}/.test(raw) && !/^[A-Z0-9 \/-]{2,20}[:-]/.test(t)) {
        cur.value += ' ' + t; continue;
      }
      // "MEL: ..." / "CREW: 3/7" / "CREW-2/5" / "LLBG-12 CLSD FOR T/O"
      var kv = /^([A-Z][A-Z0-9 \/]{1,18}?)\s*[:-]\s*(.*)$/.exec(t);
      if (kv && kv[2]) cur = { key: kv[1].trim(), value: kv[2].trim() };
      else cur = { key: null, value: t };
      b.notes.push(cur);
    }

    b.notes.forEach(function (n) {
      if (n.key === 'MEL' || n.key === 'CDL') b.mel.push(n.value);
      else if (n.key === 'CREW') b.crew = n.value;
      else if (n.key === 'ENR ALT') b.enrAlt = n.value.split(/[,\s]+/).filter(Boolean);
      else if (!n.key && /EXTRA FUEL/.test(n.value)) b.extraFuelReason = n.value;
      else if (n.key === 'EXTRA FUEL') b.extraFuelReason = n.key + ' ' + n.value;
    });
    // "MEL: NONE" is an explicit all-clear, not a defect
    b.melClear = b.mel.length === 1 && /^NONE\b/i.test(b.mel[0]);
    if (b.melClear) b.mel = [];
    // per-airport remarks, e.g. "LGAV: VOR/DME ATV U/S" or "LGTS-FISKA VOR/DME U/S"
    var NOT_ICAO = { CREW:1, MEL:1, CDL:1, INFO:1, NOTE:1, FUEL:1, ETOP:1, ETOPS:1, RVSM:1 };
    b.airportNotes = b.notes.filter(function (n) {
      return n.key && /^[A-Z]{4}$/.test(n.key) && !NOT_ICAO[n.key];
    }).map(function (n) { return { icao: n.key, text: n.value }; });
    return b;
  }

  /* ---------------- pages 18-20: weather ---------------- */

  var WX_ROLE = {
    'DEPARTURE AIRPORT': 'dep',
    'DESTINATION AIRPORT': 'dest',
    'DESTINATION ALTERNATE': 'altn',
    'ENROUTE AIRPORT(S)': 'enr',
    'TAKEOFF ALTERNATE': 'toaltn',
    'ADDITIONAL AIRPORT(S)': 'other'
  };

  function parseWeather(text) {
    var w = { stations: [], sigmets: [], issued: null };
    w.issued = grab(/LIDO\/WEATHER SERVICE\s+DATE\s*:\s*(\S+\s+TIME\s*:\s*[\d:]+\s*UTC)/, text);

    var lines = text.split('\n');
    var role = null, cur = null, sigBucket = null;

    function closeStation() { if (cur) { w.stations.push(cur); cur = null; } }

    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      if (/^AIRPORTLIST ENDED/.test(t)) { closeStation(); continue; }

      var rm = /^([A-Z][A-Z ()\/]+):$/.exec(t);
      if (rm && WX_ROLE[rm[1].trim()]) { closeStation(); role = WX_ROLE[rm[1].trim()]; sigBucket = null; continue; }

      if (/^(SIGMETs|Tropical Cyclone SIGMETs|Volcanic Ash SIGMETs)\s*:/.test(t)) {
        closeStation();
        sigBucket = /Tropical/.test(t) ? 'tc' : /Volcanic/.test(t) ? 'va' : 'ws';
        continue;
      }

      if (sigBucket) {
        if (/^No Wx data available/.test(t)) continue;
        var fir = /^([A-Z]{4})\s+([A-Z ]+FIR)$/.exec(t);
        if (fir) { w.sigmets.push({ kind: sigBucket, fir: fir[1], firName: fir[2], text: '' }); continue; }
        if (w.sigmets.length) {
          var last = w.sigmets[w.sigmets.length - 1];
          last.text = (last.text ? last.text + ' ' : '') + t;
        }
        continue;
      }

      var st = /^([A-Z]{4})\/([A-Z]{3})\s+(.*\S)$/.exec(t);
      if (st && role) { closeStation();
        cur = { icao: st[1], iata: st[2], name: st[3], role: role, metar: [], taf: [] };
        continue; }

      if (!cur) continue;
      // SA = METAR, SP = SPECI, FT/FC = TAF
      if (/^S[AP]\s/.test(t)) { cur.metar.push(t); continue; }
      if (/^F[TC]\s/.test(t)) { cur.taf.push(t); continue; }
      if (cur.taf.length) cur.taf[cur.taf.length - 1] += ' ' + t;
      else if (cur.metar.length) cur.metar[cur.metar.length - 1] += ' ' + t;
    }
    closeStation();
    return w;
  }

  /* ---------------- RAIM ---------------- */

  function parseRaim(text) {
    var rows = [], seen = {};
    var re = /^\s*(RNP\s+[\d.]+)\s+(\S+)\s+([\d.]+)\s+(.*\S)\s*$/gm, m;
    while ((m = re.exec(text))) {
      var key = m[1] + '|' + m[2] + '|' + m[3] + '|' + m[4];
      if (seen[key]) continue;
      seen[key] = true;
      rows.push({ precision: m[1], baroAided: m[2], maskAngle: num(m[3]), outage: m[4] });
    }
    return rows;
  }

  /* ---------------- main ---------------- */

  function parse(pagesRaw) {
    // Which leg a page belongs to, read from the page header before cleaning.
    var pageFlight = pagesRaw.map(function (p) {
      var m = /^[ \t]*AIZ\s+(\d+)\//m.exec(p);
      return m ? 'IZ' + m[1] : null;
    });
    var pages = pagesRaw.map(clean);
    var out = { legs: [], weather: null, weatherByLeg: {}, raim: [], warnings: [] };

    function legFor(i, fallback) {
      var fn = pageFlight[i];
      var hit = fn && out.legs.find(function (l) { return l.flightNo === fn; });
      return hit || fallback || out.legs[0] || null;
    }

    // A merged PDF holds several legs; each starts at a DISPATCH RELEASE page.
    pages.forEach(function (page) {
      if (!/^OFP\s+\d+\s+[A-Z]{2,3}\d+\s/m.test(page)) return;
      var rel = parseRelease(page);
      if (!rel.flight) return;
      if (out.legs.some(function (l) { return l.flightNo === rel.flightNo && l.dateStr === rel.dateStr; })) return;
      out.legs.push(rel);
    });

    pages.forEach(function (page, i) {
      if (/OPERATIONAL IMPACTS/.test(page)) {
        var leg = legFor(i);
        if (leg && !leg.impacts) leg.impacts = parseImpacts(page);
      }
      if (/D\s?I\s?S\s?P\s?A\s?T\s?C\s?H\s+B\s?R\s?I\s?E\s?F\s?I\s?N\s?G/.test(page)) {
        var leg2 = legFor(i);
        if (leg2 && !leg2.briefing) leg2.briefing = parseBriefing(page);
      }
      if (/RAIM FUEL ADVISORY|MASK ANGLE/.test(page)) {
        parseRaim(page).forEach(function (row) {
          var k = row.precision + '|' + row.baroAided + '|' + row.maskAngle + '|' + row.outage;
          if (!out.raim.some(function (x) {
            return x.precision + '|' + x.baroAided + '|' + x.maskAngle + '|' + x.outage === k;
          })) out.raim.push(row);
        });
      }
    });

    // One weather block per leg, each running to "AIRPORTLIST ENDED".
    for (var i = 0; i < pages.length; i++) {
      if (!/LIDO\/WEATHER SERVICE/.test(pages[i])) continue;
      var block = [], end = i;
      for (var j = i; j < pages.length; j++) {
        block.push(pages[j]); end = j;
        if (/AIRPORTLIST ENDED/.test(pages[j])) break;
      }
      var joined = block.join('\n');
      var wx = parseWeather(joined);
      // the block header names its own leg: "LLBG --> LEBL IZ271 / 13Aug2026"
      var hm = /^\s*[A-Z]{4}\s*-->\s*[A-Z]{4}\s+([A-Z]{2}\d+)\s*\//m.exec(joined);
      var fn = hm ? hm[1] : pageFlight[i];
      wx.flightNo = fn || null;
      if (fn) out.weatherByLeg[fn] = wx;
      if (!out.weather) out.weather = wx;
      i = end;
    }
    out.legs.forEach(function (l) {
      if (out.weatherByLeg[l.flightNo]) l.weather = out.weatherByLeg[l.flightNo];
    });

    if (!out.weather) out.warnings.push('לא נמצא מקטע מזג אוויר');
    if (!out.legs.length) out.warnings.push('לא זוהתה תוכנית טיסה (DISPATCH RELEASE)');
    out.legs.forEach(function (l) {
      if (!l.weather) out.warnings.push('אין מזג אוויר לטיסה ' + l.flightNo);
      if (!l.briefing) out.warnings.push('אין תדריך מוקדן לטיסה ' + l.flightNo);
    });
    return out;
  }

  root.OfpData = { parse: parse, parseRelease: parseRelease, parseImpacts: parseImpacts,
                   parseBriefing: parseBriefing, parseWeather: parseWeather };
})(typeof window !== 'undefined' ? window : globalThis);
