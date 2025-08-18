document.addEventListener('DOMContentLoaded', () => {
  // -------- Safe viewport (iOS) --------
  function setVh(){
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`);
  }
  setVh();
  window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // -------- Unlock audio on first tap (iOS) --------
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

  const btnOpen = document.getElementById('bouton-sanctuaire'); // ☥ bas-centre
  const btnMode = document.getElementById('btn-mode-mini');     // clé d’Ankh (re-select mode)
  const btnVeil = document.getElementById('btn-veille-mini');   // souffle sacré
  const btnVocal= document.getElementById('btn-vocal');         // micro

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

  // Rendre le player TTS "présent" (autoplay-friendly) mais invisible
  if(tts){
    tts.style.display = 'block';
    tts.style.width = '0';
    tts.style.height = '0';
    tts.style.opacity = '0';
  }

  // -------- App state --------
  const State = {
    sanctuaire:false,
    mode:null,
    vocal:false,          // mode vocal désiré par l’utilisateur
    recognizing:false,    // état interne de la reco WebSpeech
    souffle:false,
    tts:false,
    souffleNext:null,     // timeout chain (pas d'interval)
    isPlaying:false,
    playSeq:0,            // jeton pour annuler une lecture en cours
    papyrusHideTimer:null
  };

  const setActive=(el,on)=>{ if(!el) return; el.classList.toggle('active', !!on); el.setAttribute('aria-pressed', !!on); };
  const disable=(el,on)=>{ if(!el) return; el.disabled=!!on; el.setAttribute('aria-disabled', !!on); };
  const safePlay=a=>{ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); };
  const flash=(el, ms=220)=>{ setActive(el,true); setTimeout(()=>setActive(el,false), ms); };

  // -------- Volumes --------
  const VOLUME_BASE=0.10, VOLUME_DUCK=0.05; // musique un peu plus présente
  if(bgm) bgm.volume=VOLUME_BASE;
  if(tts) tts.volume=1.0;

  function restoreVolume(){
    if(bgm) bgm.volume = VOLUME_BASE;
    State.tts = false;
  }

  // Ducking + pause de la reco (on NE coupe PAS le mode vocal ; reprise ensuite)
  if(tts && bgm){
    tts.addEventListener('play', ()=>{
      State.tts = true;
      bgm.volume = VOLUME_DUCK;
      pauseReco(); // on stoppe juste la reco, on ne désactive pas le mode vocal
    });
    const restore=()=>{
      restoreVolume();
      // si l’utilisateur avait activé le vocal, on relance la reco après la fin du TTS
      if(State.vocal && !State.recognizing){ startReco(); }
    };
    tts.addEventListener('ended', restore);
    tts.addEventListener('pause', restore);
  }

  // -------- Resets --------
  function clearPapyrusTimer(){
    if(State.papyrusHideTimer){ clearTimeout(State.papyrusHideTimer); State.papyrusHideTimer = null; }
  }
  function scheduleHidePapyrus(delay=10000){
    clearPapyrusTimer();
    State.papyrusHideTimer = setTimeout(()=>{
      if(!State.isPlaying && pap){ pap.style.display='none'; ptxt.textContent=''; }
    }, delay);
  }
  function stopSpeaking(){
    State.playSeq++; // annule toute lecture en cours
    if(tts){ try{ tts.pause(); }catch{} tts.currentTime=0; }
    eye && eye.classList.remove('playing');
    aura && aura.classList.remove('active');
    State.isPlaying=false;
    scheduleHidePapyrus(400); // referme vite si on a stoppé manuellement
  }
  function stopReco(){
    if(!recog) return;
    try{ recog.stop(); }catch{}
    State.recognizing = false;
  }
  function pauseReco(){ // pause "douce" pendant TTS
    stopReco(); // on ne modifie pas State.vocal ici
  }
  function stopVocal(){
    if(!State.vocal) return;
    State.vocal=false;
    setActive(btnVocal,false);
    stopReco();
    toast("Vocal désactivé.");
  }
  function stopSouffle(){
    if(!State.souffle) return;
    State.souffle=false;
    setActive(btnVeil,false);
    if(State.souffleNext){ clearTimeout(State.souffleNext); State.souffleNext=null; }
    stopSpeaking(); // coupe aussi toute lecture en cours
    toast("Souffle sacré désactivé.");
  }
  function hardReset(){
    stopVocal(); stopSouffle(); stopSpeaking(); setActive(btnGo,false);
  }

  // -------- Overlay (sélection de mode) --------
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
  // ouvre l’overlay À TOUT MOMENT (même pendant chat)
  btnMode?.addEventListener('click', ()=> overlay.open(false));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'&&!overlayEl.classList.contains('overlay-hidden')) overlay.close(); });

  // -------- Sanctuaire (activation) --------
  if(zone) zone.style.display='none';
  disable(btnGo,true); disable(input,true);
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    State.sanctuaire=true;
    if(zone) zone.style.display='grid';
    safePlay(bgm); safePlay(sOpen);
    overlay.open(true);           // on force le choix d’un mode au début
    btnOpen.style.display='none'; // la clé bas disparaît après activation
  });

  // -------- Sélection mode --------
  function setMode(k){
    State.mode = k;
    try{ localStorage.setItem('mode', k); }catch(_){}
    overlay.close(); safePlay(sMode);
    disable(btnGo,false); disable(input,false);
    toast(`Mode : ${k}`);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });

  // -------- Micro --------
  let recog=null;
  function initSpeech(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;
    const r=new SR();
    r.lang='fr-FR';
    r.interimResults=false;
    r.continuous=false;
    r.maxAlternatives=1;

    r.onresult=e=>{
      const txt=(e.results[0]&&e.results[0][0]&&e.results[0][0].transcript)||'';
      if(txt){ input.value=txt; send(); }
    };
    r.onend = ()=>{
      State.recognizing=false;
      // si le mode vocal est toujours désiré et qu’aucun TTS ne joue, on reprend
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
  function startVocal(){
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    startReco();
    State.vocal=true; setActive(btnVocal,true);
    toast("Vocal activé : parle, je t’écoute.");
  }
  btnVocal?.addEventListener('click', ()=>{ if(State.vocal){ stopVocal(); } else { startVocal(); } });

  // -------- Papyrus + segments --------
  function showPap(){
    if(!pap) return;
    clearPapyrusTimer();
    pap.style.display='flex';
    ptxt.textContent=''; ptxt.scrollTop=0;
  }

  function estimateMsForText(text){
    const words = (text||'').trim().split(/\s+/).filter(Boolean).length;
    // ~2.3 mots/s + marge mini
    return Math.max(1200, Math.round((words/2.3)*1000));
  }

  async function playSegments(segments){
    if(!segments || !segments.length) return;
    const mySeq = ++State.playSeq; // jeton propre à cette lecture
    State.isPlaying=true; showPap();
    eye && eye.classList.add('playing'); aura && aura.classList.add('active');

    for (let i=0;i<segments.length;i++){
      if(mySeq !== State.playSeq) return; // annulé
      const seg=segments[i];
      await new Promise((resolve)=>{
        const text = seg.text || '';
        // animation "typer"
        let typer=null;
        const startTyper=(durationMs)=>{
          const step=Math.max(14, Math.round(durationMs/Math.max(22, text.length||1)));
          let idx=0;
          typer=setInterval(()=>{
            ptxt.textContent += text.charAt(idx++);
            ptxt.scrollTop = ptxt.scrollHeight;
            if(idx>=text.length){ clearInterval(typer); typer=null; }
          }, step);
        };

        // Si pas d'audio_url => fallback texte-only (pas de ducking, pas de tts.play)
        if(!seg.audio_url){
          const d = estimateMsForText(text);
          startTyper(d);
          setTimeout(()=>{ if(typer) clearInterval(typer); ptxt.textContent+=(i<segments.length-1?" ":""); resolve(); }, d+60);
          return;
        }

        // Lecture TTS avec fallback de durée si metadata KO
        const done = ()=>{
          if(typer){ clearInterval(typer); typer=null; }
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
          startTyper(d);
          try{ tts.play(); }catch{}
          // sécurité : si l’évènement ended ne vient pas, on force la suite
          setTimeout(()=>{ if(!endedOrTimeout){ endedOrTimeout=true; done(); } }, Math.max(d+200, 1400));
        };

        // si loadedmetadata ne vient pas (certaines plateformes), on force quand même
        metadataTimeout = setTimeout(()=>{
          if(endedOrTimeout) return;
          const d = estimateMsForText(text);
          startTyper(d);
          try{ tts.play(); }catch{}
          setTimeout(()=>{ if(!endedOrTimeout){ endedOrTimeout=true; done(); } }, Math.max(d+200, 1400));
        }, 1200);

        tts.onended = ()=>{
          if(endedOrTimeout) return;
          endedOrTimeout = true;
          if(metadataTimeout) clearTimeout(metadataTimeout);
          done();
        };
      });
      if(mySeq !== State.playSeq) return; // annulé en cours
    }

    eye && eye.classList.remove('playing'); aura && aura.classList.remove('active');
    State.isPlaying=false;
    scheduleHidePapyrus(10000); // cache après 10s si plus rien ne joue
  }

  // -------- Réseau --------
  async function fetchSegments(prompt){
    const mode = State.mode || localStorage.getItem('mode') || "sentinelle8";
    const r = await fetch("/invoquer",{
      method:"POST",
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt,mode})
    });
    const data = await r.json().catch(()=>null);
    return (data && data.segments) ? data.segments : [];
  }

  async function invokeAndPlay(prompt, {respectSouffle=true}={}){
    const segments = await fetchSegments(prompt);
    if(respectSouffle && _norm(prompt)==='souffle sacré' && !State.souffle){
      // le souffle a été coupé entre-temps : on n’enchaîne pas
      return;
    }
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
    const prompt=(input?.value||"").trim(); if(!prompt) return;
    setActive(btnGo,true); safePlay(sClick);
    // couper tout ce qui tourne (pour éviter superpositions)
    stopSouffle(); stopReco(); stopSpeaking();
    await invokeAndPlay(prompt, {respectSouffle:false});
    setActive(btnGo,false); input.value="";
    // si le vocal était ON, on relance la reco (et pas pendant un TTS)
    if(State.vocal && !State.tts && !State.recognizing){ startReco(); }
  }
  btnGo?.addEventListener('click', send);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') send(); });

  // -------- Souffle (toggle fiable + relance) --------
  function planifierSouffleSuivant(){
    if(!State.souffle) return;
    if(State.souffleNext){ clearTimeout(State.souffleNext); }
    State.souffleNext = setTimeout(()=>{ if(State.souffle) lancerSouffle(); }, 35000);
  }
  async function lancerSouffle(){
    if(!State.sanctuaire || !State.souffle) return;
    await invokeAndPlay("souffle sacré", {respectSouffle:true});
    planifierSouffleSuivant();
  }
  btnVeil?.addEventListener('click', ()=>{
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(State.souffle){
      stopSouffle();
    } else {
      State.souffle=true; setActive(btnVeil,true);
      toast("Souffle sacré activé.");
      // si quelque chose joue, on attend la fin ; sinon on lance
      if(State.isPlaying){ planifierSouffleSuivant(); } else { lancerSouffle(); }
    }
  });

  // -------- Toast --------
  function toast(msg){
    const d=document.createElement('div');
    d.className='toast';
    d.setAttribute('role','status');
    d.textContent=msg;
    document.body.appendChild(d);
    setTimeout(()=>d.remove(), 1800);
  }
});
