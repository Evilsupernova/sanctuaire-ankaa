# app.py — Sanctuaire Ankaa V10 mobile (fix voix, audio unique, réponses + longues)
import os, re, json, math, asyncio, unicodedata, random, time
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

# edge-tts sans ssml=True
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

# ---------------- Voix ----------------
FEMALE_BY_MODE = {
    "sentinelle8": "fr-FR-VivienneMultilingualNeural",
    "dragosly23":  "fr-CA-SylvieNeural",
    "invite":      "fr-FR-DeniseNeural",
    "verbe":       "fr-FR-DeniseNeural",
}
MALE_VOICE = "fr-FR-RemyMultilingualNeural"

# ---------------- Utils ----------------
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

# Anti-lecture de balises / paramètres techniques
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
    return t.replace("..","…")

# ---------------- RAG léger (BM25) ----------------
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
    if not DATASET_DIR.exists(): return
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
build_index()

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

def rag_answer(user: str) -> str:
    src = retrieve(user, k=5, min_score=0.95)
    if not src:
        return "Je n’ai rien trouvé de net dans les écrits pour ça. Donne-moi un indice concret et je refouille."
    lines = [f"• {' '.join(_clean(s['text']).split()[:120])}…" for s in src]
    return "\n".join(lines)

def is_greeting(s: str) -> bool:
    t = _norm(s)
    return any(w in t for w in ["salut","bonjour","bonsoir","coucou","hello","hey"])

# ---------------- TTS (fichier unique par requête) ----------------
async def _tts_async(text: str, out_file: Path, *, voice: str, rate: str, pitch: str):
    if edge_tts is None: return "disabled"
    comm = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch)
    await comm.save(str(out_file))
    return "ok"

def synthesize(text: str, *, male: bool, mode: str) -> tuple[str|None, str]:
    """Retourne (audio_url, status)"""
    if edge_tts is None:
        return None, "disabled"
    msg   = strip_tts_noise(text)
    voice = MALE_VOICE if male else FEMALE_BY_MODE.get(mode, "fr-FR-DeniseNeural")
    rate  = "+0%" if male else "+2%"
    pitch = "-1st" if male else "+1st"
    # nom unique => évite le cache SW/iOS
    fname = f"anka_tts_{int(time.time()*1000)}.mp3"
    out_file = AUDIO_DIR / fname
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_tts_async(msg, out_file, voice=voice, rate=rate, pitch=pitch), timeout=25))
        loop.close()
        if out_file.exists() and out_file.stat().st_size > 1000:
            return f"/static/assets/{fname}", "ok"
        return None, "error"
    except Exception as e:
        try: loop.close()
        except Exception: pass
        print("[TTS error]", e)
        return None, "error"

# ---------------- Génération ----------------
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

# ---------------- Routes ----------------
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

    # TTS : homme si "souffle sacré", sinon femme
    is_male = (_norm(prompt) == "souffle sacre")
    audio_url, tts_status = synthesize(texte, male=is_male, mode=mode)

    return jsonify({"reponse": texte, "audio_url": audio_url, "tts": tts_status})

@app.route("/activer-ankaa")
def activer():
    return ("", 204)

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
