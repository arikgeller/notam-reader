/* FP Reader — METAR/TAF decoding, reporting only what is operationally notable.
   Notable = anything beyond CAVOK / 9999:
     wind (mean or gust) over 15 kt · visibility under 9999
     BKN/OVC with a base below 2000 ft · any CB or TCU · any precipitation
   Exposed as window.Wx. */
(function (root) {
  'use strict';

  var LIMITS = { windKt: 15, cloudFt: 2000, vis: 9999 };

  var PRECIP = { DZ:'drizzle', RA:'rain', SN:'snow', SG:'snow grains', PL:'ice pellets',
                 GR:'hail', GS:'small hail', UP:'unknown precipitation', IC:'ice crystals' };
  var OBSC   = { BR:'mist', FG:'fog', FU:'smoke', VA:'volcanic ash', DU:'dust',
                 SA:'sand', HZ:'haze', PY:'spray' };
  var OTHER  = { PO:'dust whirls', SQ:'squalls', FC:'funnel cloud', SS:'sandstorm', DS:'duststorm' };
  var DESC   = { MI:'shallow', BC:'patches', PR:'partial', DR:'drifting', BL:'blowing',
                 SH:'showers', TS:'thunderstorm', FZ:'freezing' };
  var AMOUNT = { FEW:'FEW', SCT:'SCT', BKN:'BKN', OVC:'OVC', VV:'VV' };

  var RE_WIND  = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/;
  var RE_CLOUD = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/{3})(CB|TCU)?$/;
  var RE_VIS   = /^(\d{4})$/;

  function decodeWeather(tok) {
    var m = /^([+-]|VC)?((?:MI|BC|PR|DR|BL|SH|TS|FZ)?)((?:DZ|RA|SN|SG|PL|GR|GS|UP|IC|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$/.exec(tok);
    if (!m) return null;
    var inten = m[1] === '+' ? 'heavy ' : m[1] === '-' ? 'light ' : m[1] === 'VC' ? 'in the vicinity: ' : '';
    var desc = m[2] ? DESC[m[2]] + ' ' : '';
    var parts = m[3].match(/.{2}/g) || [];
    var isPrecip = parts.some(function (p) { return PRECIP[p]; }) || m[2] === 'TS' || m[2] === 'SH';
    var words = parts.map(function (p) { return PRECIP[p] || OBSC[p] || OTHER[p] || p; });
    return { raw: tok, text: (inten + desc + words.join(' ')).trim(), precip: isPrecip,
             ts: m[2] === 'TS' || parts.indexOf('TS') >= 0 };
  }

  // one segment = the base conditions, or one BECMG/TEMPO/PROB/FM group
  function decodeSegment(tokens) {
    var out = { wind: null, vis: null, cavok: false, clouds: [], weather: [], nsc: false };
    tokens.forEach(function (t) {
      if (t === 'CAVOK') { out.cavok = true; return; }
      if (t === 'NSC' || t === 'NCD' || t === 'SKC' || t === 'CLR') { out.nsc = true; return; }
      var w = RE_WIND.exec(t);
      if (w) {
        out.wind = { dir: w[1], kt: +w[2], gust: w[3] ? +w[3] : null, vrb: w[1] === 'VRB' };
        return;
      }
      var c = RE_CLOUD.exec(t);
      if (c) {
        out.clouds.push({ amount: AMOUNT[c[1]], baseFt: c[2] === '///' ? null : +c[2] * 100,
                          type: c[3] || null, raw: t });
        return;
      }
      var v = RE_VIS.exec(t);
      if (v) { out.vis = +v[1]; return; }
      var wx = decodeWeather(t);
      if (wx) out.weather.push(wx);
    });
    return out;
  }

  // what in this segment is worth telling the pilot about
  function notable(seg) {
    var hits = [];
    if (seg.wind && (seg.wind.kt > LIMITS.windKt || (seg.wind.gust && seg.wind.gust > LIMITS.windKt))) {
      hits.push({ kind: 'wind',
        text: 'Wind ' + (seg.wind.vrb ? 'variable' : seg.wind.dir + '°') + ' ' + seg.wind.kt + ' kt' +
              (seg.wind.gust ? ', gusting ' + seg.wind.gust + ' kt' : '') });
    }
    if (seg.vis !== null && seg.vis < LIMITS.vis) {
      hits.push({ kind: 'vis', text: 'Visibility ' + seg.vis + ' m' });
    }
    seg.clouds.forEach(function (c) {
      var low = (c.amount === 'BKN' || c.amount === 'OVC' || c.amount === 'VV') &&
                c.baseFt !== null && c.baseFt < LIMITS.cloudFt;
      if (low) hits.push({ kind: 'cloud',
        text: c.amount + ' at ' + c.baseFt + ' ft' + (c.type ? ' (' + c.type + ')' : '') });
      if (c.type) hits.push({ kind: 'cb',
        text: (c.type === 'CB' ? 'Cumulonimbus' : 'Towering cumulus') + ' — ' +
              c.amount + ' at ' + (c.baseFt === null ? 'unknown level' : c.baseFt + ' ft') });
    });
    seg.weather.forEach(function (w) {
      if (w.precip || w.ts) hits.push({ kind: 'wx', text: w.text.charAt(0).toUpperCase() + w.text.slice(1) });
    });
    // de-duplicate (a low BKN CB produces both a cloud and a cb hit)
    var seen = {};
    return hits.filter(function (h) {
      if (seen[h.text]) return false; seen[h.text] = true; return true;
    });
  }

  function ddhh(s) { return s.slice(0, 2) + '/' + s.slice(2) + 'Z'; }

  /* ---------- METAR ---------- */

  function decodeMetar(raw) {
    var toks = raw.replace(/=+$/, '').split(/\s+/).filter(Boolean);
    // SA 131120 28011KT CAVOK 32/21 Q1008 NOSIG
    var time = toks[1] && /^\d{6}$/.test(toks[1]) ? toks[1] : null;
    var body = toks.slice(time ? 2 : 1);
    // stop at the trend part; those are handled as their own segment
    var cut = body.findIndex(function (t) { return t === 'NOSIG' || t === 'TEMPO' || t === 'BECMG'; });
    var main = cut >= 0 ? body.slice(0, cut) : body;
    var seg = decodeSegment(main);
    return { time: time, at: time ? time.slice(0, 2) + '/' + time.slice(2, 6) + 'Z' : null,
             seg: seg, hits: notable(seg), raw: raw };
  }

  /* ---------- TAF ---------- */

  var RE_CHANGE = /^(FM\d{6}|BECMG|TEMPO|PROB\d{2}|INTER)$/;

  function decodeTaf(raw) {
    var toks = raw.replace(/=+$/, '').split(/\s+/).filter(Boolean);
    var i = 0;
    if (/^F[TC]$/.test(toks[0])) i = 1;
    if (/^\d{6}$/.test(toks[i])) i++;                 // issue time
    var valid = null;
    if (/^\d{4}\/\d{4}$/.test(toks[i])) { valid = toks[i]; i++; }

    var segments = [], cur = { label: 'base', period: valid, tokens: [] };
    for (; i < toks.length; i++) {
      var t = toks[i];
      if (RE_CHANGE.test(t)) {
        segments.push(cur);
        var label = t, period = null;
        // PROB40 TEMPO 1322/1406  /  BECMG 1316/1318  /  FM131030
        if (/^PROB\d{2}$/.test(t) && toks[i+1] === 'TEMPO') { label = t + ' TEMPO'; i++; }
        if (/^\d{4}\/\d{4}$/.test(toks[i+1] || '')) { period = toks[i+1]; i++; }
        if (/^FM\d{6}$/.test(t)) period = 'from ' + t.slice(2, 4) + '/' + t.slice(4, 6) + 'Z';
        cur = { label: label, period: period, tokens: [] };
        continue;
      }
      if (/^(TX|TN)M?\d{2}\//.test(t)) continue;      // temperature forecast
      cur.tokens.push(t);
    }
    segments.push(cur);

    return { valid: valid,
      segments: segments.map(function (sg) {
        var d = decodeSegment(sg.tokens);
        return { label: sg.label, period: sg.period,
                 periodText: sg.period && /^\d{4}\/\d{4}$/.test(sg.period)
                   ? ddhh(sg.period.slice(0,4)) + '–' + ddhh(sg.period.slice(5))
                   : sg.period,
                 seg: d, hits: notable(d) };
      }).filter(function (sg) { return sg.hits.length || sg.label === 'base'; }),
      raw: raw };
  }

  /* ---------- per station ---------- */

  function station(st) {
    var metars = (st.metar || []).map(decodeMetar);
    var tafs = (st.taf || []).map(decodeTaf);
    var metar = metars[0] || null;                    // the most recent observation
    var tafHits = [];
    tafs.forEach(function (t) {
      t.segments.forEach(function (sg) {
        if (sg.hits.length) tafHits.push(sg);
      });
    });
    var clean = (!metar || !metar.hits.length) && !tafHits.length;
    return { icao: st.icao, iata: st.iata, name: st.name, role: st.role,
             metar: metar, tafs: tafs, tafHits: tafHits, clean: clean,
             rawMetar: (st.metar || []), rawTaf: (st.taf || []) };
  }

  /* ---------- SIGMET: strip the coordinate lists, keep the meaning ---------- */

  var SIG_PHEN = [
    [/\bEMBD\s+TS(GR)?\b/, 'Embedded thunderstorms'], [/\bOBSC\s+TS(GR)?\b/, 'Obscured thunderstorms'],
    [/\bFRQ\s+TS(GR)?\b/, 'Frequent thunderstorms'], [/\bSQL\s+TS(GR)?\b/, 'Squall line thunderstorms'],
    [/\bTSGR\b/, 'Thunderstorms with hail'], [/\bTS\b/, 'Thunderstorms'],
    [/\bSEV\s+TURB\b/, 'Severe turbulence'], [/\bSEV\s+ICE\b/, 'Severe icing'],
    [/\bSEV\s+MTW\b/, 'Severe mountain waves'], [/\bVA\s+ERUPTION\b/, 'Volcanic ash eruption'],
    [/\bVA\s+CLD\b/, 'Volcanic ash cloud'], [/\bVA\b/, 'Volcanic ash'],
    [/\bTC\b/, 'Tropical cyclone'], [/\bHVY\s+DS\b/, 'Heavy duststorm'],
    [/\bHVY\s+SS\b/, 'Heavy sandstorm'], [/\bRDOACT\s+CLD\b/, 'Radioactive cloud']
  ];

  function sigmetSummary(text) {
    var t = text.replace(/=+$/, '').trim();
    var out = [];
    for (var i = 0; i < SIG_PHEN.length; i++) {
      if (SIG_PHEN[i][0].test(t)) { out.push(SIG_PHEN[i][1]); break; }
    }
    var mt = /\bMT\s+([A-Z]+)/.exec(t);
    if (mt) out.push('(' + mt[1].charAt(0) + mt[1].slice(1).toLowerCase() + ')');

    var valid = /VALID\s+(\d{6})\/(\d{6})/.exec(t);
    if (valid) out.push('valid ' + valid[1].slice(0,2) + '/' + valid[1].slice(2,6) + 'Z–' +
                        valid[2].slice(0,2) + '/' + valid[2].slice(2,6) + 'Z');

    var lvl = /\b(SFC\/FL\d{3}|FL\d{3}\/\d{3}|FL\d{3})\b/.exec(t);
    if (lvl) out.push(lvl[1]);
    var top = /\bTOP\s+(FL\d{3})/.exec(t);
    if (top) out.push('top ' + top[1]);

    var mov = /\bMOV\s+([NSEW]{1,2})\s*(\d{1,3})?KT?\b/.exec(t);
    if (mov) out.push('moving ' + mov[1] + (mov[2] ? ' ' + mov[2] + ' kt' : ''));
    else if (/\bSTNR\b/.test(t)) out.push('stationary');

    if (/\bINTSF\b/.test(t)) out.push('intensifying');
    else if (/\bWKN\b/.test(t)) out.push('weakening');
    else if (/\bNC\b/.test(t)) out.push('no change');

    if (!out.length) return t.slice(0, 150);
    return out.join(' · ');
  }

  root.Wx = { station: station, sigmetSummary: sigmetSummary, decodeMetar: decodeMetar, decodeTaf: decodeTaf,
              decodeSegment: decodeSegment, notable: notable, LIMITS: LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
