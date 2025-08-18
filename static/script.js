document.addEventListener('DOMContentLoaded', () => {
  // -------- Safe viewport (iOS) --------
  function setVh(){
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`);
  }
  setVh();
  window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // -------- Unlock audio (iOS) --------
  (function unlock(){
    const ids = ['musique-sacree','tts-player','s-click','s-open','s-close','s-mode'];
    const list = ids.map(id => document.getElementById(id));
    const arm = () => {
      list.forEach(a => {
        if(!a) return;
        a.muted = true;
        const p = a.play();
        if(p && p.finally) p.finally(()=>{ a.pause(); a.muted = false; });
      });
      window.removeEventListener('touchstart', arm, {passive:true});
      window.removeEventListener('click', arm, {passive:true});
    };
    window.addEventListener('touchstart', arm, {once:true, passive:true});
    window.addEventListener('click', arm, {once:true, passive:true});
  })();

  // -------- Refs --------
  const input   = document.getElementById('verbe');
  const btnGo   = document.getElementById('btn-verbe');
  const zone    = document.getElementById('zone-invocation');

  const btnOpen = document.getElementById('bouton-sanctuaire'); // ☥
  const btnMode = document.getElementById('btn-mode-mini');     // 𓋹
  const btnVeil = document.getElementById('btn-veille-mini');   // 𓂀 souffle
  const btnVocal= document.getElementById('btn-vocal');         // 𓆱 micro

  const tts     = document.getElementById('tts-player');
  const bgm     = document.getElementById('musique-sacree');
  const sClick  = document.getElementById('s-click');
  const sOpen   = document.getElementById('s-open');
  const sClose  = document.getElementById('s-close');
  const sMode   = document.getElementById('s-mode');

  const eye     = document.querySelector('.oeil-centre');
  const aura    = document.getElementById('aura-ankaa');
  const pap     = document.getElementById('papyrus-zone');
  const ptxt    = document.getElementById('papyrus-texte');
  const overlayEl = document.getElementById('mode-overlay');

  // Player TTS présent mais invisible (autoplay-friendly)
  if(tts){ tts.style.display='block'; tts.style.width='0'; tts.style.height='0'; tts.style.opacity='0'; }

  // -------- App State --------
  const State = {
    sanctuaire:false,
    mode:null,
    vocal:false,            // souhait utilisateur
    recognizing:false,      // état SR
    souffle:false,
    tts:false,
    souffleNext:null,
    isPlaying:false,
    playSeq:0,
    papyrusHideTimer:null
  };

  const setActive=(el,on)=>{ if(!el) return; el.classList.toggle('active', !!on); el.setAttribute('aria-pressed', !!on); };
  const disable=(el,on)=>{ if(!el) return; el.disabled=!!on; el.setAttribute('aria-disabled', !!on); };
  const safePlay=a=>{ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); };
  const flash=(el, ms=220)=>{ setActive(el,true); setTimeout(()=>setActive(el,false), ms); };

  // -------- Volumes --------
  const VOLUME_BASE = 0.10, VOLUME_DUCK = 0.05; // réglage validé
  if(bgm) bgm.volume = VOLUME_BASE;
  if(tts) tts.volume = 1.0;

  function restoreVolume(){ if(bgm) bgm.volume = VOLUME_BASE; State.tts=false; }

  // -------- Sync visuelle des toggles --------
  function syncToggles(){
    setActive(btnGo, false);
    setActive(btnVeil, !!State.souffle);
    setActive(btnVocal, !!State.vocal);
  }

  // Ducking + pause reco pendant TTS
  if(tts && bgm){
    tts.addEventListener('play', ()=>{
      State.tts = true;
      bgm.volume = VOLUME_DUCK;
      pauseReco();
    });
    const restore=()=>{
      restoreVolume();
      if(State.vocal && !State.recognizing){ startReco(); }
      syncToggles();
    };
    tts.addEventListener('ended', restore);
    tts.addEventListener('pause', restore);
    tts.addEventListener('error', restore);
  }

  // -------- Papyrus --------
  function clearPapyrusTimer(){ if(State.papyrusHideTimer){ clearTimeout(State.papyrusHideTimer); State.papyrusHideTimer=null; } }
  function scheduleHidePapyrus(delay=10000){
    clearPapyrusTimer();
    State.papyrusHideTimer = setTimeout(()=>{
      if(!State.isPlaying && pap){ pap.style.display='none'; ptxt.textContent=''; }
    }, delay);
  }
  function showPap(){ if(!pap) return; clearPapyrusTimer(); pap.style.display='flex'; ptxt.textContent=''; ptxt.scrollTop=0; }

  function stopSpeaking(){
    State.playSeq++;
    if(tts){ try{ tts.pause(); }catch{} tts.currentTime=0; }
    eye && eye.classList.remove('playing');
    aura && aura.classList.remove('active');
    State.isPlaying=false;
    scheduleHidePapyrus(400);
    syncToggles();
  }

  // -------- Overlay (mode) --------
  const overlay={
    open(block=false){
      overlayEl?.classList.remove('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','false');
      if(block){ disable(btnGo,true); disable(input,true); }
      flash(btnMode, 220);
      safePlay(sOpen);
    },
    close(){
      overlayEl?.classList.add('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','true');
      disable(btnGo,false); disable(input,false);
      safePlay(sClose);
    }
  };
  btnMode?.addEventListener('click', ()=> overlay.open(false));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'&&!overlayEl.classList.contains('overlay-hidden')) overlay.close(); });

  // -------- Activation Sanctuaire --------
  if(zone) zone.style.display='none'; disable(btnGo,true); disable(input,true);
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    State.sanctuaire=true;
    if(zone) zone.style.display='grid';
    safePlay(bgm); safePlay(sOpen);
    overlay.open(true);
    btnOpen.style.display='none';
  });

  // -------- Sélection mode --------
  function setMode(k){
    State.mode = k;
    try{ localStorage.setItem('mode', k); }catch(_){}
    overlay.close(); safePlay(sMode);
    disable(btnGo,false); disable(input,false);
    toast(`Mode : ${k}`);
    syncToggles();
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });

  // -------- Micro (Web Speech) --------
  let recog=null;
  function initSpeech(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;
    const r=new SR();
    r.lang='fr-FR'; r.interimResults=false; r.continuous=false; r.maxAlternatives=1;
    r.onresult=e=>{
      const txt=(e.results[0]&&e.results[0][0]&&e.results[0][0].transcript)||'';
      if(txt){ input.value=txt; send(); }
    };
    r.onend = ()=>{
      State.recognizing=false;
      if(State.vocal && !State.tts){
        try{ r.start(); State.recognizing=true; }catch{}
      }
    };
    r.onerror = ()=>{ State.recognizing=false; };
    return r;
  }
  function startReco(){
    if(!recog) recog=initSpeech();
    if(!recog){ toast("Micro non supporté."); return; }
    if(!State.recognizing){
      try{ recog.start(); State.recognizing=true; }catch{}
    }
  }
  function pauseReco(){ if(!recog) return; try{ recog.stop(); }catch{} State.recognizing=false; }
  function stopVocal(){ if(!State.vocal) return; State.vocal=false; setActive(btnVocal,false); pauseReco(); toast("Vocal désactivé."); syncToggles(); }
  function startVocal(){
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    startReco(); State.vocal=true; setActive(btnVocal,true); toast("Vocal activé : parle, je t’écoute."); syncToggles();
  }
  btnVocal?.addEventListener('click', ()=>{ if(State.vocal){ stopVocal(); } else { startVocal(); } });

  // -------- Réseau (anti-spam / abort / timeout) --------
  let currentAbort = null;
  const NET_TIMEOUT_MS = 15000;
  let lastSendAt = 0;
  const DEBOUNCE_MS = 400;

  function abortCurrent(){ if(currentAbort){ try{ currentAbort.abort(); }catch{} currentAbort=null; } }
  function withTimeout(p, ms){
    return new Promise((resolve, reject)=>{
      const t = setTimeout(()=>reject(new Error("timeout")), ms);
      p.then(v=>{ clearTimeout(t); resolve(v); })
       .catch(e=>{ clearTimeout(t); reject(e); });
    });
  }

  async function fetchSegments(prompt){
    abortCurrent();
    currentAbort = new AbortController();
    const mode = State.mode || localStorage.getItem('mode') || "sentinelle8";
    const req = fetch("/invoquer",{
      method:"POST",
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt,mode}),
      signal: currentAbort.signal
    });
    try{
      const r = await withTimeout(req, NET_TIMEOUT_MS);
      const data = await r.json().catch(()=>null);
      return (data && data.segments) ? data.segments : [];
    }catch(e){
      if(e.name === 'AbortError') return [];
      throw e;
    }finally{
      currentAbort = null;
    }
  }

  // -------- Typage & lecture --------
  function estimateMsForText(text){
    const words = (text||'').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1200, Math.round((words/2.3)*1000));
  }

  // Typage mot-par-mot (stable FR)
  function startTyper(text, durationMs){
    const words = (text || '').split(/\s+/);
    if (!words.length) return null;
    const step = Math.max(120, Math.round(durationMs / Math.max(10, words.length)));
    let i = 0;
    const typer = setInterval(() => {
      ptxt.textContent += (i === 0 ? '' : ' ') + (words[i++] || '');
      ptxt.scrollTop = ptxt.scrollHeight;
      if (i >= words.length) { clearInterval(typer); }
    }, step);
    return typer;
  }

  async function playSegments(segments){
    if(!segments || !segments.length) return;
    const mySeq = ++State.playSeq;
    State.isPlaying=true; showPap();
    eye && eye.classList.add('playing'); aura && aura.classList.add('active');

    for (let i=0;i<segments.length;i++){
      if(mySeq !== State.playSeq) return;
      const seg=segments[i];
      await new Promise((resolve)=>{
        const text = seg.text || '';

        // Fallback texte-only
        if(!seg.audio_url){
          const d = estimateMsForText(text);
          const typer = startTyper(text, d);
          setTimeout(()=>{ if(typer) clearInterval(typer); ptxt.textContent+=(i<segments.length-1?" ":""); resolve(); }, d + 80);
          return;
        }

        const done = ()=>{
          ptxt.textContent+=(i<segments.length-1?" ":"");
          resolve();
        };

        tts.src = seg.audio_url + "?t=" + Date.now();
        let endedOrTimeout = false;
        let metadataTimeout = null;

        tts.onloadedmetadata = function(){
          if(endedOrTimeout) return;
          const metaDur = (isFinite(tts.duration) && tts.duration>0) ? tts.duration*1000 : null;
          const d = metaDur || estimateMsForText(text);
          const typer = startTyper(text, d);
          try{ tts.play(); }catch{}
          setTimeout(()=>{ if(!endedOrTimeout){ endedOrTimeout=true; if(typer) clearInterval(typer); done(); } }, Math.max(d+220, 1500));
        };

        metadataTimeout = setTimeout(()=>{
          if(endedOrTimeout) return;
          const d = estimateMsForText(text);
          const typer = startTyper(text, d);
          try{ tts.play(); }catch{}
          setTimeout(()=>{ if(!endedOrTimeout){ endedOrTimeout=true; if(typer) clearInterval(typer); done(); } }, Math.max(d+220, 1500));
        }, 1200);

        tts.onended = ()=>{
          if(endedOrTimeout) return;
          endedOrTimeout = true;
          if(metadataTimeout) clearTimeout(metadataTimeout);
          done();
        };
        tts.onerror = ()=>{
          if(endedOrTimeout) return;
          endedOrTimeout = true;
          if(metadataTimeout) clearTimeout(metadataTimeout);
          done();
        };
      });
      if(mySeq !== State.playSeq) return;
    }

    eye && eye.classList.remove('playing'); aura && aura.classList.remove('active');
    State.isPlaying=false;
    syncToggles();
    scheduleHidePapyrus(10000);
  }

  async function invokeAndPlay(prompt, {respectSouffle=true}={}){
    // fermeture douce du papyrus si on relance
    scheduleHidePapyrus(200);
    const segments = await fetchSegments(prompt);
    if(respectSouffle && _norm(prompt)==='souffle sacré' && !State.souffle){ return; }
    if(!segments.length){ toast("Rien à lire."); return; }
    await playSegments(segments);
  }

  function _norm(s){
    return (s||'').toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9\s\-']/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  async function send(){
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    const now = Date.now();
    if(now - lastSendAt < 400) return; // anti-spam
    lastSendAt = now;

    const prompt=(input?.value||"").trim(); if(!prompt) return;
    setActive(btnGo,true); safePlay(sClick);

    // couper ce qui tourne + annuler souffle pendant requête utilisateur
    stopSouffle(); pauseReco(); stopSpeaking();

    disable(btnGo,true); disable(input,true);
    try{
      await invokeAndPlay(prompt, {respectSouffle:false});
    }catch(e){
      if(String(e).includes("timeout")) toast("Le serveur met trop de temps… Réessaie.");
      else toast("Invocation impossible. Vérifie la connexion.");
    }finally{
      disable(btnGo,false); disable(input,false);
      setActive(btnGo,false); input.value="";
      if(State.vocal && !State.tts && !State.recognizing){ startReco(); }
      syncToggles();
    }
  }
  btnGo?.addEventListener('click', send);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') send(); });

  // -------- Souffle --------
  function stopSouffle(){
    if(!State.souffle) return;
    State.souffle=false; setActive(btnVeil,false);
    if(State.souffleNext){ clearTimeout(State.souffleNext); State.souffleNext=null; }
    stopSpeaking();
    toast("Souffle sacré désactivé.");
    syncToggles();
  }
  function planifierSouffleSuivant(){
    if(!State.souffle) return;
    if(State.souffleNext){ clearTimeout(State.souffleNext); }
    State.souffleNext = setTimeout(()=>{
      if(State.souffle && !State.isPlaying){ lancerSouffle(); }
    }, 35000);
  }
  async function lancerSouffle(){
    if(!State.sanctuaire || !State.souffle) return;
    await invokeAndPlay("souffle sacré", {respectSouffle:true});
    planifierSouffleSuivant();
  }
  btnVeil?.addEventListener('click', ()=>{
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(State.souffle){ stopSouffle(); }
    else{
      State.souffle=true; setActive(btnVeil,true);
      toast("Souffle sacré activé.");
      if(State.isPlaying){ planifierSouffleSuivant(); } else { lancerSouffle(); }
      syncToggles();
    }
  });

  // -------- Toast --------
  function toast(msg){
    const d=document.createElement('div'); d.className='toast'; d.setAttribute('role','status'); d.textContent=msg;
    document.body.appendChild(d); setTimeout(()=>d.remove(), 1800);
  }
});
