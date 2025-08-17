# app.py — Sanctuaire Ankaa V10 (TTS sans SSML, compatible Render)
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

# --- edge-tts (sans SSML) ---
try:
    import edge_tts
except Exception:
    edge_tts = None

app = Flask(__name__, static_url_path="/static")

BASE    = Path(__file__).parent.resolve()
DATASET = BASE / "dataset"
MEMORY  = BASE / "memory"
AUDIO   = BASE / "static" / "assets"
MEMORY.mkdir(exist_ok=True)
AUDIO.mkdir(parents=True, exist_ok=True)

# --------- Modes & voix (FEMME = invocation / HOMME = souffle) ----------
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

# --------- Utils ----------
def _clean(s): 
    return re.sub(r"\s+"," ", (s or "").replace("\n"," ")).strip()

def _norm(s):
    s=(s or "").lower()
    s=unicodedata.normalize("NFD", s)
    s="".join(c for c in s if unicodedata.category(c)!="Mn")
    s=re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s)
    return re.sub(r"\s+"," ", s).strip()

def _tok(s): return [t for t in _norm(s).split() if len(t)>2]
STOP_FR=set("au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c".split())

def jload(p, d): 
    try: return json.loads(Path(p).read_text("utf-8")) if Path(p).exists() else d
    except: return d
def jsave(p, x): Path(p).write_text(json.dumps(x, ensure_ascii=False, indent=2), encoding="utf-8")

# --------- Dataset BM25 (pour SOUFFLE uniquement) ----------
FRAGS, DF, N = [], Counter(), 0
def _read_any(p):
    for enc in ("utf-8","latin-1"):
        try: return p.read_text(enc)
        except: pass
    return ""
def build_index():
    global FRAGS, DF, N
    FRAGS, DF, N = [], Counter(), 0
    if not DATASET.exists(): 
        print("[INDEX] dataset/ absent"); return
    for f in sorted(DATASET.glob("*.txt")):
        raw=_read_any(f)
        parts=[x.strip() for x in re.split(r"\n\s*\n|[.!?…]\s+", raw) if len(x.split())>=40]
        for frag in parts:
            toks=_tok(frag)
            if not toks: continue
            FRAGS.append({"id":len(FRAGS),"text":frag,"tokens":toks})
            for t in set(toks): DF[t]+=1
    N=len(FRAGS); print(f"[INDEX] {N} fragments.")
build_index()
def _bm25(q):
    if not FRAGS: return []
    avgdl=sum(len(d["tokens"]) for d in FRAGS)/max(1,len(FRAGS))
    sc=defaultdict(float)
    for t in q:
        df=DF.get(t,0)
        if not df: continue
        idf=math.log(1+(N-df+0.5)/(df+0.5))
        for d in FRAGS:
            tf=d["tokens"].count(t)
            if not tf: continue
            sc[d["id"]]+=idf*((tf*2.5)/(tf+1.5*(1+0.75*(len(d["tokens"])/avgdl))))
    return sorted(sc.items(), key=lambda x:x[1], reverse=True)
def retrieve(q, k=3):
    qt=[t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGS: return []
    return [FRAGS[i]["text"] for i,_ in _bm25(qt)[:k]]

# --------- Réponses ----------
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

# --------- TTS (edge-tts SANS SSML, SANS pitch/rate) ----------
async def _tts_plain(text: str, voice: str, out: Path):
    # Appel minimal compatible — PAS de param ssml
    comm = edge_tts.Communicate(_clean(text), voice=voice)
    await comm.save(str(out))

def tts_generate(text: str, voice: str, out: Path) -> str:
    if edge_tts is None:
        print("[TTS] edge_tts non installé")
        return "disabled"
    try:
        if out.exists():
            try: out.unlink()
            except: pass
        loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_tts_plain(text, voice, out), timeout=25))
        loop.close()
        ok = out.exists() and out.stat().st_size > 1000
        print("[TTS] status =", "ok" if ok else "error", "| voice:", voice, "| size:", out.stat().st_size if out.exists() else 0)
        return "ok" if ok else "error"
    except Exception as e:
        try: loop.close()
        except: pass
        print("[TTS error]", e)
        return "error"

# --------- Routes ----------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/activer-ankaa")
def activer():
    return ("", 204)

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data = request.get_json(force=True) or {}
    mode = (data.get("mode") or "sentinelle8").strip().lower()
    if mode not in MODES: mode = "sentinelle8"
    prompt = data.get("prompt") or ""
    is_souffle = (_norm(prompt) == "souffle sacre")

    if is_greet(prompt):
        rep = "Salut, frère 🌙. Je t’écoute — qu’est-ce qu’on éclaire ?"
    elif is_souffle:
        rep = souffle_answer()               # SOUFFLE = dataset + voix d’homme
    else:
        rep = dialogue_answer(prompt)        # INVOCATION = dialogue (pas de récitation)

    # mémoire
    memp = MODES[mode]["mem"]
    mem = jload(memp, {"fragments":[]})
    mem["fragments"].append({"date":datetime.now().isoformat(),"mode":mode,"souffle":is_souffle,"prompt":prompt,"reponse":rep})
    mem["fragments"] = mem["fragments"][-200:]
    jsave(memp, mem)

    # TTS : FEMME en invocation / HOMME en souffle
    voice = VOIX_HOMME[mode] if is_souffle else VOIX_FEMME[mode]
    out = AUDIO / "anka_tts.mp3"
    tts_status = tts_generate(rep, voice, out)
    url = f"/static/assets/{out.name}" if tts_status == "ok" else None

    return jsonify({"reponse": rep, "audio_url": url, "tts": tts_status})

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
