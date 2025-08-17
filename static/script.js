document.addEventListener('DOMContentLoaded', () => {
  // refs
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
  const aura = document.getElementById('aura-ankaa');
  const eye  = document.querySelector('.oeil-centre');
  const header = document.getElementById('en-tete');

  // volumes (doux)
  if (bgm) bgm.volume = 0.22;

  // bouton sanctuaire sous le titre
  function placeTopBtn(){
    if(!header || !btnOpen) return;
    const b = header.getBoundingClientRect();
    btnOpen.style.top = Math.round(b.bottom) + 8 + 'px';
  }
  placeTopBtn();
  window.addEventListener('resize', placeTopBtn);
  window.visualViewport && window.visualViewport.addEventListener('resize', placeTopBtn);

  // états
  let talking = false;
  let mode = null;

  if(tts){
    tts.addEventListener('play',  ()=>{ talking=true;  eye?.classList.add('playing'); aura?.classList.add('active'); });
    tts.addEventListener('pause', ()=>{ talking=false; eye?.classList.remove('playing'); aura?.classList.remove('active'); });
    tts.addEventListener('ended', ()=>{ talking=false; eye?.classList.remove('playing'); aura?.classList.remove('active'); });
  }

  function showPap(text, ms){
    pap.style.display='block';
    ptxt.textContent=text;
    const d = ms || Math.max(2000, text.length*40);
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=''; }, d);
  }

  // ouvre sanctuaire
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    overlay.classList.remove('overlay-hidden');
    overlay.setAttribute('aria-hidden','false');
    btnOpen.style.display='none';
    try{ bgm && bgm.play().catch(()=>{}); }catch{}
  });

  // choisir mode
  function setMode(m){
    mode = m;
    overlay.classList.add('overlay-hidden');
    overlay.setAttribute('aria-hidden','true');
    input.disabled = false;
    btnGo.disabled = false;
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });
  btnMode?.addEventListener('click', ()=>{
    overlay.classList.remove('overlay-hidden');
    overlay.setAttribute('aria-hidden','false');
  });
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape' && !overlay.classList.contains('overlay-hidden')){
      overlay.classList.add('overlay-hidden');
      overlay.setAttribute('aria-hidden','true');
    }
  });

  // Start/Stop même bouton
  async function invoquer(e){
    e && e.preventDefault();
    if(!mode){ overlay.classList.remove('overlay-hidden'); return; }
    if(talking){ tts.pause(); tts.currentTime=0; talking=false; return; }
    const prompt = (input.value || '').trim();
    if(!prompt) return;

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
      showPap("𓂀 Erreur de communication.");
    }
    btnGo.classList.remove('active');
    input.value='';
  }
  btnGo?.addEventListener('click', invoquer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') invoquer(e); });

  // Souffle (voix homme, fragments)
  btnSouffle?.addEventListener('click', async ()=>{
    if(!mode){ overlay.classList.remove('overlay-hidden'); return; }
    const r = await fetch('/invoquer', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt: "souffle sacré", mode })
    });
    const data = await r.json();
    const rep = data?.reponse || '(Souffle silencieux)';
    showPap(rep);
    if(data?.audio_url){ tts.src = data.audio_url + '?t=' + Date.now(); tts.play().catch(()=>{}); }
  });

  // Mode vocal (si supporté)
  btnVocal?.addEventListener('click', ()=>{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ showPap("Micro non supporté sur ce navigateur."); return; }
    const rec = new SR();
    rec.lang = 'fr-FR';
    rec.interimResults = false; rec.continuous = false;
    rec.onresult = (e)=>{ const t = e.results?.[0]?.[0]?.transcript || ''; if(t){ input.value=t; btnGo.click(); } };
    try{ rec.start(); }catch{}
  });
});
