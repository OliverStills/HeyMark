/**
 * HeyMark — app.js
 * All PDF parsing, OCR, and conversion run locally in the browser.
 * No file content is ever transmitted.
 */

import * as pdfjsLib from '/vendor/pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_PAGES      = 2000;
const MAX_FILES      = 50;
const VERSION        = '1.0.0';

// ─── Activity log ─────────────────────────────────────────────────────────────
const activityEntries = [];

function log(msg, level = 'info') {
  const now = new Date();
  const ts  = `${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
  activityEntries.push({ ts, msg, level });
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[HeyMark ${ts}] ${msg}`);
  flushActivityLog();
}

function flushActivityLog() {
  const el = document.getElementById('activity-log');
  if (!el) return;
  // only re-render last entry for performance
  const entry = activityEntries[activityEntries.length - 1];
  if (!entry) return;
  const row = document.createElement('div');
  row.className = 'log-entry';
  const tsEl = document.createElement('span');
  tsEl.className = 'log-ts';
  tsEl.textContent = entry.ts;
  const msgEl = document.createElement('span');
  msgEl.className = `log-msg log-${entry.level}`;
  msgEl.textContent = entry.msg;
  row.appendChild(tsEl);
  row.appendChild(msgEl);
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

const COMPOUND_PREFIXES = new Set([
  'court','cross','attorney','work','well','self','anti','ex','non','pre',
  'post','re','sub','co','inter','intra','over','under','out','up','down',
  'all','half','mid','off','on','near','quasi','ultra','trans','bi','tri',
]);

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  files: [],        // Array<FileRecord>
  activeIdx: 0,     // index into completed files for result panel
  activeTab: 'raw', // 'raw' | 'preview'
  options: {
    ocr:       false,
    lang:      'eng',
    extended:  false,
    normalize: true,
    hyphens:   true,
  },
};

/**
 * FileRecord shape:
 * { id, name, sanitizedName, size, file, status, progress, pages,
 *   markdown, error, worker, passwordNeeded, password }
 */

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dropZone         = $('drop-zone');
const fileInput        = $('file-input');
const selectBtn        = $('select-btn');
const pasteBtn         = $('paste-btn');
const optOcr           = $('opt-ocr');
const optLang          = $('opt-lang');
const optExtended      = $('opt-extended');
const optNormalize     = $('opt-normalize');
const optHyphens       = $('opt-hyphens');
const ocrNote          = $('ocr-note');
const fileQueue        = $('file-queue');
const actionsBar       = $('actions-bar');
const convertAllBtn    = $('convert-all-btn');
const downloadMdBtn    = $('download-md-btn');
const downloadZipSingle= $('download-zip-single-btn');
const downloadZipBtn   = $('download-zip-btn');
const clearAllBtn      = $('clear-all-btn');
const resultPanel      = $('result-panel');
const tabRaw           = $('tab-raw');
const tabPreview       = $('tab-preview');
const fileSelectorRow  = $('file-selector-row');
const copyBtn          = $('copy-btn');
const rawPanel         = $('raw-panel');
const previewPanel     = $('preview-panel');
const verifyBtn        = $('verify-btn');
const verifyPanelEl    = $('verify-panel');
const toastEl          = $('toast');
const activityBtn      = $('activity-btn');
const activityPanel    = $('activity-panel');
const activityClearBtn = $('activity-clear-btn');

activityBtn.addEventListener('click', () => {
  const open = !activityPanel.hidden;
  activityPanel.hidden = open;
  activityBtn.setAttribute('aria-expanded', String(!open));
  activityBtn.textContent = open ? 'Real-Time Activity' : 'Hide Activity';
  if (!open) activityPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

activityClearBtn.addEventListener('click', () => {
  activityEntries.length = 0;
  $('activity-log').innerHTML = '';
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function sanitizeFilename(raw) {
  let s = String(raw)
    .replace(/[\x00-\x1f\x7f]/g, '')  // strip control chars
    .replace(/[^A-Za-z0-9._\- ]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return s || 'document';
}

function nameWithoutExt(name) {
  return name.replace(/\.pdf$/i, '');
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = '';
  const el = document.createElement('div');
  el.className = 'toast-item';
  el.textContent = msg;
  toastEl.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 2500);
}

function yield$() {
  return new Promise(r => setTimeout(r, 0));
}

function uid() {
  return Math.random().toString(36).slice(2);
}

// ─── Options ──────────────────────────────────────────────────────────────────

optOcr.addEventListener('change', () => {
  state.options.ocr = optOcr.checked;
  optOcr.setAttribute('aria-checked', String(optOcr.checked));
  ocrNote.hidden = !optOcr.checked;

  // Re-queue files that failed text extraction so they get a second pass with OCR
  if (optOcr.checked) {
    const noTextFiles = state.files.filter(f => f.status === 'no-text');
    if (noTextFiles.length > 0) {
      noTextFiles.forEach(f => { f.status = 'queued'; f.markdown = null; f.progress = 0; });
      renderQueue();
      updateActionsBar();
      toast(`${noTextFiles.length} file${noTextFiles.length > 1 ? 's' : ''} re-queued for OCR`);
    }
  }
});

optLang.addEventListener('change', () => { state.options.lang = optLang.value; });

optExtended.addEventListener('change', () => {
  state.options.extended = optExtended.checked;
  optExtended.setAttribute('aria-checked', String(optExtended.checked));
});

optNormalize.addEventListener('change', () => {
  state.options.normalize = optNormalize.checked;
  optNormalize.setAttribute('aria-checked', String(optNormalize.checked));
});

optHyphens.addEventListener('change', () => {
  state.options.hyphens = optHyphens.checked;
  optHyphens.setAttribute('aria-checked', String(optHyphens.checked));
});

// ─── File ingestion ───────────────────────────────────────────────────────────

selectBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) addFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

dropZone.addEventListener('click', e => {
  if (e.target === selectBtn || e.target === pasteBtn) return;
  fileInput.click();
});

dropZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', e => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  if (files.length) addFiles(files);
});

pasteBtn.addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      if (item.types.includes('application/pdf')) {
        const blob = await item.getType('application/pdf');
        files.push(new File([blob], 'pasted.pdf', { type: 'application/pdf' }));
      }
    }
    if (files.length) addFiles(files);
    else toast('No PDF found on clipboard');
  } catch {
    toast('Clipboard access denied or no PDF found');
  }
});

document.addEventListener('paste', async e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.type === 'application/pdf') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length) addFiles(files);
});

function addFiles(files) {
  const toAdd = files.slice(0, MAX_FILES - state.files.length);
  for (const f of toAdd) {
    const id = uid();
    const sanitized = sanitizeFilename(nameWithoutExt(f.name));
    const rec = {
      id, name: f.name, sanitizedName: sanitized,
      size: f.size, file: f,
      status: 'queued', progress: 0, pages: null,
      markdown: null, error: null, worker: null,
      passwordNeeded: false, password: null,
    };

    // immediate validation
    if (f.size > MAX_SIZE_BYTES) {
      rec.status = 'size-exceeded';
    }

    state.files.push(rec);
  }
  renderQueue();
  updateActionsBar();
}

// ─── Queue rendering ─────────────────────────────────────────────────────────

const STATUS_META = {
  'queued':        { cls: 'status-queued',     label: 'QUEUED',             aria: 'Queued' },
  'converting':    { cls: 'status-converting', label: 'CONVERTING…',        aria: 'Converting' },
  'ocr':           { cls: 'status-converting', label: 'OCR…',               aria: 'OCR processing' },
  'complete':      { cls: 'status-complete',   label: 'COMPLETE',           aria: 'Conversion complete' },
  'failed':        { cls: 'status-failed',     label: 'FAILED',             aria: 'Conversion failed' },
  'cancelled':     { cls: 'status-cancelled',  label: 'CANCELLED',          aria: 'Cancelled by user' },
  'size-exceeded': { cls: 'status-failed',     label: 'EXCEEDS 50 MB',      aria: 'File exceeds 50 megabyte limit' },
  'page-exceeded': { cls: 'status-failed',     label: 'EXCEEDS 2000 PAGES', aria: 'File exceeds 2000 page limit' },
  'invalid-pdf':   { cls: 'status-failed',     label: 'INVALID PDF',        aria: 'Not a valid PDF file' },
  'encrypted':     { cls: 'status-failed',     label: 'PASSWORD REQUIRED',  aria: 'PDF is password protected' },
  'no-text':       { cls: 'status-failed',     label: 'NO TEXT — TRY OCR',  aria: 'No text extracted — enable OCR mode and re-convert' },
};

function renderQueue() {
  if (state.files.length === 0) {
    fileQueue.hidden = true;
    return;
  }
  fileQueue.hidden = false;
  fileQueue.innerHTML = '';

  for (const rec of state.files) {
    const meta = STATUS_META[rec.status] || STATUS_META['queued'];
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.setAttribute('data-id', rec.id);

    // icon
    const icon = document.createElement('div');
    icon.className = 'queue-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📄';
    item.appendChild(icon);

    // name (textContent, never innerHTML)
    const nameEl = document.createElement('div');
    nameEl.className = 'queue-name';
    nameEl.textContent = rec.name.slice(0, 200);
    item.appendChild(nameEl);

    // status badge
    const badge = document.createElement('div');
    badge.className = `queue-status ${meta.cls}`;
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-label', meta.aria);

    if (rec.status === 'ocr' && rec.ocrPage != null) {
      badge.textContent = `OCR · PAGE ${rec.ocrPage} OF ${rec.pages || '?'}`;
    } else {
      badge.textContent = meta.label;
    }
    item.appendChild(badge);

    // cancel / remove button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'queue-cancel';
    cancelBtn.type = 'button';
    cancelBtn.setAttribute('aria-label', `Remove ${rec.name}`);
    cancelBtn.textContent = '×';
    cancelBtn.addEventListener('click', () => cancelOrRemove(rec.id));
    item.appendChild(cancelBtn);

    // meta line
    const metaEl = document.createElement('div');
    metaEl.className = 'queue-meta';
    let metaStr = formatSize(rec.size);
    if (rec.pages) metaStr += ` · ${rec.pages} pages`;
    metaEl.textContent = metaStr;
    item.appendChild(metaEl);

    // progress bar
    if (rec.status === 'converting' || rec.status === 'ocr') {
      const wrap = document.createElement('div');
      wrap.className = 'queue-progress-wrap';
      const bar = document.createElement('div');
      bar.className = 'queue-progress-bar';
      bar.style.width = `${rec.progress}%`;
      wrap.appendChild(bar);
      item.appendChild(wrap);
    }

    // password input
    if (rec.status === 'encrypted') {
      const pwWrap = document.createElement('div');
      pwWrap.className = 'queue-password';
      const pwInput = document.createElement('input');
      pwInput.type = 'password';
      pwInput.placeholder = 'Enter PDF password…';
      pwInput.setAttribute('aria-label', `Password for ${rec.name}`);
      const pwBtn = document.createElement('button');
      pwBtn.type = 'button';
      pwBtn.className = 'btn btn-primary';
      pwBtn.style.fontSize = '10px';
      pwBtn.style.padding = '4px 10px';
      pwBtn.textContent = 'UNLOCK';
      pwBtn.addEventListener('click', () => {
        rec.password = pwInput.value;
        rec.status = 'queued';
        renderQueue();
        convertFile(rec);
      });
      pwInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') pwBtn.click();
      });
      pwWrap.appendChild(pwInput);
      pwWrap.appendChild(pwBtn);
      item.appendChild(pwWrap);
    }

    // error message
    if (rec.error && rec.status === 'failed') {
      const errEl = document.createElement('div');
      errEl.className = 'queue-meta';
      errEl.style.color = 'var(--rust)';
      errEl.style.gridColumn = '1 / -1';
      errEl.textContent = rec.error;
      item.appendChild(errEl);
    }

    fileQueue.appendChild(item);
  }
}

function updateActionsBar() {
  const hasAny = state.files.length > 0;
  actionsBar.hidden = !hasAny;

  // only 'complete' files (with actual text) count for downloads
  const completed = state.files.filter(f => f.status === 'complete');
  const queued    = state.files.filter(f => f.status === 'queued');

  convertAllBtn.hidden     = queued.length === 0;
  downloadMdBtn.hidden     = completed.length !== 1;
  downloadZipSingle.hidden = completed.length !== 1;
  downloadZipBtn.hidden    = completed.length < 2;

  if (completed.length > 0) {
    resultPanel.hidden = false;
    renderResultPanel();
  } else {
    // hide result panel if no successfully extracted files
    const noTextOnly = state.files.every(f => f.status === 'no-text' || f.status === 'queued' || f.status === 'failed' || f.status === 'cancelled');
    if (noTextOnly) resultPanel.hidden = true;
  }
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ─── Cancel / Remove ─────────────────────────────────────────────────────────

function cancelOrRemove(id) {
  const rec = state.files.find(f => f.id === id);
  if (!rec) return;
  if (rec.status === 'converting' || rec.status === 'ocr') {
    rec.status = 'cancelled';
    if (rec.worker) { try { rec.worker.terminate(); } catch {} rec.worker = null; }
  } else {
    state.files = state.files.filter(f => f.id !== id);
    // reset activeIdx if needed
    const completed = state.files.filter(f => f.status === 'complete');
    if (state.activeIdx >= completed.length) state.activeIdx = Math.max(0, completed.length - 1);
  }
  renderQueue();
  updateActionsBar();
}

// ─── Convert ─────────────────────────────────────────────────────────────────

convertAllBtn.addEventListener('click', () => {
  const queued = state.files.filter(f => f.status === 'queued');
  for (const rec of queued) convertFile(rec);
});

async function convertFile(rec) {
  if (rec.status === 'size-exceeded' || rec.status === 'page-exceeded') return;

  rec.status = 'converting';
  rec.progress = 0;
  rec.error = null;
  renderQueue();

  log(`── Starting: ${rec.name} (${formatSize(rec.size)})`, 'step');

  try {
    log('Reading file bytes…', 'info');
    const buf = await readFileAsArrayBuffer(rec.file);
    log(`File read: ${buf.byteLength.toLocaleString()} bytes`, 'ok');

    // validate magic bytes %PDF-
    const magic = new Uint8Array(buf, 0, 5);
    const isPDF = magic[0]===0x25 && magic[1]===0x50 && magic[2]===0x44 && magic[3]===0x46 && magic[4]===0x2D;
    if (!isPDF) {
      log('Magic bytes invalid — not a PDF', 'error');
      rec.status = 'invalid-pdf';
      renderQueue();
      updateActionsBar();
      return;
    }
    log('Magic bytes OK (%PDF-)', 'ok');

    // load document
    const loadParams = { data: buf };
    if (rec.password) loadParams.password = rec.password;

    log('Loading PDF with pdf.js…', 'info');
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument(loadParams).promise;
      log(`pdf.js loaded — ${pdf.numPages} page(s)`, 'ok');
    } catch (err) {
      if (err?.name === 'PasswordException' || err?.code === 1 || err?.code === 2) {
        log('PDF is password-protected', 'warn');
        rec.status = 'encrypted';
        renderQueue();
        updateActionsBar();
        return;
      }
      log(`pdf.js load error: ${err?.message}`, 'error');
      throw err;
    }

    const numPages = pdf.numPages;

    if (numPages > MAX_PAGES) {
      log(`Page count ${numPages} exceeds limit of ${MAX_PAGES}`, 'error');
      rec.status = 'page-exceeded';
      renderQueue();
      updateActionsBar();
      return;
    }

    rec.pages = numPages;
    log(`Mode: ${state.options.ocr ? 'OCR (Tesseract.js)' : 'Standard text extraction'}`, 'step');

    let markdown;
    if (state.options.ocr) {
      markdown = await convertWithOCR(rec, pdf);
    } else {
      markdown = await convertStandard(rec, pdf);
    }

    rec.markdown = markdown;
    rec.status = markdown.includes('No text could be extracted') ? 'no-text' : 'complete';
    rec.progress = 100;
    log(`Done — status: ${rec.status}, output: ${markdown.length} chars`, 'ok');

  } catch (err) {
    if (rec.status === 'cancelled') { log('Cancelled by user', 'warn'); return; }
    rec.status = 'failed';
    rec.error = err?.message || 'Unknown error';
    log(`FAILED: ${err?.message || err}`, 'error');
    console.error('Conversion error:', err);
  }

  renderQueue();
  updateActionsBar();
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Standard conversion ─────────────────────────────────────────────────────

async function convertStandard(rec, pdf) {
  const pageMarkdowns = [];
  let allEmpty = true;

  for (let i = 1; i <= pdf.numPages; i++) {
    if (rec.status === 'cancelled') return '';
    rec.progress = Math.round((i / pdf.numPages) * 90);
    log(`Page ${i}/${pdf.numPages}: extracting text…`, 'info');
    renderQueueItem(rec);
    await yield$();

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    if (textContent.items.length > 0) allEmpty = false;

    const items = textContent.items
      .filter(item => item.str && item.str.trim())
      .map(item => ({
        str:      state.options.normalize ? item.str.normalize('NFC') : item.str,
        x:        item.transform[4],
        y:        item.transform[5],
        height:   item.height || Math.abs(item.transform[3]),
        width:    item.width,
        fontName: item.fontName || '',
        bold:     /bold/i.test(item.fontName || ''),
      }));

    const ordered = reconstructReadingOrder(items, viewport);
    const md = buildPageMarkdown(ordered, viewport, state.options);
    log(`Page ${i}: ${items.length} text items → ${md.split('\n').filter(Boolean).length} lines`, items.length > 0 ? 'ok' : 'warn');
    pageMarkdowns.push(md);
    page.cleanup();
  }

  if (allEmpty) {
    log('All pages empty — no embedded text found', 'warn');
    if (state.options.ocr) return assembleOutput(rec.sanitizedName, ['[OCR mode required — no embedded text found]']);
    return `# ${rec.sanitizedName}\n\nNo text could be extracted from this document. Enable OCR Mode if this is a scanned document.`;
  }

  return assembleOutput(rec.sanitizedName, pageMarkdowns);
}

// ─── Reading order reconstruction ────────────────────────────────────────────

function reconstructReadingOrder(items, viewport) {
  if (items.length === 0) return [];

  const pageH = viewport.height;
  const headerThresh = pageH * 0.93; // top 7%
  const footerThresh = pageH * 0.07; // bottom 7%

  // filter header/footer (simple pass — full dedup across pages would need state)
  const body = items.filter(it => it.y < headerThresh && it.y > footerThresh);

  if (body.length === 0) return items; // fallback: return all

  // detect columns by clustering X positions
  const xs = body.map(it => it.x).sort((a, b) => a - b);
  const pageW = viewport.width;
  const midX  = pageW / 2;

  // simple two-column detection: significant gap around center
  const leftItems  = body.filter(it => it.x < midX - 20);
  const rightItems = body.filter(it => it.x >= midX + 20);
  const midItems   = body.filter(it => it.x >= midX - 20 && it.x < midX + 20);

  const hasTwoColumns =
    leftItems.length > 5 && rightItems.length > 5 &&
    midItems.length < (leftItems.length + rightItems.length) * 0.15;

  const sortTopBottom = arr =>
    [...arr].sort((a, b) => b.y - a.y || a.x - b.x);

  if (hasTwoColumns) {
    return [...sortTopBottom(leftItems), ...sortTopBottom(rightItems)];
  }

  return sortTopBottom(body);
}

// ─── Markdown construction ────────────────────────────────────────────────────

function buildPageMarkdown(items, viewport, opts) {
  if (items.length === 0) return '';

  // group into lines by Y (within ~2px tolerance)
  const lines = groupIntoLines(items);

  // compute median font height
  const heights = items.map(it => it.height).filter(h => h > 0).sort((a, b) => a - b);
  const median  = heights[Math.floor(heights.length / 2)] || 12;

  const mdLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const text    = line.map(it => it.str).join(' ').trim();
    if (!text) continue;

    const avgH    = line.reduce((s, it) => s + it.height, 0) / line.length;
    const isBold  = line.some(it => it.bold);

    let prefix = '';
    if      (avgH >= median * 2.0) prefix = '# ';
    else if (avgH >= median * 1.5) prefix = '## ';
    else if (avgH >= median * 1.2) prefix = '### ';
    else if (isBold && avgH >= median * 0.9) prefix = '### ';

    // list detection
    const listMatch = text.match(/^([•\-\*·○–])\s+(.*)$/);
    const olMatch   = text.match(/^(\d+\.|[a-z]\.|[ivxlc]+\.|[IVX]+\.|\([a-z0-9]+\))\s+(.*)$/i);

    let mdLine;
    if (listMatch && !prefix) {
      mdLine = `- ${listMatch[2]}`;
    } else if (olMatch && !prefix) {
      mdLine = `1. ${olMatch[2]}`;
    } else {
      mdLine = prefix + text;
    }

    // hyphen rejoining: check if this line ends with '-' and next starts lowercase
    if (i < lines.length - 1 && !prefix) {
      const nextLine = lines[i + 1];
      const nextText = nextLine.map(it => it.str).join(' ').trim();
      if (mdLine.endsWith('-') && nextText && /^[a-z]/.test(nextText)) {
        const stem   = mdLine.slice(0, -1);
        const joined = stem + nextText.split(/\s/)[0];
        const stemWord = stem.split(/\s/).pop().toLowerCase();
        if (opts.hyphens && COMPOUND_PREFIXES.has(stemWord)) {
          // keep hyphen — merge lines with hyphen preserved
          const restNext = nextText.replace(/^\S+\s*/, '');
          mdLines.push(mdLine + (restNext ? '\n' + restNext : ''));
          i++; // skip next line
          continue;
        } else {
          // join without hyphen
          const restNext = nextText.replace(/^\S+\s*/, '');
          mdLines.push(stem + nextText.split(/\s/)[0] + (restNext ? ' ' + restNext : ''));
          i++;
          continue;
        }
      }
    }

    // vertical gap detection for paragraph breaks
    if (i > 0) {
      const prevLine = lines[i - 1];
      const prevY = prevLine[0].y;
      const currY = line[0].y;
      const gap   = Math.abs(prevY - currY);
      const lineH = avgH || median;

      if (gap > lineH * 3) {
        mdLines.push('');
        mdLines.push('---');
        mdLines.push('');
      } else if (gap > lineH * 1.5) {
        mdLines.push('');
      }
    }

    mdLines.push(mdLine);
  }

  return mdLines.join('\n');
}

function groupIntoLines(items) {
  const lines = [];
  let current = [];

  for (const item of items) {
    if (current.length === 0) {
      current.push(item);
      continue;
    }
    const lastY = current[current.length - 1].y;
    if (Math.abs(item.y - lastY) <= 2) {
      current.push(item);
    } else {
      lines.push(current);
      current = [item];
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function assembleOutput(name, pageMarkdowns) {
  const parts = [`# ${name}`];
  for (const md of pageMarkdowns) {
    if (md.trim()) {
      parts.push('');
      parts.push(md);
      parts.push('');
      parts.push('---');
    }
  }
  return parts.join('\n');
}

// ─── OCR conversion ───────────────────────────────────────────────────────────

async function convertWithOCR(rec, pdf) {
  log('Importing Tesseract.js ESM module…', 'info');
  const tesseractLib = (await import('/vendor/tesseract/tesseract.esm.min.js')).default;
  log('Tesseract.js module loaded', 'ok');
  const createWorker = tesseractLib.createWorker;

  log(`Creating Tesseract worker — lang: ${state.options.lang}, workerPath: /vendor/tesseract/worker.min.js`, 'info');
  let worker;
  try {
    worker = await createWorker(state.options.lang, 1, {
      workerPath:  '/vendor/tesseract/worker.min.js',
      langPath:    '/assets/tessdata/',
      corePath:    '/vendor/tesseract-core/',
      logger: m => {
        if (m.status && m.status !== 'recognizing text') {
          log(`Tesseract: ${m.status} ${m.progress != null ? `(${(m.progress*100).toFixed(0)}%)` : ''}`, 'info');
        }
        if (m.status === 'recognizing text' && m.progress != null) {
          rec.progress = Math.round(m.progress * 100);
          renderQueueItem(rec);
        }
      },
    });
    log('Tesseract worker ready', 'ok');
  } catch (initErr) {
    log(`Tesseract worker init FAILED: ${initErr?.message || initErr}`, 'error');
    throw new Error(`OCR worker failed to initialize: ${initErr?.message || initErr}`);
  }

  rec.worker = worker;
  const pageMarkdowns = [];

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (rec.status === 'cancelled') break;

      rec.status = 'ocr';
      rec.ocrPage = i;
      log(`── Page ${i}/${pdf.numPages}`, 'step');
      renderQueueItem(rec);
      await yield$();

      log(`Page ${i}: reading text content…`, 'info');
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const hasText = textContent.items.some(it => it.str.trim().length > 0);
      log(`Page ${i}: ${textContent.items.length} text items, hasText=${hasText}`, hasText ? 'ok' : 'warn');

      if (hasText) {
        log(`Page ${i}: using embedded text (skipping OCR)`, 'info');
        const viewport = page.getViewport({ scale: 1 });
        const items = textContent.items
          .filter(item => item.str && item.str.trim())
          .map(item => ({
            str:      state.options.normalize ? item.str.normalize('NFC') : item.str,
            x:        item.transform[4],
            y:        item.transform[5],
            height:   item.height || Math.abs(item.transform[3]),
            width:    item.width,
            fontName: item.fontName || '',
            bold:     /bold/i.test(item.fontName || ''),
          }));
        const ordered = reconstructReadingOrder(items, viewport);
        pageMarkdowns.push(buildPageMarkdown(ordered, viewport, state.options));
        page.cleanup();
        continue;
      }

      // render page to canvas at 2x scale (3x can cause OOM on large images)
      const viewport = page.getViewport({ scale: 2 });
      log(`Page ${i}: rendering canvas ${Math.round(viewport.width)}×${Math.round(viewport.height)}px…`, 'info');
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      log(`Page ${i}: canvas rendered`, 'ok');

      log(`Page ${i}: converting canvas to PNG blob…`, 'info');
      const blob = await canvasToBlob(canvas);
      log(`Page ${i}: blob ready (${(blob.size/1024).toFixed(0)} KB), sending to Tesseract…`, 'ok');

      try {
        const result = await worker.recognize(blob);
        const text   = result.data.text || '';
        const conf   = result.data.confidence?.toFixed(0) ?? '?';
        log(`Page ${i}: OCR complete — confidence ${conf}%, ${text.trim().length} chars`, 'ok');
        const normalized = state.options.normalize ? text.normalize('NFC') : text;
        pageMarkdowns.push(normalized.trim());
      } catch (ocrErr) {
        log(`Page ${i}: OCR recognition failed — ${ocrErr?.message}`, 'error');
        pageMarkdowns.push(`[OCR failed — page ${i}]`);
      }
    }
  } finally {
    try { await worker.terminate(); log('Tesseract worker terminated', 'info'); } catch {}
    rec.worker = null;
  }

  if (rec.status === 'cancelled') return '';
  return assembleOutput(rec.sanitizedName, pageMarkdowns);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob failed'));
    }, 'image/png');
  });
}

// ─── Partial queue item re-render (avoid full re-render during conversion) ────

function renderQueueItem(rec) {
  const el = fileQueue.querySelector(`[data-id="${rec.id}"]`);
  if (!el) { renderQueue(); return; }

  const meta = STATUS_META[rec.status] || STATUS_META['queued'];
  const badge = el.querySelector('.queue-status');
  if (badge) {
    badge.className = `queue-status ${meta.cls}`;
    badge.setAttribute('aria-label', meta.aria);
    if (rec.status === 'ocr' && rec.ocrPage) {
      badge.textContent = `OCR · PAGE ${rec.ocrPage} OF ${rec.pages || '?'}`;
    } else {
      badge.textContent = meta.label;
    }
  }

  const bar = el.querySelector('.queue-progress-bar');
  if (bar) bar.style.width = `${rec.progress}%`;
}

// ─── Actions bar buttons ──────────────────────────────────────────────────────

downloadMdBtn.addEventListener('click', () => {
  const completed = state.files.filter(f => f.status === 'complete');
  if (completed.length !== 1) return;
  downloadSingle(completed[0]);
});

downloadZipSingle.addEventListener('click', () => {
  const completed = state.files.filter(f => f.status === 'complete');
  if (completed.length !== 1) return;
  downloadAsZip([completed[0]]);
});

downloadZipBtn.addEventListener('click', () => {
  const completed = state.files.filter(f => f.status === 'complete');
  if (completed.length < 2) return;
  downloadAsZip(completed);
});

clearAllBtn.addEventListener('click', () => {
  const hasResults = state.files.some(f => f.status === 'complete');
  if (hasResults && !confirm('Clear all files and results?')) return;
  // terminate any running workers
  for (const rec of state.files) {
    if (rec.worker) { try { rec.worker.terminate(); } catch {} }
  }
  state.files = [];
  state.activeIdx = 0;
  fileQueue.hidden = true;
  actionsBar.hidden = true;
  resultPanel.hidden = true;
  fileQueue.innerHTML = '';
  rawPanel.textContent = '';
  previewPanel.innerHTML = '';
});

// ─── Downloads ────────────────────────────────────────────────────────────────

function downloadSingle(rec) {
  const blob = new Blob([rec.markdown], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${rec.sanitizedName}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Download started');
}

async function downloadAsZip(recs) {
  const zip     = new window.JSZip();
  const counts  = {};

  for (const rec of recs) {
    let name = rec.sanitizedName || 'document';
    counts[name] = (counts[name] || 0) + 1;
    const entry  = counts[name] > 1 ? `${name} (${counts[name]}).md` : `${name}.md`;
    zip.file(entry, rec.markdown || '');
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'heymark-export.zip';
  a.click();
  URL.revokeObjectURL(url);
  toast('Download started');
}

// ─── Result panel ─────────────────────────────────────────────────────────────

tabRaw.addEventListener('click', () => switchTab('raw'));
tabPreview.addEventListener('click', () => switchTab('preview'));

tabRaw.addEventListener('keydown', e => handleTabKey(e, tabPreview));
tabPreview.addEventListener('keydown', e => handleTabKey(e, tabRaw));

function handleTabKey(e, other) {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    other.focus();
    other.click();
  }
}

function switchTab(tab) {
  state.activeTab = tab;
  tabRaw.setAttribute('aria-selected', String(tab === 'raw'));
  tabPreview.setAttribute('aria-selected', String(tab === 'preview'));
  tabRaw.tabIndex    = tab === 'raw'     ? 0 : -1;
  tabPreview.tabIndex = tab === 'preview' ? 0 : -1;
  rawPanel.hidden     = tab !== 'raw';
  previewPanel.hidden = tab !== 'preview';
}

function renderResultPanel() {
  const completed = state.files.filter(f => f.status === 'complete');
  if (completed.length === 0) return;

  if (state.activeIdx >= completed.length) state.activeIdx = 0;

  // file selector
  if (completed.length > 1) {
    fileSelectorRow.hidden = false;
    fileSelectorRow.innerHTML = '';
    completed.forEach((rec, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'file-selector-btn' + (i === state.activeIdx ? ' active' : '');
      btn.textContent = rec.sanitizedName.slice(0, 30);
      btn.setAttribute('aria-label', `View result for ${rec.sanitizedName}`);
      btn.setAttribute('aria-pressed', String(i === state.activeIdx));
      btn.addEventListener('click', () => {
        state.activeIdx = i;
        renderResultPanel();
      });
      fileSelectorRow.appendChild(btn);
    });
  } else {
    fileSelectorRow.hidden = true;
  }

  const rec = completed[state.activeIdx];
  const md  = rec?.markdown || '';

  // raw panel
  rawPanel.textContent = md;

  // preview panel
  if (!previewPanel.hidden) renderPreview(md);
}

function renderPreview(md) {
  try {
    const html = window.marked.parse(md, { breaks: false, gfm: true });
    const safe = window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','ul','ol','li',
                     'strong','em','code','pre','blockquote','table','thead',
                     'tbody','tr','th','td','hr','a'],
      ALLOWED_ATTR: ['href','title'],
      FORBID_TAGS:  ['script','style','iframe','object','embed','form','input'],
    });
    previewPanel.innerHTML = safe;
  } catch {
    previewPanel.textContent = md;
  }
}

// also render preview when switching to it
tabPreview.addEventListener('click', () => {
  const completed = state.files.filter(f => f.status === 'complete');
  const rec = completed[state.activeIdx];
  if (rec) renderPreview(rec.markdown || '');
});

// ─── Copy to clipboard ────────────────────────────────────────────────────────

copyBtn.addEventListener('click', async () => {
  const completed = state.files.filter(f => f.status === 'complete');
  const rec = completed[state.activeIdx];
  if (!rec) return;
  const text = rec.markdown || '';

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  copyBtn.textContent = 'COPIED ✓';
  copyBtn.classList.add('copied');
  toast('Copied to clipboard');
  setTimeout(() => {
    copyBtn.textContent = 'COPY';
    copyBtn.classList.remove('copied');
  }, 2000);
});

// ─── beforeunload warning ─────────────────────────────────────────────────────

window.addEventListener('beforeunload', e => {
  const hasResults = state.files.some(f => f.status === 'complete');
  if (hasResults) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ─── Integrity verification ───────────────────────────────────────────────────

verifyBtn.addEventListener('click', async () => {
  verifyPanelEl.hidden = !verifyPanelEl.hidden;
  if (verifyPanelEl.hidden) return;

  $('verify-computed').textContent = 'Computing…';
  $('verify-expected').textContent = 'Fetching…';
  $('verify-status').textContent   = '…';
  $('verify-release').textContent  = '…';

  // compute hash of loaded HTML + all scripts/styles
  const encoder = new TextEncoder();
  let combined  = document.documentElement.outerHTML;

  for (const script of document.querySelectorAll('script[src]')) {
    try {
      const r = await fetch(script.src);
      combined += await r.text();
    } catch {}
  }
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    try {
      const r = await fetch(link.href);
      combined += await r.text();
    } catch {}
  }

  const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(combined));
  const computed = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  $('verify-computed').textContent = computed;

  try {
    const resp     = await fetch('/release-hash.json');
    const data     = await resp.json();
    const expected = data.sha256 || '(not found)';
    const releaseUrl = data.releaseUrl || '';

    $('verify-expected').textContent = expected;
    $('verify-release').innerHTML = releaseUrl
      ? `<a href="${encodeURI(releaseUrl)}" target="_blank" rel="noopener noreferrer">${releaseUrl}</a>`
      : '—';

    const match = computed === expected;
    const statusEl = $('verify-status');
    statusEl.textContent = match ? '✓ MATCH' : '✗ MISMATCH';
    statusEl.className = 'verify-value ' + (match ? 'verify-match' : 'verify-mismatch');
  } catch {
    $('verify-expected').textContent = '(could not fetch release-hash.json)';
    $('verify-status').textContent   = 'Unknown';
    $('verify-release').textContent  = '—';
  }
});

// ─── Mobile OCR warning ───────────────────────────────────────────────────────

function isMobile() {
  return window.innerWidth <= 600 || /Mobi|Android/i.test(navigator.userAgent);
}

// lazy: show warning when OCR starts on mobile
const _origConvert = convertWithOCR;

// ─── Keyboard: drop zone ──────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    // handled by paste event above
  }
});
