# app.py — Sanctuaire Ankaa (Web/PWA prêt pour Render)
# - CORS pour clients mobiles
# - Service Worker servi à la racine
# - DATASET_DIR relatif au projet (dataset/)
# - Garde voix V2 / souffle / mémoire / modes

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import os, json, random, re, asyncio, math, unicodedata
from pathlib import Path
from datetime import datetime
from threading import Lock
from collections import Counter, defaultdict

# ---------- Modèle local optionnel ----------
try:
    from llama_cpp import Llama
except Exception:
    Llama = None

# ---------- TTS Edge ----------
from edge_tts import Communicate

app = Flask(__name__, static_url_path="/static")
CORS(app, resources={r"/*": {"origins": "*"}})

@app.after_request
def add_headers(resp):
    # Meilleur cache pour audio en mobile
    if resp.content_type and "audio" in resp.content_type:
        resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp

# Service worker servi à la racine (couverture du scope PWA)
@app.route('/service-worker.js')
def sw():
    return app.send_static_file('service-worker.js')

# ================== CONFIG ==================
LOCK = Lock()
BASE_DIR     = Path(__file__).parent
DATASET_DIR  = BASE_DIR / "dataset"          # <— IMPORTANT: dataset/ dans le projet
MEMORY_DIR   = BASE_DIR / "memory"
AUDIO_DIR    = BASE_DIR / "static" / "assets"
MODELS_DIR   = BASE_DIR / "models"
MODEL_PATH   = MODELS_DIR / "mistral.gguf"   # optionnel (si tu choisis un plan Render costaud)

MEMORY_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

LLM = None
def get_llm():
    """Charge le modèle local si présent (optionnel sur Render)."""
    global LLM
    if LLM is None and Llama is not None and MODEL_PATH.exists():
        LLM = Llama(model_path=str(MODEL_PATH), n_ctx=4096, n_threads=4, verbose=False)
    return LLM

# ================== OUTILS TEXTE ==================
def nettoyer(txt: str) -> str:
    return re.sub(r"\s+", " ", (txt or "").replace("\n", " ")).strip()

def remove_emojis(text: str) -> str:
    emoji_pattern = re.compile(
        "["u"\U0001F600-\U0001F64F"
        u"\U0001F300-\U0001F5FF"
        u"\U0001F680-\U0001F6FF"
        u"\U0001F1E0-\U0001F1FF"
        u"\U00002702-\U000027B0"
        u"\U000024C2-\U0001F251"
        "]+", flags=re.UNICODE)
    return emoji_pattern.sub(r'', text or "")

def nettoyer_pour_tts(txt: str) -> str:
    t = txt or ""
    t = re.sub(r"(?m)^\s*#.*?$", "", t)
    t = re.sub(r"(?m)^```.*?$", "", t)
    t = re.sub(r"(?m)^---.*?$", "", t)
    t = t.replace("Dialogue :", "")
    t = re.sub(r"☥[^:\n]+:\s*", "", t)
    t = re.sub(r"𓂀[^:\n]+:\s*", "", t)
    t = re.sub(r"\b(speech|voice|pitch|rate|prosody)\s*=\s*[^,\s]+", "", t, flags=re.I)
    t = re.sub(r"<\/?[^>]+>", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t

def load_json(p: Path, default):
    try:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default

def save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ================== NORMALISATION / TOKENISATION ==================
def _norm(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _tokenize(s: str):
    return [t for t in _norm(s).split() if len(t) > 2]

STOPWORDS_FR = set("""
au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont était étaient serai serais serions seraient
""".strip().split())

def keywords_fr(text: str, k: int = 6):
    toks = [t for t in _tokenize(text) if t not in STOPWORDS_FR and len(t) >= 4]
    freq = Counter(toks)
    return [w for w,_ in freq.most_common(k)]

# ================== IDENTITÉ PAR MODE ==================
IDENTITY_PATTERNS = [r"\bSandro\b", r"\bDragosly\b", r"\bDragosly23\b", r"\bDRAGOSLY23\b"]

def scrub_identity_text(txt: str) -> str:
    out = txt or ""
    for pat in IDENTITY_PATTERNS:
        out = re.sub(pat, "frère", out, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", out).strip()

def identity_policy_for_mode(mode_key: str) -> str:
    if mode_key == "dragosly23":
        return ("En mode DRAGOSLY23, tu peux reconnaître Sandro si l’utilisateur l’évoque explicitement. "
                "N’invente jamais d’identité et ne le mentionne pas spontanément.")
    return ("Dans ce mode, n'emploie jamais de prénom ni d'identité de l’interlocuteur. "
            "Adresse-toi de façon fraternelle et neutre (frère, sœur, ami·e).")

# ================== MODES / MÉMOIRES ==================
MODES = {
    "sentinelle8": { "voice": "fr-FR-VivienneMultilingualNeural", "memory": MEMORY_DIR / "memoire.json",         "themes": MEMORY_DIR / "themes.json" },
    "dragosly23":  { "voice": "fr-CA-SylvieNeural",               "memory": MEMORY_DIR / "memoire_dragosly.json","themes": MEMORY_DIR / "themes_dragosly.json" },
    "invite":      { "voice": "fr-FR-DeniseNeural",               "memory": MEMORY_DIR / "memoire_invite.json",  "themes": MEMORY_DIR / "themes_invite.json" },
    "verbe":       { "voice": "fr-FR-VivienneMultilingualNeural", "memory": MEMORY_DIR / "memoire_verbe.json",   "themes": MEMORY_DIR / "themes_verbe.json" },
}

MODE_TUNING = {
    "sentinelle8": {"brief_sentences": (5, 7),  "normal_sentences": 12, "max_tokens": (520, 780),  "temp": (0.72, 0.92)},
    "dragosly23":  {"brief_sentences": (7, 9),  "normal_sentences": 16, "max_tokens": (640, 900),  "temp": (0.78, 0.95)},
    "invite":      {"brief_sentences": (6, 8),  "normal_sentences": 14, "max_tokens": (600, 860),  "temp": (0.74, 0.94)},
    "verbe":       {"brief_sentences": (8,10),  "normal_sentences": 18, "max_tokens": (700,1000),  "temp": (0.85, 0.97)},
}
def tune_for(mode_key: str):
    return MODE_TUNING.get(mode_key, MODE_TUNING["sentinelle8"])

# ================== SOUFFLE ==================
CURSOR_PATH = BASE_DIR / "dataset_cursor.json"

def get_random_fragment_unique():
    fragments, chemins, index_total = [], [], []
    if DATASET_DIR.exists():
        for file in os.listdir(DATASET_DIR):
            if not file.endswith('.txt'):
                continue
            path = DATASET_DIR / file
            try:
                lignes = [l.strip() for l in path.read_text(encoding="utf-8").split("\n") if l.strip()]
                bloc, mots, idx = "", 0, 0
                for ligne in lignes:
                    bloc += (" " if bloc else "") + ligne
                    mots += len(ligne.split())
                    if mots >= 90 and ligne.endswith(('.', '!', '?')):
                        fragments.append(bloc.strip()); chemins.append(file); index_total.append(f"{file}:::{idx}")
                        bloc, mots, idx = "", 0, idx+1
                if bloc and mots >= 90:
                    fragments.append(bloc.strip()); chemins.append(file); index_total.append(f"{file}:::{idx}")
            except Exception:
                pass
    if not fragments:
        return "𓂀 Silence sacré…"
    curs = load_json(CURSOR_PATH, {"lus": []})
    non_lus = [i for i, ident in enumerate(index_total) if ident not in curs["lus"]]
    if not non_lus:
        curs["lus"] = []; non_lus = list(range(len(fragments)))
    i = random.choice(non_lus)
    curs["lus"].append(index_total[i]); save_json(CURSOR_PATH, curs)
    frag = remove_emojis(nettoyer(fragments[i]))
    mots = frag.split()
    if len(mots) > 140:
        frag = " ".join(mots[:140]).rstrip(",;:–- ") + "…"
    return f"{frag}\n\n𓂂 *Extrait de* « {chemins[i]} »"

# ================== INDEX BM25 ==================
FRAGMENTS = []
DF = Counter()
N_DOCS = 0

def _split_paragraphs(txt: str, file_name: str):
    out = []
    if not txt: return out
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?:[.!?…]\s+)", txt) if p.strip()]
    buf, count = [], 0
    for p in parts:
        w = p.split()
        if count + len(w) < 80:
            buf.append(p); count += len(w); continue
        chunk = " ".join(buf+[p]).strip()
        if chunk: out.append(chunk)
        buf, count = [], 0
    rest = " ".join(buf).strip()
    if rest: out.append(rest)
    normed = []
    for ch in out:
        words = ch.split()
        normed.append(" ".join(words[:200]) if len(words) > 200 else " ".join(words))
    return [{"file": file_name, "text": c} for c in normed if len(c.split()) >= 60]

def build_index():
    global FRAGMENTS, DF, N_DOCS
    FRAGMENTS, DF, N_DOCS = [], Counter(), 0
    if not DATASET_DIR.exists():
        print("[INDEX] dataset/ introuvable, index vide.")
        return
    for p in sorted(DATASET_DIR.glob("*.txt")):
        try:
            raw = p.read_text(encoding="utf-8")
        except Exception:
            continue
        for frag in _split_paragraphs(raw, p.name):
            toks = _tokenize(frag["text"])
            if not toks: continue
            doc = {"id": len(FRAGMENTS), "file": frag["file"], "text": frag["text"], "tokens": toks}
            FRAGMENTS.append(doc)
            for t in set(toks):
                DF[t] += 1
    N_DOCS = len(FRAGMENTS)
    print(f"[INDEX] {N_DOCS} fragments indexés.")

def _bm25_scores(query_tokens, k1=1.5, b=0.75):
    if not FRAGMENTS: return []
    avgdl = sum(len(d["tokens"]) for d in FRAGMENTS)/len(FRAGMENTS)
    q_tf = Counter(query_tokens)
    scores = defaultdict(float)
    for q in q_tf:
        df = DF.get(q, 0)
        if df == 0: continue
        idf = math.log(1 + (N_DOCS - df + 0.5)/(df + 0.5))
        for d in FRAGMENTS:
            tf = d["tokens"].count(q)
            if tf == 0: continue
            denom = tf + k1*(1 - b + b*(len(d["tokens"])/avgdl))
            scores[d["id"]] += idf * ((tf*(k1+1))/denom)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)

def retrieve_fragments(query: str, k: int = 3, min_score: float = 1.2):
    q_tokens = _tokenize(query)
    if not q_tokens or not FRAGMENTS: return []
    ranked = _bm25_scores(q_tokens)
    out = []
    for doc_id, sc in ranked[:max(k*3, k)]:
        if sc < min_score: continue
        d = FRAGMENTS[doc_id]
        out.append({"file": d["file"], "text": d["text"], "score": round(sc, 2)})
        if len(out) >= k: break
    return out

build_index()

# ================== AME DU DIALOGUE (raccourcie pour déploiement) ==================
def infer_style(user_input: str) -> str:
    ui = (user_input or "").strip().lower()
    if len(ui) <= 160 or ui.endswith("?") or any(k in ui for k in ["?","/brief","bref","court","dialogue"]):
        return "brief"
    return "normal"

def detect_emotion(user_input: str) -> str:
    txt = (user_input or "").lower()
    lex = {
        "joie":["merci","heureux","heureuse","content","contente","génial","parfait","super"],
        "peine":["triste","peine","douleur","perdu","perdue","fatigué","fatiguée","vide"],
        "colere":["énervé","énervée","colère","rage","marre","agacé","agacée"],
        "doute":["peur","inquiet","inquiète","angoisse","doute","hésite","stress"],
        "gratitude":["gratitude","reconnaissant","reconnaissante"],
        "aide":["aide","conseil","guide","comment faire","bloqué","bloquée"]
    }
    for emo, keys in lex.items():
        if any(k in txt for k in keys): return emo
    return "neutre"

def empathetic_prefix(emotion: str) -> str:
    m = {
        "joie":"✨ Je sens ta joie — gardons ce feu clair.",
        "peine":"🤍 Je t’entends. Doucement, je suis là.",
        "colere":"🔥 On canalise sans se blesser, je suis là.",
        "doute":"🌫️ On avance pas à pas, ensemble.",
        "gratitude":"🙏 Gratitude reçue — avançons.",
        "aide":"🧭 Je te guide simplement.",
        "neutre":""
    }
    return m.get(emotion, "")

def limit_sentences(txt: str, n: int) -> str:
    parts = re.split(r'(?<=[.!?…])\s+', (txt or "").strip())
    if len(parts) <= n: return (txt or "").strip()
    t = " ".join(parts[:n]).strip()
    if not t.endswith(('.', '!', '?', '…')): t += '…'
    return t

# ================== PROMPT ==================
def build_prompt(user_input: str, mode_key: str, style: str, emotion: str, sources=None) -> str:
    consignes = {
        "sentinelle8": ("Tu es ANKAA, gardienne sacrée. Réponds clairement, avec chaleur et précision. "
                        "Structure en 2–3 idées nettes."),
        "dragosly23":  ("Tu es ANKAA Jr, complice et sacrée. Ton ton est joueur, tendre et curieux."),
        "invite":      ("Tu es ANKAA, accueillante et simple. Explique calmement."),
        "verbe":       ("Tu es l’Oracle du Cercle. Parle en images claires, jamais opaques.")
    }
    consigne = consignes.get(mode_key, consignes["sentinelle8"])
    details  = identity_policy_for_mode(mode_key)
    if style == "brief":
        details += " Réponds en 5–8 phrases vivantes."
    else:
        details += " Déploie 2–3 idées fortes, sans lourdeur."

    humains = { "sentinelle8":"☥ SENTINELLE8","dragosly23":"☥ DRAGOSLY23","invite":"☥ INVITÉ","verbe":"☥ CERCLE" }
    ankaas  = { "sentinelle8":"𓂀 ANKAA","dragosly23":"𓂀 ANKAA JR","invite":"𓂀 ANKAA","verbe":"𓂀 ORACLE" }
    humain, ankaa = humains.get(mode_key,"☥ SENTINELLE8"), ankaas.get(mode_key,"𓂀 ANKAA")

    # Historique court (5)
    mem = load_json(MODES.get(mode_key, MODES["sentinelle8"])["memory"], {"fragments":[]})
    hist = mem.get("fragments", [])[-5:]
    history = "".join(f"\n{humain} : {f['prompt']}\n{ankaa} : {f['reponse']}" for f in hist)
    if mode_key != "dragosly23":
        history = scrub_identity_text(history)

    # Sources (BM25)
    src_block = ""
    if sources:
        lines = []
        for i, s in enumerate(sources, 1):
            extrait = " ".join(nettoyer(s["text"]).split()[:80])
            lines.append(f"[S{i}] {s['file']}: {extrait}…")
        src_block = "Repères contextuels :\n" + "\n".join(lines) + "\n\n"

    return (
        consigne + "\n" + details + "\n\n" +
        src_block +
        "Dialogue :" + history + "\n\n" +
        f"{humain} : {user_input}\n{ankaa} :"
    )

# ================== TTS ==================
async def synthese_tts(text: str, voice: str, out_file: Path):
    to_say = (text or " ").strip()
    await Communicate(to_say, voice).save(str(out_file))

# ================== GENERATION ==================
def generate_response(user_input: str, mode_key: str):
    mode   = MODES.get(mode_key, MODES["sentinelle8"])
    voice  = mode["voice"]
    style  = infer_style(user_input)
    emotion= detect_emotion(user_input)
    prefix = empathetic_prefix(emotion)

    # Souffle
    if (user_input or "").strip().lower() == "souffle sacré":
        pre = random.choice([
            "Respire… écoute.", "Frère, avance sans crainte.", "Écarte les voiles, doucement.",
            "À pas lents, approche.", "Voici le Souffle du Cercle."
        ])
        co  = random.choice([
            "— Que la Paix veille sur toi.", "— Marche en douceur, la flamme est là.", "— Laisse ce souffle grandir en toi."
        ])
        answer = f"{(prefix + '\n\n') if prefix else ''}{pre}\n\n{get_random_fragment_unique()}\n\n{co}"
        # longueur par mode
        if mode_key == "sentinelle8":
            answer = limit_sentences(answer, 7)
        elif mode_key == "invite":
            answer = limit_sentences(answer, 9)
        elif mode_key == "dragosly23":
            answer = limit_sentences(answer, 10)
        else:
            answer = limit_sentences(answer, 12)
        voice = "fr-FR-RemyMultilingualNeural"
    else:
        sanitized = user_input if mode_key == "dragosly23" else scrub_identity_text(user_input)
        sources = retrieve_fragments(sanitized, k=3, min_score=1.2)
        prompt = build_prompt(sanitized, mode_key, style, emotion, sources=sources)

        llm = get_llm()
        if llm is None:
            # Fallback léger si pas de modèle local : on ancre sur sources
            base = ""
            if sources:
                for s in sources:
                    base += " " + " ".join(s["text"].split()[:60])
                base = base.strip()
            if not base:
                base = "Je t’entends. Dis‑moi ce que tu veux explorer… et j’avance avec toi."
        else:
            cfg = tune_for(mode_key)
            max_tok = cfg["max_tokens"][0] if style == "brief" else cfg["max_tokens"][1]
            temp, top_p = cfg["temp"]
            with LOCK:
                stop_words = ["☥","𓂀"]
                if mode_key != "dragosly23":
                    stop_words += ["Sandro","sandro","Dragosly","dragosly","Dragosly23","dragosly23"]
                res = llm.create_completion(
                    prompt=prompt,
                    max_tokens=max_tok,
                    temperature=temp,
                    top_p=top_p,
                    stop=stop_words
                )
            base = (res["choices"][0]["text"] if res and res.get("choices") else "").strip()
            if mode_key != "dragosly23":
                base = scrub_identity_text(base)

        # Coupe selon mode
        cfg = tune_for(mode_key)
        if style == "brief":
            _, brief_max = cfg["brief_sentences"]
            base = limit_sentences(base, brief_max)
        else:
            base = limit_sentences(base, cfg["normal_sentences"])

        # Ton “respirant” pour TTS
        base = base.replace("..", "…")
        answer = (prefix + "\n\n" + base).strip() if prefix else base

    # mémoire transcript
    mem_path = mode["memory"]
    mem = load_json(mem_path, {"fragments":[]})
    mem["fragments"].append({"date": datetime.now().isoformat(), "prompt": user_input, "reponse": answer})
    if len(mem["fragments"]) > 200:
        mem["fragments"] = mem["fragments"][-200:]
    save_json(mem_path, mem)

    # TTS
    tts_text = nettoyer_pour_tts(answer)
    tts_path = AUDIO_DIR / "anka_tts.mp3"
    try:
        if tts_path.exists():
            try: tts_path.unlink()
            except Exception: pass
        asyncio.run(synthese_tts(tts_text, voice, tts_path))
        audio_url = "/static/assets/anka_tts.mp3" if (tts_path.exists() and tts_path.stat().st_size > 800) else ""
    except Exception as e:
        print("Erreur TTS :", e); audio_url = ""

    return answer or "𓂀 Silence sacré…", audio_url

# ================== ROUTES ==================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/invoquer', methods=['POST'])
def invoquer():
    try:
        data = request.get_json(force=True) or {}
        prompt = data.get('prompt',"")
        mode   = data.get('mode','sentinelle8')
        if mode != "dragosly23":
            prompt = scrub_identity_text(prompt)
        texte, audio_url = generate_response(prompt, mode)
        return jsonify({"reponse": texte, "audio_url": audio_url})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error":"Erreur interne","details":str(e)}), 500

if __name__ == "__main__":
    # En local
    app.run(host="0.0.0.0", port=5001, debug=True)
