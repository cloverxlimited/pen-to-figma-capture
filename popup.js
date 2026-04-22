var captureBtn = document.getElementById('captureBtn');
var downloadBtn = document.getElementById('downloadBtn');
var copyBtn = document.getElementById('copyBtn');
var statusEl = document.getElementById('status');
var progressBar = document.getElementById('progressBar');
var progressFill = document.getElementById('progressFill');
var outputJSON = null;
var pageTitle = '';

captureBtn.addEventListener('click', function() {
  var opts = {
    maxDepth: parseInt(document.getElementById('maxDepth').value) || 15,
    includeText: document.getElementById('includeText').checked,
    includeImages: document.getElementById('includeImages').checked,
    skipHidden: document.getElementById('skipHidden').checked,
    fullPage: document.getElementById('fullPage').checked,
  };

  captureBtn.disabled = true;
  captureBtn.textContent = 'Capturing...';
  statusEl.textContent = 'Injecting into page...';
  statusEl.className = 'status';
  progressBar.classList.add('active');
  progressFill.style.width = '20%';

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var tab = tabs[0];
    pageTitle = tab.title || 'page';

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureDOM,
      args: [opts],
    }, function(results) {
      progressFill.style.width = '100%';

      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
        statusEl.className = 'status err';
        captureBtn.disabled = false;
        captureBtn.textContent = 'Capture This Page';
        return;
      }

      var result = results[0].result;
      if (!result || result.error) {
        statusEl.textContent = 'Error: ' + (result ? result.error : 'No result');
        statusEl.className = 'status err';
        captureBtn.disabled = false;
        captureBtn.textContent = 'Capture This Page';
        return;
      }

      outputJSON = result;
      var nodeCount = countNodes(result.children || []);
      var varCount = Object.keys(result.variables || {}).length;
      statusEl.textContent = 'Captured! ' + nodeCount + ' nodes, ' + varCount + ' variables';
      statusEl.className = 'status ok';
      captureBtn.textContent = 'Captured!';
      captureBtn.className = 'capture-btn done';
      downloadBtn.disabled = false;
      copyBtn.disabled = false;
    });
  });
});

downloadBtn.addEventListener('click', function() {
  if (!outputJSON) return;
  var blob = new Blob([JSON.stringify(outputJSON, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var safeName = pageTitle.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40);
  a.href = url;
  a.download = safeName + '-figma.json';
  a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = 'Downloaded!';
});

copyBtn.addEventListener('click', function() {
  if (!outputJSON) return;
  navigator.clipboard.writeText(JSON.stringify(outputJSON, null, 2)).then(function() {
    statusEl.textContent = 'Copied to clipboard!';
    statusEl.className = 'status ok';
  });
});

function countNodes(nodes) {
  var c = 0;
  for (var i = 0; i < nodes.length; i++) {
    c++;
    if (nodes[i].children) c += countNodes(nodes[i].children);
  }
  return c;
}

// ─── This function runs INSIDE the webpage ───
function captureDOM(opts) {
  try {
    var _nid = 0;
    function nid() { return '_h' + (++_nid).toString(36); }

    function rgbToHex(rgb) {
      if (!rgb || rgb === 'transparent') return null;
      if (rgb.startsWith('#')) return rgb;
      var m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return rgb;
      var hex = '#' + pad(parseInt(m[1])) + pad(parseInt(m[2])) + pad(parseInt(m[3]));
      if (m[4] !== undefined && parseFloat(m[4]) < 1) hex += pad(Math.round(parseFloat(m[4]) * 255));
      return hex;
    }
    function pad(n) { var h = n.toString(16); return h.length === 1 ? '0' + h : h; }

    function cleanFont(ff) {
      if (!ff) return 'Inter';
      var first = ff.split(',')[0].trim().replace(/["']/g, '');
      var system = ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'];
      if (system.indexOf(first) !== -1) return 'Inter';
      if (['Georgia', 'Times New Roman', 'Times', 'serif'].indexOf(first) !== -1) return 'Georgia';
      if (['Courier New', 'Courier', 'monospace'].indexOf(first) !== -1) return 'Space Mono';
      return first;
    }

    function mapWeight(w) {
      var n = parseInt(w);
      if (isNaN(n)) return 'regular';
      if (n <= 300) return 'light';
      if (n <= 400) return 'regular';
      if (n <= 500) return 'medium';
      if (n <= 600) return 'semibold';
      return 'bold';
    }

    function parseShadow(shadow) {
      var m = shadow.match(/([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s*(?:([-\d.]+)px)?\s*(rgba?\([^)]+\)|#[0-9a-f]+)/i);
      if (!m) return null;
      return {
        type: 'shadow', offset: { x: parseFloat(m[1]), y: parseFloat(m[2]) },
        blur: parseFloat(m[3]), spread: m[4] ? parseFloat(m[4]) : 0,
        color: rgbToHex(m[5]) || '#00000040'
      };
    }

    function parseGrad(bg) {
      var m = bg.match(/linear-gradient\(([\d.]+)deg,\s*(.+)\)/);
      if (!m) return null;
      var stops = m[2].match(/(rgba?\([^)]+\)|#[0-9a-f]+)\s*([\d.]+%)?/gi);
      if (!stops || stops.length < 2) return null;
      var colors = [];
      for (var i = 0; i < stops.length; i++) {
        var p = stops[i].trim().match(/(rgba?\([^)]+\)|#[0-9a-f]+)\s*([\d.]+%)?/i);
        if (p) colors.push({ color: rgbToHex(p[1]), position: p[2] ? parseFloat(p[2]) / 100 : i / (stops.length - 1) });
      }
      return { type: 'gradient', gradientType: 'linear', rotation: parseInt(m[1]), colors: colors };
    }

    function walk(el, depth, parentRect) {
      if (depth > opts.maxDepth) return null;
      if (!el || el.nodeType !== 1) return null;
      var tag = el.tagName.toLowerCase();
      if (['script', 'style', 'meta', 'link', 'head', 'noscript', 'iframe'].indexOf(tag) !== -1) return null;

      var cs;
      try { cs = window.getComputedStyle(el); } catch (e) { return null; }
      if (opts.skipHidden && (cs.display === 'none' || cs.visibility === 'hidden')) return null;

      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) return null;

      // Skip elements fully off-screen
      var pageW = document.documentElement.scrollWidth;
      var pageH = opts.fullPage ? document.documentElement.scrollHeight : window.innerHeight;
      if (rect.right < 0 || rect.left > pageW) return null;

      var node = { type: 'frame', id: nid(), name: tag };
      node.width = Math.round(rect.width);
      node.height = Math.round(rect.height);

      // Position — relative to parent for abs/fixed, otherwise let layout handle it
      var isAbsFixed = cs.position === 'absolute' || cs.position === 'fixed';
      if (isAbsFixed && parentRect) {
        node.x = Math.round(rect.left - parentRect.left);
        node.y = Math.round(rect.top - parentRect.top);
        node.layoutPosition = 'absolute';
      }

      // Background
      var bg = cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') node.fill = rgbToHex(bg);

      var bgImg = cs.backgroundImage;
      if (bgImg && bgImg !== 'none') {
        var grad = parseGrad(bgImg);
        if (grad) node.fill = grad;
      }

      // Border
      var bw = parseFloat(cs.borderTopWidth || cs.borderWidth || '0');
      var bc = cs.borderTopColor || cs.borderColor;
      if (bw > 0 && bc && bc !== 'rgba(0, 0, 0, 0)') {
        node.stroke = { fill: rgbToHex(bc), thickness: Math.round(bw) };
      }

      // Radius
      var br = parseFloat(cs.borderRadius);
      if (br > 0) node.cornerRadius = Math.round(br);

      // Opacity
      var op = parseFloat(cs.opacity);
      if (op < 1 && op > 0) node.opacity = Math.round(op * 100) / 100;

      // Shadow
      if (cs.boxShadow && cs.boxShadow !== 'none') {
        var sh = parseShadow(cs.boxShadow);
        if (sh) node.effect = sh;
      }

      // Overflow
      if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowY === 'hidden') {
        node.clip = true;
      }

      // Layout — Flexbox
      if (cs.display === 'flex' || cs.display === 'inline-flex') {
        node.layout = (cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse') ? 'vertical' : 'horizontal';
        var gap = parseFloat(cs.gap || cs.rowGap || cs.columnGap || '0');
        if (gap > 0) node.gap = Math.round(gap);

        var pt = parseFloat(cs.paddingTop), pr = parseFloat(cs.paddingRight);
        var pb = parseFloat(cs.paddingBottom), pl = parseFloat(cs.paddingLeft);
        if (pt > 0 || pr > 0 || pb > 0 || pl > 0) {
          if (pt === pr && pr === pb && pb === pl) node.padding = Math.round(pt);
          else node.padding = [Math.round(pt), Math.round(pr), Math.round(pb), Math.round(pl)];
        }

        var jc = cs.justifyContent;
        if (jc === 'center') node.justifyContent = 'center';
        else if (jc === 'flex-end' || jc === 'end') node.justifyContent = 'end';
        else if (jc === 'space-between') node.justifyContent = 'space_between';
        else if (jc === 'space-around') node.justifyContent = 'space_around';

        var ai = cs.alignItems;
        if (ai === 'center') node.alignItems = 'center';
        else if (ai === 'flex-end' || ai === 'end') node.alignItems = 'end';
      }

      // Layout — Grid (approximate as vertical)
      if (cs.display === 'grid' || cs.display === 'inline-grid') {
        node.layout = 'vertical';
        var gg = parseFloat(cs.gap || cs.rowGap || '0');
        if (gg > 0) node.gap = Math.round(gg);
      }

      // Padding for non-flex containers
      if (!node.layout) {
        var ppt = parseFloat(cs.paddingTop), ppr = parseFloat(cs.paddingRight);
        var ppb = parseFloat(cs.paddingBottom), ppl = parseFloat(cs.paddingLeft);
        if (ppt > 2 || ppr > 2 || ppb > 2 || ppl > 2) {
          // Has significant padding — treat as layout container
          node.layout = 'vertical';
          if (ppt === ppr && ppr === ppb && ppb === ppl) node.padding = Math.round(ppt);
          else node.padding = [Math.round(ppt), Math.round(ppr), Math.round(ppb), Math.round(ppl)];
        }
      }

      // Image
      if (tag === 'img') {
        if (!opts.includeImages) return null;
        node.type = 'rectangle';
        node.name = el.alt || 'image';
        if (!node.fill) node.fill = '#E5E5E5';
        return node;
      }

      // SVG — capture as a single rectangle placeholder
      if (tag === 'svg') {
        node.type = 'rectangle';
        node.name = 'svg';
        if (!node.fill) node.fill = '#E5E5E5';
        return node;
      }

      // Children
      var children = [];
      for (var i = 0; i < el.childNodes.length; i++) {
        var child = el.childNodes[i];

        // Text node
        if (child.nodeType === 3 && opts.includeText) {
          var text = child.textContent.trim();
          if (text) {
            var tn = {
              type: 'text', id: nid(), name: 'text',
              content: text,
              fontFamily: cleanFont(cs.fontFamily),
              fontSize: Math.round(parseFloat(cs.fontSize)),
              fontWeight: mapWeight(cs.fontWeight),
              fill: rgbToHex(cs.color),
            };
            var ls = parseFloat(cs.letterSpacing);
            if (ls && !isNaN(ls) && ls !== 0) tn.letterSpacing = Math.round(ls * 100) / 100;
            var lh = parseFloat(cs.lineHeight), fz = parseFloat(cs.fontSize);
            if (lh && !isNaN(lh) && fz > 0) tn.lineHeight = Math.round((lh / fz) * 100) / 100;
            if (cs.textAlign === 'center') tn.textAlign = 'center';
            else if (cs.textAlign === 'right') tn.textAlign = 'right';

            // Wrapping
            if (rect.width > 0 && text.length > 30) {
              tn.textGrowth = 'fixed-width';
              tn.width = Math.round(rect.width);
            }

            children.push(tn);
          }
        }

        // Element node
        if (child.nodeType === 1) {
          var cn = walk(child, depth + 1, rect);
          if (cn) children.push(cn);
        }
      }

      if (children.length > 0) {
        node.children = children;
        if (!node.layout && children.length > 1) node.layout = 'vertical';
      }

      // Collapse text-only wrappers
      var hasVisual = node.fill || node.stroke || node.effect || node.cornerRadius || (op < 1 && op > 0) || node.clip;
      if (children.length === 1 && children[0].type === 'text' && !hasVisual) {
        var merged = children[0];
        if (node.width && !merged.width) { merged.textGrowth = 'fixed-width'; merged.width = node.width; }
        return merged;
      }

      // Remove empty invisible frames
      if (!hasVisual && children.length === 0) return null;

      // Unwrap single-child invisible wrappers
      if (!hasVisual && children.length === 1 && !node.layout && !node.padding) {
        var only = children[0];
        if (!only.width && node.width) only.width = node.width;
        if (!only.height && node.height) only.height = node.height;
        return only;
      }

      return node;
    }

    // Extract CSS custom properties
    var variables = {};
    try {
      var sheets = document.styleSheets;
      for (var s = 0; s < sheets.length; s++) {
        try {
          var rules = sheets[s].cssRules;
          for (var r = 0; r < rules.length; r++) {
            if (rules[r].selectorText === ':root' || rules[r].selectorText === ':root, :host') {
              var style = rules[r].style;
              for (var p = 0; p < style.length; p++) {
                var prop = style[p];
                if (prop.startsWith('--')) {
                  var val = style.getPropertyValue(prop).trim();
                  var name = prop.slice(2).replace(/-/g, '_');
                  var resolved = rgbToHex(val);
                  if (resolved && resolved.startsWith('#')) {
                    variables[name] = { type: 'color', value: resolved };
                  }
                }
              }
            }
          }
        } catch (e) { /* cross-origin */ }
      }
    } catch (e) {}

    // Walk from body
    var root = walk(document.body, 0, null);

    // Set root frame to full page dimensions
    if (root) {
      root.name = document.title || 'Page';
      root.width = Math.round(document.documentElement.scrollWidth);
      root.height = opts.fullPage
        ? Math.round(document.documentElement.scrollHeight)
        : Math.round(window.innerHeight);
    }

    return {
      variables: variables,
      children: root ? [root] : [],
    };

  } catch (err) {
    return { error: err.message || String(err) };
  }
}
