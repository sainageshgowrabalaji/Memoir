# Builds src/brain/model/memoir-words.json, Memoir's small on-phone model, from GloVe 6B 100d
# (public domain), read from the wink-embeddings-sg-100d npm package (MIT).
#
#   npm pack wink-embeddings-sg-100d && tar -xzf wink-embeddings-sg-100d-*.tgz
#   pip install numpy wordfreq
#   python3 scripts/distill-model.py package/wink-embeddings-sg-100d.json
#
# Steps: the most used words plus an everyday extras list, remove the direction every word shares,
# reduce to DIMS numbers with PCA, scale each word to length 1, and store as int8.
import json, re, base64, sys, os
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parent.parent
N, DIMS = 40000, 64
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'package/wink-embeddings-sg-100d.json'))
words, V = d['words'], d['vectors']
ok = re.compile(r"^[a-z][a-z'-]*[a-z]$|^[a-z]$")
# Everyday frequency (films, social media, web, books), so "stroller" and "invoice" make the cut.
from wordfreq import top_n_list
top = [w for w in top_n_list('en', 120000) if ok.match(w) and w in V][:N]
cats = (ROOT / 'src/brain/categories.ts').read_text()
cat_words = set(w for phrase in re.findall(r"'([a-z0-9 ]+)'", cats) for w in phrase.split())
EXTRA = """dosa idli vada sambar chutney biryani paneer samosa chaat dal masala chai lassi naan roti paratha tikka tandoori pulao
upma poha halwa jalebi ramen sushi pho tacos burrito boba matcha latte espresso croissant bagel brunch kulfi
kubernetes docker kafka leetcode bitcoin ethereum chatgpt openai python javascript typescript nodejs github gitlab aws azure
devops microservices blockchain startup startups
instagram whatsapp tiktok youtube netflix spotify uber lyft airbnb doordash zomato swiggy venmo zelle paytm upi
amma nanna appa akka anna ammamma thatha nani dadi diwali holi sankranti ugadi dussehra pongal navratri puja pooja
tirupati tirumala hyderabad bangalore bengaluru chennai vizag vijayawada mumbai pune
deadlift deadlifts squats pilates crossfit keto
etf etfs roth emi cashback podcast podcasts wishlist skincare sunscreen moisturizer
selfie selfies screenshot screenshots meme memes vlog vlogs binge sitcom""".split()
extra = [w for w in dict.fromkeys(EXTRA + sorted(cat_words)) if w in V and w not in set(top)]
vocab = top + extra
print('vocab', len(vocab), 'extras added', len(extra), 'missing', [w for w in EXTRA if w not in V])
X = np.array([V[w][:100] for w in vocab], dtype=np.float64)
X -= X[:N].mean(0)
_, _, Vt = np.linalg.svd(X[:20000], full_matrices=False)
X -= (X @ Vt[:1].T) @ Vt[:1]              # the shared direction every word leans on
_, _, Vt = np.linalg.svd(X[:N], full_matrices=False)
X = X @ Vt[:DIMS].T
X /= np.linalg.norm(X, axis=1, keepdims=True)
scale = 127 / np.percentile(np.abs(X), 99.9)
Q = np.clip(np.round(X * scale), -127, 127).astype(np.int8)
model = {
  'name': 'memoir-words', 'version': 1, 'dims': DIMS, 'scale': round(float(scale), 4), 'common': N,
  'source': 'GloVe 6B 100d (Pennington, Socher, Manning 2014, public domain), words chosen by wordfreq, distilled for Memoir',
  'words': ' '.join(vocab),
  'vectors': base64.b64encode(Q.tobytes()).decode(),
}
out = ROOT / 'src/brain/model/memoir-words.json'
json.dump(model, open(out, 'w'), separators=(',', ':'))
print(out, round(os.path.getsize(out) / 1e6, 2), 'MB')
