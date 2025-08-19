// Sanctuaire Ankaa — v16 PRO
// - Anti double-clic (verrou)
// - Reset fiable des boutons (ended/error/abort)
// - Papyrus +7s quand audio
// - Ducking musique pendant voix
// - Fond gelé quand clavier (évite saut/zoom visuel)
// - Zéro changement de positions UI

document.addEventListener('DOMContentLoaded', function () {
  // --vh stable pour mobiles
  function setVh(){ document.documentElement.style.setProperty('--vh', `${window.innerHeight*0.01}px`); }
  setVh();
  ['resize','orientationchange','focusin','focusout'].forEach(ev=>window.addEventListener(ev,setVh));
  window.addEventListener('focusin', ()=> document.body.classList.add('keyboard-open'));
  window.addEventListener('focusout',()=> document.body.classList.remove('keyboard-open'));

  // DOM
  const zoneInvocation   = document.getElementById('zone-invocation');
  const btnModeMini      = document.getElementById('btn-mode-mini');
  const btnVeilleMini    = document.getElementById('btn-veille-mini'); // Souffle
  const btnVerbe         = document.getElementById('btn-verbe');
  const promptInput      = document.getElementById('verbe');
  const boutonSanctuaire = document.getElementById('bouton-sanctuaire');
  const btnVocal         = document.getElementById('btn-vocal');

  // Audio
  const musique = document.getElementById('musique-sacree');
  const tts     = document.getElementById('tts-player');
  const sClick  = document.getElementById('s-click');
  const sOpen   = document.getElementById('s-open');
  const sClose  = document.getElementById('s-close');
  const sMode   = document.getElementById('s-mode');

  if (musique) musique.volume = 0.04;   // musique plus douce
  if (tts)     tts.volume     = 1.0;    // voix au max

  [sOpen, sClose, sMode].forEach(a => a && (a.volume = 0.24));
  if (sClick) sClick.volume = 0.18;
  const play = (a)=>{ try{ a && (a.currentTime=0) && a.play().catch(()=>{});}catch(_){ } };

  // Ducking musique
  let musikVolumeBase = musique ? (musique.volume || 0.04) : 0.04;
  function duckMusic(on){
    if(!musique) return;
    try { musique.volume = on ? musikVolumeBase*0.35 : musikVolumeBase; } catch(_){}
  }

  // États init
  if (zoneInvocation) zoneInvocation.style.display = 'none';
  if (btnModeMini)    { btnModeMini.disabled = true; btnModeMini.style.visibility = 'hidden'; }
  if (btnVeilleMini)  btnVeilleMini.disabled = true;
  if (btnVerbe)       btnVerbe.disabled = true;
  if (promptInput)    promptInput.disabled = true;
  if (btnVocal)       btnVocal.disabled = true;

  // Attente
  function afficherAttente(){ const a=document.getElementById("points-sacrés"); if(a) a.style.display="block"; }
  function masquerAttente(){ const a=document.getElementById("points-sacrés"); if(a) a.style.display="none"; }

  // Œil + aura pendant audio
  function animeOeilVoix(duree_ms){
    const oeil=document.querySelector('.oeil-centre');
    const aura=document.getElementById('aura-ankaa');
    if(oeil) oeil.classList.add('playing');
    if(aura) aura.classList.add('active');
    setTimeout(()=>{ if(oeil) oeil.classList.remove('playing'); if(aura) aura.classList.remove('active'); }, Math.max(600, duree_ms||0));
  }

  // Papyrus
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

  // Mode persistant
  function getMode(){ try{ return window.localStorage.getItem('mode'); }catch(_){ return null; } }
  function setMode(modeKey){
    try{ window.localStorage.setItem('mode', modeKey); }catch(_){}
    const html = document.documentElement;
    if (html){
      html.setAttribute('data-mode', modeKey);
      html.classList.add('pulse-accent');
      setTimeout(()=> html.classList.remove('pulse-accent'), 950);
    }
    if(btnVerbe)    btnVerbe.disabled=false;
    if(promptInput) promptInput.disabled=false;
    if(btnVocal)    btnVocal.disabled=false;
    play(sMode);
    overlay.close();
  }

  // Sanctuaire
  if (boutonSanctuaire) boutonSanctuaire.addEventListener('click', activerSanctuaire);
  function activerSanctuaire() {
    if (musique) musique.play().catch(()=>{});
    if (zoneInvocation) zoneInvocation.style.display = 'flex';
    if (btnModeMini)   { btnModeMini.disabled = false; btnModeMini.style.visibility = 'visible'; }
    if (btnVeilleMini) btnVeilleMini.disabled = false;
    if (btnVerbe)      btnVerbe.disabled      = true;
    if (promptInput)   promptInput.disabled   = true;
    if (btnVocal)      btnVocal.disabled      = true;
    try { fetch('/activer-ankaa').catch(()=>{}); } catch(_){}
    if (boutonSanctuaire) boutonSanctuaire.style.display = 'none';
    overlay.open({blockInput:true});
    play(sOpen);
  }

  // ===== Envoi "Verbe" (anti double-clic) =====
  let demandeEnCours = false;

  function envoyerVerbe(e){
    if(e) e.preventDefault();
    if (demandeEnCours) return;
    const prompt=(promptInput?.value||"").trim();
    if(!prompt) return;

    const mode=getMode();
    if(!mode){ overlay.open({blockInput:false}); return; }

    demandeEnCours = true;
    btnVerbe?.classList.add('active'); afficherAttente();

    fetch("/invoquer",{
      method:"POST", headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ prompt, mode })
    })
    .then(r=>r.json())
    .then(data=>{
      if(data?.reponse){
        if(data.audio_url && tts && vocalActif){
          tts.src=data.audio_url+"?t="+Date.now();
          tts.onloadedmetadata=function(){
            const duree=Math.max(tts.duration*1000,1800);
            animeOeilVoix(duree);
            affichePapyrus(data.reponse, duree + 7000); // +7s en lecture
            tts.play().catch(()=>{});
          };
        } else {
          const duree=Math.max(2600, data.reponse.length*55);
          animeOeilVoix(duree);
          affichePapyrus(data.reponse, duree);
        }
      } else { affichePapyrus("(Silence sacré)"); }
    })
    .catch(()=>{
      affichePapyrus("𓂀 Ankaa : Erreur de communication.");
    })
    .finally(()=>{
      demandeEnCours = false;
      btnVerbe?.classList.remove('active');
      masquerAttente();
    });

    if(promptInput) promptInput.value="";
    play(sClick);
  }
  if (btnVerbe && promptInput){
    btnVerbe.addEventListener('click', envoyerVerbe);
    promptInput.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyerVerbe(e); });
  }

  // ===== Souffle sacré (veille) =====
  let souffleInterval=null, veilleActive=false, souffleEnCours=false, ttsSouffle=false;

  if(btnVeilleMini){
    btnVeilleMini.addEventListener('click', function(){
      if(!veilleActive){
        veilleActive=true;
        btnVeilleMini.classList.add('active');
        lancerSouffle();
        souffleInterval=setInterval(lancerSouffle, 30000);
      } else {
        veilleActive=false;
        btnVeilleMini.classList.remove('active');
        clearInterval(souffleInterval); souffleInterval=null;
        souffleEnCours=false; ttsSouffle=false;
      }
      play(sClick);
    });
  }

  function lancerSouffle(){
    if(souffleEnCours) return;
    souffleEnCours=true;
    const mode=getMode() || "sentinelle8";

    fetch("/invoquer",{
      method:"POST", headers:{ "Content-Type":"application/json" },
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
            affichePapyrus(data.reponse, duree + 7000); // +7s
            ttsSouffle = true;
            tts.play().catch(()=>{});
            setTimeout(()=>{ souffleEnCours=false; }, duree+500);
          };
        } else {
          const duree=Math.max(2600, data.reponse.length*55);
          animeOeilVoix(duree);
          affichePapyrus(data.reponse, duree);
          setTimeout(()=>{ souffleEnCours=false; }, duree+500);
        }
      } else { affichePapyrus("(Silence sacré)"); souffleEnCours=false; }
    })
    .catch(()=>{ affichePapyrus("𓂀 Ankaa : Erreur de communication."); souffleEnCours=false; });
  }

  // ===== Mode Vocal =====
  let vocalActif = false;
  if (btnVocal) {
    btnVocal.addEventListener('click', () => {
      vocalActif = !vocalActif;
      btnVocal.classList.toggle('active', vocalActif);
      if (!vocalActif && tts && !tts.paused) { try { tts.pause(); } catch(_){ } }
      play(sMode);
    });
  }

  // ===== TTS events : duck + reset fiable =====
  if (tts) {
    tts.addEventListener('play',  ()=> duckMusic(true));
    const resetUiAfterVoice = () => {
      duckMusic(false);
      if (!vocalActif) btnVocal?.classList.remove('active');
      if (!veilleActive) btnVeilleMini?.classList.remove('active');
      ttsSouffle = false;
      souffleEnCours = false;
    };
    ['pause','ended','error','abort'].forEach(evt => tts.addEventListener(evt, resetUiAfterVoice));
  }

  // ===== Overlay modes =====
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
    btn.addEventListener('click', ()=> {
      const m=btn.getAttribute('data-mode');
      if(m) setMode(m);
    });
  });

  if (btnModeMini){
    btnModeMini.addEventListener('click', ()=>{ overlay.open({blockInput:false}); play(sClick); });
  }

  // ESC ferme overlay
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      const ov = document.getElementById('mode-overlay');
      if(ov && !ov.classList.contains('overlay-hidden')) overlay.close();
    }
  });
});
