let Graph;
let currentLinkWidth = 1;
let currentLinkColor = "white";
let clusters = {};
let autoRotate = false;

// ---------------- AUTO ROTATION ----------------
function rotateScene() {
  if (autoRotate && Graph) {
    const cam = Graph.cameraPosition();
    Graph.cameraPosition(
      {
        x: cam.x * Math.cos(0.004) - cam.z * Math.sin(0.004),
        y: cam.y,
        z: cam.x * Math.sin(0.004) + cam.z * Math.cos(0.004)
      },
      cam,
      100
    );
  }
  requestAnimationFrame(rotateScene);
}
rotateScene();


// ---------------- LOAD GRAPH ----------------
async function loadGraph() {
  const res = await fetch("/static/similarity.json");
  const data = await res.json();

  clusters = generateClusters(data.similarities);

  const links = createLinks(data.people, data.similarities);

  if (!Graph) {
    Graph = ForceGraph3D()(document.getElementById("graph"))
      .nodeThreeObject(node => {
        const tx = new THREE.TextureLoader().load(node.img);
        const mat = new THREE.SpriteMaterial({ map: tx });
        const sp = new THREE.Sprite(mat);
        sp.scale.set(30, 30, 1);
        return sp;
      })
      .nodeColor(node => clusters[node.id].color)
      .onNodeClick(node => highlightSimilar(node))
      .linkVisibility(() => true)
      .linkWidth(() => currentLinkWidth)
      .linkColor(() => currentLinkColor);
  }

  Graph.graphData({ nodes: data.people, links });
}


// ---------------- AUTO CLUSTERING ----------------
function generateClusters(sim) {
  let groups = {};
  let groupID = 0;

  for (let i = 0; i < sim.length; i++) {
    if (!groups[i]) {
      groups[i] = { group: groupID };
      groupID++;
    }
    for (let j = i + 1; j < sim.length; j++) {
      if (sim[i][j] > 0.55) {
        groups[j] = { group: groups[i].group };
      }
    }
  }

  const palette = ["#ff5252", "#ffd740", "#69f0ae", "#40c4ff", "#b388ff", "#ff8a65"];

  for (let i in groups) {
    groups[i].color = palette[groups[i].group % palette.length];
  }

  return groups;
}


// ---------------- HIGHLIGHT SIMILAR FACES ----------------
function highlightSimilar(node) {
  Graph.linkWidth(l =>
    l.source.id === node.id || l.target.id === node.id ? 5 : currentLinkWidth
  );

  Graph.nodeColor(n =>
    n.id === node.id
      ? "white"
      : clusters[n.id].color
  );
}


// ---------------- CREATE LINKS ----------------
function createLinks(people, sim) {
  const links = [];
  for (let i = 0; i < sim.length; i++) {
    for (let j = i + 1; j < sim.length; j++) {
      if (sim[i][j] > 0.2) {
        links.push({
          source: people[i].id,
          target: people[j].id
        });
      }
    }
  }
  return links;
}


// ---------------- UPLOAD IMAGES ----------------
async function uploadImages() {
  const input = document.getElementById("uploadInput");
  const status = document.getElementById("status");

  if (!input.files.length) {
    status.innerText = "No files selected.";
    return;
  }

  const fd = new FormData();
  for (let f of input.files) fd.append("files", f);

  status.innerText = "Uploading...";
  const res = await fetch("/upload", { method: "POST", body: fd });
  const data = await res.json();

  if (data.success) {
    status.innerText = "Uploaded: " ;
    setTimeout(loadGraph, 500);
  } else {
    status.innerText = "Error uploading!";
  }
}


// ---------------- LINK VISIBILITY ----------------
function updateLinkVisibility() {
  const visible = document.getElementById("toggleLinks").checked;

  Graph.linkVisibility(() => visible ? true : false);

  // When strings are off, width doesn't matter
  if (!visible) Graph.linkWidth(() => 0);
  else Graph.linkWidth(() => currentLinkWidth);
}


// ---------------- LINK WIDTH ----------------
function updateLinkWidth() {
  currentLinkWidth = parseFloat(document.getElementById("linkWidth").value);
  const visible = document.getElementById("toggleLinks").checked;
  Graph.linkWidth(visible ? currentLinkWidth : 0);
}


// ---------------- LINK COLOR ----------------
function updateLinkColor() {
  currentLinkColor = document.getElementById("linkColorPicker").value;
  Graph.linkColor(() => currentLinkColor);
}


// ---------------- NODE DISTANCE ----------------
function updateNodeDistance() {
  const distance = parseFloat(document.getElementById("nodeDistance").value);
  Graph.d3Force("link").distance(distance);
  Graph.numDimensions(3);
}



loadGraph();
