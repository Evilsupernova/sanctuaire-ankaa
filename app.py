# app.py — Sanctuaire Ankaa V10.1 (anti-lecture de balises + TTS SSML + salutations + RAG)
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from threading import Lock
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

# --- optionnel: modèle local (si présent) ---
try:
    from llama_cpp import Llama
except Exception:
    Llama = None

# --- TTS Edge ---
try:
    import edge_tts
except Exception:
    edge_tts = None

app = Flask(__name__, static_url_path="/static")
LOCK = Lock()

BASE_DIR    = Path(__file__).parent.resolve()
DATASET_DIR = BASE_DIR / "dataset"
MEMORY_DIR  = BASE_DIR / "memory"
AUDIO_DIR   = BASE_DIR / "static" / "assets"
MEMORY_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ---------- MODES ----------
MODES = {
    "sentinelle8": {"voice": "fr-FR-VivienneMultilingualNeural", "mem": MEMORY_DIR / "memoire_sentinelle.json"},
    "dragosly23":  {"voice": "fr-CA-SylvieNeural",               "mem": MEMORY_DIR / "memoire_dragosly.json"},
    "invite":      {"voice": "fr-FR-DeniseNeural",               "mem": MEMORY_DIR / "memoire_invite.json"},
    "verbe":       {"voice": "fr-FR-RemyMultilingualNeural",     "mem": MEMORY_DIR / "memoire_verbe.json"},
}

# ---------- util ----------
def _clean(s: str) -> str:
    if not s: return ""
    s = s.replace("\u200b","").replace("\ufeff","")
    s = re.sub(r"\s+", " ", s.replace("\n"," ")).strip()
    return s

def load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    except Exception:
        return default

def save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------- FR normalisation ----------
def _norm(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _tok(s: str): return [t for t in _norm(s).split() if len(t) > 2]

STOP_FR = set("""
au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont était étaient serai serais serions seraient
""".strip().split())

# ---------- INDEX DATASET (BM25 simple) ----------
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
        if cnt + len(w) < 80:
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

# ---------- Identité / sécurité nominative ----------
ID_PAT = [r"\bSandro\b", r"\bDragosly\b", r"\bDragosly23\b"]
def scrub_identity(txt: str) -> str:
    out = txt or ""
    for pat in ID_PAT: out = re.sub(pat, "frère", out, flags=re.I)
    return _clean(out)

# ---------- Salutations & intentions ----------
def is_greeting(s: str) -> bool:
    t = _norm(s)
    return any(w in t for w in ["salut","bonjour","bonsoir","coucou","yop","hello","hey"])

def detect_emotion(s: str) -> str:
    t = (s or "").lower()
    if any(k in t for k in ["triste","peine","fatigu","lassé","angoiss","peur"]): return "peine"
    if any(k in t for k in ["énerv","colère","marre","rage"]): return "colere"
    if any(k in t for k in ["merci","trop bien","génial","parfait","super","top"]): return "joie"
    if any(k in t for k in ["doute","hésite","inquiet","peur","stress"]): return "doute"
    return "neutre"

def empath_prefix(emotion:str)->str:
    return {
        "peine":"🤍 Je t’entends. Doucement, je suis là.",
        "colere":"🔥 J’accueille ta force — on canalise sans se blesser.",
        "joie":"✨ Je sens ta joie — gardons ce feu clair.",
        "doute":"🌫️ On avance pas à pas.",
        "neutre":""
    }.get(emotion,"")

# ---------- Génération (LLM local si dispo, sinon RAG structuré) ----------
def answer_with_rag(user: str) -> str:
    src = retrieve(user, k=3, min_score=1.02)
    if not src:
        return "Je n’ai rien de net dans les écrits pour ça. Donne-moi un indice concret et je fouille mieux."
    lines = [f"• {' '.join(_clean(s['text']).split()[:80])}…" for s in src]
    return "\n".join(lines)

def generate_answer(user_input: str, mode_key: str) -> str:
    if is_greeting(user_input):
        # salutation humaine directe
        return "Salut, frère 🌙. Qu’est-ce que tu veux éclairer maintenant ? Je t’écoute."

    # souffle sacré
    if _norm(user_input) == "souffle sacre":
        # sélectionner un long fragment puis conclure doucement
        src = retrieve("méditation souffle lumière sagesse", k=1, min_score=0.0)
        core = answer_with_rag("souffle silence présence")
        fin = random.choice([
            "— Que la Paix veille sur toi.",
            "— Marche en douceur, la flamme est là.",
            "— Respire, et laisse ce souffle grandir en toi."
        ])
        return (core + "\n\n" + fin).strip()

    # normal : LLM local si dispo, sinon RAG structuré
    llm = None
    try:
        if Llama is not None:
            # si tu as un modèle local installé, décommente et adapte le chemin
            # llm = Llama(model_path="models/mistral.gguf", n_ctx=4096, n_threads=4, verbose=False)
            llm = None
    except Exception:
        llm = None

    if llm is None:
        base = answer_with_rag(user_input)
        # petite relance vraiment liée au sujet (1 mot-clé stable)
        toks = [t for t in _tok(user_input) if t not in STOP_FR]
        pivot = max(toks, key=lambda x: len(x), default="le point clé")
        rel = f"Tu veux qu’on précise **{pivot}** côté sens, ou une action simple pour avancer ?"
        return f"{base}\n\n{rel}".strip()

    # (si LLM local actif) — prompt minimal francophone
    prompt = (
        "Tu es Ankaa, réponds en français clair, humain, sans jargon ni balises. "
        "Ne cite pas ta méthode. Réponds en 4–7 phrases utiles.\n\n"
        f"Question: {user_input}\nRéponse:"
    )
    with LOCK:
        res = llm.create_completion(prompt=prompt, max_tokens=512, temperature=0.8, top_p=0.95, stop=["```","<","speech="])
    txt = (res.get("choices",[{}])[0].get("text","") or "").strip()
    return txt or answer_with_rag(user_input)

# ---------- Anti-lecture TTS (nettoyage dur) ----------
BAD_PATTERNS = [
    r"(?mi)^```.*?$", r"(?mi)^---.*?$", r"(?mi)^#.*?$",
    r"<\/?[^>]+>", r"\b(?:speech|speak|voice|pitch|rate|prosody)\s*=\s*[^,\s]+",
    r"(?mi)^\s*(?:Dialogue\s*:|S\d+\])\s*", r"[𓂀☥]\s*[A-ZÉÈÊÎÂÔÛ][^:]{0,20}:\s*"
]
def strip_tts_garbage(txt: str) -> str:
    t = txt or ""
    for pat in BAD_PATTERNS:
        t = re.sub(pat, " ", t)
    t = re.sub(r"\s+", " ", t).strip(" .")
    return t

# ---------- TTS SSML (voix moins robotique) ----------
def build_ssml(text: str, mode_key: str, voice: str) -> str:
    style, rate, pitch = {
        "sentinelle8": ("narration-relaxed", "+0%",  "-1st"),
        "dragosly23":  ("chat",              "+4%",  "+1st"),
        "invite":      ("empathetic",        "+2%",  "+1st"),
        "verbe":       ("assistant",         "+0%",  "+0st"),
    }.get(mode_key, ("narration-relaxed","+0%","+0st"))
    s = strip_tts_garbage(text)
    s = s.replace("..","…")
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

async def tts_async(ssml: str, out_file: Path):
    if edge_tts is None: return "disabled"
    comm = edge_tts.Communicate(ssml, ssml=True)  # SSML activé
    await comm.save(str(out_file))
    return "ok"

def do_tts(text: str, mode_key: str, voice: str, out_file: Path) -> str:
    if edge_tts is None: return "disabled"
    try:
        ssml = build_ssml(text, mode_key, voice)
        if out_file.exists():
            try: out_file.unlink()
            except Exception: pass
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(tts_async(ssml, out_file), timeout=15))
        loop.close()
        return "ok" if (out_file.exists() and out_file.stat().st_size > 1000) else "error"
    except Exception as e:
        try: loop.close()
        except Exception: pass
        print("[TTS]", e)
        return "error"

# ---------- ROUTES ----------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/invoquer", methods=["POST"])
def invoquer():
    try:
        data = request.get_json(force=True) or {}
        mode = (data.get("mode") or "sentinelle8").lower()
        if mode not in MODES: mode = "sentinelle8"
        user = data.get("prompt") or ""

        # sécurité identité hors Dragosly23
        if mode != "dragosly23":
            user = scrub_identity(user)

        texte = generate_answer(user, mode)

        # mémoire transcript
        mem_path = MODES[mode]["mem"]
        mem = load_json(mem_path, {"fragments":[]})
        mem["fragments"].append({"date": datetime.now().isoformat(), "prompt": user, "reponse": texte})
        mem["fragments"] = mem["fragments"][-200:]
        save_json(mem_path, mem)

        # TTS
        out_file = AUDIO_DIR / "anka_tts.mp3"
        voice    = MODES[mode]["voice"]
        tts_status = do_tts(texte, mode, voice, out_file)
        audio_url = f"/static/assets/{out_file.name}" if tts_status == "ok" else None

        return jsonify({"reponse": texte, "audio_url": audio_url, "tts": tts_status})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error":"Erreur interne","details":str(e)}), 500

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
