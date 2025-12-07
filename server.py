from flask import Flask, request, jsonify, render_template, send_from_directory
import os, json, numpy as np
from PIL import Image
from sklearn.metrics.pairwise import cosine_similarity
import insightface
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Paths
IMAGE_DIR = "static/images"
SIM_FILE = "static/similarity.json"

os.makedirs(IMAGE_DIR, exist_ok=True)

# Load face model once
print("Loading face model...")
model = insightface.app.FaceAnalysis(allowed_modules=['detection','recognition'])
model.prepare(ctx_id=0)

def get_embedding(path):
    try:
        img = np.asarray(Image.open(path))
        faces = model.get(img)
        if len(faces) == 0:
            print("❌ No face detected:", path)
            return None
        return faces[0].embedding
    except Exception as e:
        print("❌ Error reading:", path, e)
        return None

def generate_similarity():
    files = sorted([
        f for f in os.listdir(IMAGE_DIR)
        if f.lower().endswith((".jpg",".jpeg",".png"))
    ])

    embeddings = []
    valid_files = []

    for f in files:
        path = os.path.join(IMAGE_DIR, f)
        emb = get_embedding(path)
        if emb is not None:
            embeddings.append(emb)
            valid_files.append(f)

    if len(embeddings) < 2:
        print("❌ Not enough valid faces!")
        return

    embeddings = np.array(embeddings)
    sim = cosine_similarity(embeddings).tolist()

    people = [
        {"id": i, "img": f"/static/images/{valid_files[i]}"}
        for i in range(len(valid_files))
    ]

    out = {"people": people, "similarities": sim}

    with open(SIM_FILE, "w") as f:
        json.dump(out, f, indent=2)

    print("✅ similarity.json updated")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/upload", methods=["POST"])
def upload():
    files = request.files.getlist("files")
    saved = []

    for file in files:
        filename = secure_filename(file.filename)
        path = os.path.join(IMAGE_DIR, filename)
        file.save(path)
        saved.append(filename)

    print("Uploaded:", saved)
    generate_similarity()

    return jsonify({"success": True, "saved": saved})

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
