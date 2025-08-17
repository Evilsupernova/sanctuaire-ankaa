document.addEventListener('DOMContentLoaded', () => {
  // viewport mobile
  function setVh(){ const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`); }
  setVh(); window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // déverrouille audio iOS
  (function unlock(){
    const ids=['musique-sacree','tts-player','s-click','s-open','s-close','s-mode'];
    const list=ids.map(id=>document.getElementById(id));
    const arm=()=>{ list.forEach(a=>{ if(!a) return; a.muted=true; const p=a.play(); if(p&&p.finally) p.finally(()=>{a.pause();a.muted=false;}); });
      window.removeEventListener('touchstart', arm,{passive:true}); window.removeEventListener('click', arm,{passive:true}); };
    window.addEventListener('touchstart', arm,{once:true,passive:true});
    window.addEventListener('click', arm,{once:true,passive:true});
  })();

  // Refs
  const input=document.getElementById('verbe');
  const btnGo=document.getElementById('btn-verbe');
  const zone=document.getElementById('zone-invocation');

  const btnOpen=document.getElementById('bouton-sanctuaire'); // ☥ en bas-centre
  const btnMode=document.getElementById('btn-mode-mini');
  const btnVeil=document.getElementById('btn-veille-mini');
  const btnVocal=document.getElementById('btn-vocal');

  const tts=document.getElementById('tts-player');
  const bgm=document.getElementById('musique-sacree');
  const sClick=document.getElementById('s-click');
  const sOpen=document.getElementById('s-open');
  const sClose=document.getElementById('s-close');
  const sMode=document.getElementById('s-mode');

  const eye=document.querySelector('.oeil-centre');
  const aura=document.getElementById('aura-ankaa');
  const pap=document.getElementById('papyrus-zone');
  const ptxt=document.getElementById('papyrus-texte');
  const overlayEl=document.getElementById('mode-overlay');

  // Placer la barre d’outils en colonne à gauche
  (function placeToolsLeft(){
    const tools=document.getElementById('tools-column');
    if(!tools) return;
    tools.classList.add('tools-left');
    document.body.appendChild(tools);
  })();

  // volumes : musique très faible, voix forte + ducking total
  if(bgm) bgm.volume=0.03;
  if(tts) tts.volume=1.0;
  [sClick,sOpen,sClose,sMode].forEach(a=>{ if(a) a.volume=0.30; });
  if(tts && bgm){
    tts.addEventListener('play', ()=>{ try{ bgm.volume = 0.0; }catch{} });
    const restore=()=>{ try{ bgm.volume = 0.03; }catch{} };
    tts.addEventListener('ended', restore);
    tts.addEventListener('pause', restore);
  }

  // état initial
  try{ localStorage.removeItem('mode'); }catch(_){}
  if(zone) zone.style.display='none';
  [btnGo,input].forEach(el=> el && (el.disabled=true));

  let talking=false;
  if(tts){
    tts.addEventListener('play', ()=> talking=true);
    tts.addEventListener('ended',()=> talking=false);
    tts.addEventListener('pause',()=> talking=false);
  }

  let sanctuaireActif=false;

  function safePlay(a){ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); }
  function stopSpeaking(){
    if(tts){ tts.pause(); tts.currentTime=0; }
    talking=false;
    eye && eye.classList.remove('playing'); aura && aura.classList.remove('active');
    if(pap){ pap.style.display='none'; if(ptxt) ptxt.textContent=''; ptxt.scrollTop=0; }
    btnGo && btnGo.classList.remove('active');
  }
  function playVisu(d){
    eye && eye.classList.add('playing'); aura && aura.classList.add('active');
    setTimeout(()=>{ eye && eye.classList.remove('playing'); aura && aura.classList.remove('active'); }, Math.max(d,1200));
  }
  function showPap(){ if(!pap) return; pap.style.display='flex'; }

  // overlay
  const overlay={
    open(block=false){
      overlayEl?.classList.remove('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','false');
      if(block){ btnGo&&(btnGo.disabled=true); input&&(input.disabled=true); }
      safePlay(sOpen);
    },
    close(){
      overlayEl?.classList.add('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','true');
      safePlay(sClose);
    }
  };
  btnMode?.addEventListener('click', ()=> overlay.open(false));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !overlayEl.classList.contains('overlay-hidden')) overlay.close(); });

  // ouvrir sanctuaire : apparait, musique, overlay, bouton disparaît
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    if(zone) zone.style.display='grid';
    safePlay(bgm); safePlay(sOpen);
    overlay.open(true);
    btnOpen.style.display='none';
    sanctuaireActif = true;
  });

  // set mode
  function setMode(k){
    try{ localStorage.setItem('mode', k); }catch(_){}
    btnGo&&(btnGo.disabled=false); input&&(input.disabled=false);
    overlay.close(); safePlay(sMode);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });

  // vocal
  let vocalMode=false, recognizing=false, recog=null;
  function initSpeech(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;
    const r=new SR();
    r.lang='fr-FR'; r.interimResults=false; r.continuous=false;
    r.onresult=e=>{ const txt=(e.results[0]&&e.results[0][0]&&e.results[0][0].transcript)||''; if(txt){ input.value=txt; btnGo.click(); } };
    r.onend = ()=>{ recognizing=false; if(vocalMode && !talking){ try{ r.start(); recognizing=true; }catch{} } };
    r.onerror = ()=> recognizing=false;
    return r;
  }
  function startRecog(){ if(!recog) recog=initSpeech(); if(!recog){ showToast("Micro non supporté."); vocalMode=false; return; } if(!recognizing){ try{ recog.start(); recognizing=true; }catch{} } }
  function stopRecog(){ try{ recog&&recog.stop(); }catch{} recognizing=false; }
  function showToast(msg){ const d=document.createElement('div'); d.className='toast'; d.textContent=msg; document.body.appendChild(d); setTimeout(()=>d.remove(),1800); }

  btnVocal && btnVocal.addEventListener('click', ()=>{
    if(!sanctuaireActif){ showToast("Active d’abord le Sanctuaire ☥"); return; }
    vocalMode=!vocalMode;
    if(vocalMode){ startRecog(); btnVocal.classList.add('active'); } else { stopRecog(); btnVocal.classList.remove('active'); }
  });
  if(tts){ tts.addEventListener('play', ()=>{ if(vocalMode) stopRecog(); });
           tts.addEventListener('ended',()=>{ if(vocalMode) startRecog(); }); }

  // --- Lecture segmentée synchronisée ---
  async function playSegments(segments){
    if(!segments || !segments.length){ return; }
    showPap();
    ptxt.textContent=''; ptxt.scrollTop=0;
    for (let i=0; i<segments.length; i++){
      const seg = segments[i];
      await new Promise((resolve)=>{
        tts.src = seg.audio_url + "?t=" + Date.now();
        tts.onloadedmetadata = function(){
          const durMs = Math.max(800, (tts.duration||1.6)*1000);
          // typage synchrone (vitesse = durée / nb caractères)
          const text = seg.text;
          const step = Math.max(12, Math.round(durMs / Math.max(22, text.length)));
          let idx = 0;
          const typer = setInterval(()=>{
            ptxt.textContent += text.charAt(idx++);
            ptxt.scrollTop = ptxt.scrollHeight;
            if(idx >= text.length){
              clearInterval(typer);
            }
          }, step);
          try{ tts.play(); }catch{}
          tts.onended = ()=>{ clearInterval(typer); ptxt.textContent += (i<segments.length-1 ? " " : ""); resolve(); };
          tts.onpause  = ()=>{ /* no-op */ };
          playVisu(durMs);
        };
      });
    }
  }

  // INVOCATION
  async function envoyer(e){
    e && e.preventDefault();
    if(!sanctuaireActif){ showToast("Active d’abord le Sanctuaire ☥"); return; }
    if(talking){ stopSpeaking(); return; }

    const prompt=(input?.value||"").trim(); if(!prompt) return;
    const mode=localStorage.getItem('mode'); if(!mode){ overlay.open(false); return; }

    safePlay(sClick); btnGo?.classList.add('active');

    try{
      const r=await fetch("/invoquer",{method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt, mode })});
      const data=await r.json(); btnGo?.classList.remove('active');
      const segments=data?.segments||[];
      if(!segments.length){
        showToast("𓂀 Ankaa : rien à lire."); return;
      }
      await playSegments(segments);
    }catch{
      btnGo?.classList.remove('active'); showToast("𓂀 Erreur réseau.");
    }
    if(input) input.value="";
  }
  btnGo?.addEventListener('click', envoyer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });

  // SOUFFLE — lit un fragment (segments)
  let souffleLock=false, souffleTimer=null;
  function lancerSouffle(){
    if(souffleLock) return; souffleLock=true;
    const mode=localStorage.getItem('mode')||"sentinelle8";
    fetch("/invoquer",{method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt:"souffle sacré", mode })})
      .then(r=>r.json()).then(async data=>{
        const segments=data?.segments||[];
        if(!segments.length){ souffleLock=false; return; }
        await playSegments(segments);
        setTimeout(()=> souffleLock=false, 300);
      }).catch(()=>{ souffleLock=false; showToast("𓂀 Erreur réseau."); });
  }
  btnVeil?.addEventListener('click', ()=>{
    if(!sanctuaireActif){ showToast("Active d’abord le Sanctuaire ☥"); return; }
    if(btnVeil.classList.contains('active')){
      btnVeil.classList.remove('active'); clearInterval(souffleTimer); souffleTimer=null; safePlay(sClose);
    } else {
      btnVeil.classList.add('active'); lancerSouffle(); souffleTimer=setInterval(lancerSouffle, 35000); safePlay(sOpen);
    }
  });
});