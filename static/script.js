document.addEventListener('DOMContentLoaded', () => {
  // Fix viewport mobile
  function setVh(){ const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`); }
  setVh(); window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // iOS: déverrouille audio au premier toucher
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
  const btnOpen=document.getElementById('bouton-sanctuaire');
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

  // Déplacer la rangée d’outils SOUS l’Œil (sans toucher à index.html)
  const tools=document.getElementById('tools-column');
  const eyeWrap=document.querySelector('.oeil-centre');
  if(tools && eyeWrap){ eyeWrap.insertAdjacentElement('afterend', tools); }

  // volumes de base
  if(bgm) bgm.volume=0.15;            // musique présente
  if(tts) tts.volume=1.0;             // voix au max
  [sClick,sOpen,sClose,sMode].forEach(a=>{ if(a) a.volume=0.32; });

  // Ducking: baisse la musique pendant la voix
  if(tts && bgm){
    tts.addEventListener('play', ()=>{ try{ bgm.volume = 0.05; }catch{} });
    const restore=()=>{ try{ bgm.volume = 0.15; }catch{} };
    tts.addEventListener('ended', restore);
    tts.addEventListener('pause', restore);
  }

  // état initial : tout bloqué
  try{ localStorage.removeItem('mode'); }catch(_){}
  if(zone) zone.style.display='none';
  [btnGo,input].forEach(el=> el && (el.disabled=true));

  // état TTS (parle/ne parle pas)
  let talking=false;
  if(tts){
    tts.addEventListener('play', ()=> talking=true);
    tts.addEventListener('ended',()=> talking=false);
    tts.addEventListener('pause',()=> talking=false);
  }

  // garde-fou sanctuaire
  let sanctuaireActif = false;

  function safePlay(a){ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); }
  function stopSpeaking(){
    if(tts){ tts.pause(); tts.currentTime=0; }
    talking=false;
    eye && eye.classList.remove('playing'); aura && aura.classList.remove('active');
    if(pap){ pap.style.display='none'; if(ptxt) ptxt.textContent=''; }
    btnGo && btnGo.classList.remove('active');
  }
  function playVisu(d){
    eye && eye.classList.add('playing'); aura && aura.classList.add('active');
    setTimeout(()=>{ eye && eye.classList.remove('playing'); aura && aura.classList.remove('active'); }, Math.max(d,1200));
  }
  function showPap(text,d=2000){
    if(!pap||!ptxt) return;
    pap.style.display='flex'; ptxt.textContent=text;
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=''; }, d);
  }

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

  // ouvrir sanctuaire
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    if(zone) zone.style.display='grid';
    safePlay(bgm); safePlay(sOpen);
    overlay.open(true);              // oblige le choix d'un mode
    btnOpen.style.display='none';
    sanctuaireActif = true;          // <- activation
  });

  // sélectionner mode
  function setMode(k){
    try{ localStorage.setItem('mode', k); }catch(_){}
    btnGo&&(btnGo.disabled=false); input&&(input.disabled=false);
    overlay.close(); safePlay(sMode);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });

  // micro (mode vocal) — désactivation propre
  let vocalMode=false, recognizing=false, recog=null;
  function initSpeech(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;
    const r = new SR();
    r.lang='fr-FR'; r.interimResults=false; r.continuous=false;
    r.onresult = e=>{
      const txt = (e.results[0] && e.results[0][0] && e.results[0][0].transcript) || '';
      if(txt){ input.value = txt; btnGo.click(); }
    };
    r.onend = ()=>{ recognizing=false; if(vocalMode && !talking){ try{ r.start(); recognizing=true; }catch{} } };
    r.onerror = ()=> recognizing=false;
    return r;
  }
  function startRecog(){
    if(!recog) recog=initSpeech();
    if(!recog){ showPap("Micro non supporté sur ce navigateur.", 2200); vocalMode=false; return; }
    if(!recognizing){ try{ recog.start(); recognizing=true; }catch{} }
  }
  function stopRecog(){ try{ recog && recog.stop(); }catch{} recognizing=false; }

  btnVocal && btnVocal.addEventListener('click', ()=>{
    if(!sanctuaireActif){ showPap("Active d’abord le Sanctuaire ☥", 2200); return; }
    vocalMode=!vocalMode;
    if(vocalMode){ startRecog(); btnVocal.classList.add('active'); }
    else { stopRecog(); btnVocal.classList.remove('active'); }
  });

  // suspend la reco pendant que la voix parle, puis reprend si vocalMode
  if(tts){
    tts.addEventListener('play', ()=>{ if(vocalMode) stopRecog(); });
    tts.addEventListener('ended',()=>{ if(vocalMode) startRecog(); });
  }

  // INVOCATION
  async function envoyer(e){
    e && e.preventDefault();
    if(!sanctuaireActif){ showPap("Active d’abord le Sanctuaire ☥", 2000); return; }
    if(talking){ stopSpeaking(); return; }

    const prompt=(input?.value||"").trim(); if(!prompt) return;
    const mode=localStorage.getItem('mode'); if(!mode){ overlay.open(false); return; }

    safePlay(sClick); btnGo?.classList.add('active');

    try{
      const r=await fetch("/invoquer",{method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt, mode })});
      const data=await r.json(); btnGo?.classList.remove('active');
      const rep=data?.reponse||"(Silence sacré)";

      if(data?.tts && data.tts !== 'ok'){
        const why = data.tts === 'disabled' ? "TTS désactivé" : "Erreur TTS";
        showPap(`𓂀 Ankaa : ${why}.`, 2200);
      }

      if(data?.audio_url && tts){
        tts.src=data.audio_url+"?t="+Date.now();
        tts.onloadedmetadata=function(){
          const d=Math.max(2000,(tts.duration||2.4)*1000);
          playVisu(d); showPap(rep,d);
          try{ tts.play(); }catch{}
        };
      } else {
        const d=Math.max(2200, rep.length*42);
        playVisu(d); showPap(rep,d);
      }
    }catch{
      btnGo?.classList.remove('active'); showPap("𓂀 Ankaa : Erreur de communication.", 2000);
    }
    if(input) input.value="";
  }
  btnGo?.addEventListener('click', envoyer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });

  // SOUFFLE (lit un fragment du dataset)
  let souffleLock=false, souffleTimer=null;
  btnVeil?.addEventListener('click', ()=>{
    if(!sanctuaireActif){ showPap("Active d’abord le Sanctuaire ☥", 2000); return; }
    if(btnVeil.classList.contains('active')){
      btnVeil.classList.remove('active'); clearInterval(souffleTimer); souffleTimer=null; safePlay(sClose);
    } else {
      btnVeil.classList.add('active'); lancerSouffle(); souffleTimer=setInterval(lancerSouffle, 35000); safePlay(sOpen);
    }
  });
  function lancerSouffle(){
    if(souffleLock) return; souffleLock=true;
    const mode=localStorage.getItem('mode')||"sentinelle8";
    fetch("/invoquer",{method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt:"souffle sacré", mode })})
    .then(r=>r.json()).then(data=>{
      const rep=data?.reponse||"(Silence sacré)";
      if(data?.audio_url && tts){
        tts.src=data.audio_url+"?t="+Date.now();
        tts.onloadedmetadata=function(){
          const d=Math.max(2000,(tts.duration||2.4)*1000);
          playVisu(d); showPap(rep,d); try{ tts.play(); }catch{}
          setTimeout(()=> souffleLock=false, d+400);
        };
      } else {
        const d=Math.max(2200, rep.length*42); playVisu(d); showPap(rep,d); setTimeout(()=> souffleLock=false, d+400);
      }
    }).catch(()=>{ showPap("𓂀 Ankaa : Erreur de communication.", 2000); souffleLock=false; });
  }
});