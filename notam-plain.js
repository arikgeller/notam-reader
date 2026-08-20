/* FP Reader — turn NOTAM shorthand into plain English.
   Rule-based expansion (the app is offline): a phrase pass first, then a
   word-level dictionary, then light clean-up. The raw text always stays
   available behind a button — this is a reading aid, not a replacement.
   Exposed as window.NotamPlain. */
(function (root) {
  'use strict';

  // multi-word forms first, so they win over the single-word dictionary
  var PHRASES = [
    [/\bOCA\s*\(H\)/g,                 'obstacle clearance altitude'],
    [/\bOCA\b/g,                      'obstacle clearance altitude'],
    [/\bU\/S\b/g,                     'out of service'],
    [/\bOUT OF USABLE LIMITS\b/g,     'outside its usable limits'],
    [/\bNOT AVBL\b/g,                 'not available'],
    [/\bNOT AVAILABLE\b/g,            'not available'],
    [/\bWORK IN PROGRESS\b/g,         'work in progress'],
    [/\bMNM CMB GRADIENT\b/g,         'minimum climb gradient'],
    [/\bCMB GRADIENT\b/g,             'climb gradient'],
    [/\bINTERSECTION TAKE ?OFF\b/g,   'intersection take-off'],
    [/\bMARKED AND LGTD\b/g,          'marked and lit'],
    [/\bTWY LINK\b/g,                 'taxiway link'],
    [/\bEXERCISE CAUTION\b/g,         'exercise caution'],
    [/\bPILOTS TO\b/g,                'pilots to'],
    [/\bREF AIP\b/g,                  'see AIP'],
    [/\bAIP SUPPLEMENT\b/g,           'AIP supplement'],
    [/\bDUE TO\b/g,                   'due to'],
    [/\bIN THE VICINITY OF\b/g,       'near'],
    [/\bAT OR BELOW\b/g,              'at or below'],
    [/\bAT OR ABOVE\b/g,              'at or above'],
    [/\bSHALL BE\b/g,                 'shall be'],
    [/\bWILL TAKE PLACE\b/g,          'will take place'],
    [/\bIS ESTABLISHED\b/g,           'is established'],
    [/\bNO LONGER\b/g,                'no longer'],
    [/\bAS PER\b/g,                   'as per'],
    [/\bAS FLW\b/g,                   'as follows'],
    [/\bIF UNABLE ADZ ATC\b/g,        'if unable, advise ATC'],
    [/\bFOR ALL CAT\b/g,              'for all categories'],
    [/\bCODE LETTER\b/g,              'code letter']
  ];

  var WORDS = {
    ACFT:'aircraft', AD:'aerodrome', ADZ:'advise', AFT:'aft', AGL:'above ground level',
    ALS:'approach lighting system', ALT:'altitude', AMSL:'above mean sea level',
    APCH:'approach', APRX:'approximately', APN:'apron', ARR:'arrivals', ATC:'ATC',
    AVBL:'available', AWY:'airway', BCN:'beacon', BLW:'below', BTN:'between',
    CAT:'category', CB:'cumulonimbus', CLBR:'calibration', CLSD:'closed', CNL:'cancelled',
    CHG:'changed', CHANGED:'changed', CTC:'contact', CTL:'control', CTR:'control zone', DEG:'degrees', DEP:'departures',
    DIST:'distance', DME:'DME', ELEV:'elevation', EQPT:'equipment', EST:'estimated',
    EXC:'except', FIR:'FIR', FLT:'flight', FM:'from', FREQ:'frequency', FT:'ft',
    GND:'ground', HGT:'height', HR:'hours', ILS:'ILS', INBD:'inbound', INFO:'information',
    INTL:'international', KHZ:'kHz', KT:'kt', LDG:'landing', LGT:'light', LGTD:'lit',
    LOC:'localizer', MAINT:'maintenance', MAX:'maximum', MHZ:'MHz', MIL:'military',
    MIN:'minutes', MNM:'minimum', MOV:'moving', NDB:'NDB', NM:'NM', OBST:'obstacle',
    OPR:'operating', OPS:'operations', PAX:'passengers', PJE:'parachute jumping',
    PROC:'procedure', PSN:'position', PRKG:'parking', RDO:'radio', REF:'reference',
    RMK:'remark', RTE:'route', RVR:'RVR', RWY:'runway', RNWY:'runway', SFC:'surface',
    SKED:'scheduled', STN:'station', SUSP:'suspended', TAR:'terminal area radar',
    TEMPO:'temporarily', TFC:'traffic', THR:'threshold', TKOF:'take-off', TMA:'TMA',
    TWR:'tower', TWY:'taxiway', UAV:'unmanned aircraft', UFN:'until further notice',
    UNL:'unlimited', VOR:'VOR', WEF:'with effect from', WI:'within', WIP:'work in progress',
    WX:'weather', SR:'sunrise', SS:'sunset', DLY:'daily', EXC1:'except'
  };

  // headline templates by classification, so the first line reads like a summary
  var HEAD = {
    minima:    function (m) { return 'Approach minima changed' + (m.rwy ? ' — runway ' + m.rwy : ''); },
    rwy_clsd:  function (m) { return 'Runway closed' + (m.rwy ? ' — ' + m.rwy : ''); },
    twy_clsd:  function (m) { return 'Taxiway closed' + (m.twy ? ' — ' + m.twy : ''); },
    ils:       function (m) { return 'ILS unavailable or degraded' + (m.rwy ? ' — runway ' + m.rwy : ''); },
    papi:      function (m) { return 'PAPI out of service' + (m.rwy ? ' — runway ' + m.rwy : ''); },
    apch_lgt:  function ()  { return 'Approach lighting affected'; },
    cat:       function ()  { return 'Approach category / lighting status changed'; },
    gradient:  function ()  { return 'Minimum climb gradient required'; },
    alt_rstr:  function ()  { return 'Level restriction'; },
    intx_to:   function ()  { return 'Intersection take-off not available'; },
    proc_susp: function ()  { return 'Approach procedure suspended'; },
    closed_as: function ()  { return 'Airspace closed or entry prohibited'; },
    military:  function ()  { return 'Military activity / navigation warning'; },
    gps:       function ()  { return 'GPS / GNSS interference expected'; },
    navaid:    function ()  { return 'Navigation aid out of service'; },
    radar:     function ()  { return 'Radar out of service'; },
    obstacle:  function ()  { return 'Obstacle or work in progress'; },
    birds:     function ()  { return 'Bird activity'; },
    stands:    function ()  { return 'Stand / apron change'; },
    acdm:      function ()  { return 'Local procedure in force'; },
    pavement:  function ()  { return 'Pavement strength data'; },
    fire:      function ()  { return 'Fire reporting / firefighting activity'; }
  };

  function facts(body) {
    var f = {};
    var r = /\bRWY\s+(\d{2}[LRC]?(?:\/\d{2}[LRC]?)?)/.exec(body);
    if (r) f.rwy = r[1];
    var t = /\bTWY\s+(?:LINK\s+)?([A-Z]\d*(?:\d)?)/.exec(body);
    if (t) f.twy = t[1];
    return f;
  }

  // abbreviations and identifiers that must stay in capitals
  var KEEP = {};
  ('ILS LOC LLZ DME VOR NDB TACAN VORTAC PAPI VASI APAPI CAT SID STAR RNP RNAV LPV LNAV VNAV ' +
   'GPS GNSS RAIM ATC ATIS AIP NOTAM FIR TMA CTR UIR ACC MSA RVR CB TCU TS UTC MHZ KHZ NM FT KT ' +
   'AGL AMSL SFC FL WIP MEL CDL APU PCN PCR ETOPS EDTO SAR VFR IFR LVO TOBT TSAT ASAT UAV PSR ' +
   'MSSR SSR TAR ADC IAC ENR AD2 QNH QFE ATS AFIS AWY H24 HJ HN EST PERM UFN')
    .split(' ').forEach(function (w) { KEEP[w] = 1; });

  // Expansion leaves ordinary English words shouting in capitals; drop them to
  // lower case unless they are an identifier or a kept abbreviation.
  function deshout(s, icaos) {
    return s.replace(/\b[A-Z][A-Z\-\/()]{1,}\b/g, function (w) {
      var core = w.replace(/[^A-Z]/g, '');
      if (KEEP[w] || KEEP[core]) return w;
      if (icaos && icaos[core]) return w;
      if (core.length <= 1) return w;            // runway / taxiway designators
      return w.toLowerCase();
    });
  }

  function expand(text, icaos) {
    var s = ' ' + text.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() + ' ';
    PHRASES.forEach(function (p) { s = s.replace(p[0], p[1]); });
    s = s.replace(/\b[A-Z][A-Z0-9\/]{1,6}\b/g, function (w) {
      // leave identifiers, frequencies and coordinates alone
      if (/\d/.test(w) && !WORDS[w]) return w;
      return WORDS[w] !== undefined ? WORDS[w] : w;
    });
    s = deshout(s, icaos);
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  function sentenceCase(s) {
    return s.replace(/([.!?]\s+|^)([a-z])/g, function (_, p, c) { return p + c.toUpperCase(); });
  }

  // plain(notam) -> { headline, body }
  function plain(n, icaos) {
    var f = facts(n.body);
    var head = HEAD[n.tagId] ? HEAD[n.tagId](f) : null;
    var text = sentenceCase(expand(n.body, icaos));
    if (text.length > 320) {
      var cut = text.slice(0, 320);
      var stop = cut.lastIndexOf('. ');
      text = (stop > 140 ? cut.slice(0, stop + 1) : cut) + ' …';
    }
    return { headline: head, body: text };
  }

  root.NotamPlain = { plain: plain, expand: expand, WORDS: WORDS, PHRASES: PHRASES };
})(typeof window !== 'undefined' ? window : globalThis);
