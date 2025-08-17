# app.py — Sanctuaire Ankaa V10.2 (base V10.1 stabilisée)
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

# TTS Edge
try:
    import edge_tts
except Exception:
    edge_tts = None

app = Flask(__name__, static_url_path="/static")

BASE = Path(__file__).parent.resolve()
DATASET = BASE / "dataset"
MEMORY  = BASE / "memory"
AUDIO   = BASE / "static" / "assets"
MEMORY.mkdir(exist_ok=True)
AUDIO.mkdir(parents=True, exist_ok=True)

# ---- Voix : FEMME = invocation / HOMME = souffle
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
MODES = {m: {"mem": MEMORY / f"memoire_{m}.json"} for m in VOIX_FEMME}

# ---- utils
def _clean(s): 
    return re.sub(r"\s+"," ", (s or "").replace("\n"," ")).strip()

def load_json(p, d): 
    try: return json.loads(Path(p).read_text("utf-8")) if Path(p).exists() else d
    except: return d

def save_json(p, x): Path(p).write_text(json.dumps(x, ensure_ascii=False, indent=2), encoding="utf-8")

def _norm(s):
    s=(s or "").lower()
    s=unicodedata.normalize("NFD", s)
    s="".join(c for c in s if unicodedata.category(c)!="Mn")
    s=re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s)
    return re.sub(r"\s+"," ", s).strip()

def _tok(s): return [t for t in _norm(s).split() if len(t)>2]

STOP_FR=set("au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c".split())

# ---- Dataset BM25 (pour Souffle)
FRAGS, DF, N = [], Counter(), 0

def _read_safe(p: Path) -> str:
    for enc in ("utf-8","latin-1"):
        try: return p.read_text(enc)
        except: pass
    return ""

def build_index():
    global FRAGS, DF, N
    FRAGS, DF, N = [], Counter(), 0
    if not DATASET.exists(): 
        print("[INDEX] dataset/ absent"); 
        return
    for p in sorted(DATASET.glob("*.txt")):
        raw=_read_safe(p)
        parts=[x.strip() for x in re.split(r"\n\s*\n|[.!?…]\s+", raw) if len(x.split())>=40]
        for frag in parts:
            toks=_tok(frag)
            if not toks: continue
            FRAGS.append({"id":len(FRAGS),"text":frag,"tokens":toks})
            for t in set(toks): DF[t]+=1
    N=len(FRAGS)
    print(f"[INDEX] {N} fragments.")
build_index()

def _bm25(q, k1=1.5, b=0.75):
    if not FRAGS: return []
    avgdl = sum(len(d["tokens"]) for d in FRAGS)/len(FRAGS)
    sc=defaultdict(float)
    for t in q:
        df=DF.get(t,0)
        if not df: continue
        idf=math.log(1+(N-df+0.5)/(df+0.5))
        for d in FRAGS:
            tf=d["tokens"].count(t)
            if not tf: continue
            sc[d["id"]] += idf*((tf*(k1+1)) / (tf + k1*(1 - b + b*(len(d["tokens"])/avgdl))))
    return sorted(sc.items(), key=lambda x:x[1], reverse=True)

def retrieve(q, k=3):
    qt=[t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGS: return []
    return [FRAGS[i]["text"] for i,_ in _bm25(qt)[:k]]

# ---- Réponses
def is_greet(s): 
    t=_norm(s); return any(w in t for w in ["salut","bonjour","bonsoir","coucou","hello","hey"])

def dialogue_answer(user_text: str) -> str:
    user_text=_clean(user_text)
    if len(user_text)<4: 
        return "Dis-m’en un peu plus et je te réponds franchement."
    lead=random.choice(["Je comprends.","D’accord.","Je te suis."])
    ask=random.choice([
        "Tu veux qu’on clarifie, ou qu’on passe à une action concrète ?",
        "On vise le cœur du sujet ou on commence simple ?",
        "Tu veux un plan en 3 étapes ?",
    ])
    return f"{lead} {ask}"

def souffle_answer() -> str:
    src=retrieve("souffle méditation paix lumière")
    if not src:
        return "Respire. Je garde la flamme pendant que tu te poses."
    body="\n".join("• "+_clean(t)[:120]+"…" for t in src)
    fin=random.choice(["— Respire, je suis là.","— Laisse la lumière t’habiter.","— Doucement, tout va bien."])
    return f"{body}\n\n{fin}"

# ---- SSML (pitch retiré -> compatibilité max)
def build_ssml(text: str, style: str = "narration-relaxed", rate: str = "+0%") -> str:
    s=_clean(text).replace("..","…")
    return f"""
<speak version="1.0" xml:lang="fr-FR" xmlns:mstts="https://www.w3.org/2001/mstts">
  <mstts:express-as style="{style}" styledegree="1.0">
    <prosody rate="{rate}">
      <break time="220ms"/>{s}<break time="240ms"/>
    </prosody>
  </mstts:express-as>
</speak>""".strip()

async def _tts_async(ssml: str, voice: str, out_file: Path):
    comm=edge_tts.Communicate(ssml, voice=voice, ssml=True)
    await comm.save(str(out_file))

def do_tts(text: str, voice: str, out_file: Path, style="narration-relaxed", rate="+0%") -> str:
    if edge_tts is None: return "disabled"
    try:
        if out_file.exists():
            try: out_file.unlink()
            except: pass
        ssml=build_ssml(text, style=style, rate=rate)
        loop=asyncio.new_event_loop(); asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_tts_async(ssml, voice, out_file), timeout=20))
        loop.close()
        return "ok" if (out_file.exists() and out_file.stat().st_size>1000) else "error"
    except Exception as e:
        try: loop.close()
        except: pass
        print("[TTS error]", e)
        return "error"

# ---- Routes
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/activer-ankaa")
def activer():
    # simple ping pour marquer l'ouverture (évite 404/500 dans les logs)
    return ("", 204)

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data=request.get_json(force=True) or {}
    mode=(data.get("mode") or "sentinelle8").strip().lower()
    if mode not in MODES: mode="sentinelle8"
    prompt=data.get("prompt") or ""
    is_souffle = (_norm(prompt)=="souffle sacre")

    if is_greet(prompt):
        rep="Salut, frère 🌙. Je t’écoute — qu’est-ce qu’on éclaire ?"
    elif is_souffle:
        rep=souffle_answer()
    else:
        # INVOCATION = dialogue naturel (pas de récitation dataset)
        rep=dialogue_answer(prompt)

    # mémoire légère
    memp=MODES[mode]["mem"]; mem=load_json(memp, {"fragments":[]})
    mem["fragments"].append({"date":datetime.now().isoformat(),"mode":mode,"souffle":is_souffle,"prompt":prompt,"reponse":rep})
    mem["fragments"]=mem["fragments"][-200:]; save_json(memp, mem)

    # TTS : femme en invocation / homme en souffle
    voice = VOIX_HOMME[mode] if is_souffle else VOIX_FEMME[mode]
    style = "narration-relaxed" if not is_souffle else "empathetic"
    rate  = "+2%" if not is_souffle else "-2%"
    out=AUDIO/"anka_tts.mp3"
    tts_status=do_tts(rep, voice, out, style=style, rate=rate)
    url=f"/static/assets/{out.name}" if tts_status=="ok" else None

    return jsonify({"reponse":rep, "audio_url":url, "tts":tts_status})

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)), debug=True)
