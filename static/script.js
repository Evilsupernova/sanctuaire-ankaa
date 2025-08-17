// Sanctuaire Ankaa — V10 mobile stable (chemins OK, TTS, micro toggle, stop)
document.addEventListener('DOMContentLoaded', () => {
  try { localStorage.removeItem('mode'); } catch(_) {}

  const audioBG = document.getElementById('musique-sacree');
  const tts     = document.getElementById('tts-player');
  const btnSan  = document.getElementById('bouton-sanctuaire');
  const btnMode = document.getElementById('btn-mode-mini');
  const btnSouf = document.getElementById('btn-veille-mini');
  const btnGo   = document.getElementById('btn-verbe');
  const input   = document.getElementById('verbe');
  const zone    = document.getElementById('zone-invocation');

  const sfxOpen   = document.getElementById('sfx-portal-open');
  const sfxClose  = document.getElementById('sfx-portal-close');
  const sfxSelect = document.getElementById('sfx-select');

  if (audioBG) audioBG.volume = 0.14;
  [sfxOpen, sfxClose].forEach(a=>a && (a.volume=0.26));
  [sfxSelect].forEach(a=>a && (a.volume=0.18));
  const play = a=>{ try{ a&& (a.currentTime=0, a.play().catch(()=>{})); }catch(_){} };

  // iOS audio unlock
  (function unlockIOS(){
    function arm(){
      [audioBG, tts, sfxOpen, sfxClose, sfxSelect].forEach(a=>{
        if(!a) return; a.muted=true; const p=a.play();
        if(p&&p.finally) p.finally(()=>{a.pause(); a.currentTime=0; a.muted=false;});
      });
      window.removeEventListener('touchstart', arm, {passive:true});
      window.removeEventListener('click', arm, {passive:true});
    }
    window.addEventListener('touchstart', arm, {once:true, passive:true});
    window.addEventListener('click', arm, {once:true, passive:true});
  })();

  // État initial
  if(zone) zone.style.display='none';
  if(input) input.disabled = true;
  if(btnGo) btnGo.disabled = true;

  // Overlay
  const overlayEl = document.getElementById('mode-overlay');
  const modeBtns  = Array.from(document.querySelectorAll('#mode-overlay .mode-option'));
  const overlay = {
    open({blockInput}={blockInput:false}){
      if(!overlayEl) return;
      overlayEl.classList.remove('overlay-hidden');
      overlayEl.setAttribute('aria-hidden','false');
      if(blockInput){ if(input) input.disabled = true; if(btnGo) btnGo.disabled = true; }
      play(sfxOpen);
    },
    close(){
      if(!overlayEl) return;
      overlayEl.classList.add('overlay-hidden');
      overlayEl.setAttribute('aria-hidden','true');
      play(sfxClose);
    }
  };
  if(overlayEl && !overlayEl.classList.contains('overlay-hidden')){
    overlayEl.style.display='none';
    overlayEl.classList.add('overlay-hidden');
    overlayEl.removeAttribute('style');
  }

  // Sanctuaire
  btnSan?.addEventListener('click', ()=>{
    audioBG?.play().catch(()=>{});
    if(zone) zone.style.display='flex';
    btnSan.style.display='none';
    overlay.open({blockInput:true});
    fetch('/activer-ankaa').catch(()=>{});
  });

  // Choix mode
  function setMode(modeKey){
    try{ localStorage.setItem('mode',modeKey); }catch(_){}
    if(input) input.disabled=false;
    if(btnGo) btnGo.disabled=false;
    play(sfxSelect); overlay.close();
  }
  modeBtns.forEach(b=>b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')) ));
  btnMode?.addEventListener('click', ()=> overlay.open({blockInput:false}));

  // ESC = ferme overlay
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){
      const ov=document.getElementById('mode-overlay');
      if(ov && !ov.classList.contains('overlay-hidden')) overlay.close();
    }
  });

  // UI helpers
  function afficherAttente(){ const a=document.getElementById("points-sacrés"); if(a) a.style.display="block"; }
  function masquerAttente(){ const a=document.getElementById("points-sacrés"); if(a) a.style.display="none"; }
  function animeOeilVoix(d){
    const oeil=document.querySelector('.oeil-centre');
    const aura=document.getElementById('aura-ankaa');
    if(oeil) oeil.classList.add('playing');
    if(aura) aura.classList.add('active');
    setTimeout(()=>{ if(oeil) oeil.classList.remove('playing'); if(aura) aura.classList.remove('active'); }, d);
  }
  function affichePapyrus(txt, d=2500){
    const z=document.getElementById('papyrus-zone');
    const s=document.getElementById('papyrus-texte');
    if(!z||!s) return;
    z.style.display='block'; s.textContent='';
    let i=0, L=txt.length, step=Math.max(10, d/Math.max(1,L));
    (function next(){ if(i<L){ s.textContent+=txt[i++]; setTimeout(next,step);} })();
    if(Number.isFinite(d)){ setTimeout(()=>{ z.style.display='none'; s.textContent=''; }, Math.max(d+300,2200)); }
  }

  function getMode(){ try{ return localStorage.getItem('mode'); }catch(_){ return null; } }

  // Web Speech API (si dispo) — iOS Safari ne supporte pas => fallback
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recActive = false;
  if(SR){
    rec = new SR(); rec.lang='fr-FR'; rec.interimResults=false; rec.continuous=false;
    rec.onresult = e => { const t = e.results?.[0]?.[0]?.transcript || ''; if(t){ input.value=t; envoyer(); } };
    rec.onend = ()=> { recActive=false; btnGo?.classList.remove('active'); };
  }
  function startRec(){
    if(!rec){ affichePapyrus("🎙️ Le micro n’est pas supporté par ce navigateur. Utilise le micro du clavier iOS."); return; }
    recActive=true; btnGo?.classList.add('active'); try{ rec.start(); }catch(_){}
  }
  function stopRec(){ try{ rec && rec.stop(); }catch(_){} recActive=false; btnGo?.classList.remove('active'); }

  // Bouton unique : Invoquer / Stop TTS / Micro
  function envoyer(e){
    if(e) e.preventDefault();

    // 1) si TTS joue → stoppe
    if(!tts.paused && !tts.ended){
      try{ tts.pause(); tts.currentTime=0; }catch(_){}
      return;
    }
    // 2) si micro actif → le couper
    if(recActive){ stopRec(); return; }

    const prompt=(input?.value||"").trim();
    const mode=getMode();
    if(!mode){ overlay.open({blockInput:false}); return; }
    if(!prompt){
      // rien dans l'input → essayer micro
      startRec(); return;
    }

    btnGo?.classList.add('active'); afficherAttente();
    fetch('/invoquer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt, mode })
    })
    .then(r=>r.json())
    .then(data=>{
      btnGo?.classList.remove('active'); masquerAttente();
      if(data?.reponse){
        if(data.audio_url && tts){
          tts.src = data.audio_url + '?t=' + Date.now();
          tts.onloadedmetadata = function(){
            const d = Math.max((tts.duration||2)*1000, 1800);
            animeOeilVoix(d); affichePapyrus(data.reponse, d);
            tts.play().catch(()=>{});
          };
        }else{
          const d = Math.max(2200, data.reponse.length*50);
          animeOeilVoix(d); affichePapyrus(data.reponse, d);
        }
      }
    })
    .catch(()=>{ btnGo?.classList.remove('active'); masquerAttente(); affichePapyrus("𓂀 Ankaa : erreur de communication."); });

    if(input) input.value="";
  }
  btnGo?.addEventListener('click', envoyer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });

  // Souffle sacré
  let souffleTimer=null, souffleEnCours=false;
  btnSouf?.addEventListener('click', ()=>{
    if(btnSouf.classList.contains('active')){
      btnSouf.classList.remove('active'); clearInterval(souffleTimer); souffleTimer=null;
    }else{
      btnSouf.classList.add('active'); lancerSouffle(); souffleTimer=setInterval(lancerSouffle, 30000);
    }
  });
  function lancerSouffle(){
    if(souffleEnCours) return; souffleEnCours=true;
    const mode=getMode()||'sentinelle8';
    fetch('/invoquer', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt:'souffle sacré', mode })
    })
    .then(r=>r.json())
    .then(data=>{
      if(data?.reponse){
        if(data.audio_url && tts){
          tts.src = data.audio_url + '?t=' + Date.now();
          tts.onloadedmetadata = function(){
            const d = Math.max((tts.duration||2)*1000, 1800);
            animeOeilVoix(d); affichePapyrus(data.reponse, d);
            tts.play().catch(()=>{});
            setTimeout(()=>{ souffleEnCours=false; }, d+400);
          };
        } else {
          const d = Math.max(2200, data.reponse.length*50);
          animeOeilVoix(d); affichePapyrus(data.reponse, d);
          setTimeout(()=>{ souffleEnCours=false; }, d+400);
        }
      } else { souffleEnCours=false; }
    })
    .catch(()=>{ souffleEnCours=false; });
  }
});
