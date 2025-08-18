document.addEventListener('DOMContentLoaded', () => {
  // viewport
  function setVh(){ const vh=window.visualViewport?window.visualViewport.height:window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`); }
  setVh(); window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // unlock iOS
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

  const tools=document.getElementById('tools-column');
  const header=document.getElementById('en-tete');
  if(tools && header){ header.insertAdjacentElement('afterend', tools); }

  const eye=document.querySelector('.oeil-centre');
  const aura=document.getElementById('aura-ankaa');
  const pap=document.getElementById('papyrus-zone');
  const ptxt=document.getElementById('papyrus-texte');
  const overlayEl=document.getElementById('mode-overlay');

  // state
  const State={ sanctuaire:false, mode:null, vocal:false, souffle:false, tts:false, isPlaying:false, souffleNext:null };
  const setActive=(el,on)=>{ if(!el) return; el.classList.toggle('active', !!on); el.setAttribute('aria-pressed', !!on); };
  const disable=(el,on)=>{ if(!el) return; el.disabled=!!on; el.setAttribute('aria-disabled', !!on); };
  const safePlay=a=>{ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); };

  // volumes
  const VOLUME_BASE=0.22, VOLUME_DUCK=0.08;
  if(bgm) bgm.volume=VOLUME_BASE;
  if(tts) tts.volume=1.0;
  if(tts && bgm){
    tts.addEventListener('play', ()=>{ State.tts=true; bgm.volume=VOLUME_DUCK; stopVocal(); });
    const restore=()=>{ State.tts=false; bgm.volume=VOLUME_BASE; };
    tts.addEventListener('ended', restore); tts.addEventListener('pause', restore);
  }

  // reset helpers
  let recog=null, recognizing=false;
  function stopSpeaking(){ if(tts){ try{ tts.pause(); }catch{} tts.currentTime=0; }
    if(pap){ ptxt.textContent=''; pap.style.display='none'; } eye?.classList.remove('playing'); aura?.classList.remove('active'); State.isPlaying=false; }
  function stopVocal(){ if(!State.vocal) return; State.vocal=false; setActive(btnVocal,false); if(recog){ try{ recog.stop(); }catch{} } }
  function stopSouffle(){ if(!State.souffle) return; State.souffle=false; setActive(btnVeil,false); if(State.souffleNext){ clearTimeout(State.souffleNext); State.souffleNext=null; } }
  function hardReset(){ stopVocal(); stopSouffle(); stopSpeaking(); setActive(btnGo,false); }

  // overlay (mode)
  const overlay={ open(block=false){ overlayEl?.classList.remove('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','false');
                                      if(block){ disable(btnGo,true); disable(input,true); }
                                      setActive(btnMode,true); setTimeout(()=>setActive(btnMode,false),200); safePlay(sOpen); },
                  close(){ overlayEl?.classList.add('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','true'); disable(btnGo,false); disable(input,false); safePlay(sClose);} };
  btnMode?.addEventListener('click', ()=>{ overlay.open(false); }); // rouvrir à tout moment
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'&&!overlayEl.classList.contains('overlay-hidden')) overlay.close(); });

  // sanctuaire
  if(zone) zone.style.display='none'; disable(btnGo,true); disable(input,true);
  btnOpen?.addEventListener('click', ()=>{ fetch('/activer-ankaa').catch(()=>{}); State.sanctuaire=true; zone&&(zone.style.display='grid');
    safePlay(bgm); safePlay(sOpen); overlay.open(true); btnOpen.style.display='none'; });

  // mode select
  function setMode(k){ State.mode=k; try{ localStorage.setItem('mode',k);}catch(_){}
    overlay.close(); safePlay(sMode); disable(btnGo,false); disable(input,false); }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=> b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode'))));

  // micro
  function initSpeech(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return null;
    const r=new SR(); r.lang='fr-FR'; r.interimResults=false; r.continuous=false;
    r.onresult=e=>{ const txt=(e.results[0]&&e.results[0][0]&&e.results[0][0].transcript)||''; if(txt){ input.value=txt; send(); } };
    r.onend=()=>{ recognizing=false; if(State.vocal && !State.tts){ try{ r.start(); recognizing=true; }catch{} } };
    r.onerror=()=> recognizing=false; return r;
  }
  function startVocal(){ if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(!recog) recog=initSpeech(); if(!recog){ toast("Micro non supporté."); return; }
    if(!recognizing){ try{ recog.start(); recognizing=true; }catch{} } State.vocal=true; setActive(btnVocal,true); }
  btnVocal?.addEventListener('click', ()=>{ if(State.vocal){ stopVocal(); } else { startVocal(); } });

  // papyrus + segments (gère audio manquant)
  function showPap(){ if(!pap) return; pap.style.display='flex'; ptxt.textContent=''; ptxt.scrollTop=0; }
  async function playOneSegment(seg){
    return new Promise((resolve)=>{
      const text=seg.text||"";
      const playTyping=(durMs)=>{
        const step=Math.max(14, Math.round(durMs/Math.max(22,text.length||1)));
        let i=0; const typer=setInterval(()=>{ ptxt.textContent+=text.charAt(i++); ptxt.scrollTop=ptxt.scrollHeight; if(i>=text.length){ clearInterval(typer); resolve(); } }, step);
      };
      if(seg.audio_url){ // avec audio
        tts.src=seg.audio_url+"?t="+Date.now();
        tts.onloadedmetadata=function(){ const d=Math.max(900,(tts.duration||1.6)*1000); playTyping(d); try{ tts.play(); }catch{} tts.onended=()=>resolve(); };
      }else{ // sans audio => typing seul
        const d=Math.max(1200, text.length*26); playTyping(d);
      }
    });
  }
  async function playSegments(segments){
    if(!segments||!segments.length) return;
    State.isPlaying=true; showPap(); eye?.classList.add('playing'); aura?.classList.add('active');
    for(let i=0;i<segments.length;i++){ await playOneSegment(segments[i]); if(i<segments.length-1){ ptxt.textContent+=" "; } }
    eye?.classList.remove('playing'); aura?.classList.remove('active'); State.isPlaying=false;
  }

  // réseau (avec timeout)
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
    }catch{ clearTimeout(t); toast("Serveur occupé. Réessaie."); }
  }

  async function send(){
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    const prompt=(input?.value||"").trim(); if(!prompt) return;
    setActive(btnGo,true); safePlay(sClick); stopSouffle(); stopVocal(); stopSpeaking();
    await invokeServer(prompt); setActive(btnGo,false); input.value="";
  }
  btnGo?.addEventListener('click', send);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') send(); });

  // souffle (toggle + auto multi-fragments)
  function planifierSouffleSuivant(){ if(!State.souffle) return; if(State.souffleNext){ clearTimeout(State.souffleNext); }
    State.souffleNext=setTimeout(()=>{ if(State.souffle) lancerSouffle(); }, 40000); }
  async function lancerSouffle(){ await invokeServer("souffle sacré"); planifierSouffleSuivant(); }
  btnVeil?.addEventListener('click', ()=>{
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(State.souffle){ // stop immédiat
      stopSouffle(); stopSpeaking();
    }else{
      State.souffle=true; setActive(btnVeil,true);
      if(State.isPlaying){ planifierSouffleSuivant(); } else { lancerSouffle(); }
    }
  });

  // toast
  function toast(msg){ const d=document.createElement('div'); d.className='toast'; d.setAttribute('role','status'); d.textContent=msg; document.body.appendChild(d); setTimeout(()=>d.remove(),1800); }
});