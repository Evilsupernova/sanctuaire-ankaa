# app.py — Sanctuaire Ankaa V10 mobile stable (Render-safe, voix FR)
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from threading import Lock
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

# Optionnel: modèle local
try:
    from llama_cpp import Llama  # noqa
except Exception:
    Llama = None

# TTS Edge (texte brut, sans SSML) — compatible Render
try:
    import edge_tts
except Exception:
    edge_tts = None

app = Flask(
    __name__,
    static_url_path="/static",
    static_folder="static",
    template_folder="templates",
)
LOCK = Lock()

BASE_DIR    = Path(__file__).parent.resolve()
DATASET_DIR = BASE_DIR / "dataset"
MEMORY_DIR  = BASE_DIR / "memory"
AUDIO_DIR   = BASE_DIR / "static" / "assets"
MEMORY_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ============ utils ============
def _clean(s: str) -> str:
    if not s: return ""
    s = s.replace("\u200b","").replace("\ufeff","")
    return re.sub(r"\s+"," ", s.replace("\n"," ")).strip()

def load_json(p: Path, default):
    try: return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    except: return default

def save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def _norm(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]"," ", s)
    s = re.sub(r"\s+"," ", s).strip()
    return s

def _tok(s: str): return [t for t in _norm(s).split() if len(t) > 2]

STOP_FR = set("au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont était étaient serai serais serions seraient".split())

# ============ identité ============
ID_PAT = [r"\bSandro\b", r"\bDragosly\b", r"\bDragosly23\b"]
def scrub_identity(txt: str) -> str:
    out = txt or ""
    for pat in ID_PAT: out = re.sub(pat, "frère", out, flags=re.I)
    return _clean(out)

# ============ dataset / BM25 ============
FRAGMENTS, DF, N_DOCS = [], Counter(), 0

def _split(txt: str, file_name: str):
    if not txt: return []
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?:[.!?…]\s+)", txt) if p.strip()]
    out, buf, cnt = [], [], 0
    for p in parts:
        w = p.split()
        if cnt + len(w) < 80: buf.append(p); cnt += len(w); continue
        chunk = " ".join(buf+[p]).strip()
        if chunk: out.append(chunk)
        buf, cnt = [], 0
    rest = " ".join(buf).strip()
    if rest: out.append(rest)
    clean=[]
    for ch in out:
        words = ch.split()
        clean.append(" ".join(words[:200]) if len(words)>200 else " ".join(words))
    return [{"file": file_name, "text": c} for c in clean if len(c.split())>=60]

def build_index():
    global FRAGMENTS, DF, N_DOCS
    FRAGMENTS, DF, N_DOCS = [], Counter(), 0
    if not DATASET_DIR.exists():
        print("[INDEX] dataset/ introuvable."); return
    for p in sorted(DATASET_DIR.glob("*.txt")):
        try: raw = p.read_text(encoding="utf-8")
        except: continue
        for frag in _split(raw, p.name):
            toks = _tok(frag["text"])
            if not toks: continue
            d = {"id": len(FRAGMENTS), "file": frag["file"], "text": frag["text"], "tokens": toks}
            FRAGMENTS.append(d)
            for t in set(toks): DF[t] += 1
    N_DOCS = len(FRAGMENTS)
    print(f"[INDEX] {N_DOCS} fragments indexés.")
build_index()

def _bm25(qt, k1=1.5, b=0.75):
    if not FRAGMENTS: return []
    avgdl = sum(len(d["tokens"]) for d in FRAGMENTS)/len(FRAGMENTS)
    scores = defaultdict(float)
    for q in qt:
        df = DF.get(q,0)
        if df==0: continue
        idf = math.log(1 + (N_DOCS - df + .5)/(df + .5))
        for d in FRAGMENTS:
            tf = d["tokens"].count(q)
            if tf==0: continue
            denom = tf + k1*(1 - b + b*(len(d["tokens"])/avgdl))
            scores[d["id"]] += idf*((tf*(k1+1))/denom)
    return sorted(scores.items(), key=lambda x:x[1], reverse=True)

def retrieve(q: str, k: int=3, min_score: float=1.1):
    qt = [t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGMENTS: return []
    ranked = _bm25(qt)
    out=[]
    for doc_id, sc in ranked[:max(12,k*3)]:
        if sc < min_score: continue
        d = FRAGMENTS[doc_id]
        out.append({"file": d["file"], "text": d["text"], "score": round(sc,2)})
        if len(out)>=k: break
    return out

# ============ modes / voix ============
MODES = {
    "sentinelle8": {"voice":"fr-FR-DeniseNeural",              "mem": MEMORY_DIR/"memoire_sentinelle.json"},
    "dragosly23":  {"voice":"fr-CA-SylvieNeural",              "mem": MEMORY_DIR/"memoire_dragosly.json"},
    "invite":      {"voice":"fr-FR-DeniseNeural",              "mem": MEMORY_DIR/"memoire_invite.json"},
    "verbe":       {"voice":"fr-FR-VivienneMultilingualNeural","mem": MEMORY_DIR/"memoire_verbe.json"},
}

def answer_with_rag(user: str) -> str:
    src = retrieve(user, k=3, min_score=1.05)
    if not src:
        return "Je n’ai rien trouvé de net dans les écrits. Donne-moi un indice et je fouille mieux."
    lines = [f"• {' '.join(_clean(s['text']).split()[:80])}…" for s in src]
    return "\n".join(lines)

def generate_answer(user_input: str, mode_key: str) -> str:
    if _norm(user_input) == "souffle sacre":
        base = answer_with_rag("souffle présence paix lumière sagesse")
        fin = random.choice(["— Que la Paix veille sur toi.","— Marche en douceur, la flamme est là.","— Respire, et laisse ce souffle grandir en toi."])
        return (base+"\n\n"+fin).strip()
    base = answer_with_rag(user_input)
    toks = [t for t in _tok(user_input) if t not in STOP_FR]
    pivot = max(toks, key=lambda x: len(x), default="le point clé")
    rel = f"Tu veux qu’on précise **{pivot}**, côté sens ou côté pratique ?"
    return f"{base}\n\n{rel}".strip()

# ============ TTS (texte brut) ============
BAD_PATTERNS = [r"(?mi)^```.*?$", r"(?mi)^---.*?$", r"(?mi)^#.*?$",
                r"</?[^>]+>", r"\b(?:speech|speak|voice|pitch|rate|prosody)\s*=\s*[^,\s]+"]
def strip_tts(txt: str) -> str:
    t = txt or ""
    for pat in BAD_PATTERNS: t = re.sub(pat, " ", t)
    return re.sub(r"\s+"," ", t).strip(" .")

async def _tts_plain(text: str, voice: str, out_path: Path):
    comm = edge_tts.Communicate(strip_tts(text), voice=voice)
    await comm.save(str(out_path))

def tts_generate(text: str, voice: str, out_path: Path) -> str:
    if edge_tts is None:
        print("[TTS] edge_tts non disponible"); return "disabled"
    loop=None
    try:
        if out_path.exists():
            try: out_path.unlink()
            except: pass
        loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_tts_plain(text, voice, out_path), timeout=25))
        loop.close()
        ok = out_path.exists() and out_path.stat().st_size>800
        print("[TTS] status =", "ok" if ok else "error", "| voice:", voice)
        return "ok" if ok else "error"
    except Exception as e:
        try:
            if loop: loop.close()
        except: pass
        print("[TTS error]", e)
        return "error"

# ============ routes ============
@app.route("/")
def index(): return render_template("index.html")

@app.route("/invoquer", methods=["POST"])
def invoquer():
    try:
        data = request.get_json(force=True) or {}
        mode = (data.get("mode") or "sentinelle8").lower()
        if mode not in MODES: mode="sentinelle8"
        user = data.get("prompt") or ""
        if mode != "dragosly23": user = scrub_identity(user)

        texte = generate_answer(user, mode)

        mem_path = MODES[mode]["mem"]
        mem = load_json(mem_path, {"fragments":[]})
        mem["fragments"].append({"date": datetime.now().isoformat(), "prompt": user, "reponse": texte})
        mem["fragments"] = mem["fragments"][-200:]
        save_json(mem_path, mem)

        # voix: femme (invocation), homme si "souffle sacré"
        voice = MODES[mode]["voice"]
        if _norm(user) == "souffle sacre":
            voice = "fr-FR-RemyMultilingualNeural"

        out_file = AUDIO_DIR / "anka_tts.mp3"
        tts_status = tts_generate(texte, voice, out_file)
        audio_url  = f"/static/assets/{out_file.name}" if tts_status=="ok" else None
        return jsonify({"reponse": texte, "audio_url": audio_url, "tts": tts_status})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error":"Erreur interne","details":str(e)}), 500

@app.route("/service-worker.js")
def sw(): return app.send_static_file("service-worker.js")

@app.route("/activer-ankaa")
def ping(): return ("",204)

if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)), debug=True)
