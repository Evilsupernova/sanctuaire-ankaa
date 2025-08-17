// V10 mobile — correctifs : TTS fiable iOS, titre 1 ligne auto-fit, boutons gauche/droite, dactylo plus lente
document.addEventListener('DOMContentLoaded', () => {
  // viewport iOS
  function setVh(){
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`);
  }
  setVh(); window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // refs
  const input   = document.getElementById('verbe');
  const btnGo   = document.getElementById('btn-verbe');
  const zone    = document.getElementById('zone-invocation');
  const btnOpen = document.getElementById('bouton-sanctuaire');
  const btnMode = document.getElementById('btn-mode-mini');
  const btnVeil = document.getElementById('btn-veille-mini');
  const tts     = document.getElementById('tts-player');
  const bgm     = document.getElementById('musique-sacree');
  const sClick  = document.getElementById('s-click');
  const sOpen   = document.getElementById('s-open');
  const sClose  = document.getElementById('s-close');
  const sMode   = document.getElementById('s-mode');
  const eye     = document.querySelector('.oeil-centre');
  const aura    = document.getElementById('aura-ankaa');
  const pap     = document.getElementById('papyrus-zone');
  const ptxt    = document.getElementById('papyrus-texte');
  const pts     = document.getElementById('points-sacrés');
  const overlayEl = document.getElementById('mode-overlay');
  const title   = document.getElementById('titre-unique');
  const head    = document.getElementById('en-tete');
  const toolsL  = document.getElementById('tools-left');
  const toolsR  = document.getElementById('tools-right');

  // volumes
  if (bgm) bgm.volume = 0.18;
  [sClick,sOpen,sClose,sMode].forEach(a=>{ if(a) a.volume=0.28; });

  // déverrouillage audio iOS au 1er tap
  (function unlock(){
    const arr=[bgm,tts,sClick,sOpen,sClose,sMode].filter(Boolean);
    function arm(){
      arr.forEach(x=>{ try{
        x.muted=true; const p=x.play(); (p&&p.finally)?p.finally(()=>{x.pause();x.currentTime=0;x.muted=false;}):(x.muted=false);
      }catch{} });
      window.removeEventListener('touchstart', arm, {passive:true});
      window.removeEventListener('click', arm, {passive:true});
    }
    window.addEventListener('touchstart', arm, {once:true, passive:true});
    window.addEventListener('click', arm, {once:true, passive:true});
  })();

  // Titre : fit sur 1 ligne (diminue la taille si besoin)
  function fitTitle(){
    if(!title) return;
    const max=36, min=14;
    let size=parseFloat(getComputedStyle(title).fontSize)||max;
    title.style.fontSize=max+'px';
    const wrap=title.parentElement;
    while(title.scrollWidth > wrap.clientWidth && size>min){ size-=1; title.style.fontSize=size+'px'; }
  }
  fitTitle(); window.addEventListener('resize', fitTitle); window.visualViewport && window.visualViewport.addEventListener('resize', fitTitle);

  // place outils sous le titre (gauche et droite)
  function placeTools(){
    if(!head) return;
    const b=head.getBoundingClientRect();
    const top = Math.round(b.bottom + 8) + 'px';
    if(toolsL) toolsL.style.top = top;
    if(toolsR) toolsR.style.top = top;
  }
  placeTools(); window.addEventListener('resize', placeTools); window.visualViewport && window.visualViewport.addEventListener('resize', placeTools);

  // état initial
  try{ localStorage.removeItem('mode'); }catch(_){}
  if(zone) zone.style.display='none';
  [btnGo,input].forEach(el=> el && (el.disabled = true));

  // utils
  const safePlay=a=>{ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); };
  const wait=on=>{ if(!pts) return; pts.style.display = on ? 'block' : 'none'; };

  // chat height -> pas de chevauchements
  function syncChatH(){
    const z=document.getElementById('zone-invocation'); if(!z) return;
    const h=Math.ceil(z.getBoundingClientRect().height||56);
    document.documentElement.style.setProperty('--chat-h', h+'px');
  }
  syncChatH(); window.addEventListener('resize', syncChatH); window.visualViewport && window.visualViewport.addEventListener('resize', syncChatH);

  // overlay
  const overlay={
    open({blockInput}={blockInput:false}){
      overlayEl?.classList.remove('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','false');
      if(blockInput){ btnGo&&(btnGo.disabled=true); input&&(input.disabled=true); }
      safePlay(sOpen);
    },
    close(){
      overlayEl?.classList.add('overlay-hidden'); overlayEl?.setAttribute('aria-hidden','true');
      safePlay(sClose);
    }
  };

  // ouvrir sanctuaire (bouton à DROITE) -> disparaît après ouverture
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    safePlay(sOpen);
    if(zone) zone.style.display='grid';
    if(btnGo) btnGo.disabled=true;
    if(input) input.disabled=true;
    if(bgm) safePlay(bgm);
    overlay.open({blockInput:true});
    if(btnOpen) btnOpen.style.display='none'; // cache le bouton
    placeTools();
  });

  // choix mode
  function setMode(key){
    try{ localStorage.setItem('mode', key); }catch(_){}
    btnGo&&(btnGo.disabled=false);
    input&&(input.disabled=false);
    overlay.close(); safePlay(sMode);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });
  document.getElementById('btn-mode-mini')?.addEventListener('click', ()=> overlay.open({blockInput:false}));
  document.addEventListener('keydown', (e)=>{
    if(e.key==='Escape' && overlayEl && !overlayEl.classList.contains('overlay-hidden')) overlay.close();
  });

  // visu
  function playVisu(d){ if(eye) eye.classList.add('playing'); if(aura) aura.classList.add('active');
    setTimeout(()=>{ eye?.classList.remove('playing'); aura?.classList.remove('active'); }, Math.max(d,1200));
  }
  function showPap(text,d){ if(!pap||!ptxt) return; pap.style.display='flex'; ptxt.textContent='';
    let i=0, L=text.length;
    // dactylo beaucoup plus lente
    const step = Math.max(28, (d/Math.max(1,L)) * 2.2);
    (function loop(){ if(i<L){ ptxt.textContent+=text[i++]; setTimeout(loop, step);} })();
    // papyrus reste longtemps
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=''; }, Math.max(d+1200, 3500));
  }

  // envoyer
  async function envoyer(e){
    e && e.preventDefault();
    const prompt=(input?.value||"").trim(); if(!prompt) return;
    const mode=localStorage.getItem('mode')||null;
    if(!mode){ overlay.open({blockInput:false}); return; }

    safePlay(sClick); wait(true); btnGo?.classList.add('active');
    try{
      const r=await fetch("/invoquer",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt, mode })});
      const data=await r.json(); wait(false); btnGo?.classList.remove('active');
      const rep=data?.reponse||"(Silence sacré)";

      if(data?.audio_url && tts){
        // on attend le canplaythrough pour iOS
        tts.src=data.audio_url+"?t="+Date.now();
        const onReady=()=>{ tts.removeEventListener('canplaythrough',onReady);
          const d=Math.max(2200,(tts.duration||2.8)*1000);
          playVisu(d); showPap(rep,d); safePlay(tts);
        };
        tts.addEventListener('canplaythrough', onReady, {once:true});
        // sécurité si l’événement ne vient pas
        setTimeout(()=>{ if(tts.readyState<3){ const d=Math.max(2600, rep.length*55); playVisu(d); showPap(rep,d);} }, 1200);
      } else {
        const d=Math.max(3000, rep.length*60); // réponses affichées plus longtemps
        playVisu(d); showPap(rep,d);
      }
    }catch{
      wait(false); btnGo?.classList.remove('active'); showPap("𓂀 Ankaa : Erreur de communication.");
    }
    if(input) input.value="";
  }
  btnGo?.addEventListener('click', envoyer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });

  // souffle (voix homme côté serveur)
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
    fetch("/invoquer",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt:"souffle sacré", mode })})
      .then(r=>r.json()).then(data=>{
        const rep=data?.reponse||"(Silence sacré)";
        if(data?.audio_url && tts){
          tts.src=data.audio_url+"?t="+Date.now();
          const ready=()=>{ tts.removeEventListener('canplaythrough',ready);
            const d=Math.max(2400,(tts.duration||3.2)*1000);
            playVisu(d); showPap(rep,d); safePlay(tts); setTimeout(()=>souffleLock=false, d+400);
          };
          tts.addEventListener('canplaythrough', ready, {once:true});
          setTimeout(()=>{ if(tts.readyState<3){ const d=Math.max(2800, rep.length*60); playVisu(d); showPap(rep,d); souffleLock=false; } }, 1400);
        } else {
          const d=Math.max(2800, rep.length*60); playVisu(d); showPap(rep,d); setTimeout(()=>souffleLock=false, d+400);
        }
      })
      .catch(()=>{ showPap("𓂀 Ankaa : Erreur de communication."); souffleLock=false; });
  }
});
