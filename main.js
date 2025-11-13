(() => {
  // Centralized style variables
  const STYLE = {
    nodeFill: '#ffffff',
    nodeStroke: '#000000',
    nodeText: '#000000',
    edgeStroke: '#888888'
  };

  // 1) Initialize Mermaid safely (and silence its error channel)
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'antiscript',
      theme: 'base', // fixed geometry and neutral baseline
      themeVariables: {
        background: 'transparent',
        primaryColor: STYLE.nodeFill,
        primaryBorderColor: STYLE.nodeStroke,
        lineColor: STYLE.edgeStroke,
        textColor: STYLE.nodeText,
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
      },
      flowchart: { useMaxWidth: true, padding: 6, htmlLabels: true }
    });
    if (typeof mermaid.parseError === 'function') mermaid.parseError = () => {};
  } catch (e) {}

  // 2) Filter Mermaid’s repetitive console noise (without muting others)
  (function patchConsoleError() {
    const orig = console.error;
    console.error = function (...args) {
      const s = args.join(' ');
      if (s.includes('Syntax error in text') || s.includes('Parse error') || s.includes('textmermaid')) return;
      return orig.apply(this, args);
    };
  })();

  // DOM state
  let editor = null;
  let lastSvgText = null;
  let copyButton = null;

  // Helpers
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function sanitizeMermaidText(s) {
    if (!s) return '';
    return s
      .replace(/\u2018|\u2019|\u201A|\u201B|\u2032/g, "'")
      .replace(/\u201C|\u201D|\u201E|\u201F|\u2033/g, '"')
      .replace(/\r\n?/g, '\n')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, '')
      .trim();
  }

function attemptAutoFixes(text) {
  return text;
}

  // CodeMirror overlay for basic Mermaid syntax
  function mermaidOverlay() {
    const kw = /^(?:graph|flowchart|sequenceDiagram|gantt|classDiagram|stateDiagram|pie|erDiagram|journey|subgraph|end)\b/i;
    return {
      token(stream) {
        if (stream.match('%%')) { stream.skipToEnd(); return 'comment'; }
        if (stream.match(/^"([^"]*)"/)) return 'string';
        if (stream.match(/^'([^']*)'/)) return 'string';
        if (stream.match(kw, true)) return 'keyword';
        if (stream.match(/^(?:-->|<--|->|<-|--|==>|<-==|-\.\->|<-\.\-)/, true)) return 'operator';
        if (stream.match(/^\[[^\]]*\]/, true)) return 'bracket';
        if (stream.match(/^\([^\)]*\)/, true)) return 'bracket';
        if (stream.match(/^[A-Za-z0-9_\-]+(?=\s|:|->|--|\[|\(|$)/, true)) return 'atom';
        stream.next(); return null;
      }
    };
  }

  // Render Mermaid silently
  async function renderDiagram({ tryAutoFix = true, stripAnchors = false } = {}) {
    try {
      const raw = editor.getValue();
      const sanitized = sanitizeMermaidText(raw);
      if (!sanitized) { if (!lastSvgText) document.getElementById('output').innerHTML = ''; return; }

      const fixed = tryAutoFix ? attemptAutoFixes(sanitized) : sanitized;
      const id = 'mmd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const { svg } = await mermaid.render(id, fixed);

      if (!svg || svg.includes('aria-roledescription="error"')) return;
      const parser = new DOMParser();
      const doc = parser.parseFromString(svg, 'image/svg+xml');
      const svgEl = doc.documentElement;
      if (!svgEl || svgEl.nodeName.toLowerCase() !== 'svg') return;
      if (!svgEl.getAttribute('xmlns')) svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      // Simple black-on-white override for export
      const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleEl.textContent = `
        g[class*="node"] rect, g[class*="node"] circle, g[class*="node"] ellipse, 
        g[class*="node"] polygon, g[class*="node"] polyline, g[class*="node"] path {
          fill: #ffffff !important; stroke: #000000 !important;
        }
        g[class*="node"] text, g[class*="node"] tspan, .label { fill: #000000 !important; }
      `;
      svgEl.insertBefore(styleEl, svgEl.firstChild || null);

      const imported = document.importNode(svgEl, true);
      imported.classList.add('m2a');

      const originalNodeLabels = new Map();
      const originalEdgeLabels = new Map();

      // collect node labels
      imported.querySelectorAll('g.node').forEach(node => {
        const lbl = node.querySelector('g.label');
        if (!lbl) return;
        const txt = lbl.textContent.trim();
        originalNodeLabels.set(node.id, txt);
      });

      // collect edge labels (Mermaid v10 foreignObject structure)
      let edgeIndex = 0;
      imported.querySelectorAll('g.edgeLabel').forEach(el => {
        const div = el.querySelector('foreignObject > div');
        const text = div ? div.textContent.trim() : '';
        originalEdgeLabels.set(edgeIndex++, text);
      });

      // remove only node labels
      imported.querySelectorAll('g.node g.label').forEach(lbl => lbl.remove());
      // remove only edge label contents
      imported.querySelectorAll('g.edgeLabel g.label').forEach(lbl => lbl.remove());

      Array.from(imported.querySelectorAll('g.node')).forEach(node => {
        const shape = node.querySelector('.label-container');
        if (!shape) return;

        const bbox = shape.getBBox();
        const pad = 10;
        const adjX = bbox.x - pad / 2;
        const adjY = bbox.y - pad / 2;
        const adjW = bbox.width + pad;
        const adjH = bbox.height + pad;
        const text = originalNodeLabels.get(node.id) || '';

        const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('x', adjX);
        fo.setAttribute('y', adjY);
        fo.setAttribute('width', adjW);
        fo.setAttribute('height', adjH);

        const div = document.createElement('div');
        div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        div.style.width = adjW + 'px';
        div.style.height = adjH + 'px';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.textAlign = 'center';
        div.style.whiteSpace = 'nowrap';
        div.style.background = '#ffffff';
        div.style.backgroundColor = '#ffffff';
        div.style.color = STYLE.nodeText;

        div.textContent = text;
        fo.appendChild(div);
        node.appendChild(fo);
      });

      let rebuildIndex = 0;
      Array.from(imported.querySelectorAll('g.edgeLabel')).forEach(el => {
        // Remove Mermaid's default edge-label rect
        el.querySelectorAll('rect').forEach(r => r.remove());

        const text = originalEdgeLabels.get(rebuildIndex++) || '';
        // Skip unlabeled edges
        if (!text || !text.trim()) {
          return;
        }

        // Get the inner transform to compute real coords
        const inner = el.querySelector(':scope > g');
        if (inner) {
          inner.querySelectorAll('foreignObject').forEach(n => n.remove());
        }
        let x = 0, y = 0;
        if (inner) {
          const match = inner.getAttribute('transform')?.match(/translate\(([^,]+),\s*([^)]+)\)/);
          if (match) {
            x = parseFloat(match[1]);
            y = parseFloat(match[2]);
          }
        }

        // Provide a minimal bounding box for text
        const width = Math.max(40, text.length * 10);
        const height = 18;

        const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('x', x - width / 2);
        fo.setAttribute('y', y - height / 2);
        fo.setAttribute('width', width);
        fo.setAttribute('height', height);

        const div = document.createElement('div');
        div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        div.style.width = width + 'px';
        div.style.height = height + 'px';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.textAlign = 'center';
        div.style.whiteSpace = 'nowrap';
        div.style.background = '#ffffff';
        div.style.backgroundColor = '#ffffff';
        div.style.color = STYLE.nodeText;

        div.textContent = text;
        fo.appendChild(div);
        (inner || el).appendChild(fo);
      });

      const styleElTop = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleElTop.textContent = `
        g.label, g.node .label, .edgeLabel {
          overflow: visible !important;
        }
        g.label *, g.node .label * {
          white-space: nowrap !important;
          text-anchor: middle !important;
          dominant-baseline: middle !important;
          pointer-events: none !important;
          overflow: visible !important;
        }
        .edgeLabel * {
          white-space: nowrap !important;
          text-anchor: middle !important;
          dominant-baseline: middle !important;
          pointer-events: auto !important;
          overflow: visible !important;
        }
        g.node .label, g.label {
          z-index: 9999 !important;
        }
        g.node foreignObject div,
        g.node foreignObject span,
        g.node foreignObject p {
          text-align: center !important;
          overflow: visible !important;
        }
      `;
      imported.insertBefore(styleElTop, imported.firstChild || null);

      const out = document.getElementById('output');
      out.innerHTML = '';
      out.appendChild(imported);
  out.style.borderColor = '';

      // Post-render: center all text inside each node
      Array.from(imported.querySelectorAll('g.node')).forEach(node => {
        // Allow HTML overflow for node labels
        node.style.overflow = 'visible';

        const texts = node.querySelectorAll('text, tspan, foreignObject');
        texts.forEach(txt => {
          txt.style.textAlign = 'center';
          txt.style.whiteSpace = 'nowrap';
          txt.style.overflow = 'visible';
          txt.setAttribute('style', (txt.getAttribute('style') || '') + '; text-align:center;');
          if (txt.tagName === 'foreignObject') {
            const div = txt.querySelector('div');
            if (div) div.style.textAlign = 'center';
          }
          // Also force-align HTML p and span inside foreignObject
          if (txt.tagName === 'foreignObject') {
            txt.querySelectorAll('div, span, p').forEach(el => {
              el.style.textAlign = 'center';
            });
          }
          // Force-align any label text elements
          node.querySelectorAll('g.label text, g.label tspan').forEach(n => {
            n.setAttribute('text-anchor', 'middle');
            n.style.textAlign = 'center';
          });
        });

      });

      imported.querySelectorAll('clipPath').forEach(cp => cp.remove());
      imported.querySelectorAll('[clip-path]').forEach(el => el.removeAttribute('clip-path'));

      // --- 2. Light gray shape outlines to match arrows ---
      Array.from(imported.querySelectorAll('g.node rect, g.node ellipse, g.node polygon, g.node path'))
        .forEach(shape => {
          shape.setAttribute('stroke', STYLE.nodeStroke);
          shape.setAttribute('stroke-width', '1.4');
          shape.setAttribute('fill', STYLE.nodeFill);
        });

      // --- 3. Center the SVG itself on Anki cards ---
      imported.removeAttribute('width');
      imported.removeAttribute('height');
      imported.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      imported.style.display = 'block';
      imported.style.marginLeft = 'auto';
      imported.style.marginRight = 'auto';
      imported.style.height = 'auto';
      imported.style.width = 'auto';

      // --- 4. Add overflow-safe text and consistent arrow color ---
      const styleEl2 = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleEl2.textContent = `
        g[class*="node"] {
          overflow: visible !important;
        }
        g[class*="node"] foreignObject,
        g[class*="node"] text,
        g[class*="node"] tspan {
          overflow: visible !important;
          pointer-events: none !important;
        }
        g.edgeLabel foreignObject,
        g.edgeLabel div,
        g.edgeLabel span {
          pointer-events: auto !important;
        }
        path[class*="edge"],
        line[class*="edge"],
        path[class*="message"],
        line[class*="message"] {
          stroke: ${STYLE.edgeStroke} !important;
        }
      `;
      imported.insertBefore(styleEl2, imported.firstChild || null);

      const serializer = new XMLSerializer();
      let svgText = serializer.serializeToString(imported);
      if (stripAnchors) svgText = svgText.replace(/<\/?a\b[^>]*>/gi, '');
      lastSvgText = svgText;
      if (copyButton) copyButton.disabled = false;
    } catch { return; }
  }

  async function copyRawSvgOnly(svgText, buttonEl) {
    if (!svgText) return;
    const xmlDecl = '<?xml version="1.0" encoding="utf-8"?>\n';
    const rawSvg = svgText.startsWith('<?xml') ? svgText : xmlDecl + svgText;
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([rawSvg], { type: 'text/html' }),
        'text/plain': new Blob([rawSvg], { type: 'text/plain' })
      });
      await navigator.clipboard.write([item]);
    } catch {
      await navigator.clipboard.writeText(rawSvg).catch(() => window.prompt('Copy this SVG manually:', rawSvg));
    }
    const prev = buttonEl.textContent;
    buttonEl.textContent = 'Copied';
    setTimeout(() => buttonEl.textContent = prev, 900);
  }

  function createCopyButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Copy SVG to clipboard (paste into Anki)';
    b.disabled = true;
    b.addEventListener('click', () => copyRawSvgOnly(lastSvgText, b));
    return b;
  }

  // Init
  function init() {
    const hidden = document.getElementById('input');
    const codeArea = document.getElementById('codeArea');
    const controls = document.getElementById('controls');
  codeArea.value = hidden ? hidden.value : (codeArea.value || 'flowchart TD\n  Pyruvate -->|Pyruvate decarboxylase| Acetaldehyde\n  Acetaldehyde -->|Alcohol dehydrogenase| Ethanol');

    editor = CodeMirror.fromTextArea(codeArea, {
      lineNumbers: false,
      mode: 'text/plain',
      theme: 'default',
      lineWrapping: true,
      tabSize: 2,
      autofocus: true
    });
    editor.addOverlay(mermaidOverlay());
    controls.innerHTML = '';
    copyButton = createCopyButton();
    controls.appendChild(copyButton);
    editor.on('change', debounce(() => renderDiagram({ tryAutoFix: true }), 350));
    renderDiagram({ tryAutoFix: true });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  window.addEventListener('unhandledrejection', e => e.preventDefault());
})();
