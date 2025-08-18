# Sanctuaire Ankaa v13.1 — FR poli, RAG stable, TTS cache, journaux JSON, endpoints service + DIAG séparé
import os, re, json, math, asyncio, unicodedata, random, time
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict, deque
from hashlib import sha1
from flask import Flask, render_template, request, jsonify, make_response

try:
    import edge_tts
except Exception:
    edge_tts = None

app = Flask(__name__, static_url_path="/static", template_folder="templates")
BASE    = Path(__file__).parent.resolve()
DATASET = BASE / "dataset"
MEM     = BASE / "memory"
ASSETS  = BASE / "static" / "assets"
CACHE   = ASSETS / "cache"   # MP3 réutilisables
MEM.mkdir(exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

# ---------- VOIX ----------
VOIX_FEMME = {
    "sentinelle8": "fr-FR-DeniseNeural",
    "dragosly23":  "fr-CA-SylvieNeural",
    "invite":      "fr-FR-VivienneMultilingualNeural",
    "verbe":       "fr-FR-BrigitteMultilingualNeural",
}
VOIX_HOMME = {
    "sentinelle8": "fr-FR-RemyMultilingualNeural",
    "dragosly23":  "fr-CA-JeanNeural",
    "invite":      "fr-FR-HenriNeural",
    "verbe":       "fr-FR-AntoineNeural",
}
MODES = {m: {"mem": MEM / f"memoire_{m}.json"} for m in VOIX_FEMME}

# ---------- Utils texte ----------
EMOJI_RE = re.compile(r"[\U0001F1E6-\U0001F1FF\U0001F300-\U0001FAD6\U0001FAE0-\U0001FAFF\u2600-\u26FF\u2700-\u27BF]+", re.UNICODE)
def strip_emojis(s: str) -> str: return EMOJI_RE.sub(" ", s or "")

def _clean(s):
    if not s: return ""
    s = s.replace("\u200b","").replace("\ufeff","")
    return re.sub(r"\s+"," ", s.replace("\n"," ")).strip()

def _norm(s):
    s=(s or "").lower()
    s=unicodedata.normalize("NFD", s)
    s="".join(c for c in s if unicodedata.category(c)!="Mn")
    s=re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]"," ", s)
    return re.sub(r"\s+"," ", s).strip()

def _tok(s): return [t for t in _norm(s).split() if len(t)>2]
STOP_FR=set("au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont".split())

def jload(p, d):
    try: return json.loads(Path(p).read_text("utf-8")) if Path(p).exists() else d
    except: return d
def jsave(p, x): Path(p).write_text(json.dumps(x, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------- INDEX RAG ----------
FRAGS, DF, N = [], Counter(), 0
def _read_any(p: Path) -> str:
    for enc in ("utf-8","latin-1"):
        try: return p.read_text(enc)
        except: pass
    return ""
def _split(txt: str, name: str):
    if not txt: return []
    parts=[p.strip() for p in re.split(r"\n\s*\n|(?<=[.!?…])\s+", txt) if p.strip()]
    out, buf, cnt=[],[],0
    for p in parts:
        w=p.split()
        if cnt+len(w)<80: buf.append(p); cnt+=len(w); continue
        out.append(" ".join(buf+[p]).strip()); buf,cnt=[],0
    rest=" ".join(buf).strip()
    if rest: out.append(rest)
    clean=[]
    for ch in out:
        w=ch.split()
        clean.append(" ".join(w[:220]) if len(w)>220 else " ".join(w))
    return [{"id":None,"file":name,"text":c} for c in clean if len(c.split())>=50]

def build_index():
    global FRAGS, DF, N
    FRAGS, DF, N = [], Counter(), 0
    if not DATASET.exists():
        print("[INDEX] dataset/ MANQUANT"); return
    files = sorted(DATASET.glob("*.txt"))
    if not files:
        print("[INDEX] 0 fichier .txt"); return
    for p in files:
        raw=_read_any(p)
        if not raw: continue
        for frag in _split(raw, p.name):
            toks=_tok(frag["text"])
            if not toks: continue
            d={"id":len(FRAGS),"file":p.name,"text":frag["text"],"tokens":toks}
            FRAGS.append(d)
            for t in set(toks): DF[t]+=1
    N=len(FRAGS); print(f"[INDEX] {N} fragments.")

def _bm25(q, k1=1.5, b=0.75):
    if not FRAGS: return []
    avgdl=sum(len(d["tokens"]) for d in FRAGS)/len(FRAGS)
    sc=defaultdict(float)
    for t in q:
        df=DF.get(t,0)
        if not df: continue
        idf=math.log(1+(N-df+0.5)/(df+0.5))
        for d in FRAGS:
            tf=d["tokens"].count(t)
            if not tf: continue
            denom=tf + k1*(1 - b + b*(len(d["tokens"])/avgdl))
            sc[d["id"]] += idf*((tf*(k1+1))/denom)
    return sorted(sc.items(), key=lambda x:x[1], reverse=True)

def retrieve(q, k=3):
    qt=[t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGS: return []
    ranked=_bm25(qt)
    out=[]
    top = ranked[0][1] if ranked else 0.0
    min_score = max(0.65, top*0.42)  # coupe le bruit
    for did,sc in ranked[:max(18,k*4)]:
        if sc<min_score: continue
        d=FRAGS[did]
        out.append({"id":d["id"],"file":d["file"],"text":d["text"],"score":round(sc,2)})
        if len(out)>=k: break
    return out

# ---------- FRAGMENTS COMPLETS ----------
def join_consecutive(start_idx, min_words=90, max_words=220):
    if not FRAGS: return ""
    cur=FRAGS[start_idx]; text=_clean(cur["text"]); words=len(text.split())
    j=start_idx+1
    while words<min_words and j<len(FRAGS) and FRAGS[j]["file"]==cur["file"]:
        nxt=_clean(FRAGS[j]["text"]); text=f"{text} {nxt}"; words=len(text.split()); j+=1
        if words>=max_words: break
    return text

def pick_full_fragment():
    if not FRAGS: return None
    i=random.randrange(0, len(FRAGS))
    return join_consecutive(i)

def pick_multi_fragments(n=2):
    out=[]; used=set()
    for _ in range(n):
        i=random.randrange(0, len(FRAGS))
        while i in used: i=random.randrange(0, len(FRAGS))
        used.add(i)
        out.append(join_consecutive(i))
    return [o for o in out if o]

# ---------- Interprétation ----------
def top_keywords(text, n=6):
    words=[w for w in _tok(text) if w not in STOP_FR]
    if not words: return []
    from collections import Counter
    return [w for w,_ in Counter(words).most_common(n)]

def interpret(hits):
    frags=[_clean(h["text"]) for h in hits]
    base=" ".join(frags); lb=base.lower()
    kw=top_keywords(base)
    themes=[]
    if any(k in lb for k in ["amour","authentic", "authenticité","libre"]):
        themes.append("appel à l’amour libre et vrai")
    if any(k in lb for k in ["souffle","respire","respiration"]):
        themes.append("retour au souffle vivant")
    if any(k in lb for k in ["fatigu","perform","efficace"]):
        themes.append("fatigue d’être performant, soif de sens")
    if any(k in lb for k in ["sacré","flamme","feu"]):
        themes.append("réveil du sacré, flamme intérieure")
    lines=[]
    if frags:
        cite=(" ".join(frags[0].split()[:55])+"…")
        lines.append(f"« {cite} »")
    if themes: lines.append("Je lis : " + "; ".join(themes)+".")
    if kw:     lines.append("Signaux : " + ", ".join(kw[:5]) + ".")
    lines.append("Sens : avance sans te perdre dans la performance ; cherche la relation vivante, le feu qui relie.")
    return "\n".join(lines)

def is_greet(s):
    t=_norm(s); return any(w in t for w in ["salut","bonjour","bonsoir","coucou","hello","hey"])
def greet(): return "Salut, frère. De quel passage veux-tu que je tire la lumière ?"

def compose_answer(user):
    hits=retrieve(user, k=3)
    if not hits: return None
    return "Dans tes écrits, voici ce qui se lève :\n" + interpret(hits)

def answer(user, mode):
    # Réponses toujours en français
    if is_greet(user): return greet()
    if _norm(user)=="souffle sacre":
        multi=pick_multi_fragments(n=2) or [pick_full_fragment() or ""]
        text="\n\n".join(multi)
        return "Souffle sacré :\n" + text
    composed=compose_answer(user)
    if composed: return composed
    return "Donne-moi un mot-clé ou une phrase, et je descends dans ton Verbe."

# ---------- FR post-processing ----------
def polish_fr_text(txt: str) -> str:
    if not txt: return ""
    t = strip_emojis(txt)
    t = re.sub(r"\.\.\.", "…", t)             # ... -> …
    t = re.sub(r"\s*([:;!?])", r" \1", t)     # espace avant : ; ! ?
    t = re.sub(r"\s+([\.…])", r"\1", t)       # pas d’espace avant . …
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\s--\s", " — ", t)
    # guillemets français simples (approx)
    t = t.replace('" ', '« ').replace(' "', ' « ').replace('"', ' »')
    return t.strip()

# ---------- TTS ----------
BAD=[r"(?mi)^```.*?$", r"(?mi)^---.*?$", r"(?mi)^#.*?$",
     r"<\/?[^>]+>", r"\b(?:speech|speak|voice|pitch|rate|prosody)\s*=\s*[^,\s]+",
     r"(?mi)^\s*(?:Dialogue\s*:|S\d+\])\s*", r"[𓂀☥]\s*[A-ZÉÈÊÎÂÔÛ][^:]{0,20}:\s*",
     r"[\/\\]{1,}", r"\[[^\]]+\]", r"\([^)]+\)"]
def strip_tts(txt):
    t=strip_emojis(txt or "")
    for p in BAD: t=re.sub(p," ", t)
    return re.sub(r"\s+"," ", t).strip(" .")

def split_sentences(text: str):
    raw=[s.strip() for s in re.split(r"(?<=[\.!?…])\s+", text) if s.strip()]
    out=[]; buf=""
    for s in raw:
        if len(s.split())<6: buf=(buf+" "+s).strip(); continue
        if buf: out.append(buf); buf=""
        out.append(s)
    if buf: out.append(buf)
    return out[:14]

def voice_params(mode: str, is_souffle: bool):
    if is_souffle:
        return VOIX_HOMME.get(mode,"fr-FR-RemyMultilingualNeural"), "-2%", "default"
    return VOIX_FEMME.get(mode,"fr-FR-DeniseNeural"), "+2%", "default"

def _tts_azure(text, voice, out_file: Path):
    try:
        import azure.cognitiveservices.speech as speechsdk
        key=os.getenv("AZURE_SPEECH_KEY"); region=os.getenv("AZURE_SPEECH_REGION")
        if not key or not region: return "disabled"
        speech_config=speechsdk.SpeechConfig(subscription=key, region=region)
        speech_config.speech_synthesis_voice_name=voice
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3)
        audio_config=speechsdk.audio.AudioOutputConfig(filename=str(out_file))
        synthesizer=speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)
        result=synthesizer.speak_text_async(strip_tts(text)).get()
        ok=(result.reason==speechsdk.ResultReason.SynthesizingAudioCompleted)
        return "ok" if (ok and out_file.exists() and out_file.stat().st_size>800) else "error"
    except Exception as e:
        print("[azure-tts error]", e); return "error"

async def _edge_async(text, voice, rate, pitch, out_path):
    if edge_tts is None: return "disabled"
    kwargs={"voice": voice}
    if rate: kwargs["rate"]=rate
    if pitch and pitch!="default": kwargs["pitch"]=pitch
    comm=edge_tts.Communicate(strip_tts(text), **kwargs)
    await comm.save(str(out_path))
    return "ok"

def _tts_edge(text, voice, rate, pitch, out_file: Path):
    if edge_tts is None: return "disabled"
    try:
        if out_file.exists():
            try: out_file.unlink()
            except: pass
        loop=asyncio.new_event_loop(); asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_edge_async(text, voice, rate, pitch, out_file), timeout=25))
        loop.close()
        return "ok" if (out_file.exists() and out_file.stat().st_size>800) else "error"
    except Exception as e:
        try: loop.close()
        except: pass
        print("[edge-tts error]", e); return "error"

def do_tts(text, voice, rate, pitch, out_file: Path):
    st=_tts_azure(text, voice, out_file)
    if st=="ok": return "ok"
    if st!="disabled": print("[tts] Azure KO, fallback edge-tts…")
    return _tts_edge(text, voice, rate, pitch, out_file)

def cache_path_for(text: str, voice: str, rate: str, pitch: str) -> Path:
    key = f"{voice}|{rate}|{pitch}|{strip_tts(text)}"
    h = sha1(key.encode("utf-8")).hexdigest()[:24]
    return CACHE / f"tts_{h}.mp3"

# ---------- HEADERS ----------
@app.after_request
def add_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp

# ---------- Routes ----------
@app.route("/")
def index(): return render_template("index.html")

@app.route("/health")
def health(): return jsonify({"ok": True, "time": datetime.utcnow().isoformat()+"Z"})

@app.route("/activer-ankaa")
def activer_ankaa(): return jsonify({"status": "ok"})

@app.route("/service-worker.js")
def sw(): return app.send_static_file("service-worker.js")

@app.route("/diag")
def diag():
    return jsonify({"dataset_exists": DATASET.exists(),
                    "files": sorted([p.name for p in DATASET.glob('*.txt')]) if DATASET.exists() else [],
                    "fragments": len(FRAGS)})

@app.route("/reindex", methods=["POST","GET"])
def reindex():
    build_index()
    return jsonify({"fragments": len(FRAGS)})

# Journal circulaire en mémoire (dernier 200)
INV_LOG = deque(maxlen=200)

@app.route("/invoquer", methods=["POST"])
def invoquer():
    t0 = time.time()
    data = request.get_json(force=True) or {}
    mode = (data.get("mode") or "sentinelle8").strip().lower()
    if mode not in MODES: mode="sentinelle8"
    prompt = data.get("prompt") or ""
    is_souffle = (_norm(prompt)=="souffle sacre")

    # Réponse française polie
    rep = answer(prompt, mode) or ""
    rep = polish_fr_text(rep)

    # Mémoire (mode)
    memp=MODES[mode]["mem"]
    mem=jload(memp, {"fragments":[]})
    mem["fragments"].append({
        "date":datetime.now().isoformat(),
        "mode":mode,"souffle":is_souffle,"prompt":prompt,"reponse":rep
    })
    mem["fragments"]=mem["fragments"][-200:]
    jsave(memp, mem)

    # Découpage + TTS (cache)
    segments = split_sentences(rep)
    out_list=[]
    voice, rate, pitch = voice_params(mode, is_souffle)
    for seg in segments:
        p = cache_path_for(seg, voice, rate, pitch)
        status = "ok" if (p.exists() and p.stat().st_size>800) else do_tts(seg, voice, rate, pitch, p)
        if status=="ok":
            out_list.append({"text": seg, "audio_url": f"/static/assets/cache/{p.name}"})
        else:
            out_list.append({"text": seg, "audio_url": None})

    # Log JSON + journal mémoire
    log = {
        "ts": datetime.utcnow().isoformat()+"Z",
        "mode": mode,
        "souffle": is_souffle,
        "prompt_len": len(prompt or ""),
        "segments": len(segments),
        "dur_ms": int((time.time()-t0)*1000)
    }
    print("[invoke]", json.dumps(log, ensure_ascii=False))
    INV_LOG.append(log)

    return jsonify({"segments": out_list, "tts": "ok", "lang": "fr"})

# -------- DIAG FRONT SEPARE (n'interfère pas avec l'app) --------
@app.route("/diag-log")
def diag_log():
    return jsonify(list(INV_LOG))

@app.route("/diag-front")
def diag_front():
    # IMPORTANT: pas de f-string ici, pour éviter les accolades CSS/JS qui cassent l'analyse
    html = """<!doctype html>
<html lang="fr"><meta charset="utf-8">
<title>Diag Front — Sanctuaire Ankaa</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#0f1115;color:#eaeef2;margin:20px}
  h1{font-size:20px;margin:0 0 12px}
  .row{display:flex;gap:10px;align-items:center;margin:8px 0}
  .ok{color:#90ee90} .ko{color:#ff8080}
  table{border-collapse:collapse;width:100%;margin-top:12px}
  th,td{border:1px solid #334; padding:6px 8px; font-size:13px}
  th{background:#18202b}
  .mono{font-family:ui-monospace,Consolas,Monaco,monospace}
  button{background:#1b2838;color:#eaeef2;border:1px solid #334;padding:6px 10px;border-radius:6px;cursor:pointer}
  button:hover{filter:brightness(1.1)}
</style>
<h1>Diag Front — Sanctuaire Ankaa</h1>
<div class="row">
  <button id="ping">Ping /health</button>
  <span id="pingres"></span>
</div>
<div class="row">
  <button id="refresh">Rafraîchir journal</button>
  <span>Affiche les 50 dernières invocations</span>
</div>
<table id="log">
  <thead><tr>
    <th>Horodatage</th><th>Mode</th><th>Souffle</th><th>Segments</th><th>Durée (ms)</th><th>Prompt len</th>
  </tr></thead>
  <tbody></tbody>
</table>
<script>
const pingBtn = document.getElementById('ping');
const pingRes = document.getElementById('pingres');
const refreshBtn = document.getElementById('refresh');
const tbody = document.querySelector('#log tbody');

pingBtn.onclick = async ()=>{
  pingRes.textContent = '…';
  try{
    const r = await fetch('/health');
    const j = await r.json();
    pingRes.textContent = j.ok ? 'OK' : 'KO';
    pingRes.className = j.ok ? 'ok' : 'ko';
  }catch(e){
    pingRes.textContent = 'KO'; pingRes.className = 'ko';
  }
};

async function loadLog(){
  try{
    const r = await fetch('/diag-log');
    const arr = await r.json();
    const last = arr.slice(-50).reverse();
    tbody.innerHTML = last.map(x=>`
      <tr>
        <td class="mono">${x.ts||''}</td>
        <td>${x.mode||''}</td>
        <td>${x.souffle? 'oui':'non'}</td>
        <td>${x.segments||0}</td>
        <td>${x.dur_ms||0}</td>
        <td>${x.prompt_len||0}</td>
      </tr>
    `).join('');
  }catch(e){
    tbody.innerHTML = '<tr><td colspan="6" class="ko">Impossible de charger /diag-log</td></tr>';
  }
}
refreshBtn.onclick = loadLog;
loadLog();
</script>
"""
    return make_response(html, 200, {"Content-Type": "text/html; charset=utf-8"})

# ---------- BOOT ----------
build_index()
if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)), debug=True)
