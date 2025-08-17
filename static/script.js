document.addEventListener('DOMContentLoaded', () => {
  // ---------------- Layout safe viewport (iOS) ----------------
  function setVh(){ const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`); }
  setVh(); window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // ---------------- Unlock audio on first tap (iOS) ----------------
  (function unlock(){
    const ids=['musique-sacree','tts-player','s-click','s-open','s-close','s-mode'];
    const list=ids.map(id=>document.getElementById(id));
    const arm=()=>{ list.forEach(a=>{ if(!a) return; a.muted=true; const p=a.play(); if(p&&p.finally) p.finally(()=>{a.pause();a.muted=false;}); });
      window.removeEventListener('touchstart', arm,{passive:true}); window.removeEventListener('click', arm,{passive:true}); };
    window.addEventListener('touchstart', arm,{once:true,passive:true});
    window.addEventListener('click', arm,{once:true,passive:true});
  })();

  // ---------------- Refs ----------------
  const input=document.getElementById('verbe');
  const btnGo=document.getElementById('btn-verbe');
  const zone=document.getElementById('zone-invocation');

  const btnOpen=document.getElementById('bouton-sanctuaire'); // ☥ bas-centre
  const btnMode=document.getElementById('btn-mode-mini');
  const btnVeil=document.getElementById('btn-veille-mini');
  const btnVocal=document.getElementById('btn-vocal');

  const tools=document.getElementById('tools-column');
  const header=document.getElementById('en-tete'); // titre + phrase
  if(tools && header){ header.insertAdjacentElement('afterend', tools); } // -> entre titre et oeil

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

  // ---------------- App state (anti-bug) ----------------
  const State = {
    sanctuaire:false,
    mode:null,
    vocal:false,
    souffle:false,
    tts:false,
    timerSouffle:null,
    playingPromise:null,
  };

  // helpers UI
  const setActive=(el,on)=>{ if(!el) return; el.classList.toggle('active', !!on); el.setAttribute('aria-pressed', !!on); };
  const disable=(el,on)=>{ if(!el) return; el.disabled=!!on; el.setAttribute('aria-disabled', !!on); };
  const safePlay=a=>{ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); };

  // ---------------- Volumes & ducking ----------------
  const VOLUME_BASE=0.18, VOLUME_DUCK=0.06; // musique plus présente mais douce
  if(bgm) bgm.volume=VOLUME_BASE;
  if(tts) tts.volume=1.0;

  if(tts && bgm){
    tts.addEventListener('play', ()=>{
      State.tts=true; bgm.volume=VOLUME_DUCK;
      // toute lecture TTS coupe le micro et le souffle
      stopVocal(); stopSouffle();
    });
    const restore=()=>{ State.tts=false; bgm.volume=VOLUME_BASE; };
    tts.addEventListener('ended', restore);
    tts.addEventListener('pause', restore);
  }

  // ---------------- Sanitary reset ----------------
  function stopSpeaking(){
    if(tts){ tts.pause(); tts.currentTime=0; }
    if(pap){ ptxt.textContent=''; pap.style.display='none'; }
    eye && eye.classList.remove('playing'); aura && aura.classList.remove('active');
  }

  function stopVocal(){
    if(!State.vocal) return;
    State.vocal=false; setActive(btnVocal,false);
    if(recog){ try{ recog.stop(); }catch{} }
  }

  function stopSouffle(){
    if(!State.souffle) return;
    State.souffle=false; setActive(btnVeil,false);
    if(State.timerSouffle){ clearInterval(State.timerSouffle); State.timerSouffle=null; }
  }

  function hardReset(){
    stopVocal(); stopSouffle(); stopSpeaking();
    setActive(btnGo,false);
  }

  // ---------------- Overlay mode ----------------
  const overlay={
    open(block=false){
      overlayEl?.classList.remove('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','false');
      if(block){ disable(btnGo,true); disable(input,true); }
      safePlay(sOpen);
    },
    close(){
      overlayEl?.classList.add('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','true');
      disable(btnGo,false); disable(input,false); safePlay(sClose);
    }
  };
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'&&!overlayEl.classList.contains('overlay-hidden')) overlay.close(); });

  // ---------------- Sanctuaire (bouton bas) ----------------
  if(zone) zone.style.display='none'; disable(btnGo,true); disable(input,true);
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    State.sanctuaire=true; if(zone) zone.style.display='grid';
    safePlay(bgm); safePlay(sOpen);
    overlay.open(true);
    btnOpen.style.display='none';
  });

  // ---------------- Sélection de mode ----------------
  function setMode(k){
    State.mode=k; localStorage.setItem('mode', k);
    overlay.close(); safePlay(sMode);
    disable(btnGo,false); disable(input,false);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });

  // ---------------- Micro (reco vocale stable) ----------------
  let recog=null, recognizing=false;
  function initSpeech(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR) return null;
    const r=new SR(); r.lang='fr-FR'; r.interimResults=false; r.continuous=false;
    r.onresult=e=>{
      const txt=(e.results[0]&&e.results[0][0]&&e.results[0][0].transcript)||'';
      if(txt){ input.value=txt; send(); }
    };
    r.onend = ()=>{ recognizing=false; if(State.vocal && !State.tts){ try{ r.start(); recognizing=true; }catch{} } };
    r.onerror = ()=> recognizing=false;
    return r;
  }
  function startVocal(){
    if(!recog) recog=initSpeech();
    if(!recog){ toast("Micro non supporté."); return; }
    if(!recognizing){ try{ recog.start(); recognizing=true; }catch{} }
    State.vocal=true; setActive(btnVocal,true);
  }

  btnVocal?.addEventListener('click', ()=>{
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(State.vocal){ stopVocal(); } else { startVocal(); }
  });

  // ---------------- Souffle (toggle fiable) ----------------
  btnVeil?.addEventListener('click', ()=>{
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(State.souffle){ stopSouffle(); return; }
    State.souffle=true; setActive(btnVeil,true); lancerSouffle();
    State.timerSouffle=setInterval(lancerSouffle, 35000);
  });

  function lancerSouffle(){
    if(!State.sanctuaire) return;
    invokeServer("souffle sacré");
  }

  // ---------------- Papyrus + synchro ----------------
  function showPap(){ if(!pap) return; pap.style.display='flex'; ptxt.textContent=''; ptxt.scrollTop=0; }
  function playSegments(segments){
    return new Promise(async (resolveOuter)=>{
      showPap(); eye && eye.classList.add('playing'); aura && aura.classList.add('active');
      for (let i=0;i<segments.length;i++){
        const seg=segments[i];
        await new Promise((resolve)=>{
          tts.src=seg.audio_url+"?t="+Date.now();
          tts.onloadedmetadata=function(){
            const d=Math.max(900,(tts.duration||1.6)*1000);
            // typing sync
            const text=seg.text; let idx=0;
            const step=Math.max(14, Math.round(d/Math.max(22,text.length)));
            const typer=setInterval(()=>{
              ptxt.textContent+=text.charAt(idx++);
              ptxt.scrollTop=ptxt.scrollHeight;
              if(idx>=text.length){ clearInterval(typer); }
            }, step);
            try{ tts.play(); }catch{}
            tts.onended=()=>{ clearInterval(typer); ptxt.textContent+=(i<segments.length-1?" ":""); resolve(); };
          };
        });
      }
      eye && eye.classList.remove('playing'); aura && aura.classList.remove('active');
      resolveOuter();
    });
  }

  // ---------------- Réseau ----------------
  async function invokeServer(prompt){
    const mode = State.mode || localStorage.getItem('mode') || "sentinelle8";
    try{
      const r=await fetch("/invoquer",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,mode})});
      const data=await r.json();
      const segments=data?.segments||[];
      if(!segments.length){ toast("Rien à lire."); return; }
      await playSegments(segments);
    }catch{ toast("Erreur réseau."); }
  }

  async function send(){
    if(!State.sanctuaire){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(!input.value.trim()) return;
    hardReset(); setActive(btnGo,true); safePlay(sClick);
    await invokeServer(input.value.trim());
    setActive(btnGo,false); input.value="";
  }

  btnGo?.addEventListener('click', send);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') send(); });

  // ---------------- Toast minimal ----------------
  function toast(msg){
    const d=document.createElement('div'); d.className='toast'; d.textContent=msg;
    document.body.appendChild(d); setTimeout(()=>d.remove(),1800);
  }
});