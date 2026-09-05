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

// ==========================================================================
// v4.9.178 removals — legacy session-opening chain, unreachable.
//
// Verified dead before removal: renderToday and renderWeekSched are each referenced
// ONLY by their own definition (never called), and every opener below is reached only
// through them. openCoreSession's single call site at index.html:31377 sits behind
// generateDailyCore(), which exists and returns first. Between them these carried NINE
// native confirm() dialogs — dead branches on iOS (a suppressed confirm returns false),
// so 'Mark session as complete?' could never have worked from these paths anyway.
//
//   renderToday           — legacy Today renderer — never called; renderTodayScreen is live. Contained makeTile.
//   renderWeekSched       — legacy week-schedule renderer — never called. Contained renderSlot.
//   openSession           — legacy generic session opener, reached only from renderToday/makeTile.
//   openLowerSqSession    — legacy lower-squat opener, reached only from renderWeekSched/renderSlot.
//   openCoreSession       — legacy core opener; its one call site (:31377) is shadowed by generateDailyCore, which returns first.
//   openKarenSession      — legacy Karen WOD opener, reached only from the legacy tiles.
//
// NOTE ON KAREN: openKarenSession was the app's ONLY implementation of the Karen
// benchmark WOD — it is not in PHX_LIB. Its two dispatch sites (index.html karen-core
// branches) lived inside makeTile and renderSlot, i.e. inside the dead renderers above,
// so the WOD has been unreachable for some time. A harness assertion pinning its
// count-in gate was passing the whole while — green, but certifying dead code. That
// assertion is removed with this change. If Karen is wanted again it should be added to
// PHX_LIB as a proper library session rather than restored from here.
// ==========================================================================

// ---- renderToday -------------------------------------------------------
/*
function renderToday(){
  if(!athlete) return;
  var w=progWeek();
  currentProgWeek=w;
  var now=new Date();
  var dayIdx=(now.getDay()+6)%7;
  var sched=buildWeek(w);
  var day=sched[dayIdx];
  document.getElementById('t-dayname').textContent=DAYS[dayIdx];
  document.getElementById('t-datestr').textContent=now.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'});
  document.getElementById('t-weekbadge').textContent='Week '+w+(isDeload(w)?' - Deload':'');
  personaliseToday();
  var container=document.getElementById('t-tiles');
  container.innerHTML='';
  var allRest=day.am.category==='rest'&&day.pm.category==='rest';
  [{label:'AM',s:day.am},{label:'PM',s:day.pm}].forEach(function(slot){
    container.appendChild(makeTile(slot.label,slot.s));
  });
  // Rest day nudge card
  if(allRest){
    var nudge=document.createElement('div');
    nudge.style.cssText='background:var(--bg3);border:1px solid var(--border2);border-left:3px solid var(--blue);border-radius:var(--radius);padding:16px;margin-top:4px;';
    nudge.innerHTML=
      '<div style="font-family:var(--font-d);font-size:10px;letter-spacing:3px;color:var(--blue);text-transform:uppercase;margin-bottom:6px;">Rest day</div>'+
      '<div style="font-family:var(--font-d);font-size:18px;font-weight:700;text-transform:uppercase;color:var(--text);margin-bottom:8px;">Fancy a walk?</div>'+
      '<div style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:12px;">Recovery is part of the programme. A walk, some core work, or full rest — your call.</div>'+
      '<div style="display:flex;gap:8px;">'+
        '<div onclick="openWalkLog()" style="flex:1;background:var(--bg);border:1px solid var(--border2);border-radius:var(--radius);padding:10px;text-align:center;cursor:pointer;font-family:var(--font-d);font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text2);">Walk / Run</div>'+
        '<div onclick="openCoreModal()" style="flex:1;background:var(--bg);border:1px solid var(--border2);border-radius:var(--radius);padding:10px;text-align:center;cursor:pointer;font-family:var(--font-d);font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text2);">Core</div>'+
        '<div style="flex:1;background:var(--bg);border:1px solid var(--border2);border-radius:var(--radius);padding:10px;text-align:center;font-family:var(--font-d);font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text3);">Full Rest</div>'+
      '</div>';
    container.appendChild(nudge);
  }
}
*/

// ---- renderWeekSched ---------------------------------------------------
/*
function renderWeekSched(w){
  var dl=isDeload(w);
  document.getElementById('wk-num').innerHTML='Week '+w+(dl?' <span class="deload-badge">Deload</span>':'');
  document.getElementById('wk-phase').textContent=getPhase(w);
  var sched=buildWeek(w);
  var container=document.getElementById('week-sched');
  container.innerHTML='';
  sched.forEach(function(day,i){
    var block=document.createElement('div');
    block.className='day-block';
    var header=document.createElement('div');
    header.className='day-header';
    header.innerHTML='<div class="day-name">'+DAYS[i]+'</div>';
    var slots=document.createElement('div');
    slots.className='day-slots';
    slots.appendChild(renderSlot('AM',day.am));
    slots.appendChild(renderSlot('PM',day.pm));
    block.appendChild(header);
    block.appendChild(slots);
    container.appendChild(block);
  });
}
*/

// ---- openSession -------------------------------------------------------
/*
function openSession(sessionId){
  // Reset warm-up state
  clearInterval(wuTimerInterval);
  wuTimerSecs=0;wuTimerRunning=false;wuSelectedCardio='row';
  if(sessionId==='me-lower-sq'){openLowerSqSession();return;}
  var body=document.getElementById('session-body-content');body.innerHTML='';
  var hero=document.createElement('div');hero.className='session-hero';
  hero.innerHTML='<div class="sh-tag">Monday AM &middot; Lifting</div><div class="sh-name">ME Upper Pull</div><div class="sh-detail">Wide Grip Chins &middot; Dips &middot; Rows &middot; Shoulders &middot; Arms</div>'+(athlete&&athlete.notes?'<div class="sh-notes">Note: '+athlete.notes+'</div>':'');
  body.appendChild(hero);
  buildWarmupBlocks('upper-pull',body);
  ME_PULL_STRUCTURE.forEach(function(ex,i){
    body.appendChild(renderExBlock(ex));
    if(i<ME_PULL_STRUCTURE.length-1){
      var nextEx=ME_PULL_STRUCTURE[i+1];
      var upNext=document.createElement('div');
      upNext.style.cssText='padding:6px 20px;font-family:var(--font-d);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);background:var(--bg2);border-bottom:1px solid var(--border);';
      upNext.innerHTML='Up next: <span style="color:var(--text2);">'+(nextEx.name||'Select exercise')+'</span>';
      body.appendChild(upNext);
    }
  });
  setTimeout(populatePullLoads,50);
  var notesBlock=document.createElement('div');notesBlock.className='session-notes-block';
  notesBlock.innerHTML='<div class="section-hdr">Session Notes</div><textarea class="session-notes-input" id="session-notes-field" rows="3" placeholder="How did it feel? Any modifications..."></textarea>';
  body.appendChild(notesBlock);
  var finBtn=document.createElement('button');finBtn.className='finish-btn';finBtn.textContent='Complete Session \u2713';
  finBtn.addEventListener('click',function(){
    if(confirm('Mark session as complete?')){
      logLiftSession('me-pull');
      navTo('today');
    }
  });
  body.appendChild(finBtn);
  document.getElementById('session-back-btn').onclick=function(){navTo('today');};
  supabaseStartSession('strength','ME Upper Pull','me-pull');
  showScreen('screen-session');
}
*/

// ---- openLowerSqSession ------------------------------------------------
/*
function openLowerSqSession() {
  clearInterval(wuTimerInterval);wuTimerSecs=0;wuTimerRunning=false;wuSelectedCardio='row';
  var body=document.getElementById('session-body-content');body.innerHTML='';
  var hero=document.createElement('div');hero.className='session-hero';
  hero.innerHTML='<div class="sh-tag">Tuesday AM - Lifting</div><div class="sh-name">ME Lower</div><div class="sh-detail">Back Squat / Pause Squat / Unilateral / Hamstrings / DE</div>'+(athlete&&athlete.notes?'<div class="sh-notes">Note: '+athlete.notes+'</div>':'');
  body.appendChild(hero);
  buildWarmupBlocks('lower-sq',body);
  ME_LOWER_SQ_STRUCTURE.forEach(function(ex){body.appendChild(renderExBlock(ex));});
  setTimeout(populateSqLoads,50);
  var notesBlock=document.createElement('div');notesBlock.className='session-notes-block';
  notesBlock.innerHTML='<div class="section-hdr">Session Notes</div><textarea class="session-notes-input" id="session-notes-field" rows="3" placeholder="How did it feel? PBs? Modifications..."></textarea>';
  body.appendChild(notesBlock);
  var finBtn=document.createElement('button');finBtn.className='finish-btn';finBtn.textContent='Complete Session';
  finBtn.addEventListener('click',function(){
    if(confirm('Mark session as complete?')){
      logLiftSession(sessionId);
      navTo('today');
    }
  });
  body.appendChild(finBtn);
  document.getElementById('session-back-btn').onclick=function(){navTo('today');};
  supabaseStartSession('strength','ME Lower','me-lower-sq');
  showScreen('screen-session');
}
*/

// ---- openCoreSession ---------------------------------------------------
/*
function openCoreSession(coreNum) {
  clearInterval(wuTimerInterval);wuTimerSecs=0;wuTimerRunning=false;wuSelectedCardio='row';
  coreNum = coreNum || 1;
  var coreData = CORE_SESSIONS[coreNum-1];
  var body = document.getElementById('session-body-content');
  body.innerHTML = '';

  // Hero
  var hero = document.createElement('div');
  hero.className = 'session-hero';
  hero.innerHTML = '<div class="sh-tag">Core Session - 20 min AMRAP</div>' +
    '<div class="sh-name">Core ' + coreNum + '</div>' +
    '<div class="sh-detail">Complete as many rounds as possible</div>';
  body.appendChild(hero);
  buildWarmupBlocks('core',body);

  // Timer block
  var timerBlock = document.createElement('div');
  timerBlock.style.cssText = 'padding:24px 20px;text-align:center;border-bottom:1px solid var(--border)';
  timerBlock.innerHTML =
    '<div style="font-family:var(--font-d);font-size:11px;letter-spacing:4px;color:var(--gold);text-transform:uppercase;margin-bottom:8px">AMRAP Timer</div>' +
    '<div id="core-timer-display" style="font-family:var(--font-d);font-size:80px;font-weight:900;color:var(--text);line-height:1">20:00</div>' +
    '<div style="display:flex;gap:10px;margin-top:16px;">' +
    '<button onclick="startCoreTimer()" style="flex:1;background:var(--gold);color:#000;font-family:var(--font-d);font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px;border:none;border-radius:4px;cursor:pointer;">Start</button>' +
    '<button onclick="stopCoreTimer()" style="flex:1;background:var(--bg3);color:var(--text2);font-family:var(--font-d);font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px;border:1px solid var(--border2);border-radius:4px;cursor:pointer;">Reset</button>' +
    '</div>';
  body.appendChild(timerBlock);

  // Core picker button
  var pickerBtn = document.createElement('div');
  pickerBtn.style.cssText = 'padding:12px 20px;border-bottom:1px solid var(--border)';
  pickerBtn.innerHTML = '<button onclick="openCoreModal()" style="width:100%;background:var(--bg3);border:1px dashed var(--border2);color:var(--text2);font-family:var(--font-d);font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;padding:12px;border-radius:4px;cursor:pointer;">Switch Core Session</button>';
  body.appendChild(pickerBtn);

  // Exercise cards
  var exSection = document.createElement('div');
  exSection.style.cssText = 'padding:20px';
  exSection.innerHTML = '<div style="font-family:var(--font-d);font-size:11px;font-weight:600;letter-spacing:4px;color:var(--gold);text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:12px;">Exercises<span style="flex:1;height:1px;background:var(--border);display:block"></span></div>';

  coreData.exercises.forEach(function(ex, i) {
    var card = document.createElement('div');
    card.style.cssText = 'background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;';
    card.innerHTML =
      '<div>' +
        '<div style="font-family:var(--font-d);font-size:11px;letter-spacing:2px;color:var(--text3);text-transform:uppercase;margin-bottom:3px">Exercise ' + (i+1) + '</div>' +
        '<div style="font-family:var(--font-d);font-size:20px;font-weight:700;color:var(--text);text-transform:uppercase">' + ex.name + '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<div style="font-family:var(--font-d);font-size:22px;font-weight:900;color:var(--gold)">' + ex.reps + '</div>' +
        '<div style="font-family:var(--font-d);font-size:12px;color:var(--text2)">' + ex.load + '</div>' +
      '</div>';
    exSection.appendChild(card);
  });
  body.appendChild(exSection);

  // Round counter
  var roundBlock = document.createElement('div');
  roundBlock.style.cssText = 'padding:0 20px 20px';
  roundBlock.innerHTML =
    '<div style="font-family:var(--font-d);font-size:11px;font-weight:600;letter-spacing:4px;color:var(--gold);text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:12px;">Rounds<span style="flex:1;height:1px;background:var(--border);display:block"></span></div>' +
    '<div style="display:flex;align-items:center;justify-content:center;gap:20px">' +
    '<button onclick="adjustRounds(-1)" style="width:52px;height:52px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:24px;cursor:pointer;">-</button>' +
    '<div id="round-count" style="font-family:var(--font-d);font-size:64px;font-weight:900;color:var(--text);min-width:80px;text-align:center">0</div>' +
    '<button onclick="adjustRounds(1)" style="width:52px;height:52px;background:var(--gold);border:none;border-radius:4px;color:#000;font-size:24px;cursor:pointer;">+</button>' +
    '</div>';
  body.appendChild(roundBlock);

  // Notes + finish
  var notesBlock = document.createElement('div');
  notesBlock.className = 'session-notes-block';
  notesBlock.innerHTML = '<div class="section-hdr">Session Notes</div><textarea class="session-notes-input" rows="3" placeholder="Rounds completed, how it felt..."></textarea>';
  body.appendChild(notesBlock);

  var finBtn = document.createElement('button');
  finBtn.className = 'finish-btn';
  finBtn.textContent = 'Complete Session';
  finBtn.addEventListener('click', function(){
    if(confirm('Mark session as complete?')){
      stopCoreTimer();
      var roundEl=document.getElementById('round-count');
      var rounds=roundEl?parseInt(roundEl.textContent)||0:0;
      supabaseCompleteSession({total_reps:rounds,details:{session_id:'core',coreNum:coreNum,fullRounds:rounds}});
      navTo('today');
    }
  });
  body.appendChild(finBtn);

  document.getElementById('session-back-btn').onclick = function(){stopCoreTimer();navTo('today');};
  supabaseStartSession('core','Core '+coreNum,'core',{coreNum:coreNum});
  showScreen('screen-session');
}
*/

// ---- openKarenSession --------------------------------------------------
/*
function openKarenSession(){
  clearInterval(wuTimerInterval);wuTimerSecs=0;wuTimerRunning=false;wuSelectedCardio='row';
  var body=document.getElementById('session-body-content');body.innerHTML='';
  var hero=document.createElement('div');hero.className='session-hero';
  hero.innerHTML='<div class="sh-tag">Friday AM - Conditioning</div><div class="sh-name">Karen + Core</div><div class="sh-detail">150 Wall Balls @ 9kg AFAP, then Core AMRAP</div>';
  body.appendChild(hero);
  buildWarmupBlocks('crossfit',body);

  // Karen timer block
  var karenBlock=document.createElement('div');
  karenBlock.style.cssText='padding:24px 20px;border-bottom:1px solid var(--border);text-align:center';
  karenBlock.innerHTML=
    '<div style="font-family:var(--font-d);font-size:11px;letter-spacing:4px;color:var(--orange);text-transform:uppercase;margin-bottom:4px">Karen - AFAP</div>'+
    '<div style="font-family:var(--font-d);font-size:48px;font-weight:900;color:var(--text);line-height:1;margin-bottom:4px">150</div>'+
    '<div style="font-family:var(--font-d);font-size:18px;color:var(--text2);margin-bottom:16px">Wall Balls @ 9kg</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:12px">'+
      '<button id="karen-start-btn" style="flex:1;background:var(--orange);color:#fff;font-family:var(--font-d);font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px;border:none;border-radius:4px;cursor:pointer;">Start Timer</button>'+
      '<button id="karen-reset-btn" style="flex:0 0 80px;background:var(--bg3);color:var(--text2);font-family:var(--font-d);font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:14px;border:1px solid var(--border2);border-radius:4px;cursor:pointer;">Reset</button>'+
    '</div>'+
    '<div id="karen-timer-display" style="font-family:var(--font-d);font-size:72px;font-weight:900;color:var(--gold);line-height:1">0:00</div>'+
    '<div style="margin-top:12px">'+
      '<div style="font-family:var(--font-d);font-size:11px;letter-spacing:3px;color:var(--text3);text-transform:uppercase;margin-bottom:6px">Reps completed</div>'+
      '<input type="number" id="karen-reps-input" class="field-input" placeholder="150" inputmode="numeric" style="text-align:center;font-size:28px;font-weight:700;">'+
    '</div>'+
    '<div id="karen-pb-note" style="font-size:13px;color:var(--text3);margin-top:8px"></div>';
  body.appendChild(karenBlock);

  // Show previous Karen time if logged
  var logs=JSON.parse(localStorage.getItem('phoenix_session_logs')||'[]');
  var karenLogs=logs.filter(function(l){return l.sessionId==='karen-core';});
  if(karenLogs.length){
    var lastKaren=karenLogs[karenLogs.length-1];
    if(lastKaren.karenTime){
      var pbNote=document.getElementById('karen-pb-note');
      if(pbNote) pbNote.textContent='Last time: '+lastKaren.karenTime;
    }
  }

  // Karen timer logic
  var karenInterval=null,karenStart=0,karenRunning=false;
  setTimeout(function(){
    var startBtn=document.getElementById('karen-start-btn');
    var resetBtn=document.getElementById('karen-reset-btn');
    var display=document.getElementById('karen-timer-display');
    if(startBtn) startBtn.addEventListener('click',function(){
      if(!karenRunning){
        karenRunning=true;
        startBtn.textContent='Stop';
        startBtn.style.background='var(--red)';
        requestWakeLock();
        // v4.9.118 FIX 3: count-in first, clock starts at 0:00 after GO!. FIX 1 + FIX 2: the
        // clock is derived from karenStart and repaints on unlock via the resync registry.
        showCountIn(function(){
          if(!karenRunning) return; // stopped / left during the count-in
          display=document.getElementById('karen-timer-display');
          if(!display) return;
          requestWakeLock();
          karenStart=_phxStampTimerStart();
          var paint=function(){
            var elapsed=_phxElapsedSince(karenStart);
            var m=Math.floor(elapsed/60),s=elapsed%60;
            if(display) display.textContent=m+':'+(s<10?'0':'')+s;
          };
          karenInterval=setInterval(paint,500);
          _phxRegisterTimer(paint);
          paint();
        });
      } else {
        _phxCancelCountIn();
        clearInterval(karenInterval);karenRunning=false;
        _phxUnregisterTimer();
        startBtn.textContent='Start Timer';
        startBtn.style.background='var(--orange)';
        releaseWakeLock();
      }
    });
    if(resetBtn) resetBtn.addEventListener('click',function(){
      _phxCancelCountIn();
      clearInterval(karenInterval);karenRunning=false;karenStart=0;
      _phxUnregisterTimer();
      releaseWakeLock();
      if(display) display.textContent='0:00';
      if(startBtn){startBtn.textContent='Start Timer';startBtn.style.background='var(--orange)';}
    });
  },0);

  // Core section
  var coreSection=document.createElement('div');
  coreSection.style.cssText='padding:20px';
  coreSection.innerHTML=
    '<div style="font-family:var(--font-d);font-size:11px;font-weight:600;letter-spacing:4px;color:var(--blue);text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:12px;">Core Session<span style="flex:1;height:1px;background:var(--border);display:block"></span></div>'+
    '<button onclick="openCoreModal()" style="width:100%;background:var(--bg3);border:1px dashed var(--border2);color:var(--text2);font-family:var(--font-d);font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;padding:14px;border-radius:4px;cursor:pointer;">Select + Start Core Session</button>';
  body.appendChild(coreSection);

  var notesBlock=document.createElement('div');notesBlock.className='session-notes-block';
  notesBlock.innerHTML='<div class="section-hdr">Session Notes</div><textarea class="session-notes-input" id="session-notes-field" rows="3" placeholder="Karen time, rounds on core, how it felt..."></textarea>';
  body.appendChild(notesBlock);

  var finBtn=document.createElement('button');finBtn.className='finish-btn';finBtn.textContent='Complete Session';
  finBtn.addEventListener('click',function(){
    if(confirm('Mark session as complete?')){
      var timerEl=document.getElementById('karen-timer-display');
      var repsEl=document.getElementById('karen-reps-input');
      var notesEl=document.getElementById('session-notes-field');
      var logs2=JSON.parse(localStorage.getItem('phoenix_session_logs')||'[]');
      logs2.push({
        date:new Date().toISOString(),sessionId:'karen-core',week:currentProgWeek||1,
        karenTime:timerEl?timerEl.textContent:'',
        karenReps:repsEl?repsEl.value:'150',
        notes:notesEl?notesEl.value:''
      });
      localStorage.setItem('phoenix_session_logs',JSON.stringify(logs2));
      var _karenReps=parseInt(repsEl?repsEl.value:0)||0;
      supabaseCompleteSession({total_reps:_karenReps,notes:notesEl?notesEl.value:'',details:{session_id:'karen-core',week:currentProgWeek||1,karenTime:timerEl?timerEl.textContent:'',karenReps:repsEl?repsEl.value:'150'}});
      _phxCancelCountIn();clearInterval(karenInterval);_phxUnregisterTimer();releaseWakeLock();
      navTo('today');
    }
  });
  body.appendChild(finBtn);
  document.getElementById('session-back-btn').onclick=function(){_phxCancelCountIn();clearInterval(karenInterval);_phxUnregisterTimer();releaseWakeLock();navTo('today');};
  supabaseStartSession('wod','Karen + Core','karen-core');
  showScreen('screen-session');
}
*/



/* ══════════════════════════════════════════════════════════════════════════
   NUTRITION CHECK-IN TAB — archived v4.9.221 (2026-08-22), CLAUDE.md rule 9.

   Unreachable, not broken. `_nutTabCheckin` had no caller: the nutrition tab
   router routes today / recipes / week / meals and never had a 'checkin' branch.
   Everything below is the transitive closure of that one orphan —
   `_nutWeeklyAssessment` was called ONLY by the renderer, and the two handler
   functions were bound ONLY by wiring inside the live `nutRenderScreen`, which
   ran on every nutrition render and found nothing, every time.

   NOT a capability loss. Weight and feeling logging live in the morning
   check-in card (`_phxOpenMorningCheckin`) and the weekly flow
   (`openWeeklyCheckin`), both live and both writing `weekly_checkins` /
   `_wciState`. Nothing outside this cluster ever read `ns.daily[date].feeling`,
   which is the only store this code wrote — verified before removal.
   ══════════════════════════════════════════════════════════════════════════ */

// ---- check-in wiring inside nutRenderScreen ----
  var saveCI = body.querySelector('#nut-save-checkin');
  if(saveCI) saveCI.addEventListener('click', nutSaveCheckin);
  _nutWireFeelingBtns();
  // Reset feeling selection to what was already saved today
  var _todayData = (nutGetState() && nutGetState().daily && nutGetState().daily[_nutToday()]) || {};
  _nutFeelingVal = _todayData.feeling || 0;
// ---- _nutTabCheckin + _nutFeelingVal + _nutWireFeelingBtns + nutSaveCheckin ----
function _nutTabCheckin(ns){
  var today   = _nutToday();
  var dayData = (ns.daily && ns.daily[today]) || {};
  var feeling = dayData.feeling || 0;
  var weight  = dayData.weight_kg || '';
  var feelingBtns = '';
  for(var i=1;i<=10;i++){
    var active = (feeling === i);
    feelingBtns += '<button data-feeling="' + i + '" style="width:32px;height:32px;border-radius:50%;border:1px solid ' + (active ? 'var(--gold)' : 'var(--border2)') + ';background:' + (active ? 'var(--gold)' : 'var(--bg2)') + ';color:' + (active ? '#000' : 'var(--text2)') + ';font-family:var(--font-d);font-size:12px;font-weight:700;cursor:pointer;touch-action:manipulation;">' + i + '</button>';
  }
  var h = '<div style="margin-bottom:20px;">';
  h += '<div style="font-family:var(--font-d);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:10px;">How are you feeling today?</div>';
  h += '<div id="nut-feeling-btns" style="display:flex;gap:6px;flex-wrap:wrap;">' + feelingBtns + '</div>';
  h += '<div style="font-size:10px;color:var(--text3);margin-top:6px;display:flex;justify-content:space-between;"><span>Low energy</span><span>Peak</span></div>';
  h += '</div>';
  h += '<div style="margin-bottom:20px;">';
  h += '<div style="font-family:var(--font-d);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:8px;">Weight</div>';
  h += '<div style="display:flex;align-items:center;gap:10px;">';
  h += '<input type="number" id="nut-weight-input" inputmode="decimal" step="0.1" placeholder="kg" value="' + weight + '" style="flex:1;padding:12px;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius);color:var(--text);font-family:var(--font-d);font-size:18px;font-weight:700;text-align:center;outline:none;">';
  h += '<div style="font-size:13px;color:var(--text3);">kg</div>';
  h += '</div></div>';
  h += '<button id="nut-save-checkin" style="width:100%;padding:14px;background:var(--gold);border:none;border-radius:var(--radius);font-family:var(--font-d);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#000;cursor:pointer;touch-action:manipulation;margin-bottom:20px;">Save Check-in</button>';
  if(dayData.feeling){ h += '<div style="text-align:center;margin-bottom:20px;font-size:11px;color:var(--text3);">Checked in ✔ Feeling: ' + dayData.feeling + '/10' + (dayData.weight_kg ? ' · ' + dayData.weight_kg + 'kg' : '') + '</div>'; }
  h += _nutWeeklyAssessment(ns);
  return h;
}

// Wires up feeling button taps in check-in tab
var _nutFeelingVal = 0;
function _nutWireFeelingBtns(){
  var container = document.getElementById('nut-feeling-btns');
  if(!container) return;
  container.querySelectorAll('[data-feeling]').forEach(function(btn){
    btn.addEventListener('click', function(){
      _nutFeelingVal = parseInt(btn.getAttribute('data-feeling'));
      container.querySelectorAll('[data-feeling]').forEach(function(b){
        var active = parseInt(b.getAttribute('data-feeling')) === _nutFeelingVal;
        b.style.background = active ? 'var(--gold)' : 'var(--bg2)';
        b.style.borderColor = active ? 'var(--gold)' : 'var(--border2)';
        b.style.color = active ? '#000' : 'var(--text2)';
      });
    });
  });
}

function nutSaveCheckin(){
  var ns = nutGetState();
  if(!ns) return;
  var today = _nutToday();
  if(!ns.daily) ns.daily = {};
  if(!ns.daily[today]) ns.daily[today] = { meals: [] };
  var feelingEl = document.getElementById('nut-feeling-btns');
  var weightEl  = document.getElementById('nut-weight-input');
  var feeling = _nutFeelingVal || (ns.daily[today].feeling || 0);
  var weight  = weightEl ? parseFloat(weightEl.value) || 0 : 0;
  if(feeling > 0) ns.daily[today].feeling = feeling;
  if(weight > 0)  ns.daily[today].weight_kg = weight;
  nutSaveState(ns);
  nutRenderScreen();
  if(typeof nutRenderTile === 'function') nutRenderTile();
}

// ---- _nutWeeklyAssessment ----
function _nutWeeklyAssessment(ns){
  if(!ns || !ns.daily) return '';
  var days = [];
  for(var i = 0; i < 14; i++){
    var d = new Date();
    d.setDate(d.getDate() - i);
    var dk = _phxLocalISO(d);
    var dd  = ns.daily[dk] || {};
    var tot = _nutDayTotals(dd);
    days.push({date:dk, weight:dd.weight_kg||null, kcal:tot.kcal, p:tot.protein_g, hasLog:tot.kcal>0});
  }
  var withWeight = days.filter(function(d){ return d.weight; });
  var withFood   = days.filter(function(d){ return d.hasLog; });
  if(withWeight.length < 2){
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;">' +
      '<div style="font-family:var(--font-d);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:8px;">Weekly Assessment</div>' +
      '<div style="font-size:12px;color:var(--text3);line-height:1.5;">Log your weight on at least 2 separate days to see your trend assessment.</div></div>';
  }
  var newest   = withWeight[0];
  var oldest   = withWeight[withWeight.length-1];
  var wDelta   = Math.round((newest.weight - oldest.weight) * 10) / 10;
  var daysSpan = withWeight.length;
  var avgKcal  = withFood.length ? Math.round(withFood.reduce(function(a,d){ return a+d.kcal; },0) / withFood.length) : 0;
  var tgtKcal  = (ns.targets && ns.targets.kcal) || 0;
  var tgtProt  = (ns.targets && ns.targets.protein_g) || 0;
  var daysHitP = withFood.filter(function(d){ return d.p >= tgtProt * 0.9; }).length;
  var goal     = ns.goal || 'maintenance';
  var verdict  = '', vColor = 'var(--text3)';
  if(goal === 'fat_loss'){
    if(wDelta <= -0.2 && wDelta >= -1.5){ verdict = 'On track — steady weight loss'; vColor = '#4CAF50'; }
    else if(wDelta > 0.2){               verdict = 'Weight trending up — review daily intake'; vColor = 'var(--gold)'; }
    else if(wDelta < -1.5){              verdict = 'Dropping fast — slight increase helps muscle retention'; vColor = 'var(--gold)'; }
    else {                               verdict = 'Weight stable — small deficit may be needed'; vColor = 'var(--text3)'; }
  } else if(goal === 'hypertrophy'){
    if(wDelta >= 0.1 && wDelta <= 1.0){ verdict = 'On track — healthy gaining rate'; vColor = '#4CAF50'; }
    else if(wDelta < 0){                verdict = 'Weight dropping — eat more to support growth'; vColor = 'var(--gold)'; }
    else if(wDelta > 1.0){              verdict = 'Gaining fast — watch the rate for lean gains'; vColor = 'var(--gold)'; }
    else {                              verdict = 'Weight stable — slight calorie increase may help'; vColor = 'var(--text3)'; }
  } else if(goal === 'strength'){
    if(Math.abs(wDelta) <= 0.5){ verdict = 'Weight stable — good for strength phase'; vColor = '#4CAF50'; }
    else if(wDelta > 0.5){       verdict = 'Gaining — keep an eye on the rate'; vColor = 'var(--text3)'; }
    else {                       verdict = 'Losing — ensure enough calories for recovery'; vColor = 'var(--gold)'; }
  } else {
    if(Math.abs(wDelta) <= 0.3){ verdict = 'Maintaining well'; vColor = '#4CAF50'; }
    else {                       verdict = 'Weight moving — adjust intake to maintain'; vColor = 'var(--gold)'; }
  }
  var wArrow = wDelta > 0.1 ? '↑' : wDelta < -0.1 ? '↓' : '→';
  var wColor = goal === 'fat_loss' ? (wDelta < 0 ? '#4CAF50' : 'var(--gold)') :
               goal === 'hypertrophy' ? (wDelta > 0 ? '#4CAF50' : 'var(--gold)') : 'var(--text)';
  var kcalDiff = avgKcal - tgtKcal;
  // Mini weight sparkline
  var chartDays = days.slice(0,7).reverse();
  var wVals  = chartDays.map(function(d){ return d.weight; }).filter(Boolean);
  var minW   = wVals.length ? Math.min.apply(null,wVals) - 0.3 : 0;
  var maxW   = wVals.length ? Math.max.apply(null,wVals) + 0.3 : 1;
  var chartH = 36;
  var chartBars = chartDays.map(function(d){
    var dayLbl = new Date(d.date + 'T12:00:00').toLocaleDateString('en-AU',{weekday:'narrow'});
    if(!d.weight) return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;height:' + (chartH+18) + 'px;"><div style="height:' + chartH + 'px;"></div><div style="font-size:8px;color:var(--border2);">' + dayLbl + '</div></div>';
    var pct = maxW > minW ? (d.weight - minW) / (maxW - minW) : 0.5;
    var bH  = Math.max(4, Math.round(pct * chartH));
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;height:' + (chartH+18) + 'px;">' +
      '<div style="font-size:7px;color:var(--text3);">' + d.weight + '</div>' +
      '<div style="width:80%;max-width:18px;height:' + bH + 'px;background:var(--gold);border-radius:2px 2px 0 0;"></div>' +
      '<div style="font-size:8px;color:var(--text3);">' + dayLbl + '</div>' +
      '</div>';
  }).join('');
  var h = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;">';
  h += '<div style="font-family:var(--font-d);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:14px;">Weekly Assessment</div>';
  h += '<div style="display:flex;gap:8px;margin-bottom:14px;">';
  h += '<div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px;text-align:center;">' +
    '<div style="font-family:var(--font-d);font-size:18px;font-weight:900;color:' + wColor + ';">' + wArrow + ' ' + Math.abs(wDelta) + 'kg</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-top:2px;">' + daysSpan + '-day weight</div></div>';
  h += '<div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px;text-align:center;">' +
    '<div style="font-family:var(--font-d);font-size:18px;font-weight:900;color:' + (Math.abs(kcalDiff)<100 ? '#4CAF50' : 'var(--gold)') + ';">' + (avgKcal||'—') + '</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-top:2px;">avg kcal &middot; tgt ' + tgtKcal + '</div></div>';
  h += '<div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px;text-align:center;">' +
    '<div style="font-family:var(--font-d);font-size:18px;font-weight:900;color:' + (daysHitP>=5 ? '#4CAF50' : 'var(--gold)') + ';">' + daysHitP + '/' + (withFood.length||7) + '</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-top:2px;">days hit protein</div></div>';
  h += '</div>';
  if(wVals.length >= 3) h += '<div style="display:flex;align-items:flex-end;gap:3px;margin-bottom:14px;padding:8px;background:var(--bg3);border-radius:var(--radius);">' + chartBars + '</div>';
  h += '<div style="background:var(--bg3);border-left:3px solid ' + vColor + ';border-radius:0 var(--radius) var(--radius) 0;padding:10px 12px;">';
  h += '<div style="font-size:12px;color:' + vColor + ';font-weight:600;">' + verdict + '</div>';
  if(kcalDiff !== 0 && avgKcal > 0) h += '<div style="font-size:11px;color:var(--text3);margin-top:4px;">Avg intake ' + Math.abs(kcalDiff) + ' kcal ' + (kcalDiff > 0 ? 'above' : 'below') + ' target</div>';
  h += '</div></div>';
  return h;
}



// ═══════════════════════════════════════════════════════════════════════════
// ARCHIVED v4.9.310 — the two week-level nutrition cards the restructure retired
//
// Jon: "Remove 'Evening Meals' as a week-level picker (the per-day dinner
// selector is redundant now that he's editing at day/meal level)" and "Remove
// everything else that isn't those three sections."
//
// _nutProgWeekPickerCard was a WEEK-level control for ONE meal, built when
// dinner was the only choosable thing. Every meal is now editable per day from
// _nutProgDayPlanCard, so keeping it would have been a second control for one
// setting — which is how two controls drift apart.
//
// _nutProgWeekAheadCard was the seven-row kcal/blocks table at the top of the
// review scroll. The day plan shows the same figures per day, on the rows he
// taps to edit, so the table repeated them a screen earlier.
//
// Kept here rather than deleted because both are complete, working renderers: if
// the day plan turns out to be worse for planning a week at a glance, the week
// table is a paste away.
// ═══════════════════════════════════════════════════════════════════════════


// The week ahead, day by day. On setup day there is no plan to EAT yet, so
// "what am I eating this week" has to be answerable somewhere other than Today.
function _nutProgWeekAheadCard(week){
  var days = _nutProgWeekDates(week);
  if(!days) return '';
  var h = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px 15px;margin-bottom:14px;">' +
    '<div style="font-family:var(--font-d);font-size:12px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:var(--gold);">The week ahead</div>';
  days.forEach(function(d){
    var t = nutProgTargetsOn(d);
    if(!t) return;
    var dt = _nutProgDate(d);
    var nm = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
    h += '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">' +
      '<div style="min-width:0;"><span style="font-weight:700;">' + nm + '</span>' +
        '<span style="color:var(--text3);"> ' + d.slice(8) + '/' + d.slice(5,7) + '</span>' +
        '<span style="font-size:10px;color:var(--text3);"> &middot; ' + (t.sessions.length ? t.sessions.join(' + ') : 'rest') + '</span></div>' +
      '<div style="white-space:nowrap;color:var(--text3);font-size:11px;">' +
        t.total.kcal + ' kcal &middot; <span style="color:var(--gold);">' + t.blocks + ' blk</span></div></div>';
  });
  h += '<div style="font-size:10px;color:var(--text3);margin-top:8px;line-height:1.5;">Lift days eat one block less &mdash; the intra drink carries it.</div></div>';
  return h;
}



function _nutProgWeekPickerCard(week){
  var days = _nutProgWeekDates(week);
  if(!days) return '';
  var h = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px 15px;margin-bottom:14px;">' +
    '<div style="font-family:var(--font-d);font-size:12px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:var(--gold);">Evening meals</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-top:2px;">Set each night before you shop &mdash; the list follows these</div>';
  days.forEach(function(d){
    var t = nutProgTargetsOn(d);
    if(!t) return;
    var pick = nutProgNightlyOn(d);
    var pr = _nutProgNightlyOpt('dinner_protein', pick.dinner_protein) || _nutProgNightlyBase('dinner_protein');
    var vg = _nutProgNightlyOpt('dinner_veg', pick.dinner_veg) || _nutProgNightlyBase('dinner_veg');
    var dt = _nutProgDate(d);
    var nm = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
    h += '<div data-prog-night-day="' + d + '" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer;touch-action:manipulation;">' +
      '<div style="min-width:0;">' +
        '<div style="font-size:12px;font-weight:700;">' + nm + ' <span style="color:var(--text3);font-weight:400;">' + d.slice(8) + '/' + d.slice(5,7) + '</span></div>' +
        '<div style="font-size:11px;color:var(--gold);margin-top:1px;">' + pr.n + ' ' + pr.g + ' g' +
          '<span style="color:var(--text3);"> &middot; ' + vg.n + '</span></div>' +
        '<div style="font-size:10px;color:var(--text3);margin-top:2px;">' + _nutProgGrainLine(d) + '</div>' +
      '</div>' +
      '<div style="font-size:16px;color:var(--text3);flex-shrink:0;">&rsaquo;</div></div>';
  });
  h += '<div style="font-size:10px;color:var(--text3);margin-top:9px;line-height:1.5;">Each serve is sized to land the same protein, so the weight changes with the choice. The oil moves to hold the fat.</div></div>';
  return h;
}

