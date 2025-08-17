# app.py — Sanctuaire Ankaa V10 mobile (fix TTS edge-tts + voix séparées + RAG FR)
# - Plus de 'ssml=True' (erreur Communicate.__init__)
# - Souffle = voix H (Remy), Invocation = voix F (par mode)
# - Nettoyage anti-lecture (speech=, balises, etc.)
# - Réponses plus longues (RAG k=5, seuil réduit)

import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

# --- TTS (Edge) ---
try:
    import edge_tts
except Exception:
    edge_tts = None

BASE_DIR    = Path(__file__).parent.resolve()
DATASET_DIR = BASE_DIR / "dataset"
MEMORY_DIR  = BASE_DIR / "memory"
AUDIO_DIR   = BASE_DIR / "static" / "assets"
MEMORY_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_url_path="/static")

# ---------------------- MODES & VOIX ----------------------
FEMALE_BY_MODE = {
    "sentinelle8": "fr-FR-VivienneMultilingualNeural",
    "dragosly23":  "fr-CA-SylvieNeural",
    "invite":      "fr-FR-DeniseNeural",
    "verbe":       "fr-FR-DeniseNeural",
}
MALE_VOICE = "fr-FR-RemyMultilingualNeural"

MEM_PATHS = {
    "sentinelle8": MEMORY_DIR / "memoire_sentinelle.json",
    "dragosly23":  MEMORY_DIR / "memoire_dragosly.json",
    "invite":      MEMORY_DIR / "memoire_invite.json",
    "verbe":       MEMORY_DIR / "memoire_verbe.json",
}

# ---------------------- UTILS ----------------------
def _clean(s: str) -> str:
    if not s: return ""
    s = s.replace("\u200b","").replace("\ufeff","")
    s = re.sub(r"\s+", " ", s.replace("\n"," ")).strip()
    return s

def _norm(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    except Exception:
        return default

def _save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------------------- RAG (BM25 light) ----------------------
STOP_FR = set("""
au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont
""".strip().split())

FRAGMENTS, DF, N_DOCS = [], Counter(), 0

def _read_any(p: Path) -> str:
    for enc in ("utf-8","latin-1"):
        try: return p.read_text(encoding=enc)
        except Exception: pass
    return ""

def _split(txt: str, file_name: str):
    if not txt: return []
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?:[.!?…]\s+)", txt) if p.strip()]
    out, buf, cnt = [], [], 0
    for p in parts:
        w = p.split()
        if cnt + len(w) < 90:
            buf.append(p); cnt += len(w); continue
        chunk = " ".join(buf+[p]).strip()
        if chunk: out.append(chunk)
        buf, cnt = [], 0
    rest = " ".join(buf).strip()
    if rest: out.append(rest)
    final = []
    for ch in out:
        words = ch.split()
        final.append(" ".join(words[:240]) if len(words) > 240 else " ".join(words))
    return [{"file": file_name, "text": c} for c in final if len(c.split()) >= 70]

def build_index():
    global FRAGMENTS, DF, N_DOCS
    FRAGMENTS, DF, N_DOCS = [], Counter(), 0
    if not DATASET_DIR.exists():
        print("[INDEX] dataset/ introuvable.")
        return
    for p in sorted(DATASET_DIR.glob("*.txt")):
        raw = _read_any(p)
        if not raw: continue
        for frag in _split(raw, p.name):
            toks = [t for t in _norm(frag["text"]).split() if len(t) > 2]
            if not toks: continue
            d = {"id": len(FRAGMENTS), "file": p.name, "text": frag["text"], "tokens": toks}
            FRAGMENTS.append(d)
            for t in set(toks): DF[t] += 1
    N_DOCS = len(FRAGMENTS)
    print(f"[INDEX] {N_DOCS} fragments indexés.")

def _bm25(qt, k1=1.5, b=0.75):
    if not FRAGMENTS: return []
    avgdl = sum(len(d["tokens"]) for d in FRAGMENTS) / len(FRAGMENTS)
    scores = defaultdict(float)
    for q in qt:
        df = DF.get(q, 0)
        if df == 0: continue
        idf = math.log(1 + (N_DOCS - df + 0.5)/(df + 0.5))
        for d in FRAGMENTS:
            tf = d["tokens"].count(q)
            if tf == 0: continue
            denom = tf + k1*(1 - b + b*(len(d["tokens"])/avgdl))
            scores[d["id"]] += idf * ((tf*(k1+1))/denom)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)

def retrieve(q: str, k: int = 5, min_score: float = 0.95):
    qt = [t for t in _norm(q).split() if len(t) > 2 and t not in STOP_FR]
    if not qt or not FRAGMENTS: return []
    ranked = _bm25(qt)
    out = []
    for doc_id, sc in ranked[:max(15, k*3)]:
        if sc < min_score: continue
        d = FRAGMENTS[doc_id]
        out.append({"file": d["file"], "text": d["text"], "score": round(sc,2)})
        if len(out) >= k: break
    return out

build_index()

def rag_answer(user: str) -> str:
    src = retrieve(user, k=5, min_score=0.95)
    if not src:
        return "Je n’ai rien trouvé de net dans les écrits pour ça. Donne-moi un indice concret et je refouille."
    # ~120 mots par fragment pour plus de matière
    lines = [f"• {' '.join(_clean(s['text']).split()[:120])}…" for s in src]
    return "\n".join(lines)

# ---------------------- Dialogique légère ----------------------
def is_greeting(s: str) -> bool:
    t = _norm(s)
    return any(w in t for w in ["salut","bonjour","bonsoir","coucou","hello","hey"])

# ---------------------- Anti-lecture TTS ----------------------
BAD_PATTERNS = [
    r"(?mi)^```.*?$", r"(?mi)^---.*?$", r"(?mi)^#.*?$",
    r"<\/?[^>]+>", r"\b(?:speech|speak|voice|pitch|rate|prosody)\s*=\s*[^,\s]+",
    r"(?mi)^\s*(?:Dialogue\s*:|S\d+\])\s*", r"[𓂀☥]\s*[A-ZÉÈÊÎÂÔÛ][^:]{0,20}:\s*"
]
def strip_tts_noise(txt: str) -> str:
    t = txt or ""
    for pat in BAD_PATTERNS:
        t = re.sub(pat, " ", t)
    t = re.sub(r"\s+", " ", t).strip(" .")
    return t

# ---------------------- TTS (sans ssml=True) ----------------------
async def _tts_async(text: str, out_file: Path, *, voice: str, rate: str, pitch: str):
    if edge_tts is None: return "disabled"
    # Communicate accepte voice/rate/pitch ; pas de paramètre 'ssml'
    comm = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch)
    await comm.save(str(out_file))
    return "ok"

def synthesize(text: str, out_file: Path, *, male: bool, mode: str) -> str:
    if edge_tts is None: return "disabled"
    # Nettoyage du texte avant TTS
    msg = strip_tts_noise(text).replace("..","…")
    voice = MALE_VOICE if male else FEMALE_BY_MODE.get(mode, "fr-FR-DeniseNeural")
    # réglages doux (compatibles Render)
    rate  = "+0%" if male else "+2%"
    pitch = "-1st" if male else "+1st"
    try:
        if out_file.exists():
            try: out_file.unlink()
            except Exception: pass
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_tts_async(msg, out_file, voice=voice, rate=rate, pitch=pitch), timeout=20))
        loop.close()
        return "ok" if out_file.exists() and out_file.stat().st_size > 1000 else "error"
    except Exception as e:
        try: loop.close()
        except Exception: pass
        print("[TTS error]", e)
        return "error"

# ---------------------- Génération ----------------------
def generate(user_input: str, mode: str) -> str:
    if is_greeting(user_input):
        return "Salut, frère 🌙. Que veux-tu éclairer maintenant ?"
    if _norm(user_input) == "souffle sacre":
        base = rag_answer("souffle méditation lumière présence sagesse")
        fin  = random.choice([
            "— Que la Paix veille sur toi.",
            "— Respire, la lumière te traverse.",
            "— Marche en douceur, la flamme est là."
        ])
        return f"{base}\n\n{fin}"
    base = rag_answer(user_input)
    toks = [t for t in _norm(user_input).split() if len(t) > 3 and t not in STOP_FR]
    pivot = max(toks, key=len, default="le point clé")
    rel = f"On cible **{pivot}** ou tu veux un exemple concret ?"
    return f"{base}\n\n{rel}"

# ---------------------- ROUTES ----------------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data = request.get_json(force=True) or {}
    mode = (data.get("mode") or "sentinelle8").lower().strip()
    if mode not in FEMALE_BY_MODE: mode = "sentinelle8"
    prompt = data.get("prompt") or ""

    texte = generate(prompt, mode)

    # mémoire courte
    mem_path = MEM_PATHS[mode]
    mem = _load_json(mem_path, {"fragments":[]})
    mem["fragments"].append({
        "date": datetime.now().isoformat(timespec="seconds"),
        "mode": mode, "prompt": prompt, "reponse": texte
    })
    mem["fragments"] = mem["fragments"][-200:]
    _save_json(mem_path, mem)

    # TTS : homme si "souffle sacré", sinon femme par mode
    out_file = AUDIO_DIR / "anka_tts.mp3"
    is_male  = (_norm(prompt) == "souffle sacre")
    tts_status = synthesize(texte, out_file, male=is_male, mode=mode)
    audio_url  = f"/static/assets/{out_file.name}" if tts_status == "ok" else None

    return jsonify({"reponse": texte, "audio_url": audio_url, "tts": tts_status})

@app.route("/activer-ankaa")
def activer():
    return ("", 204)

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
