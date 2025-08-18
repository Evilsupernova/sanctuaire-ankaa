document.addEventListener('DOMContentLoaded', () => {
  // ----- viewport safe iOS -----
  function setVh(){ const vh=window.visualViewport?window.visualViewport.height:window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`); }
  setVh(); window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // ----- unlock audio first tap (iOS) -----
  (function unlock(){
    const ids=['musique-sacree','tts-player','s-click','s-open','s-close','s-mode'];
    const list=ids.map(id=>document.getElementById(id));
    const arm=()=>{ list.forEach(a=>{ if(!a) return; a.muted=true; const p=a.play(); if(p&&p.finally) p.finally(()=>{a.pause();a.muted=false;}); });
      window.removeEventListener('touchstart', arm,{passive:true}); window.removeEventListener('click', arm,{passive:true}); };
    window.addEventListener('touchstart', arm,{once:true,passive:true});
    window.addEventListener('click', arm,{once:true,passive:true});
  })();

  // ----- refs -----
  const input=document.getElementById('verbe');
  const btnGo=document.getElementById('btn-verbe');
  const zone=document.getElementById('zone-invocation');

  const btnOpen=document.getElementById('bouton-sanctuaire');
  const btnMode=document.getElementById('btn-mode-mini');     // Clé (réouvre le choix)
  const btnVeil=document.getElementById('btn-veille-mini');   // Souffle
  const btnVocal=document.getElementById('btn-vocal');        // Micro

  const tts=document.getElementById('tts-player');
  const bgm=document.getElementById('musique-sacree');
  const sClick=document.getElementById('s-click');
  const sOpen=document.getElementById('s-open');
  const sClose=document.getElementById('s-close');
  const sMode=document.getElementById('s-mode');

  const tools=document.getElementById('tools-column');
  const header=document.getElementById('en-tete');
  if(tools && header){ header.insertAdjacentElement('afterend', tools); }

  const eye=document.querySelector('.oeil-centre');
  const aura=document.getElementById('aura-ankaa');
  const pap=document.getElementById('papyrus-zone');
  const ptxt=document.getElementById('papyrus-texte');
  const overlayEl=document.getElementById('mode-overlay');

  // ----- state -----
  const State={ sanctuaire:false, mode:null, vocal:false, souffle:false, tts:false, isPlaying:false, nextCycle:null };
  const setActive=(el,on)=>{ if(!el) return; el.classList.toggle('active', !!on); el.setAttribute('aria-pressed', !!on); };
  const disable=(el,on)=>{ if(!el) return; el.disabled=!!on; el.setAttribute('aria-disabled', !!on); };
  const safePlay=a=>{ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); };

  // ----- audio volumes -----
  const VOLUME_BASE = 0.38;  // musique plus présente
  const SILENCE_TOTAL = true; // coupe totalement la musique pendant la voix
  let VOLUME_RESTORE = VOLUME_BASE;

  if(bgm) bgm.volume = VOLUME_BASE;
  if(tts) tts.volume = 1.0;

  let papyrusHideTimer = null;

  if(tts && bgm){
    tts.addEventListener('play', ()=>{
      State.tts=true;
      VOLUME_RESTORE = VOLUME_BASE;
      bgm.volume = SILENCE_TOTAL ? 0 : 0.12;  // silence total ou ducking léger
      // afficher papyrus si on parle
      if (pap) { pap.style.display='flex'; }
      if (papyrusHideTimer){ clearTimeout(papyrusHideTimer); papyrusHideTimer=null; }
      stopVocal(); // micro off quand la voix joue
    });
    const restore=()=>{
      State.tts=false;
      bgm.volume = VOLUME_RESTORE;  // remet la musique
      // cacher papyrus 10 s après la fin
      if (papyrusHideTimer) clearTimeout(papyrusHideTimer);
      papyrusHideTimer = setTimeout(()=>{
        if (pap){ ptxt.textContent=''; pap.style.display='none'; }
      }, 10000);
    };
    tts.addEventListener('ended', restore);
    tts.addEventListener('pause', restore);
  }

  // ----- helpers reset -----
  let recog=null, recognizing=false;

  function stopSpeaking(){
    if(tts){ try{ tts.pause(); }catch{} tts.currentTime=0; }
    eye && eye.classList.remove('playing');
    aura && aura.classList.remove('active');
    State.isPlaying=false;
  }
  function stopVocal(){
    if(!State.vocal) return;
    State.vocal=false; setActive(btnVocal,false);
    if(recog){ try{ recog.stop(); }catch{} }
  }
  function stopSouffleCycle(){
    if(State.nextCycle){ clearTimeout(State.nextCycle); State.nextCycle=null; }
  }
  function stopSouffle(){
    if(!State.souffle) return;
    State.souffle=false; setActive(btnVeil,false);
    stopSouffleCycle();
  }
  function hardReset(){
    stopVocal(); stopSouffle(); stopSpeaking(); setActive(btnGo,false);
  }

  // ----- overlay (choix mode) -----
  const overlay={
    open(block=false){ overlayEl?.classList.remove('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','false');
      if(block){ disable(btnGo,true); disable(input,true); }
      setActive(btnMode,true); setTimeout(()=>setActive(btnMode,false),200); safePlay(sOpen); },
    close(){ overlayEl?.classList.add('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','true');
      disable(btnGo,false); disable(input,false); safePlay(sClose); }
  };
  btnMode?.addEventListener('click', ()=> overlay.open(false));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'&&!overlayEl.classList.contains('overlay-hidden')) overlay.close(); });

  // ----- sanctuaire -----
  if(zone) zone.style.display='none'; disable(btnGo,true); disable(input,true);
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    State.sanctuaire=true;
    if(zone) zone.style.display='grid';
    safePlay(bgm); safePlay(sOpen);
    overlay.open(true);         // forcer le choix au début
    btnOpen.style.display='none';
  });

  // ----- sélection de mode -----
  function setMode(k){
    State.mode=k; try{ localStorage.setItem('mode', k); }catch(_){}
    overlay.close(); safePlay(sMode);
    disable(btnGo,false); disable(input,false);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });

  // ----- micro -----
  function initSpeech(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR) return null;
    const r=new SR(); r.lang='fr-FR'; r.interimResults=false; r.continuous=false;
    r.onresult=e=>{
      const txt=(e.results[0]&&e.results[0][0]&&e.results[0][0].transcript)||'';
      if(txt){ input.value=txt; send(); }
    };
    r.onend=()=>{ recognizing=false; if(State.vocal && !State.tts){ try{ r.start(); recognizing=true; }catch{} } };
    r.onerror=()=> recognizing=false;
    return r;
  }
  function startVocal(){
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(!recog) recog=initSpeech();
    if(!recog){ toast("Micro non supporté."); return; }
    if(!recognizing){ try{ recog.start(); recognizing=true; }catch{} }
    State.vocal=true; setActive(btnVocal,true);
  }
  btnVocal?.addEventListener('click', ()=>{ if(State.vocal){ stopVocal(); } else { startVocal(); } });

  // ----- papyrus + lecture segmentée (support sans audio_url) -----
  function showPap(){ if(!pap) return; pap.style.display='flex'; ptxt.textContent=''; ptxt.scrollTop=0; }
  function typeText(text, durMs){
    return new Promise(resolve=>{
      const step=Math.max(14, Math.round(durMs/Math.max(22,(text||"").length||1)));
      let i=0;
      const id=setInterval(()=>{
        ptxt.textContent+=(text||"").charAt(i++); ptxt.scrollTop=ptxt.scrollHeight;
        if(i>=(text||"").length){ clearInterval(id); resolve(); }
      }, step);
    });
  }
  async function playOneSegment(seg){
    const text=seg.text||"";
    if(seg.audio_url){
      return new Promise(resolve=>{
        tts.src=seg.audio_url+"?t="+Date.now();
        tts.onloadedmetadata=async function(){
          const d=Math.max(900,(tts.duration||1.6)*1000);
          try{ tts.play(); }catch{}
          await typeText(text, d);
          tts.onended=()=>resolve();
        };
      });
    }else{
      const d=Math.max(1200, text.length*26);
      await typeText(text, d);
    }
  }
  async function playSegments(segments){
    if(!segments||!segments.length) return;
    State.isPlaying=true; showPap(); eye?.classList.add('playing'); aura?.classList.add('active');
    for(let i=0;i<segments.length;i++){
      await playOneSegment(segments[i]);
      if(i<segments.length-1){ ptxt.textContent+=' '; }
    }
    eye?.classList.remove('playing'); aura?.classList.remove('active');
    State.isPlaying=false;
  }

  // ----- réseau -----
  async function invokeServer(prompt){
    const mode = State.mode || localStorage.getItem('mode') || "sentinelle8";
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(), 25000);
    try{
      const r=await fetch("/invoquer",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,mode}), signal:ctrl.signal});
      clearTimeout(t);
      const data=await r.json();
      const segs=data?.segments||[];
      if(!segs.length){ toast("Rien à lire."); return; }
      await playSegments(segs);
    }catch{
      clearTimeout(t); toast("Serveur occupé. Réessaie.");
    }
  }

  async function send(){
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    const prompt=(input?.value||"").trim(); if(!prompt) return;
    setActive(btnGo,true); safePlay(sClick);
    stopSouffle(); stopVocal(); stopSpeaking();
    await invokeServer(prompt);
    setActive(btnGo,false); input.value="";
  }
  btnGo?.addEventListener('click', send);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') send(); });

  // ----- Souffle : cycles auto -----
  function scheduleNextCycle(){
    if(!State.souffle) return;
    if(State.nextCycle) clearTimeout(State.nextCycle);
    // pause 8–10 s entre les cycles
    const pause = 8000 + Math.floor(Math.random()*2000);
    State.nextCycle = setTimeout(()=>{ if(State.souffle) lancerCycleSouffle(); }, pause);
  }
  async function lancerCycleSouffle(){
    // un cycle = serveur renvoie déjà plusieurs fragments complets
    await invokeServer("souffle sacré");
    scheduleNextCycle();
  }
  btnVeil?.addEventListener('click', ()=>{
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(State.souffle){
      stopSouffle(); stopSpeaking();
    }else{
      State.souffle=true; setActive(btnVeil,true);
      if(State.isPlaying){ scheduleNextCycle(); } else { lancerCycleSouffle(); }
    }
  });

  // ----- toast -----
  function toast(msg){
    const d=document.createElement('div'); d.className='toast'; d.setAttribute('role','status'); d.textContent=msg;
    document.body.appendChild(d); setTimeout(()=>d.remove(),1800);
  }
});
