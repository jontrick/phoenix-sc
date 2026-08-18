// BLAB ARCHIVE — dead code removed from index.html
// Reference only — not loaded by the app.
//
// v4.9.108 removals:
//   blabBuildExCard         — old overlay card builder (dead path)
//   blabLaunchExercise      — old exercise launcher (dead path)
//   blabRenderPct           — old percentage sets renderer
//   _blabPctDone            — completion handler for blabRenderPct
//   blabRenderSuper         — old superset renderer
//   _blabSuperA / _blabSuperB — superset A/B handlers
//   blabRenderMaxReps       — old max reps renderer
//   _blabMrDone             — completion handler for blabRenderMaxReps
//   blabRenderStd           — old standard sets renderer
//
// v4.9.119 removals:
//   ?debug=1 panel          — in-browser debug overlay (guarded IIFE, head of index.html)
//
// Live code that looks similar but IS still in use:
//   blabRunWorkout          — timer engine for complex/afap/total_rep/run blocks
//   _blabWoState            — runner state object
//   blab-workout-overlay    — HTML overlay element
//   blabRenderAfap          — AFAP/complex renderer (live)
//   blabRenderTR            — total rep goal renderer (live)
//   blabRenderRun           — 1.6km run renderer (live)

// v4.9.146 removals:
//   _phxRenderWeekScheduleTile — Today screen "This Week's Schedule" tile body.
//     DEAD since the tile was dropped from screen-today: its target element
//     #card-this-week-body does not exist in the DOM and nothing called the function.
//     Superseded by the BLAB Training Calendar (screen-blab-calendar) plus the
//     existing _renderTodayRemainingRow, which are the live Today surfaces.
//     Full body preserved below in case the tile is ever reinstated — note it had
//     been wired to read the BLAB calendar (blabCalUpcoming) before removal.
//
// Live code that looks similar but IS still in use:
//   _phxRenderWeekPlan      — screen-week-plan renderer (live)
//   openWeekPlan            — opens screen-week-plan (live, called from Today tiles)
//   _renderTodayRemainingRow — Today screen remaining-sessions row (live)

/* ── _phxRenderWeekScheduleTile (removed v4.9.146) ──────────────────────────
// v4.7.59 — Today screen "This Week's Schedule" tile body. Shows the next 2 upcoming
// sessions (today onward), merging programme + athlete-added customs. Tapping the tile
// itself opens the full week plan.
window._phxRenderWeekScheduleTile = function(){
  var bodyEl = document.getElementById('card-this-week-body');
  if(!bodyEl) return;
  // v4.9.141: when BLAB is active its training calendar owns the week — render the
  // scheduled BLAB sessions ahead of (and instead of) the AI programme week.
  var _calUp = (typeof window.blabCalUpcoming === 'function' && typeof blabIsActive === 'function' && blabIsActive())
    ? window.blabCalUpcoming(2) : [];
  if(_calUp.length){
    bodyEl.innerHTML = _calUp.map(function(e, i){
      var _d = _blabCalParse(e.scheduledDate);
      var _dayShort = _d ? _BLAB_CAL_DAYS[(_d.getDay()+6)%7].substring(0,3).toUpperCase() : '';
      var _rule = (i === _calUp.length-1) ? '' : 'border-bottom:1px solid rgba(255,255,255,0.08);';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;'+_rule+'">'+
        '<div style="font-family:var(--font-d);font-size:12px;letter-spacing:1.5px;color:rgba(255,255,255,0.95);text-transform:uppercase;">'+
          _dayShort+' · '+(_BLAB_DAY_LABELS[e.blabDay]||('Day '+e.blabDay))+'</div>'+
        '<div style="font-family:var(--font-d);font-size:11px;letter-spacing:2px;color:var(--gold);">W'+e.blabWeek+' D'+e.blabDay+'</div>'+
      '</div>';
    }).join('');
    return;
  }
  // v4.8.3: show a clear CTA when no programme exists instead of leaving "Loading..."
  var prog = athlete && athlete.aiProgramme;
  if(!prog){
    bodyEl.innerHTML = '<div style="font-size:13px;color:var(--text2);line-height:1.5;">No programme yet — complete the questionnaire to get started.</div>';
    return;
  }
  // v4.8.4: check if today is before the week start (i.e. we're in the gap between
  // check-in day and the new week kicking off). Show a "starts [day]" message.
  var start = _phxWeekStartDate();
  var todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
  if(start > todayMidnight){
    var daysUntil = Math.round((start - todayMidnight) / 86400000);
    var startDayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][start.getDay()];
    var untilStr = daysUntil === 1 ? 'tomorrow' : 'in ' + daysUntil + ' days';
    bodyEl.innerHTML =
      '<div style="font-family:var(--font-d);font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);margin-bottom:6px;">Week ' +
      ((athlete && athlete.currentWeek) || 1) + ' starts ' + untilStr + '</div>' +
      '<div style="font-size:12px;color:var(--text2);line-height:1.5;">Your ' + startDayName + ' session is ready. Rest up.</div>';
    return;
  }
  var weekStartISO = start.getFullYear()+'-'+String(start.getMonth()+1).padStart(2,'0')+'-'+String(start.getDate()).padStart(2,'0');
  var byDay = {Monday:[],Tuesday:[],Wednesday:[],Thursday:[],Friday:[],Saturday:[],Sunday:[]};
  if(prog && prog.week && Array.isArray(prog.week.sessions)){
    prog.week.sessions.forEach(function(s){
      var dayKey = String(s.day||'').replace(/\s+(am|pm).*$/i,'').trim();
      var canon = dayKey.charAt(0).toUpperCase() + dayKey.slice(1).toLowerCase();
      if(!byDay[canon]) return;
      if(s.am_session || s.pm_session){
        if(s.am_session) byDay[canon].push(Object.assign({}, s.am_session, {_slot:'am'}));
        if(s.pm_session) byDay[canon].push(Object.assign({}, s.pm_session, {_slot:'pm'}));
      } else {
        byDay[canon].push(s);
      }
    });
  }
  var customByDay = _phxLoadWeekCustomSessions(weekStartISO);
  Object.keys(customByDay).forEach(function(dayName){
    if(!byDay[dayName]) return;
    (customByDay[dayName]||[]).forEach(function(c){
      byDay[dayName].push({session_type: c.sessionType, _slot: c.slot});
    });
  });
  var orderedDays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  var todayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
  var startIdx = orderedDays.indexOf(todayName);
  if(startIdx < 0) startIdx = 0;
  var upcoming = [];
  for(var i=0; i<orderedDays.length && upcoming.length<2; i++){
    var d = orderedDays[(startIdx + i) % orderedDays.length];
    var amList = byDay[d].filter(function(s){ return (String(s._slot||'').toLowerCase() !== 'pm'); });
    var pmList = byDay[d].filter(function(s){ return (String(s._slot||'').toLowerCase() === 'pm'); });
    amList.concat(pmList).forEach(function(s){
      if(upcoming.length<2) upcoming.push({day:d, sess:s, slot:(String(s._slot||'').toLowerCase()==='pm'?'pm':'am')});
    });
  }
  if(!upcoming.length){
    bodyEl.innerHTML = '<div style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.5;">No sessions scheduled this week — tap to plan your week.</div>';
    return;
  }
  // v4.7.60: figure out current programme week so we can flag customised sessions.
  var weekN = (athlete && athlete.currentWeek) || (typeof progWeek==='function' ? progWeek() : 1);
  bodyEl.innerHTML = upcoming.map(function(u, idx){
    var dayShort = u.day.substring(0,3).toUpperCase();
    var slot = u.slot.toUpperCase();
    var type = String(u.sess.session_type || 'Training');
    var borderRule = (idx === upcoming.length-1) ? '' : 'border-bottom:1px solid rgba(255,255,255,0.08);';
    // v4.7.60: "Customised" badge when this session has stored swaps/supersets.
    var sidForBadge = (typeof _phxSessionId === 'function') ? _phxSessionId(u.sess) : '';
    var hasCust = sidForBadge && (typeof _phxHasCustomisations === 'function') && _phxHasCustomisations(sidForBadge, weekN);
    var customBadge = hasCust
      ? '<span style="display:inline-block;margin-left:6px;font-family:var(--font-d);font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);padding:1px 5px;border-radius:3px;">Customised</span>'
      : '';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;'+borderRule+'">'+
             '<div style="font-family:var(--font-d);font-size:12px;letter-spacing:1.5px;color:rgba(255,255,255,0.95);text-transform:uppercase;">'+dayShort+' · '+type+customBadge+'</div>'+
             '<div style="font-family:var(--font-d);font-size:11px;letter-spacing:2px;color:var(--gold);">'+slot+'</div>'+
           '</div>';
  }).join('');
};
*/
