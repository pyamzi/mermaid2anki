//main.js
// Mermaid renderer + CodeMirror editor
// - Static "base" theme (no dark/light toggling)
// - No parse errors shown (UI or console spam)
// - One button: Copy raw SVG (html + plain text). No images written.

(() => {
  // 1) Initialize Mermaid safely (and silence its error channel)
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'antiscript',
      theme: 'base', // fixed geometry and neutral baseline
      themeVariables: {
        background: 'transparent',
        primaryColor: '#ffffff',
        primaryBorderColor: '#000000',
        lineColor: '#888888',
        textColor: '#000000',
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
    let t = text;
    const firstLine = t.split('\n').find(l => l.trim().length);
    if (firstLine && !/^(graph|flowchart|sequenceDiagram|gantt|classDiagram|stateDiagram|pie|erDiagram|journey)/i.test(firstLine.trim()))
      t = 'graph TD\n' + t;
    t = t.replace(/-\s*>\s*/g, '-->').replace(/-{2,}>/g, '-->');
    const sqDiff = (t.match(/\[/g) || []).length - (t.match(/\]/g) || []).length;
    if (sqDiff > 0) t += ']'.repeat(sqDiff);
    const parDiff = (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
    if (parDiff > 0) t += ')'.repeat(parDiff);
    t = t.replace(/<\/?[^>]+(>|$)/g, '').replace(/\n{3,}/g, '\n\n');
    return t;
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
      const out = document.getElementById('output');
      out.innerHTML = '';
      out.appendChild(imported);
      out.style.borderColor = 'green';

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
    codeArea.value = hidden ? hidden.value : (codeArea.value || '');

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

