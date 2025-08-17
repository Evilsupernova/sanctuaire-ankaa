# app.py — Sanctuaire Ankaa (Mobile V10 adapté)
# - Invocation : voix FEMME
# - Souffle    : voix HOMME
# - Nettoyage anti-lecture TTS
# - RAG FR simple si pas de LLM local (Render)
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

# ----- TTS Edge -----
try:
    import edge_tts
except Exception:
    edge_tts = None

# ----- Optionnel : LLM local (si dispo en dev local) -----
try:
    from llama_cpp import Llama  # facultatif
except Exception:
    Llama = None

app = Flask(__name__, static_url_path="/static")
BASE_DIR    = Path(__file__).parent.resolve()
DATASET_DIR = BASE_DIR / "dataset"
MEMORY_DIR  = BASE_DIR / "memory"
AUDIO_DIR   = BASE_DIR / "static" / "assets"
MEMORY_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# =========================
#  CONFIG VOIX PAR MODE
# =========================
# Voix FEMME pour invocation / Voix HOMME pour souffle
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

MODES = { m: {"mem": MEMORY_DIR / f"memoire_{m}.json"} for m in VOIX_FEMME.keys() }

# =========================
#  UTILITAIRES
# =========================
def _clean(s: str) -> str:
    if not s: return ""
    s = s.replace("\u200b","").replace("\ufeff","")
    return re.sub(r"\s+", " ", s.replace("\n"," ")).strip()

def _norm(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _tok(s: str):
    return [t for t in _norm(s).split() if len(t) > 2]

STOP_FR = set("""
au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont était étaient serai serais serions seraient
""".strip().split())

def load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    except Exception:
        return default

def save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# =========================
#  INDEX RAG (BM25 simple)
# =========================
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
        if cnt + len(w) < 80:  # colle des phrases pour atteindre un bloc lisible
            buf.append(p); cnt += len(w); continue
        chunk = " ".join(buf+[p]).strip()
        if chunk: out.append(chunk)
        buf, cnt = [], 0
    rest = " ".join(buf).strip()
    if rest: out.append(rest)
    clean = []
    for ch in out:
        words = ch.split()
        clean.append(" ".join(words[:200]) if len(words) > 200 else " ".join(words))
    return [{"file": file_name, "text": c} for c in clean if len(c.split()) >= 60]

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
            toks = _tok(frag["text"])
            if not toks: continue
            d = {"id": len(FRAGMENTS), "file": p.name, "text": frag["text"], "tokens": toks}
            FRAGMENTS.append(d)
            for t in set(toks): DF[t] += 1
    N_DOCS = len(FRAGMENTS)
    print(f"[INDEX] {N_DOCS} fragments indexés.")

def _bm25(qt, k1=1.5, b=0.75):
    if not FRAGMENTS: return []
    avgdl = sum(len(d["tokens"]) for d in FRAGMENTS)/len(FRAGMENTS)
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
    return sorted(scores.items(), key=lambda x:x[1], reverse=True)

def retrieve(q: str, k: int = 4, min_score: float = 1.02):
    qt = [t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGMENTS: return []
    ranked = _bm25(qt)
    out = []
    for doc_id, sc in ranked[:max(12, k*3)]:
        if sc < min_score: continue
        d = FRAGMENTS[doc_id]
        out.append({"file": d["file"], "text": d["text"], "score": round(sc,2)})
        if len(out) >= k: break
    return out

build_index()

# =========================
#  RÉPONSES HUMAINES
# =========================
def is_greeting(s: str) -> bool:
    t = _norm(s)
    return any(w in t for w in ["salut","bonjour","bonsoir","coucou","hello","hey"])

def human_greet() -> str:
    return "Salut, frère 🌙. Je suis là. Qu’est-ce que tu veux éclairer ?"

def answer_from_rag(user: str) -> str:
    src = retrieve(user, k=3, min_score=1.02)
    if not src:
        return "Je n’ai rien de net dans les écrits. Donne-moi un indice précis et je fouille mieux."
    lines = [f"• {' '.join(_clean(s['text']).split()[:80])}…" for s in src]
    return "\n".join(lines)

def generate_answer(user_input: str, mode_key: str) -> str:
    # salutation
    if is_greeting(user_input):
        return human_greet()

    # souffle sacré : plus contemplatif
    if _norm(user_input) == "souffle sacre":
        base = answer_from_rag("souffle méditation paix respiration calme")
        fin = random.choice([
            "— Respire. Que la paix te garde.",
            "— Laisse la lumière s’asseoir dans le souffle.",
            "— Reste doux avec toi, la flamme veille."
        ])
        return f"{base}\n\n{fin}"

    # LLM local (si tu l’utilises en DEV) — sinon RAG propre
    txt = None
    if Llama is not None and os.getenv("ANKAA_USE_LOCAL_LLM") == "1":
        try:
            llm = Llama(model_path="models/mistral.gguf", n_ctx=4096, n_threads=4, verbose=False)
            prompt = (
                "Réponds en français, clair et humain, sans balises ni technicalités.\n"
                f"Question: {user_input}\nRéponse:"
            )
            res = llm.create_completion(prompt=prompt, max_tokens=512, temperature=0.8, top_p=0.95)
            txt = (res.get("choices",[{}])[0].get("text","") or "").strip()
        except Exception:
            txt = None

    if not txt:
        # fallback RAG
        base = answer_from_rag(user_input)
        toks = [t for t in _tok(user_input) if t not in STOP_FR]
        pivot = max(toks, key=lambda x: len(x), default="le point clé")
        rel = f"On creuse **{pivot}** ou tu préfères une action concrète ?"
        txt = f"{base}\n\n{rel}"

    return txt

# =========================
#  NETTOYAGE TTS (anti-récitation)
# =========================
BAD_PATTERNS = [
    r"(?mi)^```.*?$", r"(?mi)^---.*?$", r"(?mi)^#.*?$",
    r"<\/?[^>]+>", r"\b(?:speech|speak|voice|pitch|rate|prosody)\s*=\s*[^,\s]+",
    r"(?mi)^\s*(?:Dialogue\s*:|S\d+\])\s*", r"[𓂀☥]\s*[A-ZÉÈÊÎÂÔÛ][^:]{0,20}:\s*",
    r"[\/\\]{1,}", r"\[[^\]]+\]", r"\([^)]+\)"
]
def strip_tts_garbage(txt: str) -> str:
    t = txt or ""
    for pat in BAD_PATTERNS:
        t = re.sub(pat, " ", t)
    t = re.sub(r"\s+", " ", t).strip(" .")
    return t

# =========================
#  TTS SSML (Femme / Homme)
# =========================
def build_ssml(text: str, voice: str, style: str, rate: str, pitch: str) -> str:
    s = strip_tts_garbage(text).replace("..","…")
    return f"""
<speak version="1.0" xml:lang="fr-FR" xmlns:mstts="https://www.w3.org/2001/mstts">
  <voice name="{voice}">
    <mstts:express-as style="{style}" styledegree="1.0">
      <prosody rate="{rate}" pitch="{pitch}">
        <break time="220ms"/>{s}<break time="260ms"/>
      </prosody>
    </mstts:express-as>
  </voice>
</speak>
""".strip()

async def _tts_async(ssml: str, out_file: Path):
    if edge_tts is None: return "disabled"
    comm = edge_tts.Communicate(ssml, ssml=True)
    await comm.save(str(out_file))
    return "ok"

def do_tts(text: str, mode_key: str, is_souffle: bool, out_file: Path) -> str:
    if edge_tts is None:
        return "disabled"
    try:
        if is_souffle:
            # Homme posé
            voice = VOIX_HOMME.get(mode_key, "fr-FR-RemyMultilingualNeural")
            style, rate, pitch = ("narration-relaxed", "-2%", "-1st")
        else:
            # Femme chaleureuse
            voice = VOIX_FEMME.get(mode_key, "fr-FR-DeniseNeural")
            style, rate, pitch = ("empathetic", "+2%", "+1st")

        ssml = build_ssml(text, voice, style, rate, pitch)
        if out_file.exists():
            try: out_file.unlink()
            except Exception: pass
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_tts_async(ssml, out_file), timeout=15))
        loop.close()
        return "ok" if (out_file.exists() and out_file.stat().st_size > 1000) else "error"
    except Exception as e:
        try: loop.close()
        except Exception: pass
        print("[TTS error]", e)
        return "error"

# =========================
#  ROUTES
# =========================
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data = request.get_json(force=True) or {}
    mode = (data.get("mode") or "sentinelle8").strip().lower()
    if mode not in MODES: mode = "sentinelle8"
    prompt = data.get("prompt") or ""
    is_souffle = (_norm(prompt) == "souffle sacre")

    # Génération texte
    reponse = generate_answer(prompt, mode)

    # Mémoire (légère)
    mem_path = MODES[mode]["mem"]
    mem = load_json(mem_path, {"fragments": []})
    mem["fragments"].append({
        "date": datetime.now().isoformat(),
        "mode": mode, "souffle": is_souffle,
        "prompt": prompt, "reponse": reponse
    })
    mem["fragments"] = mem["fragments"][-200:]
    save_json(mem_path, mem)

    # TTS
    out_file = AUDIO_DIR / "anka_tts.mp3"
    tts_status = do_tts(reponse, mode, is_souffle, out_file)
    audio_url = f"/static/assets/{out_file.name}" if tts_status == "ok" else None

    return jsonify({"reponse": reponse, "audio_url": audio_url, "tts": tts_status})

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
