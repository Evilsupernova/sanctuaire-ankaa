// Sanctuaire Ankaa — JS (overlay + souffle + verbe + vocal)
// (v15) — correctifs + 6 patchs UX (papyrus+7s, fond lent, musique douce+ducking, vh stable, anti-zoom iOS via CSS, durées texte)

document.addEventListener('DOMContentLoaded', function () {
  // --vh stable pour claviers mobiles (évite le "saut" d'UI)
  function setVh() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
  setVh();
  window.addEventListener('resize', setVh);
  window.addEventListener('orientationchange', setVh);
  window.addEventListener('focusin', setVh);
  window.addEventListener('focusout', setVh);

  // --- Raccourcis DOM
  const zoneInvocation   = document.getElementById('zone-invocation');
  const btnModeMini      = document.getElementById('btn-mode-mini');
  const btnVeilleMini    = document.getElementById('btn-veille-mini'); // Souffle sacré (veille)
  const btnVerbe         = document.getElementById('btn-verbe');
  const promptInput      = document.getElementById('verbe');
  const boutonSanctuaire = document.getElementById('bouton-sanctuaire');
  const btnVocal         = document.getElementById('btn-vocal');

  // --- Audio & SFX (IDs alignés avec index.html)
  const musique   = document.getElementById('musique-sacree');
  const tts       = document.getElementById('tts-player');
  const sClick    = document.getElementById('s-click');
  const sOpen     = document.getElementById('s-open');
  const sClose    = document.getElementById('s-close');
  const sMode     = document.getElementById('s-mode');

  if (musique) musique.volume = 0.0014; // PATCH: musique plus douce (-50%)
  if (tts) tts.volume = 1.5;          // voix au max

  [sOpen, sClose, sMode].forEach(a => a && (a.volume = 0.24));
  if (sClick) sClick.volume = 0.18;

  const play = (a) => { try { a && (a.currentTime = 0); a && a.play().catch(()=>{}); } catch(_){ } };

  // Ducking musique pendant la voix (PATCH)
  let musikVolumeBase = musique ? (musique.volume || 0.01) : 0.01;
  function duckMusic(on){
    if (!musique) return;
    try { musique.volume = Math.max(0, Math.min(1, on ? musikVolumeBase * 0.35 : musikVolumeBase)); } catch(_){}
  }
  if (tts) {
    tts.addEventListener('play',  ()=> duckMusic(true));
    tts.addEventListener('pause', ()=> duckMusic(false));
    tts.addEventListener('ended', ()=> duckMusic(false));
  }

  // --- États init UI (avant ouverture du sanctuaire)
  if (zoneInvocation) zoneInvocation.style.display = 'none';
  if (btnModeMini)    { btnModeMini.disabled = true; btnModeMini.style.visibility = 'hidden'; }
  if (btnVeilleMini)  btnVeilleMini.disabled = true;
  if (btnVerbe)       btnVerbe.disabled = true;
  if (promptInput)    promptInput.disabled = true;
  if (btnVocal)       btnVocal.disabled = true;

  // --- Aide visuelle "attente"
  function afficherAttente(){ const a=document.getElementById("points-sacrés"); if(a) a.style.display="block"; }
  function masquerAttente(){ const a=document.getElementById("points-sacrés"); if(a) a.style.display="none"; }

  // --- Animation œil + aura pendant audio
  function animeOeilVoix(duree_ms){
    const oeil=document.querySelector('.oeil-centre');
    const aura=document.getElementById('aura-ankaa');
    if(oeil) oeil.classList.add('playing');
    if(aura) aura.classList.add('active');
    setTimeout(()=>{ if(oeil) oeil.classList.remove('playing'); if(aura) aura.classList.remove('active'); }, Math.max(600, duree_ms||0));
  }

  // --- Papyrus
  function affichePapyrus(texte, duree_ms = 2500){
    const zone = document.getElementById('papyrus-zone');
    const span = document.getElementById('papyrus-texte');
    if(!zone || !span) return;
    zone.style.display = 'flex';
    span.textContent = '';
    let i=0, total=(texte||'').length, delay=Math.max(10, (duree_ms||2500)/Math.max(1,total));
    (function next(){ if(i<total){ span.textContent+=texte[i++]; setTimeout(next,delay);} })();
    if (Number.isFinite(duree_ms)) {
      const T = Math.max((duree_ms||2500) + 300, 2000);
      setTimeout(closePapyrus, T);
    }
  }
  function closePapyrus(){
    try{
      const z=document.getElementById('papyrus-zone');
      const s=document.getElementById('papyrus-texte');
      if(z) z.style.display='none';
      if(s) s.textContent='';
    }catch(_){}
  }

  // --- Mode persistant
  function getMode(){ try{ return window.localStorage.getItem('mode'); }catch(_){ return null; } }
  function setMode(modeKey){
    try{ window.localStorage.setItem('mode', modeKey); }catch(_){}
    const html = document.documentElement;
    if (html){
      html.setAttribute('data-mode', modeKey);
      html.classList.add('pulse-accent');
      setTimeout(()=> html.classList.remove('pulse-accent'), 950);
    }
    // Débloque l’invocation et le vocal
    if(btnVerbe)    btnVerbe.disabled=false;
    if(promptInput) promptInput.disabled=false;
    if(btnVocal)    btnVocal.disabled=false;

    if (modeKey === 'sentinelle8' || modeKey === 'dragosly23' || modeKey === 'invite' || modeKey === 'verbe') play(sMode);
    overlay.close();
  }

  // --- Ouverture sanctuaire
  if (boutonSanctuaire) boutonSanctuaire.addEventListener('click', activerSanctuaire);

  function activerSanctuaire() {
    if (musique) musique.play().catch(()=>{});
    if (zoneInvocation) zoneInvocation.style.display = 'flex';
    if (btnModeMini)   { btnModeMini.disabled = false; btnModeMini.style.visibility = 'visible'; }
    if (btnVeilleMini) btnVeilleMini.disabled = false;
    if (btnVerbe)      btnVerbe.disabled      = true; // bloqué tant que mode non choisi
    if (promptInput)   promptInput.disabled   = true;
    if (btnVocal)      btnVocal.disabled      = true;

    try { fetch('/activer-ankaa').catch(()=>{}); } catch(_){}
    if (boutonSanctuaire) boutonSanctuaire.style.display = 'none';

    overlay.open({blockInput:true});
    play(sOpen);
  }

  // --- Envoi "Verbe"
  function envoyerVerbe(e){
    if(e) e.preventDefault();
    const prompt=(promptInput?.value||"").trim();
    if(!prompt) return;

    const mode=getMode();
    if(!mode){ overlay.open({blockInput:false}); return; }

    btnVerbe?.classList.add('active'); afficherAttente();

    fetch("/invoquer",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ prompt, mode })
    })
    .then(r=>r.json())
    .then(data=>{
      btnVerbe?.classList.remove('active'); masquerAttente();
      if(data?.reponse){
        if(data.audio_url && tts && vocalActif){
          tts.src=data.audio_url+"?t="+Date.now();
          tts.onloadedmetadata=function(){
            const duree=Math.max(tts.duration*1000,1800);
            animeOeilVoix(duree);
            affichePapyrus(data.reponse, duree + 7000); // PATCH: +7s quand lecture vocale
            tts.play().catch(()=>{});
          };
        } else {
          const duree=Math.max(2600, data.reponse.length*55); // PATCH: un peu plus long en texte seul
          animeOeilVoix(duree);
          affichePapyrus(data.reponse, duree);
        }
      } else { affichePapyrus("(Silence sacré)"); }
    })
    .catch(()=>{
      btnVerbe?.classList.remove('active'); masquerAttente();
      affichePapyrus("𓂀 Ankaa : Erreur de communication.");
    });

    if(promptInput) promptInput.value="";
    play(sClick);
  }

  if (btnVerbe && promptInput){
    btnVerbe.addEventListener('click', envoyerVerbe);
    promptInput.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyerVerbe(e); });
  }

  // ===== Souffle sacré (veille) — toggle propre
  let souffleInterval=null, veilleActive=false, souffleEnCours=false;
  const btnVeille=btnVeilleMini;

  if(btnVeille){
    btnVeille.addEventListener('click', function(){
      if(!veilleActive){
        // activation
        veilleActive=true;
        btnVeille.classList.add('active');
        lancerSouffle();
        souffleInterval=setInterval(lancerSouffle, 30000);
      } else {
        // désactivation
        veilleActive=false;
        btnVeille.classList.remove('active');
        clearInterval(souffleInterval); souffleInterval=null;
        souffleEnCours=false;
      }
      play(sClick);
    });
  }

  function lancerSouffle(){
    if(souffleEnCours) return;
    souffleEnCours=true;
    const mode=getMode() || "sentinelle8";

    fetch("/invoquer",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ prompt:"souffle sacré", mode })
    })
    .then(r=>r.json())
    .then(data=>{
      if(data?.reponse){
        if(data.audio_url && tts && vocalActif){
          tts.src=data.audio_url+"?t="+Date.now();
          tts.onloadedmetadata=function(){
            const duree=Math.max(tts.duration*1000,1800);
            animeOeilVoix(duree);
            affichePapyrus(data.reponse, duree + 7000); // PATCH: +7s quand lecture vocale
            tts.play().catch(()=>{});
            setTimeout(()=>{ souffleEnCours=false; }, duree+500);
          };
        } else {
          const duree=Math.max(2600, data.reponse.length*55); // PATCH: un peu plus long en texte seul
          animeOeilVoix(duree);
          affichePapyrus(data.reponse, duree);
          setTimeout(()=>{ souffleEnCours=false; }, duree+500);
        }
      } else { affichePapyrus("(Silence sacré)"); souffleEnCours=false; }
    })
    .catch(()=>{ affichePapyrus("𓂀 Ankaa : Erreur de communication."); souffleEnCours=false; });
  }

  // ===== Mode VOCAL (lecture auto des réponses) — toggle propre
  let vocalActif = false;
  if (btnVocal) {
    btnVocal.addEventListener('click', () => {
      vocalActif = !vocalActif;
      btnVocal.classList.toggle('active', vocalActif);

      // Si on coupe pendant une lecture, on arrête proprement
      if (!vocalActif && tts && !tts.paused) {
        try { tts.pause(); } catch(_){}
      }
      play(sMode);
    });
  }

  // ===== Overlay Mode =====
  const overlayEl = document.getElementById('mode-overlay');
  const optionBtns = Array.from(document.querySelectorAll('#mode-overlay .mode-option'));

  const overlay = {
    open({blockInput}={blockInput:false}){
      if(!overlayEl) return;
      overlayEl.classList.remove('overlay-hidden');
      overlayEl.setAttribute('aria-hidden','false');
      if(blockInput){ if(btnVerbe) btnVerbe.disabled=true; if(promptInput) promptInput.disabled=true; if(btnVocal) btnVocal.disabled=true; }
      play(sOpen);
    },
    close(){
      if(!overlayEl) return;
      overlayEl.classList.add('overlay-hidden');
      overlayEl.setAttribute('aria-hidden','true');
      const hasMode = !!getMode();
      if(btnVerbe)    btnVerbe.disabled=!hasMode;
      if(promptInput) promptInput.disabled=!hasMode;
      if(btnVocal)    btnVocal.disabled=!hasMode;
      play(sClose);
    }
  };
  window.overlay = overlay;

  optionBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const m=btn.getAttribute('data-mode');
      if(m) setMode(m);
    });
  });

  if (btnModeMini){
    btnModeMini.addEventListener('click', ()=>{ overlay.open({blockInput:false}); play(sClick); });
  }

  // --- ESC ferme overlay
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      const ov = document.getElementById('mode-overlay');
      if(ov && !ov.classList.contains('overlay-hidden')){
        overlay.close();
      }
    }
  });

});
