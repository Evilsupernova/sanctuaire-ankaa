document.addEventListener('DOMContentLoaded', () => {
  // Déblocage audio iOS au 1er tap
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

  // Volumes
  if (bgm) bgm.volume = 0.20;

  // Bouton sanctuaire placé sous le titre
  function placeTopBtn(){
    if(!header || !btnOpen) return;
    const r = header.getBoundingClientRect();
    btnOpen.style.top = (Math.round(r.bottom) + 8) + 'px';
    btnOpen.style.right = '12px';
  }
  placeTopBtn();
  window.addEventListener('resize', placeTopBtn);
  window.visualViewport && window.visualViewport.addEventListener('resize', placeTopBtn);

  // États
  try{ localStorage.removeItem('mode'); }catch(_){}
  let mode = null, talking = false;

  // TTS état
  if(tts){
    tts.addEventListener('play',  ()=>{ talking=true;  document.getElementById('aura-ankaa')?.classList.add('active'); });
    tts.addEventListener('pause', ()=>{ talking=false; document.getElementById('aura-ankaa')?.classList.remove('active'); });
    tts.addEventListener('ended', ()=>{ talking=false; document.getElementById('aura-ankaa')?.classList.remove('active'); });
  }

  function showPap(text, ms){
    pap.style.display='block';
    ptxt.textContent = text || '';
    const d = ms || Math.max(2200, (text||'').length * 40);
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=''; }, d);
  }

  // Overlay API
  const overlayAPI = {
    open(block=false){
      overlay.classList.remove('overlay-hidden');
      overlay.setAttribute('aria-hidden','false');
      if(block){ input.disabled=true; btnGo.disabled=true; }
    },
    close(){
      overlay.classList.add('overlay-hidden');
      overlay.setAttribute('aria-hidden','true');
    }
  };

  // Ouverture sanctuaire (musique + overlay)
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    try{ bgm && bgm.play().catch(()=>{}); }catch{}
    overlayAPI.open(true);          // forcer le choix du mode
    btnOpen.style.display='none';   // bouton disparaît une fois ouvert
  });

  // Réouverture via bouton mode (𓁹)
  btnMode?.addEventListener('click', ()=> overlayAPI.open(false));

  // Choix du mode
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=>{
      mode = b.getAttribute('data-mode');
      try{ localStorage.setItem('mode', mode); }catch(_){}
      input.disabled=false; btnGo.disabled=false;
      overlayAPI.close();
    });
  });

  // ESC pour fermer l’overlay
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && !overlay.classList.contains('overlay-hidden')) overlayAPI.close();
  });

  // Invoquer (Start/Stop sur le même bouton)
  async function invoquer(e){
    e && e.preventDefault();
    if(talking){ tts.pause(); tts.currentTime=0; talking=false; return; }
    const prompt=(input.value||'').trim();
    if(!prompt) return;
    if(!mode){ overlayAPI.open(false); return; } // garde-fou

    btnGo.classList.add('active');
    try{
      const r = await fetch('/invoquer', {
        method:'POST', headers:{'Content-Type':'application/json'},
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
      showPap('𓂀 Erreur de communication.');
    }
    btnGo.classList.remove('active');
    input.value='';
  }
  btnGo?.addEventListener('click', invoquer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') invoquer(e); });

  // Souffle (voix d’homme, fragments dataset)
  btnSouffle?.addEventListener('click', async ()=>{
    if(!mode){ overlayAPI.open(false); return; }
    try{
      const r = await fetch('/invoquer', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt:'souffle sacré', mode })
      });
      const data = await r.json();
      const rep = data?.reponse || '(Souffle silencieux)';
      showPap(rep);
      if(data?.audio_url){
        tts.src = data.audio_url + '?t=' + Date.now();
        tts.play().catch(()=>{});
      }
    }catch{
      showPap('𓂀 Erreur de communication.');
    }
  });

  // Mode vocal (si supporté)
  btnVocal?.addEventListener('click', ()=>{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ showPap('Micro non supporté sur ce navigateur.'); return; }
    const rec = new SR();
    rec.lang = 'fr-FR'; rec.interimResults = false; rec.continuous = false;
    rec.onresult = (e)=>{ const t = e.results?.[0]?.[0]?.transcript || ''; if(t){ input.value=t; btnGo.click(); } };
    try{ rec.start(); }catch{}
  });
});
