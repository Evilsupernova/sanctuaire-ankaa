document.addEventListener('DOMContentLoaded', () => {
  // viewport
  function setVh(){ const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`); }
  setVh(); window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // déverrouillage audio iOS
  (function unlock(){
    const ids=['musique-sacree','tts-player','s-click','s-open','s-close','s-mode'];
    const list=ids.map(id=>document.getElementById(id));
    const arm=()=>{ list.forEach(a=>{ if(!a) return; a.muted=true; const p=a.play(); if(p&&p.finally) p.finally(()=>{a.pause();a.muted=false;}); }); 
      window.removeEventListener('touchstart', arm,{passive:true}); window.removeEventListener('click', arm,{passive:true}); };
    window.addEventListener('touchstart', arm,{once:true,passive:true});
    window.addEventListener('click', arm,{once:true,passive:true});
  })();

  // refs
  const input=document.getElementById('verbe');
  const btnGo=document.getElementById('btn-verbe');
  const zone=document.getElementById('zone-invocation');
  const btnOpen=document.getElementById('bouton-sanctuaire');   // placé en haut-droite (CSS)
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
  const pts=document.getElementById('points-sacrés');
  const overlayEl=document.getElementById('mode-overlay');
  const header=document.getElementById('en-tete');

  // volumes
  if (bgm) bgm.volume=0.22;
  [sClick,sOpen,sClose,sMode].forEach(a=>{ if(a) a.volume=0.30; });

  // positionne le bouton sanctuaire en haut-droite SOUS le titre
  function placeTopBtn(){
    if(!header || !btnOpen) return;
    const b=header.getBoundingClientRect();
    btnOpen.style.top=(Math.round(b.bottom)+8)+'px';
  }
  placeTopBtn(); window.addEventListener('resize', placeTopBtn);
  window.visualViewport && window.visualViewport.addEventListener('resize', placeTopBtn);

  // état initial
  try{ localStorage.removeItem('mode'); }catch(_){}
  if(zone) zone.style.display='none';
  [btnGo,input].forEach(el=> el && (el.disabled=true));

  let vocalMode=false;                     // OFF par défaut (tu peux mettre true)
  let recognizing=false, recog=null;       // reconnaissance vocale

  // micro (si dispo)
  function initSpeech(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ return null; }
    const r = new SR();
    r.lang='fr-FR'; r.interimResults=false; r.continuous=false;
    r.onresult = (e)=>{
      const txt = (e.results[0] && e.results[0][0] && e.results[0][0].transcript) || '';
      if(txt){ input.value = txt; btnGo.click(); }
    };
    r.onend = ()=>{ recognizing=false; if(vocalMode) try{ r.start(); recognizing=true; }catch{} };
    r.onerror = ()=>{ recognizing=false; };
    return r;
  }
  btnVocal && btnVocal.addEventListener('click', ()=>{
    vocalMode=!vocalMode;
    if(vocalMode){
      if(!recog) recog=initSpeech();
      if(!recog){ pap && (pap.style.display='flex', ptxt.textContent="Micro non supporté sur ce navigateur."); setTimeout(()=>pap.style.display='none', 2000); vocalMode=false; return; }
      try{ recog.start(); recognizing=true; }catch{}
      btnVocal.classList.add('active');
    } else {
      try{ recog && recog.stop(); }catch{}
      recognizing=false;
      btnVocal.classList.remove('active');
    }
  });

  const safePlay=a=>{ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); };
  const isSpeaking=()=> tts && !tts.paused && tts.currentTime>0 && !tts.ended;
  const stopSpeaking=()=>{
    if(tts){ tts.pause(); tts.currentTime=0; }
    eye && eye.classList.remove('playing'); aura && aura.classList.remove('active');
    if(pap){ pap.style.display='none'; if(ptxt) ptxt.textContent=''; }
    btnGo && btnGo.classList.remove('active');
  };
  const wait=on=>{ if(!pts) return; pts.style.display = on ? 'block' : 'none'; };

  // overlay
  const overlay={
    open(blockInput=false){
      overlayEl?.classList.remove('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','false');
      if(blockInput){ btnGo&&(btnGo.disabled=true); input&&(input.disabled=true); }
      safePlay(sOpen);
    },
    close(){
      overlayEl?.classList.add('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','true');
      safePlay(sClose);
    }
  };

  // ouvrir sanctuaire
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    if(zone) zone.style.display='grid';
    btnGo && (btnGo.disabled=true);
    input && (input.disabled=true);
    safePlay(bgm); safePlay(sOpen);
    overlay.open(true);
    btnOpen.style.display='none'; // ← disparaît après ouverture
  });

  // choisir mode
  function setMode(k){
    try{ localStorage.setItem('mode', k); }catch(_){}
    btnGo&&(btnGo.disabled=false); input&&(input.disabled=false);
    overlay.close(); safePlay(sMode);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });
  btnMode?.addEventListener('click', ()=> overlay.open(false));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !overlayEl.classList.contains('overlay-hidden')) overlay.close(); });

  // visu
  function playVisu(d){ eye && eye.classList.add('playing'); aura && aura.classList.add('active');
    setTimeout(()=>{ eye && eye.classList.remove('playing'); aura && aura.classList.remove('active'); }, Math.max(d,1200)); }
  function showPap(text,d){ if(!pap||!ptxt) return; pap.style.display='flex'; ptxt.textContent='';
    let i=0,L=text.length,step=Math.max(8,d/Math.max(1,L));
    (function loop(){ if(i<L){ ptxt.textContent+=text[i++]; setTimeout(loop,step);} })();
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=''; }, Math.max(d+300,2000)); }

  // INVOCATION: même bouton => Start / Stop
  async function envoyer(e){
    e && e.preventDefault();
    if(isSpeaking()){ stopSpeaking(); return; }

    const prompt=(input?.value||"").trim(); if(!prompt) return;
    const mode=localStorage.getItem('mode'); if(!mode){ overlay.open(false); return; }

    safePlay(sClick); wait(true); btnGo?.classList.add('active');
    try{
      const r=await fetch("/invoquer",{method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt, mode })});
      const data=await r.json(); wait(false); btnGo?.classList.remove('active');
      const rep=data?.reponse||"(Silence sacré)";
      if(data?.audio_url && tts){
        tts.src=data.audio_url+"?t="+Date.now();
        tts.onloadedmetadata=function(){
          const d=Math.max(1800,(tts.duration||2)*1000);
          playVisu(d); showPap(rep,d);
          safePlay(tts); // lecture auto en invocation
        };
      } else {
        const d=Math.max(2200, rep.length*42); playVisu(d); showPap(rep,d);
      }
    }catch{ wait(false); btnGo?.classList.remove('active'); showPap("𓂀 Ankaa : Erreur de communication."); }
    if(input) input.value="";
  }
  btnGo?.addEventListener('click', envoyer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });

  // SOUFFLE (toujours voix homme)
  let souffleLock=false, souffleTimer=null;
  btnVeil?.addEventListener('click', ()=>{
    if(btnVeil.classList.contains('active')){
      btnVeil.classList.remove('active'); clearInterval(souffleTimer); souffleTimer=null; safePlay(sClose);
    } else {
      btnVeil.classList.add('active'); lancerSouffle(); souffleTimer=setInterval(lancerSouffle, 30000); safePlay(sOpen);
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
          const d=Math.max(1800,(tts.duration||2)*1000);
          playVisu(d); showPap(rep,d); safePlay(tts);
          setTimeout(()=>souffleLock=false, d+400);
        };
      } else {
        const d=Math.max(2200, rep.length*42); playVisu(d); showPap(rep,d); setTimeout(()=>souffleLock=false, d+400);
      }
    }).catch(()=>{ showPap("𓂀 Ankaa : Erreur de communication."); souffleLock=false; });
  }
});
