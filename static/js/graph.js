// static/js/graph.js  (defensive, debug-friendly)
(function () {
  // Wait for DOM + libs to be ready
  document.addEventListener('DOMContentLoaded', () => {
    // defensive presence checks
    if (typeof THREE === 'undefined') {
      console.error('THREE is not loaded. Ensure three.min.js is included BEFORE graph.js');
      return;
    }
    if (typeof ForceGraph3D === 'undefined') {
      console.error('3d-force-graph is not loaded. Ensure 3d-force-graph is included BEFORE graph.js');
      return;
    }

    // --- state ---
    let Graph = null;
    let currentLinkWidth = 1;
    let currentLinkColor = "#ffffff";
    let clusters = {};
    let autoRotate = false;
    const PLACEHOLDER_IMG = '/static/placeholder.png'; // optional placeholder you can add

    // --- helpers ---
    function safeEl(id, def = null) { try { return document.getElementById(id) || def; } catch { return def; } }

    function log(...args) { console.log('[graph]', ...args); }
    function warn(...args) { console.warn('[graph]', ...args); }
    function err(...args) { console.error('[graph]', ...args); }

    // auto-rotate loop
    function rotateScene() {
      try {
        if (autoRotate && Graph) {
          const c = Graph.cameraPosition();
          Graph.cameraPosition(
            { x: c.x * Math.cos(0.004) - c.z * Math.sin(0.004),
              y: c.y,
              z: c.x * Math.sin(0.004) + c.z * Math.cos(0.004) },
            c,
            100
          );
        }
      } catch (e) { /* don't crash animation */ }
      requestAnimationFrame(rotateScene);
    }
    rotateScene();

    // glow effect (safe - no crash if shader compile unavailable)
    function addGlowEffect(sprite) {
      try {
        if (!sprite.material || !sprite.material.onBeforeCompile) return;
        sprite.material.onBeforeCompile = shader => {
          try {
            shader.fragmentShader = shader.fragmentShader.replace(
              `#include <premultiplied_alpha_fragment>`,
              `
                #include <premultiplied_alpha_fragment>
                float glow = smoothstep(0.45, 0.2, length(gl_PointCoord * 2.0 - 1.0));
                gl_FragColor.rgb += glow * 0.5;
              `
            );
          } catch (e) { /* ignore shader patch errors */ }
        };
      } catch (e) { /* ignore */ }
    }

    // show preview popup (safe)
    function showPreview(src) {
      const popup = safeEl('previewPopup');
      const img = safeEl('previewImage');
      if (!popup || !img) {
        warn('Preview popup elements not found in HTML.');
        return;
      }
      img.src = src || PLACEHOLDER_IMG;
      popup.style.display = 'block';
    }

    // reset camera (centers at average)
    function resetCameraPosition() {
      if (!Graph) return;
      try {
        const nodes = Graph.graphData().nodes || [];
        if (!nodes.length) return;
        let cx = 0, cy = 0, cz = 0;
        nodes.forEach(n => { cx += n.x; cy += n.y; cz += n.z; });
        cx /= nodes.length; cy /= nodes.length; cz /= nodes.length;
        Graph.cameraPosition({ x: cx + 350, y: cy + 350, z: cz + 350 }, { x: cx, y: cy, z: cz }, 1000);
      } catch (e) { warn('resetCamera error', e); }
    }

    // clustering (same as before)
    function generateClusters(sim) {
      const groups = {};
      let groupID = 0;
      for (let i = 0; i < sim.length; i++) {
        if (!groups[i]) { groups[i] = { group: groupID }; groupID++; }
        for (let j = i + 1; j < sim.length; j++) {
          if (sim[i][j] > 0.55) groups[j] = { group: groups[i].group };
        }
      }
      const palette = ["#ff5252","#ffd740","#69f0ae","#40c4ff","#b388ff","#ff8a65","#18ffff","#ff4081"];
      for (let i in groups) groups[i].color = palette[groups[i].group % palette.length];
      return groups;
    }

    function highlightSimilar(node) {
      try {
        if (!Graph) return;
        Graph.linkWidth(l => (l.source.id === node.id || l.target.id === node.id) ? 5 : currentLinkWidth);
        Graph.nodeColor(n => n.id === node.id ? "#ffffff" : (clusters[n.id] ? clusters[n.id].color : "#999999"));
      } catch (e) { warn('highlightSimilar error', e); }
    }

    function createLinks(people, sim, maxLinksPerNode = 50) {
      // Build links but limit edges per node to avoid browser overload
      const links = [];
      const counts = Array(people.length).fill(0);
      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          if (sim[i][j] > 0.2) {
            if (counts[i] < maxLinksPerNode && counts[j] < maxLinksPerNode) {
              links.push({ source: people[i].id, target: people[j].id, value: sim[i][j] });
              counts[i]++; counts[j]++;
            }
          }
        }
      }
      log(`createLinks: nodes=${people.length} links=${links.length}`);
      return links;
    }

    // safe texture loader with fallback
    function loadTextureWithFallback(url, onLoad, onError) {
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = '';
      loader.load(
        url,
        tex => { if (onLoad) onLoad(tex); },
        undefined,
        e => {
          warn('Texture load failed for', url, ', using placeholder.');
          if (onError) onError(e);
        }
      );
    }

    // Build or update graph
    async function loadGraph() {
      try {
        const res = await fetch('/static/similarity.json', {cache: "no-store"});
        if (!res.ok) { err('Failed to fetch similarity.json', res.status); return; }
        const data = await res.json();

        if (!data.people || !data.people.length) { warn('similarity.json has no people.'); return; }

        clusters = generateClusters(data.similarities || []);
        const links = createLinks(data.people, data.similarities || [], 80); // limit edges per node

        if (!Graph) {
          Graph = ForceGraph3D()(document.getElementById('graph'));

          // Make graph "limitless" if desired (you can remove these lines to enable centering)
          try {
            Graph.d3Force('center', null);
            Graph.d3Force('charge').strength(-5);
            Graph.d3Force('link').distance(() => null);
            if (Graph.cameraDistanceMax) Graph.cameraDistanceMax(Infinity);
            if (Graph.cameraDistanceMin) Graph.cameraDistanceMin(0.01);
          } catch (e) { warn('Could not set force params', e); }

          // node rendering with aspect ratio and safe texture
          Graph.nodeThreeObject(node => {
            const mat = new THREE.SpriteMaterial({ map: null, transparent: true });
            const sp = new THREE.Sprite(mat);

            // load texture safely
            loadTextureWithFallback(node.img,
              (tex) => {
                try { mat.map = tex; mat.needsUpdate = true; }
                catch (e) { warn('apply texture error', e); }
              },
              () => {
                // fallback to placeholder if exists
                loadTextureWithFallback(PLACEHOLDER_IMG, tex => { mat.map = tex; mat.needsUpdate = true; });
              }
            );

            // preserve aspect ratio
            const tmpImg = new Image();
            tmpImg.src = node.img;
            tmpImg.onload = () => {
              const w = tmpImg.width || 1, h = tmpImg.height || 1;
              const maxSize = 30;
              if (w > h) sp.scale.set(maxSize, maxSize * (h / w), 1);
              else sp.scale.set(maxSize * (w / h), maxSize, 1);
            };
            tmpImg.onerror = () => {
              // placeholder scale
              sp.scale.set(30, 30, 1);
            };

            // add glow if possible
            try { addGlowEffect(sp); } catch (e) { /* ignore */ }

            return sp;
          });

          Graph.nodeColor(node => clusters[node.id] ? clusters[node.id].color : '#999999');

          Graph.onNodeClick(node => {
            showPreview(node.img);
            highlightSimilar(node);
          });

          Graph.linkVisibility(() => true);
          Graph.linkWidth(() => currentLinkWidth);
          Graph.linkColor(() => currentLinkColor);

          // safety: catch engine errors
          Graph.onEngineStop(() => { log('Force engine stopped'); });
        }

        Graph.graphData({ nodes: data.people, links });
        log(`Loaded graph: ${data.people.length} nodes, ${links.length} links`);
      } catch (e) {
        err('loadGraph error', e);
      }
    }

    // UI actions
    window.uploadImages = async function () {
      try {
        const input = safeEl('uploadInput');
        const status = safeEl('status');
        if (!input || !input.files.length) { if (status) status.innerText = 'No files selected'; return; }
        const fd = new FormData();
        for (const f of input.files) fd.append('files', f);
        if (status) status.innerText = 'Uploading...';
        const res = await fetch('/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success) {
          if (status) status.innerText = 'Uploaded';
          setTimeout(loadGraph, 700);
        } else if (status) status.innerText = 'Upload failed';
      } catch (e) { err('uploadImages error', e); }
    };

    window.updateLinkVisibility = function () {
      try {
        const visible = !!(safeEl('toggleLinks') && safeEl('toggleLinks').checked);
        if (!Graph) return;
        Graph.linkVisibility(() => visible);
        Graph.linkWidth(() => visible ? currentLinkWidth : 0);
      } catch (e) { warn('updateLinkVisibility', e); }
    };

    window.updateLinkWidth = function () {
      try {
        const el = safeEl('linkWidth');
        currentLinkWidth = el ? parseFloat(el.value) : 1;
        const visible = !!(safeEl('toggleLinks') && safeEl('toggleLinks').checked);
        if (Graph) Graph.linkWidth(() => visible ? currentLinkWidth : 0);
      } catch (e) { warn('updateLinkWidth', e); }
    };

    window.updateLinkColor = function () {
      try {
        const el = safeEl('linkColorPicker');
        currentLinkColor = el ? el.value : '#ffffff';
        if (Graph) Graph.linkColor(() => currentLinkColor);
      } catch (e) { warn('updateLinkColor', e); }
    };

    window.updateNodeDistance = function () {
      try {
        const el = safeEl('nodeDistance');
        const distance = el ? parseFloat(el.value) : 120;
        if (Graph) Graph.d3Force('link').distance(distance);
        if (Graph) Graph.numDimensions(3);
      } catch (e) { warn('updateNodeDistance', e); }
    };

    window.toggleAutoRotate = function () {
      autoRotate = !!(safeEl('autoRotate') && safeEl('autoRotate').checked);
    };

    window.resetCamera = function () {
      resetCameraPosition();
    };

    // expose debug loader
    window.reloadGraph = loadGraph;

    // start
    setTimeout(loadGraph, 200);
    log('graph.js initialized');
  });
})();
