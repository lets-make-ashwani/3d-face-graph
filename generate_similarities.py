import os, json, numpy as np
from PIL import Image
from sklearn.metrics.pairwise import cosine_similarity
import insightface

print("Loading model...")
model = insightface.app.FaceAnalysis(allowed_modules=['detection','recognition'])
model.prepare(ctx_id=0)

def get_emb(path):
    try:
        img = np.asarray(Image.open(path))
        faces = model.get(img)
        if len(faces) == 0:
            print("⚠️ No face detected in:", path)
            return None
        return faces[0].embedding
    except Exception as e:
        print("⚠️ Error reading image:", path, e)
        return None

folder = "images"

files = sorted([
    f for f in os.listdir(folder)
    if f.lower().endswith((".jpg", ".jpeg", ".png"))
])

print("Found images:", files)

embeddings = []
valid_files = []

for f in files:
    print("Processing:", f)
    emb = get_emb(os.path.join(folder, f))
    if emb is not None:
        embeddings.append(emb)
        valid_files.append(f)
    else:
        print("❌ Skipped:", f)

if len(embeddings) < 2:
    print("❌ Not enough valid face images to compute similarity!")
    exit()

# Convert to numpy array
embeddings = np.array(embeddings)

sim = cosine_similarity(embeddings).tolist()

people = [{"id": i, "img": f"images/{valid_files[i]}"} for i in range(len(valid_files))]

out = {
    "people": people,
    "similarities": sim
}

json.dump(out, open("similarity.json", "w"), indent=2)

print("🎉 similarity.json created successfully!")
print("Valid images used:", valid_files)
