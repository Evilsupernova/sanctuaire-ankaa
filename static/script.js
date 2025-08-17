// script.js — V11.0.1 (fix erreurs, init ordre, reset vocal)
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // ---- viewport mobile
  function setVh() {
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh / 100}px`);
  }
  setVh();
  window.addEventListener('resize', setVh);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh);

  // ---- iOS: déverrouille audio au 1er toucher
  (function unlock() {
    const ids = ['musique-sacree', 'tts-player', 's-click', 's-open', 's-close', 's-mode'];
    const list = ids.map(id => document.getElementById(id)).filter(Boolean);
    const arm = () => {
      list.forEach(a => { a.muted = true; const p = a.play(); if (p?.finally) p.finally(() => { a.pause(); a.muted = false; }); });
      window.removeEventListener('touchstart', arm, { passive: true });
      window.removeEventListener('click', arm, { passive: true });
    };
    window.addEventListener('touchstart', arm, { once: true, passive: true });
    window.addEventListener('click', arm, { once: true, passive: true });
  })();

  // ---- refs DOM
  const input   = document.getElementById('verbe');
  const btnGo   = document.getElementById('btn-verbe');
  const zone    = document.getElementById('zone-invocation');

  const btnOpen = document.getElementById('bouton-sanctuaire'); // ☥ en bas
  const btnMode = document.getElementById('btn-mode-mini');
  const btnVeil = document.getElementById('btn-veille-mini');
  const btnVocal = document.getElementById('btn-vocal');        // ✅ une seule déclaration

  const tts  = document.getElementById('tts-player');
  const bgm  = document.getElementById('musique-sacree');
  const sClick = document.getElementById('s-click');
  const sOpen  = document.getElementById('s-open');
  const sClose = document.getElementById('s-close');
  const sMode  = document.getElementById('s-mode');

  const eye   = document.querySelector('.oeil-centre');
  const aura  = document.getElementById('aura-ankaa');
  const pap   = document.getElementById('papyrus-zone');
  const ptxt  = document.getElementById('papyrus-texte');
  const header = document.getElementById('en-tete');
  const overlayEl = document.getElementById('mode-overlay');

  // ---- utilitaires UI
  function safePlay(a){ if(!a) return; a.currentTime = 0; a.play()?.catch(()=>{}); }
  function toast(msg){
    const d=document.createElement('div'); d.className='toast'; d.textContent=msg;
    document.body.appendChild(d); setTimeout(()=>d.remove(), 1800);
  }
  function playVisu(d){
    eye?.classList.add('playing'); aura?.classList.add('active');
    setTimeout(()=>{ eye?.classList.remove('playing'); aura?.classList.remove('active'); }, Math.max(d,1200));
  }
  function showPap(){ if(pap) pap.style.display='flex'; }

  // ---- insérer la barre d’outils entre le titre et l’œil
  (function placeTools(){
    const tools = document.getElementById('tools-column');
    if(!tools || !header) return;
    const bar = document.createElement('div'); bar.id = 'tools-bar';
    header.insertAdjacentElement('afterend', bar);
    bar.appendChild(tools);
  })();

  // ---- états init
  let sanctuaireActif = false;
  try{ localStorage.removeItem('mode'); }catch(_){}
  if(zone) zone.style.display = 'none';
  [btnGo, input].forEach(el => el && (el.disabled = true));

  // ---- mode vocal (déclaré AVANT listeners TTS) ✅
  let vocalMode = false, recognizing = false, recog = null;
  function initSpeech(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;
    const r = new SR();
    r.lang = 'fr-FR'; r.interimResults = false; r.continuous = false;
    r.onresult = e => {
      const txt = (e.results?.[0]?.[0]?.transcript) || '';
      if(txt){ input && (input.value = txt); btnGo?.click(); }
    };
    // à l’arrêt → bouton et état remis à zéro
    r.onend = r.onerror = () => { recognizing = false; vocalMode = false; btnVocal?.classList.remove('active'); };
    return r;
  }
  function startRecog(){ if(!btnVocal) return;
    if(!recog) recog = initSpeech();
    if(!recog) { toast("Micro non supporté."); return; }
    if(!recognizing){ try{ recog.start(); recognizing = true; }catch{} }
  }
  function stopRecog(){ try{ recog && recog.stop(); }catch{} recognizing = false; }

  btnVocal?.addEventListener('click', ()=>{
    if(!sanctuaireActif){ toast("Active d’abord le Sanctuaire ☥"); return; }
    if(vocalMode){ stopRecog(); vocalMode=false; btnVocal.classList.remove('active'); }
    else { startRecog(); vocalMode=true; btnVocal.classList.add('active'); }
  });

  // ---- audio: volumes + ducking + reset vocal pendant TTS
  if(bgm) bgm.volume = 0.22;
  if(tts) tts.volume = 1.0;
  [sClick,sOpen,sClose,sMode].filter(Boolean).forEach(a=> a.volume = 0.30);

  if(tts && bgm){
    tts.addEventListener('play', () => {
      bgm.volume = 0.08;
      if(vocalMode){ stopRecog(); vocalMode=false; btnVocal?.classList.remove('active'); }
    });
    const restore = () => { bgm.volume = 0.22; };
    tts.addEventListener('ended', restore);
    tts.addEventListener('pause', restore);
  }

  // ---- overlay modes
  const overlay = {
    open(){ overlayEl?.classList.remove('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','false'); safePlay(sOpen); },
    close(){ overlayEl?.classList.add('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','true'); safePlay(sClose); }
  };
  document.getElementById('btn-mode-mini')?.addEventListener('click', ()=> overlay.open());
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !overlayEl?.classList.contains('overlay-hidden')) overlay.close(); });
  function setMode(k){
    try{ localStorage.setItem('mode', k); }catch(_){}
    btnGo && (btnGo.disabled=false); input && (input.disabled=false);
    overlay.close(); safePlay(sMode);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });

  // ---- sanctuaire (activation)
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    if(zone) zone.style.display='grid';
    safePlay(bgm); safePlay(sOpen);
    btnOpen.style.display='none';
    sanctuaireActif = true;
  });

  // ---- lecture segmentée synchronisée
  async function playSegments(segments){
    if(!segments?.length) return;
    showPap(); ptxt && (ptxt.textContent=''); ptxt && (ptxt.scrollTop=0);
    for(let i=0;i<segments.length;i++){
      const seg = segments[i];
      // attente segment
      await new Promise((resolve)=>{
        if(!tts){ resolve(); return; }
        tts.src = seg.audio_url + '?t=' + Date.now();
        tts.onloadedmetadata = function(){
          const durMs = Math.max(800, (tts.duration||1.6)*1000);
          const text = seg.text;
          const step = Math.max(10, Math.round(durMs / Math.max(22, text.length)));
          let idx = 0;
          const typer = setInterval(()=>{
            if(ptxt){ ptxt.textContent += text.charAt(idx); ptxt.scrollTop = ptxt.scrollHeight; }
            idx++;
            if(idx >= text.length){ clearInterval(typer); }
          }, step);
          tts.play()?.catch(()=>{});
          tts.onended = ()=>{ clearInterval(typer); if(ptxt && i<segments.length-1) ptxt.textContent += ' '; resolve(); };
          playVisu(durMs);
        };
      });
    }
  }

  // ---- envoi invocation
  async function envoyer(e){
    e && e.preventDefault();
    if(!sanctuaireActif){ toast("Active d’abord le Sanctuaire ☥"); return; }
    const prompt = (input?.value || '').trim(); if(!prompt) return;
    const mode = localStorage.getItem('mode'); if(!mode){ overlay.open(); return; }
    safePlay(sClick);
    try{
      const r = await fetch('/invoquer', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt, mode}) });
      const data = await r.json();
      const segments = data?.segments || [];
      if(!segments.length){ toast('𓂀 Rien à lire.'); return; }
      await playSegments(segments);
    }catch{ toast('𓂀 Erreur réseau.'); }
    if(input) input.value='';
  }
  btnGo?.addEventListener('click', envoyer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });

  // ---- Souffle
  let souffleLock=false, souffleTimer=null;
  function lancerSouffle(){
    if(souffleLock) return; souffleLock=true;
    const mode = localStorage.getItem('mode') || 'sentinelle8';
    fetch('/invoquer',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt:'souffle sacré', mode})})
      .then(r=>r.json()).then(async data=>{
        const segments = data?.segments || [];
        if(!segments.length){ souffleLock=false; return; }
        await playSegments(segments);
        setTimeout(()=> souffleLock=false, 300);
      }).catch(()=>{ souffleLock=false; toast('𓂀 Erreur réseau.'); });
  }
  btnVeil?.addEventListener('click', ()=>{
    if(!sanctuaireActif){ toast('Active d’abord le Sanctuaire ☥'); return; }
    if(btnVeil.classList.contains('active')){
      btnVeil.classList.remove('active');
      clearInterval(souffleTimer); souffleTimer=null; safePlay(sClose);
    } else {
      btnVeil.classList.add('active');
      lancerSouffle(); souffleTimer=setInterval(lancerSouffle, 35000); safePlay(sOpen);
    }
  });
});
