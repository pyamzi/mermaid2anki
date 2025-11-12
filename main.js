// main.js
// Compact Mermaid → Anki helper
// - Small, readable diagrams (12px text, max 480px wide, centered)
// - No Mermaid errors shown anywhere; console spam filtered
// - Single "Copy SVG" button; "Dark Mode" <-> "Light Mode" toggle
// - Editor: no line numbers; Mermaid highlighting; follows dark mode

(() => {
  // Silence Mermaid UI callbacks
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'antiscript',
      theme: 'default',
      themeVariables: {
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial'
      },
      flowchart: { useMaxWidth: true, padding: 6, htmlLabels: true }
    });
    if (typeof mermaid.parseError === 'function') mermaid.parseError = () => {};
  } catch (_) {}

  // Filter Mermaid console noise without muting unrelated errors
  (function patchConsole() {
    const drop = (s) =>
      /Syntax error in text|textmermaid|Parse error|mermaid/.test(s || '');
    const wrap = (orig) =>
      function (...args) {
        const s = args && args.join ? args.join(' ') : '';
        if (drop(s)) return;
        return orig.apply(this, args);
      };
    console.error = wrap(console.error.bind(console));
    console.warn = wrap(console.warn.bind(console));
  })();

  // State
  let editor = null;
  let lastSvgText = null;

  // Helpers
  const isDark = () => document.body.classList.contains('dark-preview');
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
    let t = text;
    const first = t.split('\n').find(l => l.trim().length);
    if (first && !/^(graph|flowchart|sequenceDiagram|gantt|classDiagram|stateDiagram|pie|erDiagram|journey)/i.test(first.trim())) {
      t = 'graph TD\n' + t;
    }
    t = t.replace(/-\s*>\s*/g, '-->').replace(/-{2,}>/g, '-->');
    const sq = (t.match(/\[/g) || []).length - (t.match(/\]/g) || []).length;
    if (sq > 0) t += ']'.repeat(sq);
    const pr = (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
    if (pr > 0) t += ')'.repeat(pr);
    t = t.replace(/<\/?[^>]+(>|$)/g, '').replace(/\n{3,}/g, '\n\n');
    return t;
  }

  // Make SVG small and centered. Ensure viewBox, remove width/height, cap CSS width.
  function normalizeSvgSizing(svgEl) {
    // Extract numeric width/height if present to set a viewBox
    const wAttr = svgEl.getAttribute('width');
    const hAttr = svgEl.getAttribute('height');
    const num = (v) => v && parseFloat(String(v).replace(/[^\d.]/g, ''));
    let w = num(wAttr);
    let h = num(hAttr);

    if (!svgEl.getAttribute('viewBox')) {
      if (w && h) {
        svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
      } else {
        // Fallback viewBox if dimensions missing; keeps aspect sane
        svgEl.setAttribute('viewBox', '0 0 800 600');
      }
    }

    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const centerStyle = 'display:block;margin:0 auto;max-width:480px;width:100%;height:auto;clear:both;';
    const existing = svgEl.getAttribute('style') || '';
    svgEl.setAttribute('style', existing ? existing + ';' + centerStyle : centerStyle);

    // Force readable text size
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = `
      svg { font-size: 12px; }
      text, tspan { font-size: 12px !important; }
      .edgeLabel .label, .label foreignObject, foreignObject div { font-size: 12px !important; line-height: 1.25; }
      g[class*="node"] rect, g[class*="node"] circle, g[class*="node"] ellipse, g[class*="node"] polygon, g[class*="node"] polyline, g[class*="node"] path {
        fill: #ffffff !important; stroke: #000000 !important;
      }
      g[class*="node"] text, g[class*="node"] tspan, .label { fill: #000000 !important; }
    `;
    svgEl.insertBefore(styleEl, svgEl.firstChild || null);
  }

  // Render silently; keep last good SVG if render fails
  async function renderDiagram({ tryAutoFix = true, stripAnchors = false } = {}) {
    const raw = editor.getValue();
    const sanitized = sanitizeMermaidText(raw);
    if (!sanitized) { if (!lastSvgText) document.getElementById('output').innerHTML = ''; return; }

    const fixed = tryAutoFix ? attemptAutoFixes(sanitized) : sanitized;

    let res;
    try {
      const id = 'mmd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      res = await mermaid.render(id, fixed);
    } catch { return; }

    const svg = res && res.svg ? res.svg : null;
    if (!svg) return;
    if (svg.includes('aria-roledescription="error"') || svg.includes('class="error-icon"') || svg.includes('class="error-text"')) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) return;

    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.nodeName.toLowerCase() !== 'svg') return;
    if (!svgEl.getAttribute('xmlns')) svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    normalizeSvgSizing(svgEl);

    let svgText;
    try { svgText = new XMLSerializer().serializeToString(svgEl); } catch { svgText = svg; }
    if (stripAnchors) svgText = svgText.replace(/<\/?a\b[^>]*>/gi, '');

    const imported = document.importNode(svgEl, true);
    imported.classList.add('m2a');
    const out = document.getElementById('output');
    out.innerHTML = '';
    out.appendChild(imported);
    out.style.borderColor = 'green';

    lastSvgText = svgText;
    copyBtn.disabled = false;
  }

  // Copy raw SVG (text/html + text/plain). No images. Button label never changes.
  async function copyRawSvgOnly(svgText) {
    if (!svgText) return;
    const xmlDecl = '<?xml version="1.0" encoding="utf-8"?>\n';
    const rawSvg = svgText.startsWith('<?xml') ? svgText : xmlDecl + svgText;

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([rawSvg], { type: 'text/html' }),
          'text/plain': new Blob([rawSvg], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
        return;
      } catch {}
    }
    try { await navigator.clipboard.writeText(rawSvg); }
    catch { window.prompt('Copy the SVG below', rawSvg); }
  }

  // Lightweight Mermaid syntax highlighting for CodeMirror
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

  // Init UI
  let copyBtn;
  function init() {
    const seed = document.getElementById('input');
    const codeArea = document.getElementById('codeArea');
    const controls = document.getElementById('controls');

    codeArea.value = seed ? seed.value : (codeArea.value || '');

    editor = CodeMirror.fromTextArea(codeArea, {
      lineNumbers: false,
      mode: 'text/plain',
      theme: isDark() ? 'monokai' : 'default',
      lineWrapping: true,
      tabSize: 2,
      autofocus: true
    });
    editor.addOverlay(mermaidOverlay());

    controls.innerHTML = '';

    copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy SVG';
    copyBtn.disabled = true;
    copyBtn.addEventListener('click', () => copyRawSvgOnly(lastSvgText));
    controls.appendChild(copyBtn);

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.textContent = isDark() ? 'Light Mode' : 'Dark Mode';
    modeBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-preview');
      editor.setOption('theme', isDark() ? 'monokai' : 'default');
      modeBtn.textContent = isDark() ? 'Light Mode' : 'Dark Mode';
      setTimeout(() => editor.refresh(), 30);
    });
    controls.appendChild(modeBtn);

    editor.on('change', debounce(() => renderDiagram({ tryAutoFix: true, stripAnchors: false }), 250));
    renderDiagram({ tryAutoFix: true, stripAnchors: false });
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Suppress unhandled promise UI
  window.addEventListener('unhandledrejection', e => { e.preventDefault(); });
})();
