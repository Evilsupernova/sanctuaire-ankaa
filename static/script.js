document.addEventListener('DOMContentLoaded', () => {
  // Débloque l'audio sur iOS au 1er tap
  (function unlockIOS(){
    const ids=['musique-sacree','tts-player'];
    function arm(){
      ids.forEach(id=>{
        const a=document.getElementById(id);
        if(!a) return;
        a.muted=true;
        const p=a.play();
        if(p && p.finally) p.finally(()=>{ a.pause(); a.currentTime=0; a.muted=false; });
      });
      window.removeEventListener('touchstart', arm, {passive:true});
      window.removeEventListener('click', arm, {passive:true});
    }
    window.addEventListener('touchstart', arm, {once:true, passive:true});
    window.addEventListener('click', arm, {once:true, passive:true});
  })();

  // Refs
  const input = document.getElementById('verbe');
  const btnGo = document.getElementById('btn-verbe');
  const btnOpen = document.getElementById('bouton-sanctuaire');
  const btnMode = document.getElementById('btn-mode-mini');
  const btnSouffle = document.getElementById('btn-veille-mini');
  const btnVocal = document.getElementById('btn-vocal');
  const overlay = document.getElementById('mode-overlay');
  const pap = document.getElementById('papyrus-zone');
  const ptxt = document.getElementById('papyrus-texte');
  const tts = document.getElementById('tts-player');
  const bgm = document.getElementById('musique-sacree');
  const header = document.getElementById('en-tete');

  // UI placements
  function placeTopBtn(){
    if(!header || !btnOpen) return;
    const r=header.getBoundingClientRect();
    btnOpen.style.top=(Math.round(r.bottom)+8)+'px';
    btnOpen.style.right='12px';
  }
  placeTopBtn();
  window.addEventListener('resize', placeTopBtn);
  window.visualViewport && window.visualViewport.addEventListener('resize', placeTopBtn);

  // État
  try{ localStorage.removeItem('mode'); }catch(_){}
  let mode=null, talking=false;

  // Titre sur une ligne -> rien à faire ici, géré par CSS

  // Musique (douce)
  if(bgm) bgm.volume=0.22;

  // Overlay helpers
  const showOverlay = (block=false)=>{
    overlay.classList.remove('overlay-hidden');
    overlay.setAttribute('aria-hidden','false');
    if(block){ input.disabled=true; btnGo.disabled=true; }
  };
  const hideOverlay = ()=>{
    overlay.classList.add('overlay-hidden');
    overlay.setAttribute('aria-hidden','true');
  };

  // Papyrus
  function showPap(text, ms){
    pap.style.display='block'; ptxt.textContent=text;
    const d = ms || Math.max(2000, text.length*40);
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=''; }, d);
  }

  // TTS état
  if(tts){
    tts.addEventListener('play', ()=>{ talking=true; });
    tts.addEventListener('ended',()=>{ talking=false; });
    tts.addEventListener('pause',()=>{ talking=false; });
  }

  // Ouvrir le sanctuaire -> affiche l'overlay de mode (caché par défaut)
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    try{ bgm && bgm.play().catch(()=>{}); }catch{}
    showOverlay(true);
    btnOpen.style.display='none';   // disparaît après ouverture
  });

  // Choisir un mode
  function setMode(m){
    mode=m;
    try{ localStorage.setItem('mode', m); }catch(_){}
    input.disabled=false; btnGo.disabled=false;
    hideOverlay();
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });

  // Réouvrir overlay via bouton mode (sans rebloquer input)
  btnMode?.addEventListener('click', ()=> showOverlay(false));

  // Escape pour fermer overlay
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape' && !overlay.classList.contains('overlay-hidden')) hideOverlay();
  });

  // Garde-fou: si on invoque sans mode -> ouvre overlay
  async function invoquer(e){
    e && e.preventDefault();
    if(talking){ tts.pause(); tts.currentTime=0; talking=false; return; }
    const prompt=(input.value||'').trim(); if(!prompt) return;
    if(!mode){ showOverlay(false); return; }

    btnGo.classList.add('active');
    try{
      const r = await fetch('/invoquer', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt, mode })
      });
      const data = await r.json();
      const rep = data?.reponse || '(Silence sacré)';
      showPap(rep);
      if(data?.audio_url){
        tts.src = data.audio_url + '?t=' + Date.now();
        tts.play().catch(()=>{});
      }
    }catch{
      showPap("𓂀 Erreur de communication.");
    }
    btnGo.classList.remove('active');
    input.value='';
  }
  btnGo?.addEventListener('click', invoquer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') invoquer(e); });

  // Souffle (voix homme, fragments du dataset)
  btnSouffle?.addEventListener('click', async ()=>{
    if(!mode){ showOverlay(false); return; }
    try{
      const r = await fetch('/invoquer', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt:"souffle sacré", mode })
      });
      const data = await r.json();
      const rep = data?.reponse || '(Souffle silencieux)';
      showPap(rep);
      if(data?.audio_url){
        tts.src = data.audio_url + '?t=' + Date.now();
        tts.play().catch(()=>{});
      }
    }catch{
      showPap("𓂀 Erreur de communication.");
    }
  });

  // Mode vocal simple (si supporté)
  btnVocal?.addEventListener('click', ()=>{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ showPap("Micro non supporté sur ce navigateur."); return; }
    const rec=new SR(); rec.lang='fr-FR'; rec.interimResults=false; rec.continuous=false;
    rec.onresult=(e)=>{ const t=e.results?.[0]?.[0]?.transcript || ''; if(t){ input.value=t; btnGo.click(); } };
    try{ rec.start(); }catch{}
  });
});
