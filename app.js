/**
 * HeyMark — app.js
 * All PDF parsing, OCR, and conversion run locally in the browser.
 * No file content is ever transmitted.
 */

import * as pdfjsLib from '/vendor/pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';

// ─── Constants ────────────────────────────────────────────────────────────────
const SECURITY_LIMITS = {
  maxFileBytes:             50 * 1024 * 1024,
  maxPdfPages:              2000,
  maxPdfPagesSoftWarn:      500,
  maxRenderedPixelsPerPage: 40_000_000,
  maxTotalRenderedPixels:   500_000_000,
  maxOcrPages:              100,
  maxConversionMs:          60_000,
  maxOcrMsPerPage:          45_000,
  maxOutputChars:           25_000_000,
  docx: {
    maxEntries:            5000,
    maxUncompressedBytes:  250 * 1024 * 1024,
    maxSingleEntryBytes:    50 * 1024 * 1024,
    maxCompressionRatio:   100,
    maxImages:            1000,
  },
};
const MAX_FILES = 50;
const VERSION   = '1.1.0';

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

const PREF_KEYS = {
  ocr:       'heymark:ocr',
  lang:      'heymark:lang',
  extended:  'heymark:extended',
  normalize: 'heymark:normalize',
  hyphens:   'heymark:hyphens',
};
const ADVISORY_KEY = 'heymark:advisoryDismissed';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  files: [],
  activeIdx: 0,
  options: {
    ocr:       false,
    lang:      'eng',
    extended:  true,
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
const fileSelectorRow  = $('file-selector-row');
const copyBtn          = $('copy-btn');
const ocrConfEl        = $('ocr-confidence');
const rawPanel         = $('raw-panel');
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
  return name.replace(/\.(pdf|docx)$/i, '');
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
  savePrefs();
});

optLang.addEventListener('change', () => { state.options.lang = optLang.value; savePrefs(); });

optExtended.addEventListener('change', () => {
  state.options.extended = optExtended.checked;
  optExtended.setAttribute('aria-checked', String(optExtended.checked));
  savePrefs();
});

optNormalize.addEventListener('change', () => {
  state.options.normalize = optNormalize.checked;
  optNormalize.setAttribute('aria-checked', String(optNormalize.checked));
  savePrefs();
});

optHyphens.addEventListener('change', () => {
  state.options.hyphens = optHyphens.checked;
  optHyphens.setAttribute('aria-checked', String(optHyphens.checked));
  savePrefs();
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
    if (f.size > SECURITY_LIMITS.maxFileBytes) {
      rec.status = 'size-exceeded';
    }

    state.files.push(rec);
  }
  renderQueue();
  updateActionsBar();
}

// ─── Queue rendering ─────────────────────────────────────────────────────────

const STATUS_META = {
  'queued':           { cls: 'status-queued',     label: 'QUEUED',             aria: 'Queued' },
  'converting':       { cls: 'status-converting', label: 'CONVERTING…',        aria: 'Converting' },
  'ocr':              { cls: 'status-converting', label: 'OCR…',               aria: 'OCR processing' },
  'docx':             { cls: 'status-converting', label: 'READING DOCX…',      aria: 'Reading DOCX document' },
  'complete':         { cls: 'status-complete',   label: 'COMPLETE',           aria: 'Conversion complete' },
  'failed':           { cls: 'status-failed',     label: 'FAILED',             aria: 'Conversion failed' },
  'cancelled':        { cls: 'status-cancelled',  label: 'CANCELLED',          aria: 'Cancelled by user' },
  'size-exceeded':    { cls: 'status-failed',     label: 'EXCEEDS 50 MB',      aria: 'File exceeds 50 megabyte limit' },
  'page-exceeded':    { cls: 'status-failed',     label: 'EXCEEDS 2000 PAGES', aria: 'File exceeds 2000 page limit' },
  'invalid-pdf':      { cls: 'status-failed',     label: 'INVALID PDF',        aria: 'Not a valid PDF file' },
  'invalid-format':   { cls: 'status-failed',     label: 'UNSUPPORTED FORMAT', aria: 'File format not supported' },
  'invalid-docx':     { cls: 'status-failed',     label: 'INVALID DOCX',       aria: 'Not a valid DOCX file' },
  'encrypted':        { cls: 'status-failed',     label: 'PASSWORD REQUIRED',  aria: 'PDF is password protected' },
  'no-text':          { cls: 'status-failed',     label: 'NO TEXT — TRY OCR',  aria: 'No text extracted — enable OCR mode and re-convert' },
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
    if (rec.softPageWarn) metaStr += ' · ⚠ large document';
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

// ─── Security helpers ─────────────────────────────────────────────────────────

function classifyPdfError(err) {
  const msg = err?.message || '';
  const name = err?.name || '';
  if (/password|encrypt/i.test(msg) || name === 'PasswordException') return 'PDF is password-protected.';
  if (/invalid|corrupt|malformed/i.test(msg) || /UnknownErrorException|InvalidPDFException/i.test(name)) return 'The file appears to be corrupted or is not a valid PDF.';
  if (/out of memory|memory/i.test(msg)) return 'The PDF is too large to process.';
  return 'An error occurred while processing this PDF.';
}

// ─── DOCX pipeline ────────────────────────────────────────────────────────────

async function validateDocxFormat(buf) {
  const JSZip = window.JSZip; // loaded as UMD global via <script> in index.html
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw Object.assign(new Error('Not a valid ZIP archive'), { docxCode: 'invalid-docx' });
  }

  const entries = Object.keys(zip.files);
  if (entries.length > SECURITY_LIMITS.docx.maxEntries) {
    throw Object.assign(new Error(`Archive has too many entries (${entries.length})`), { docxCode: 'invalid-docx' });
  }

  const ctFile = zip.file('[Content_Types].xml');
  if (!ctFile) {
    throw Object.assign(new Error('Missing [Content_Types].xml — not a valid Office document'), { docxCode: 'invalid-docx' });
  }

  const ct = await ctFile.async('text');

  if (ct.includes('spreadsheetml')) {
    throw Object.assign(new Error('XLSX spreadsheets are not supported. Convert to PDF first.'), { docxCode: 'invalid-docx' });
  }
  if (ct.includes('presentationml')) {
    throw Object.assign(new Error('PPTX presentations are not supported. Convert to PDF first.'), { docxCode: 'invalid-docx' });
  }
  if (ct.includes('macro') || ct.includes('macroenabled') || zip.file('word/vbaProject.bin')) {
    throw Object.assign(new Error('Macro-enabled documents (DOCM) are not supported.'), { docxCode: 'invalid-docx' });
  }
  if (!ct.includes('wordprocessingml')) {
    throw Object.assign(new Error('ZIP file is not a Word document.'), { docxCode: 'invalid-docx' });
  }
  if (!zip.file('word/document.xml')) {
    throw Object.assign(new Error('Missing word/document.xml — not a valid DOCX.'), { docxCode: 'invalid-docx' });
  }
}

function sanitizeDocxHtml(html) {
  // Parse the raw HTML string safely; never assign to innerHTML directly
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const ALLOWED = new Set(['H1','H2','H3','H4','H5','H6','P','BR','HR',
    'STRONG','B','EM','I','U','DEL','S','A',
    'UL','OL','LI','TABLE','THEAD','TBODY','TR','TH','TD',
    'BLOCKQUOTE','PRE','CODE']);

  const SAFE_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

  function clean(node) {
    const toRemove = [];
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED.has(child.tagName)) {
          // replace with its text content
          const text = document.createTextNode(child.textContent);
          node.insertBefore(text, child);
          toRemove.push(child);
          continue;
        }
        // strip all attributes except href on <a>
        const attrsToRemove = [];
        for (const attr of child.attributes) {
          if (child.tagName === 'A' && attr.name === 'href') {
            try {
              const url = new URL(attr.value);
              if (!SAFE_PROTOCOLS.has(url.protocol)) attrsToRemove.push(attr.name);
            } catch { attrsToRemove.push(attr.name); }
          } else {
            attrsToRemove.push(attr.name);
          }
        }
        for (const a of attrsToRemove) child.removeAttribute(a);
        clean(child);
      }
    }
    for (const el of toRemove) el.remove();
  }

  clean(doc.body);
  return doc.body;
}

function domToMarkdown(node, depth = 0) {
  const parts = [];

  function walk(n, ctx) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent;
      if (t) parts.push(ctx.inline ? t : t.trim());
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;

    const tag = n.tagName;

    if (/^H([1-6])$/.test(tag)) {
      const level = parseInt(tag[1]);
      const prefix = '#'.repeat(level);
      const text = n.textContent.trim();
      if (text) { parts.push(`\n${prefix} ${text}\n`); }
      return;
    }
    if (tag === 'P') {
      const text = n.textContent.trim();
      if (text) { parts.push(`\n${text}\n`); }
      return;
    }
    if (tag === 'BR') { parts.push('\n'); return; }
    if (tag === 'HR') { parts.push('\n---\n'); return; }
    if (tag === 'STRONG' || tag === 'B') {
      const t = n.textContent.trim();
      if (t) parts.push(`**${t}**`);
      return;
    }
    if (tag === 'EM' || tag === 'I') {
      const t = n.textContent.trim();
      if (t) parts.push(`*${t}*`);
      return;
    }
    if (tag === 'DEL' || tag === 'S') {
      const t = n.textContent.trim();
      if (t) parts.push(`~~${t}~~`);
      return;
    }
    if (tag === 'CODE') {
      const t = n.textContent;
      if (t) parts.push(`\`${t}\``);
      return;
    }
    if (tag === 'PRE') {
      const t = n.textContent;
      if (t) parts.push(`\n\`\`\`\n${t}\n\`\`\`\n`);
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      const t = n.textContent.trim();
      if (t) parts.push('\n' + t.split('\n').map(l => `> ${l}`).join('\n') + '\n');
      return;
    }
    if (tag === 'A') {
      const href = n.getAttribute('href') || '';
      const t = n.textContent.trim();
      if (t && href) parts.push(`[${t}](${href})`);
      else if (t) parts.push(t);
      return;
    }
    if (tag === 'UL') {
      parts.push('\n');
      for (const li of n.querySelectorAll(':scope > li')) {
        const t = li.textContent.trim();
        if (t) parts.push(`- ${t}\n`);
      }
      parts.push('\n');
      return;
    }
    if (tag === 'OL') {
      parts.push('\n');
      let i = 1;
      for (const li of n.querySelectorAll(':scope > li')) {
        const t = li.textContent.trim();
        if (t) parts.push(`${i++}. ${t}\n`);
      }
      parts.push('\n');
      return;
    }
    if (tag === 'TABLE') {
      parts.push('\n');
      const rows = Array.from(n.querySelectorAll('tr'));
      if (!rows.length) return;
      const cells = (tr) => Array.from(tr.querySelectorAll('th,td')).map(c => c.textContent.trim().replace(/\|/g, '\\|'));
      const header = cells(rows[0]);
      parts.push('| ' + header.join(' | ') + ' |\n');
      parts.push('| ' + header.map(() => '---').join(' | ') + ' |\n');
      for (const row of rows.slice(1)) {
        const c = cells(row);
        if (c.some(v => v)) parts.push('| ' + c.join(' | ') + ' |\n');
      }
      parts.push('\n');
      return;
    }
    // recurse into container elements
    for (const child of n.childNodes) walk(child, ctx);
  }

  walk(node, { inline: false });
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

async function convertDocx(rec, buf) {
  rec.status = 'docx';
  renderQueue();

  // 1 — validate archive format
  log('Validating DOCX archive structure…', 'info');
  try {
    await validateDocxFormat(buf);
  } catch (err) {
    log(`DOCX validation failed: ${err.message}`, 'error');
    rec.status = err.docxCode || 'invalid-docx';
    rec.error  = err.message;
    return null;
  }
  log('DOCX format valid', 'ok');

  // 2 — run Mammoth in a Web Worker
  log('Starting Mammoth DOCX worker…', 'info');
  return new Promise((resolve) => {
    const worker = new Worker('/docx-worker.js');
    rec.worker = worker;

    const id = Date.now();
    const timeout = setTimeout(() => {
      log('DOCX worker timed out', 'error');
      worker.terminate();
      rec.worker  = null;
      rec.status  = 'failed';
      rec.error   = 'DOCX conversion timed out — document may be too complex.';
      resolve(null);
    }, SECURITY_LIMITS.maxConversionMs);

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.id !== id) return;
      clearTimeout(timeout);
      worker.terminate();
      rec.worker = null;

      if (msg.type === 'error') {
        log(`Mammoth error: ${msg.message}`, 'error');
        rec.status = 'failed';
        rec.error  = 'DOCX could not be converted.';
        resolve(null);
        return;
      }

      // 3 — collect legal-document warnings from Mammoth messages
      const warnings = (msg.messages || [])
        .filter(m => m.type === 'warning')
        .map(m => m.message);

      const imageWarnings = warnings.filter(w => /image/i.test(w));
      const changeWarnings = warnings.filter(w => /tracked.change|revision/i.test(w));
      const otherWarnings = warnings.filter(w => !/image/i.test(w) && !/tracked.change|revision/i.test(w));

      log(`Mammoth done — ${warnings.length} warning(s)`, warnings.length ? 'warn' : 'ok');

      // 4 — sanitize HTML (no innerHTML, no eval — pure DOM manipulation)
      log('Sanitizing DOCX HTML output…', 'info');
      const cleanBody = sanitizeDocxHtml(msg.html || '');

      // 5 — convert sanitized DOM to Markdown
      log('Converting to Markdown…', 'info');
      let markdown = domToMarkdown(cleanBody);

      // 6 — prepend structured warnings
      const warnLines = [];
      if (changeWarnings.length) {
        warnLines.push('> ⚠️ **Tracked changes detected.** This document contains revision marks that may not be fully reflected in the output. Review the original before use.');
      }
      if (imageWarnings.length) {
        warnLines.push(`> 🖼️ **${imageWarnings.length} image(s) not included.** Embedded images cannot be converted to Markdown.`);
      }
      for (const w of otherWarnings) {
        warnLines.push(`> ℹ️ ${w}`);
      }
      if (warnLines.length) {
        markdown = warnLines.join('\n') + '\n\n' + markdown;
      }

      // 7 — prepend clipboard advisory for DOCX (same as scanned PDF)
      const advisory = '> **Privacy note:** This Markdown was extracted from a DOCX file locally in your browser. ' +
        "HeyMark's privacy guarantee does not extend to tools you paste this text into.";
      markdown = advisory + '\n\n' + markdown;

      resolve(markdown);
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      rec.worker = null;
      log(`DOCX worker error: ${err.message}`, 'error');
      rec.status = 'failed';
      rec.error  = 'DOCX worker failed unexpectedly.';
      resolve(null);
    };

    worker.postMessage({ type: 'convert', id, buf }, [buf]);
  });
}

function sanitizeMarkdownLinks(md) {
  return md.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (match, text, url) => {
    const trimmed = url.trim();
    if (/^javascript:/i.test(trimmed) || /^data:text\/html/i.test(trimmed)) return `[${text}]()`;
    return match;
  });
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

  let loadingTask = null;
  const timeoutHandle = setTimeout(() => {
    if (rec.status === 'converting' || rec.status === 'ocr') {
      log(`Conversion timeout after ${SECURITY_LIMITS.maxConversionMs}ms — aborting`, 'error');
      if (rec.worker) { try { rec.worker.terminate(); } catch {} rec.worker = null; }
      rec.status = 'failed';
      rec.error = 'Conversion timed out — document may be too complex or too large.';
      renderQueue();
      updateActionsBar();
    }
  }, SECURITY_LIMITS.maxConversionMs);

  try {
    log('Reading file bytes…', 'info');
    const buf = await readFileAsArrayBuffer(rec.file);
    log(`File read: ${buf.byteLength.toLocaleString()} bytes`, 'ok');

    // format router — detect PDF or ZIP/DOCX by magic bytes
    const magic = new Uint8Array(buf, 0, 8);
    const isPDF  = magic[0]===0x25 && magic[1]===0x50 && magic[2]===0x44 && magic[3]===0x46 && magic[4]===0x2D;
    const isZIP  = magic[0]===0x50 && magic[1]===0x4B && magic[2]===0x03 && magic[3]===0x04;

    if (isZIP) {
      log('Magic bytes: ZIP/DOCX — routing to DOCX pipeline', 'info');
      const docxMarkdown = await convertDocx(rec, buf);
      if (docxMarkdown !== null) {
        const md = sanitizeMarkdownLinks(docxMarkdown);
        rec.markdown = md.length > SECURITY_LIMITS.maxOutputChars
          ? md.slice(0, SECURITY_LIMITS.maxOutputChars) + '\n\n[Output truncated — document too large]'
          : md;
        rec.status   = rec.markdown.trim() ? 'complete' : 'no-text';
        rec.progress = 100;
        log(`Done — status: ${rec.status}, output: ${rec.markdown.length} chars`, 'ok');
      }
      renderQueue();
      updateActionsBar();
      return;
    }

    if (!isPDF) {
      log('Magic bytes invalid — unsupported format', 'error');
      rec.status = 'invalid-format';
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
      loadingTask = pdfjsLib.getDocument(loadParams);
      pdf = await loadingTask.promise;
      log(`pdf.js loaded — ${pdf.numPages} page(s)`, 'ok');
    } catch (err) {
      if (err?.name === 'PasswordException' || err?.code === 1 || err?.code === 2) {
        log('PDF is password-protected', 'warn');
        rec.status = 'encrypted';
        renderQueue();
        updateActionsBar();
        return;
      }
      log(`pdf.js load error: ${classifyPdfError(err)}`, 'error');
      throw err;
    }

    const numPages = pdf.numPages;

    if (numPages > SECURITY_LIMITS.maxPdfPages) {
      log(`Page count ${numPages} exceeds limit of ${SECURITY_LIMITS.maxPdfPages}`, 'error');
      rec.status = 'page-exceeded';
      renderQueue();
      updateActionsBar();
      return;
    }

    if (numPages > SECURITY_LIMITS.maxPdfPagesSoftWarn) {
      log(`Large document: ${numPages} pages — processing may be slow`, 'warn');
      rec.softPageWarn = true;
      renderQueue();
    }

    rec.pages = numPages;
    log(`Mode: ${state.options.ocr ? 'OCR (Tesseract.js)' : 'Standard text extraction'}`, 'step');

    let markdown;
    if (state.options.ocr) {
      markdown = await convertWithOCR(rec, pdf);
    } else {
      markdown = await convertStandard(rec, pdf);
    }

    markdown = sanitizeMarkdownLinks(markdown);

    if (markdown.length > SECURITY_LIMITS.maxOutputChars) {
      markdown = markdown.slice(0, SECURITY_LIMITS.maxOutputChars) + '\n\n[Output truncated — document too large]';
      log('Output truncated — exceeded maxOutputChars limit', 'warn');
    }

    rec.markdown = markdown;
    rec.status = markdown.includes('No text could be extracted') ? 'no-text' : 'complete';
    rec.progress = 100;
    log(`Done — status: ${rec.status}, output: ${markdown.length} chars`, 'ok');

  } catch (err) {
    if (rec.status === 'cancelled') { log('Cancelled by user', 'warn'); return; }
    if (rec.status === 'failed') { return; }
    rec.status = 'failed';
    rec.error = classifyPdfError(err);
    log(`FAILED: ${rec.error}`, 'error');
    console.error('Conversion error:', err);
  } finally {
    clearTimeout(timeoutHandle);
    if (loadingTask) { try { loadingTask.destroy(); } catch {} }
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
    if (rec.status === 'cancelled' || rec.status === 'failed') return '';
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

// ─── Reading order, headings, tables (v2 — legal-tuned) ─────────────────────

function modalHeight(items) {
  const counts = new Map();
  for (const it of items) {
    if (it.height < 6 || it.height > 18) continue;
    const k = Math.round(it.height * 2) / 2;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = 10.5, bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function groupIntoLines(items, modalH) {
  const tol = Math.max(2.5, modalH * 0.5);
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let cur = [];
  for (const it of sorted) {
    if (!cur.length) { cur = [it]; continue; }
    if (Math.abs(it.y - cur[cur.length - 1].y) <= tol) cur.push(it);
    else { lines.push(cur); cur = [it]; }
  }
  if (cur.length) lines.push(cur);
  return lines.map(ln => {
    ln.sort((a, b) => a.x - b.x);
    const h = Math.max(...ln.map(i => i.height));
    const meta = { items: ln, y: ln[0].y, x0: ln[0].x, h, text: ln.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim() };
    // ordered-list marker CANDIDATE: lone leading number/letter token + wide gap to body text.
    // Only applied later for lines that are NOT part of a detected table (tables can have a numeric first column).
    if (ln.length >= 2 && /^(\d{1,3}|[ivxlc]{1,4}|[a-z])$/i.test(ln[0].str.trim()) && (ln[1].x - ln[0].x) > 18) {
      meta.olCand = true;
      meta.olMarker = ln[0].str.trim().replace(/\.$/, '');
      meta.olText = ln.slice(1).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
    }
    return meta;
  });
}

function isAllCaps(t) {
  const letters = t.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && /[A-Z]/.test(letters);
}

// ─── heading classifier (pattern + size) ─────────────────────────────────────
function headingPrefix(line, modalH) {
  const t = line.text, h = line.h, len = t.length;
  if (!t) return null;
  if (h >= modalH * 1.35) return '# ';                                            // doc title
  if (/^[IVXLC]{1,5}\.\s+\S/.test(t) && h >= modalH * 1.05) return '## ';         // roman section
  if (/^\d{1,2}\.\s+[A-Z]/.test(t) && h >= modalH * 1.12 && len < 60) return '## '; // numbered contract section
  if (/^Exhibit\s+[A-Z0-9]/i.test(t) && h >= modalH * 1.05) return '## ';          // Exhibit heading
  if (isAllCaps(t) && len <= 45 && h >= modalH * 1.03) return '## ';               // INTRODUCTION, ARGUMENT…
  if (/^[A-Z]\.\s+\S/.test(t) && h >= modalH * 1.0 && len < 75) return '### ';     // lettered subhead A., B.
  if (h >= modalH * 1.22) return '## ';
  if (h >= modalH * 1.1)  return '### ';
  return null;
}

// ─── table detection ─────────────────────────────────────────────────────────
// A table block = run of >=2 consecutive lines that each place items at >=2
// shared column anchors. Returns {start,end,cols} or null per region.
function clusterAnchors(xsByLine, tol = 14) {
  const all = [];
  for (const xs of xsByLine) for (const x of xs) all.push(x);
  all.sort((a, b) => a - b);
  const clusters = [];
  for (const x of all) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.mean <= tol) { last.xs.push(x); last.mean = last.xs.reduce((s, v) => s + v, 0) / last.xs.length; }
    else clusters.push({ xs: [x], mean: x });
  }
  return clusters.map(c => ({ x: c.mean, count: c.xs.length }));
}

function detectTableBlocks(lines, modalH) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    // a heading or ordered-list line can never start/extend a table
    if (headingPrefix(lines[i], modalH)) { i++; continue; }
    let j = i;
    const xsByLine = [];
    while (j < lines.length) {
      if (j > i && headingPrefix(lines[j], modalH)) break; // stop at heading
      const xs = lines[j].items.map(it => it.x);
      xsByLine.push(xs);
      const anchors = clusterAnchors(xsByLine).filter(a => a.count >= 2);
      if (j > i) {
        const hits = anchors.filter(a => xs.some(x => Math.abs(x - a.x) <= 16)).length;
        if (anchors.length < 2 || hits < 1) { xsByLine.pop(); break; }
      }
      j++;
    }
    const runLen = j - i;
    if (runLen >= 2) {
      const anchors = clusterAnchors(xsByLine).filter(a => a.count >= 2 && a.count >= Math.ceil(runLen * 0.5));
      // need >=2 columns, separated by >40px, and most rows fill >=2 cols
      const cols = anchors.map(a => a.x).sort((x, y) => x - y);
      const wellSeparated = cols.length >= 2 && cols.every((c, k) => k === 0 || c - cols[k - 1] > 40);
      const rows = lines.slice(i, j);
      const multiColRows = rows.filter(r => {
        const xs = r.items.map(it => it.x);
        return cols.filter(c => xs.some(x => Math.abs(x - c) <= 18)).length >= 2;
      }).length;
      if (wellSeparated && multiColRows >= 2) {
        blocks.push({ start: i, end: j, cols });
        i = j; continue;
      }
    }
    i++;
  }
  return blocks;
}

function buildTable(rows, cols) {
  // assign each item to nearest column whose anchor <= item.x (last col catches rest)
  const colOf = x => {
    let idx = 0;
    for (let c = 0; c < cols.length; c++) if (x >= cols[c] - 18) idx = c;
    return idx;
  };
  const grid = [];
  for (const r of rows) {
    const cells = Array.from({ length: cols.length }, () => []);
    for (const it of r.items) cells[colOf(it.x)].push(it.str);
    const row = cells.map(c => c.join(' ').replace(/\s+/g, ' ').trim());
    // continuation row (only later cols filled, first col empty) → merge into previous
    if (grid.length && row[0] === '' && row.some(c => c !== '')) {
      const prev = grid[grid.length - 1];
      row.forEach((c, k) => { if (c) prev[k] = (prev[k] + ' ' + c).trim(); });
    } else grid.push(row);
  }
  if (grid.length < 2) return null;
  const esc = s => s.replace(/\|/g, '\\|');
  const header = grid[0];
  const out = [];
  out.push('| ' + header.map(esc).join(' | ') + ' |');
  out.push('| ' + header.map(() => '---').join(' | ') + ' |');
  for (let r = 1; r < grid.length; r++) out.push('| ' + grid[r].map(esc).join(' | ') + ' |');
  return out.join('\n');
}

// ─── reading order (caption-aware, two-column safe) ──────────────────────────
function reconstructReadingOrder(items, viewport) {
  if (!items.length) return [];
  const pageH = viewport.height;
  const body = items.filter(it => it.y < pageH * 0.95 && it.y > pageH * 0.045); // strip running header/footer/page#
  if (!body.length) return items;
  const pageW = viewport.width, midX = pageW / 2;
  const left = body.filter(it => it.x < midX - 20);
  const right = body.filter(it => it.x >= midX + 20);
  const mid = body.filter(it => it.x >= midX - 20 && it.x < midX + 20);
  const twoCol = left.length > 8 && right.length > 8 && mid.length < (left.length + right.length) * 0.12;
  const tb = arr => [...arr].sort((a, b) => b.y - a.y || a.x - b.x);
  if (twoCol) return [...tb(left), ...tb(right)];
  return tb(body);
}

// ─── main ────────────────────────────────────────────────────────────────────
function buildPageMarkdown(items, viewport, opts) {
  if (!items.length) return '';
  const modalH = modalHeight(items);
  const lines = groupIntoLines(items, modalH);

  const tables = opts.extended === false ? [] : detectTableBlocks(lines, modalH);
  const inTable = idx => tables.find(t => idx >= t.start && idx < t.end);

  const out = [];
  let para = [];
  const sep = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  const flushPara = () => { if (para.length) { out.push(para.join(' ')); para = []; out.push(''); } };

  for (let i = 0; i < lines.length; i++) {
    const tbl = inTable(i);
    if (tbl) {
      if (tbl.start === i) { flushPara(); sep(); const t = buildTable(lines.slice(tbl.start, tbl.end), tbl.cols); if (t) { out.push(t); out.push(''); } }
      continue;
    }
    const ln = lines[i];
    if (!ln.text) continue;

    // ordered-list marker (superscript number paired with body text) — before heading test
    if (ln.olCand) { flushPara(); out.push(`${ln.olMarker}. ${ln.olText}`); continue; }

    const prefix = headingPrefix(ln, modalH);
    if (prefix) {
      flushPara(); sep();
      const lvl = prefix.trim();
      let text = ln.text;
      while (i + 1 < lines.length && !inTable(i + 1)) {
        const nxt = lines[i + 1];
        const np = headingPrefix(nxt, modalH);
        if (np && np.trim() === lvl && !nxt.olCand && Math.abs(nxt.y - ln.y) < modalH * 2.2) { text += ' ' + nxt.text; i++; } else break;
      }
      out.push(prefix + text);
      out.push('');
      continue;
    }

    // explicit inline list markers
    const ulm = ln.text.match(/^([•\-\*·○–])\s+(.*)$/);
    const olm = ln.text.match(/^(\d+\.|\([a-z0-9]+\))\s+(.*)$/i);
    if (ulm) { flushPara(); out.push(`- ${ulm[2]}`); continue; }
    if (olm) { flushPara(); out.push(`1. ${olm[2]}`); continue; }

    // body: reflow into paragraphs, break on vertical gap
    if (para.length) {
      const prevY = lines[i - 1] ? lines[i - 1].y : ln.y;
      if (Math.abs(prevY - ln.y) > ln.h * 2.0) flushPara();
    }
    if (para.length && /[A-Za-z]-$/.test(para[para.length - 1])) {
      const stem = para[para.length - 1];
      const stemWord = stem.split(/\s/).pop().slice(0, -1).toLowerCase();
      if (!(opts.hyphens && COMPOUND_PREFIXES.has(stemWord))) { para[para.length - 1] = stem.slice(0, -1) + ln.text.split(/\s/)[0]; para.push(ln.text.split(/\s/).slice(1).join(' ')); continue; }
    }
    para.push(ln.text);
  }
  flushPara();

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Output assembly ─────────────────────────────────────────────────────────
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
      langPath:    '/assets/tessdata',
      corePath:    '/vendor/tesseract-core/',
      gzip:        false,
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
  const confScores = [];
  let totalRenderedPixels = 0;

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (rec.status === 'cancelled' || rec.status === 'failed') break;
      if (i > SECURITY_LIMITS.maxOcrPages) {
        log(`OCR page limit (${SECURITY_LIMITS.maxOcrPages}) reached — stopping`, 'warn');
        pageMarkdowns.push(`[OCR stopped at page ${SECURITY_LIMITS.maxOcrPages} — document exceeds maximum OCR page count]`);
        break;
      }

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

      const rawVp = page.getViewport({ scale: 1 });
      const rawPixels = rawVp.width * rawVp.height;
      let ocrScale = 3;
      if (rawPixels * ocrScale * ocrScale > SECURITY_LIMITS.maxRenderedPixelsPerPage) {
        ocrScale = Math.sqrt(SECURITY_LIMITS.maxRenderedPixelsPerPage / rawPixels);
        log(`Page ${i}: canvas pixel cap — scale reduced to ${ocrScale.toFixed(2)}×`, 'warn');
      }
      totalRenderedPixels += rawPixels * ocrScale * ocrScale;
      if (totalRenderedPixels > SECURITY_LIMITS.maxTotalRenderedPixels) {
        log(`Page ${i}: total pixel budget exceeded — aborting OCR`, 'error');
        pageMarkdowns.push('[OCR aborted — document has too many large pages]');
        page.cleanup();
        break;
      }
      const viewport = page.getViewport({ scale: ocrScale });
      log(`Page ${i}: rendering canvas ${Math.round(viewport.width)}×${Math.round(viewport.height)}px…`, 'info');
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      log(`Page ${i}: canvas rendered`, 'ok');

      // preprocess: grayscale + Otsu binarization. Cleans up scanner noise,
      // blur, and uneven lighting that degrade OCR on image-only exhibits.
      preprocessForOCR(canvas, ctx);
      log(`Page ${i}: preprocessed (grayscale + binarize)`, 'ok');

      log(`Page ${i}: converting canvas to PNG blob…`, 'info');
      const blob = await canvasToBlob(canvas);
      log(`Page ${i}: blob ready (${(blob.size/1024).toFixed(0)} KB), sending to Tesseract…`, 'ok');

      try {
        const result = await Promise.race([
          worker.recognize(blob),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(Object.assign(new Error('OCR timed out'), { ocrTimeout: true })),
              SECURITY_LIMITS.maxOcrMsPerPage
            )
          ),
        ]);
        const text   = result.data.text || '';
        const confNum = typeof result.data.confidence === 'number' ? result.data.confidence : null;
        const conf   = confNum != null ? confNum.toFixed(0) : '?';
        if (confNum != null) confScores.push(confNum);
        log(`Page ${i}: OCR complete — confidence ${conf}%, ${text.trim().length} chars`, confNum != null && confNum < 75 ? 'warn' : 'ok');

        // reconstruct layout using Tesseract line segmentation + word bboxes for
        // column detection; fall back to raw text if line data is unavailable
        let pageMarkdown;
        if (result.data.lines?.length > 0) {
          pageMarkdown = buildPageMarkdownFromOCR(result.data, canvas, 3, state.options);
          if (!pageMarkdown) {
            pageMarkdown = state.options.normalize ? text.normalize('NFC').trim() : text.trim();
          }
        } else {
          pageMarkdown = state.options.normalize ? text.normalize('NFC').trim() : text.trim();
        }

        // confidence labeling: flag low-confidence pages so reviewers verify against source
        if (confNum != null && confNum < 75 && pageMarkdown) {
          pageMarkdown = `> ⚠️ **Low OCR confidence (${conf}%)** — text recognition on this page is unreliable. Common causes: light or faded ink, blurry or low-resolution scan, or significant page skew. For best results, re-scan at 300+ DPI with high contrast, straight alignment, and dark lines. Review this page against the original document before relying on any extracted text.\n\n${pageMarkdown}`;
        }
        pageMarkdowns.push(pageMarkdown);
      } catch (ocrErr) {
        if (ocrErr?.ocrTimeout) {
          log(`Page ${i}: OCR timed out after ${SECURITY_LIMITS.maxOcrMsPerPage}ms — skipping`, 'warn');
          pageMarkdowns.push(`[OCR timed out — page ${i}]`);
        } else {
          log(`Page ${i}: OCR recognition failed — ${ocrErr?.message}`, 'error');
          pageMarkdowns.push(`[OCR failed — page ${i}]`);
        }
      }
    }
  } finally {
    try { await worker.terminate(); log('Tesseract worker terminated', 'info'); } catch {}
    rec.worker = null;
  }

  if (confScores.length)
    rec.ocrConfidence = Math.round(confScores.reduce((a, b) => a + b, 0) / confScores.length);

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

// OCR-specific layout reconstruction. Uses Tesseract's own line segmentation
// (result.data.lines) rather than re-grouping from raw word bboxes, because
// Tesseract's line grouping is far more reliable than re-deriving it from noisy
// OCR bboxes. Word bboxes are used only for column detection inside each line.
// Heading detection is pattern-only (EXHIBIT, ALL CAPS) — font-height is not a
// reliable signal from OCR bboxes and causes dates/rows to be misclassified.
function buildPageMarkdownFromOCR(ocrData, canvas, scale, opts) {
  const canvasW = canvas.width, canvasH = canvas.height;
  const pageH = canvasH / scale;

  // Build line items using Tesseract's own line segmentation. Reconstruct line
  // text from words with confidence >= 5 to capture italic/bordered-cell text;
  // word x-positions (normalized to 1× space) are kept for word-bbox column detection.
  const rawLines = (ocrData.lines || [])
    .map(l => {
      const goodWords = (l.words || [])
        .filter(w => { const t = w.text.trim(); return t && w.confidence >= 5 && !/^[|\[\]]$/.test(t); })
        .map(w => ({ text: w.text, x: w.bbox.x0 / scale }));
      return {
        text:   goodWords.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim(),
        wordXs: goodWords.map(w => w.x),
        words:  goodWords,
        y:      (canvasH - l.bbox.y0) / scale,
        yMid:   (l.bbox.y0 + l.bbox.y1) / 2 / scale,  // top-down, for ruled-line region test
        h:      (l.bbox.y1 - l.bbox.y0) / scale,
      };
    })
    .filter(l => l.text && l.y > pageH * 0.04 && l.y < pageH * 0.97)
    .filter(l => !(l.text.length <= 4 && /^[a-z]/.test(l.text)));

  // Ruled-line table detection: scan binarized canvas for physical border lines
  // and assign words geometrically to cells. More reliable than word-bbox clustering
  // for scanned documents with visible borders; falls back to word-bbox if no grid found.
  let ruledTable = null;
  if (opts.tables !== false) {
    const ruled = detectRuledLines(canvas, scale);
    if (ruled) ruledTable = buildRuledTable(ocrData.words || [], ruled.hLines, ruled.vLines, scale);
  }

  const tableBlocks = ruledTable ? [] : detectOCRTables(rawLines);
  const inTable = idx => tableBlocks.find(t => idx >= t.start && idx < t.end);

  const out = [];
  const sep = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  let para = [];
  const flushPara = () => { if (para.length) { out.push(para.join(' ')); para = []; out.push(''); } };
  let ruledTableEmitted = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Ruled table: emit once on first in-table line; skip all lines in the table region
    if (ruledTable) {
      const inRegion = line.yMid >= ruledTable.y0 && line.yMid <= ruledTable.y1;
      if (inRegion) {
        if (!ruledTableEmitted) {
          flushPara(); sep();
          out.push(ruledTable.markdown);
          out.push('');
          ruledTableEmitted = true;
        }
        continue;
      }
    }

    const tbl = inTable(i);
    if (tbl) {
      if (tbl.start === i) {
        flushPara(); sep();
        const t = buildOCRTable(rawLines.slice(tbl.start, tbl.end), tbl.cols);
        if (t) { out.push(t); out.push(''); }
      }
      continue;
    }

    const { text } = line;
    if (!text) continue;

    // Pattern-only heading detection (no height heuristics)
    if (/^EXHIBIT\s+[A-Z0-9]/i.test(text)) {
      flushPara(); sep(); out.push(`## ${text}`); out.push(''); continue;
    }
    if (isAllCaps(text) && text.length >= 3 && text.length <= 60) {
      flushPara(); sep(); out.push(`## ${text}`); out.push(''); continue;
    }

    // Ordered / unordered lists
    const olm = text.match(/^(\d{1,2}\.)\s+(.*)/);
    if (olm) { flushPara(); out.push(`${olm[1]} ${olm[2]}`); continue; }
    const ulm = text.match(/^[•\-\*·]\s+(.*)/);
    if (ulm) { flushPara(); out.push(`- ${ulm[1]}`); continue; }

    // Body paragraph — break on large vertical gaps
    if (para.length) {
      const prevY = rawLines[i - 1] ? rawLines[i - 1].y : rawLines[i].y;
      if (Math.abs(prevY - rawLines[i].y) > rawLines[i].h * 2.5) flushPara();
    }
    para.push(text);
  }
  flushPara();

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Column detection for OCR lines: clusters word x-positions across consecutive
// lines to find shared column anchors (same algorithm as the pdf.js path).
function detectOCRTables(lines) {
  // Lines that should never start or extend a table block
  const isNonTable = text => (
    /^EXHIBIT\s+[A-Z0-9]/i.test(text) ||
    (isAllCaps(text) && text.length >= 3 && text.length <= 80) ||
    /^(\d{1,2}\.)\s+/.test(text) ||
    /^[•\-\*·]\s+/.test(text)
  );

  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (isNonTable(lines[i].text)) { i++; continue; }
    let j = i;
    const xsByLine = [];
    while (j < lines.length) {
      if (isNonTable(lines[j].text)) break;
      const xs = lines[j].wordXs;
      if (!xs.length) break;
      xsByLine.push(xs);
      const anchors = clusterAnchors(xsByLine, 20).filter(a => a.count >= 2);
      if (j > i) {
        const hits = anchors.filter(a => xs.some(x => Math.abs(x - a.x) <= 20)).length;
        if (anchors.length < 2 || hits < 1) { xsByLine.pop(); break; }
      }
      j++;
    }
    const runLen = j - i;
    if (runLen >= 2) {
      const anchors = clusterAnchors(xsByLine, 20).filter(
        a => a.count >= 2 && a.count >= Math.ceil(runLen * 0.5)
      );
      const cols = anchors.map(a => a.x).sort((a, b) => a - b);
      // Cap at 4 cols; require ≥28px gap between columns to avoid word-level splitting
      const wellSeparated = cols.length >= 2 && cols.length <= 4 &&
        cols.every((c, k) => k === 0 || c - cols[k - 1] > 28);
      if (wellSeparated) { blocks.push({ start: i, end: j, cols }); i = j; continue; }
    }
    i++;
  }
  return blocks;
}

function buildOCRTable(lines, cols) {
  const colOf = x => {
    let idx = 0;
    for (let c = 0; c < cols.length; c++) if (x >= cols[c] - 20) idx = c;
    return idx;
  };
  const grid = lines.map(l => {
    const cells = Array.from({ length: cols.length }, () => []);
    for (const w of l.words) cells[colOf(w.x)].push(w.text);
    return cells.map(c => c.join(' ').replace(/\s+/g, ' ').trim());
  });
  if (grid.length < 2) return null;
  const esc = s => s.replace(/\|/g, '\\|');
  const hdr = grid[0];
  const rows = [`| ${hdr.map(esc).join(' | ')} |`, `| ${hdr.map(() => '---').join(' | ')} |`];
  for (let r = 1; r < grid.length; r++) rows.push(`| ${grid[r].map(esc).join(' | ')} |`);
  return rows.join('\n');
}

// Detect physical ruled lines (table borders) in a binarized canvas by scanning
// for long horizontal and vertical runs of black pixels. Returns { hLines, vLines }
// (sorted positions at 1x scale, top-down / left-right) or null if no grid found.
function detectRuledLines(canvas, scale) {
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;

  const MIN_H = Math.round(W * 0.20); // horizontal rule: ≥20% of page width
  const MIN_V = Math.round(H * 0.06); // vertical rule: ≥6% of page height

  const hRows = [], vCols = [];
  for (let y = 0; y < H; y++) {
    let run = 0, best = 0;
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4] < 128) { if (++run > best) best = run; } else run = 0;
    }
    if (best >= MIN_H) hRows.push(y);
  }
  for (let x = 0; x < W; x++) {
    let run = 0, best = 0;
    for (let y = 0; y < H; y++) {
      if (d[(y * W + x) * 4] < 128) { if (++run > best) best = run; } else run = 0;
    }
    if (best >= MIN_V) vCols.push(x);
  }

  if (!hRows.length || !vCols.length) return null;

  // Merge adjacent pixel positions into single line centers (handles thick borders)
  const mergeRuns = (sorted, tol = 6) => {
    const out = []; let g = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] <= tol) g.push(sorted[i]);
      else { out.push(Math.round(g.reduce((a, b) => a + b, 0) / g.length)); g = [sorted[i]]; }
    }
    out.push(Math.round(g.reduce((a, b) => a + b, 0) / g.length));
    return out;
  };

  const hLines = mergeRuns(hRows).map(y => y / scale);
  const vLines = mergeRuns(vCols).map(x => x / scale);

  if (hLines.length < 2 || vLines.length < 2) return null;
  return { hLines, vLines };
}

// Build a markdown table by assigning OCR words to cells defined by ruled-line
// positions. Cell assignment is purely geometric — no confidence floor — so
// italic/low-contrast text in bordered cells is captured regardless of OCR score.
function buildRuledTable(allWords, hLines, vLines, scale) {
  const rows = hLines.length - 1, cols = vLines.length - 1;
  if (rows < 1 || cols < 1) return null;

  const y0 = hLines[0], y1 = hLines[hLines.length - 1];
  const x0 = vLines[0], x1 = vLines[vLines.length - 1];

  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));

  for (const w of allWords) {
    const t = w.text?.trim();
    if (!t || /^[|\[\]]$/.test(t)) continue;
    const wx = (w.bbox.x0 + w.bbox.x1) / 2 / scale;
    const wy = (w.bbox.y0 + w.bbox.y1) / 2 / scale; // top-down canvas coords
    if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;

    let row = -1, col = -1;
    for (let r = 0; r < rows; r++) if (wy >= hLines[r] && wy < hLines[r + 1]) { row = r; break; }
    for (let c = 0; c < cols; c++) if (wx >= vLines[c] && wx < vLines[c + 1]) { col = c; break; }
    if (row >= 0 && col >= 0) grid[row][col].push(t);
  }

  const esc = s => s.replace(/\|/g, '\\|');
  const hdr = grid[0].map(c => esc(c.join(' ').trim() || ' '));
  const mdRows = [
    `| ${hdr.join(' | ')} |`,
    `| ${hdr.map(() => '---').join(' | ')} |`,
  ];
  for (let r = 1; r < rows; r++)
    mdRows.push(`| ${grid[r].map(c => esc(c.join(' ').trim() || ' ')).join(' | ')} |`);

  return { markdown: mdRows.join('\n'), y0, y1, x0, x1 };
}

// Grayscale + Otsu binarization. Runs entirely on the local canvas — no data
// leaves the browser. Improves Tesseract accuracy on noisy/blurry/skewed scans
// by removing scanner artifacts and producing clean black-on-white input.
function preprocessForOCR(canvas, ctx) {
  const { width: w, height: h } = canvas;
  if (!w || !h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  // 1) grayscale (luminosity) + build histogram
  const gray = new Uint8Array(n);
  const hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[p] = g;
    hist[g]++;
  }
  // 2) Otsu's method — find threshold maximizing between-class variance
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }
  // 3) apply threshold → pure black/white
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = gray[p] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 4) correct scan skew so Tesseract line-segments cleanly and column x-positions cluster
  deskewCanvas(canvas, ctx);
}

// Projection-profile deskew. Searches ±5° in 0.5° steps on a downsampled copy,
// picks the angle whose rotated row-sums have highest variance (sharpest peaks =
// cleanest horizontal alignment), then applies the correction to the full canvas.
function deskewCanvas(canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  const SH = 350, SW = Math.round(W * SH / H);

  const ref = document.createElement('canvas');
  ref.width = SW; ref.height = SH;
  ref.getContext('2d').drawImage(canvas, 0, 0, SW, SH);

  const work = document.createElement('canvas');
  work.width = SW; work.height = SH;
  const wCtx = work.getContext('2d');

  let bestAngle = 0, bestVar = -1;
  for (let deg = -5; deg <= 5; deg += 0.5) {
    wCtx.fillStyle = '#fff';
    wCtx.fillRect(0, 0, SW, SH);
    wCtx.save();
    wCtx.translate(SW / 2, SH / 2);
    wCtx.rotate(deg * Math.PI / 180);
    wCtx.drawImage(ref, -SW / 2, -SH / 2);
    wCtx.restore();
    const d = wCtx.getImageData(0, 0, SW, SH).data;
    const rowCounts = new Float32Array(SH);
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < SW; x++)
        if (d[(y * SW + x) * 4] < 128) rowCounts[y]++;
    let s = 0, s2 = 0;
    for (const v of rowCounts) { s += v; s2 += v * v; }
    const mean = s / SH;
    const variance = s2 / SH - mean * mean;
    if (variance > bestVar) { bestVar = variance; bestAngle = deg; }
  }

  if (Math.abs(bestAngle) < 0.25) return;

  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tCtx = tmp.getContext('2d');
  tCtx.fillStyle = '#fff';
  tCtx.fillRect(0, 0, W, H);
  tCtx.save();
  tCtx.translate(W / 2, H / 2);
  tCtx.rotate(-bestAngle * Math.PI / 180);
  tCtx.drawImage(canvas, -W / 2, -H / 2);
  tCtx.restore();
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tmp, 0, 0);
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
  showAdvisoryOnce(() => downloadSingle(completed[0]));
});

downloadZipSingle.addEventListener('click', () => {
  const completed = state.files.filter(f => f.status === 'complete');
  if (completed.length !== 1) return;
  showAdvisoryOnce(() => downloadAsZip([completed[0]]));
});

downloadZipBtn.addEventListener('click', () => {
  const completed = state.files.filter(f => f.status === 'complete');
  if (completed.length < 2) return;
  showAdvisoryOnce(() => downloadAsZip(completed));
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

  // OCR confidence badge
  if (rec?.ocrConfidence != null) {
    const pct = rec.ocrConfidence;
    ocrConfEl.textContent = `OCR ${pct}%`;
    ocrConfEl.className = pct >= 85 ? 'conf-high' : pct >= 75 ? 'conf-medium' : 'conf-low';
    ocrConfEl.title = pct >= 85
      ? 'Good OCR quality'
      : pct >= 75
        ? 'Acceptable OCR quality — review complex passages'
        : 'Low OCR quality — verify against original document';
    ocrConfEl.hidden = false;
  } else {
    ocrConfEl.hidden = true;
  }

  rawPanel.textContent = md;
}


// ─── Copy to clipboard ────────────────────────────────────────────────────────

copyBtn.addEventListener('click', () => {
  const completed = state.files.filter(f => f.status === 'complete');
  const rec = completed[state.activeIdx];
  if (!rec) return;
  const text = rec.markdown || '';

  showAdvisoryOnce(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
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

  const computedEl = $('verify-computed');
  const expectedEl = $('verify-expected');
  const statusEl   = $('verify-status');
  const releaseEl  = $('verify-release');
  computedEl.textContent = 'Verifying…';
  expectedEl.textContent = '…';
  statusEl.textContent   = '…';
  statusEl.className     = 'verify-value';
  releaseEl.textContent  = '…';

  const sha256Hex = async (buf) => {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  let manifest;
  try {
    const resp = await fetch('/release-hash.json', { cache: 'no-store' });
    manifest = await resp.json();
  } catch {
    computedEl.textContent = '—';
    expectedEl.textContent = '(could not fetch release-hash.json)';
    statusEl.textContent   = 'Unknown';
    return;
  }

  const entries = Object.entries(manifest.files || {});
  expectedEl.textContent = `manifest v${manifest.version || '?'} · ${manifest.algorithm || 'SHA-256'}`;
  if (manifest.releaseUrl) {
    try {
      const url = new URL(manifest.releaseUrl);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unexpected URL scheme');
      const a = document.createElement('a');
      a.href = url.href;
      a.textContent = manifest.releaseUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      releaseEl.textContent = '';
      releaseEl.appendChild(a);
    } catch {
      releaseEl.textContent = manifest.releaseUrl;
    }
  } else {
    releaseEl.textContent = '—';
  }

  let ok = 0;
  const mismatched = [];
  for (let i = 0; i < entries.length; i++) {
    const [path, expected] = entries[i];
    computedEl.textContent = `Hashing ${i + 1} / ${entries.length}…`;
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const actual = await sha256Hex(await r.arrayBuffer());
      if (actual === expected) ok++;
      else mismatched.push(path);
    } catch {
      mismatched.push(path + ' (unreadable)');
    }
    await new Promise(res => setTimeout(res, 0)); // keep UI responsive
  }

  computedEl.textContent = `${ok} / ${entries.length} files verified`;
  const allMatch = mismatched.length === 0 && entries.length > 0;
  statusEl.textContent = allMatch ? '\u2713 ALL MATCH' : `\u2717 ${mismatched.length} MISMATCH`;
  statusEl.className = 'verify-value ' + (allMatch ? 'verify-match' : 'verify-mismatch');
  if (mismatched.length) {
    const note = document.createElement('div');
    note.className = 'verify-row';
    note.style.cssText = 'flex-direction:column;align-items:flex-start;gap:2px;margin-top:6px;';
    const lbl = document.createElement('span');
    lbl.className = 'verify-label';
    lbl.textContent = 'FAILED';
    const list = document.createElement('span');
    list.className = 'verify-value verify-mismatch';
    list.style.cssText = 'font-size:10px;word-break:break-all;';
    list.textContent = mismatched.slice(0, 12).join(', ') + (mismatched.length > 12 ? ` (+${mismatched.length - 12} more)` : '');
    note.appendChild(lbl); note.appendChild(list);
    // replace any prior failure note
    const prior = verifyPanelEl.querySelector('.verify-failnote');
    if (prior) prior.remove();
    note.classList.add('verify-failnote');
    verifyPanelEl.appendChild(note);
  } else {
    const prior = verifyPanelEl.querySelector('.verify-failnote');
    if (prior) prior.remove();
  }
  log(`Integrity check: ${ok}/${entries.length} files verified, ${mismatched.length} mismatched`, mismatched.length ? 'error' : 'ok');
});

// ─── Mobile OCR warning ───────────────────────────────────────────────────────

function isMobile() {
  return window.innerWidth <= 600 || /Mobi|Android/i.test(navigator.userAgent);
}

// lazy: show warning when OCR starts on mobile
const _origConvert = convertWithOCR;

// ─── Preferences (localStorage) ──────────────────────────────────────────────

const VALID_LANGS_SET = new Set(['eng','fra','deu','spa','ita','por','nld','pol','ces','vie']);

function savePrefs() {
  try {
    localStorage.setItem(PREF_KEYS.ocr,       String(state.options.ocr));
    localStorage.setItem(PREF_KEYS.lang,       state.options.lang);
    localStorage.setItem(PREF_KEYS.extended,   String(state.options.extended));
    localStorage.setItem(PREF_KEYS.normalize,  String(state.options.normalize));
    localStorage.setItem(PREF_KEYS.hyphens,    String(state.options.hyphens));
  } catch {}
}

function loadPrefs() {
  try {
    const ocr = localStorage.getItem(PREF_KEYS.ocr);
    if (ocr === 'true' || ocr === 'false') {
      state.options.ocr = ocr === 'true';
      optOcr.checked = state.options.ocr;
      optOcr.setAttribute('aria-checked', ocr);
      ocrNote.hidden = !state.options.ocr;
    }
    const lang = localStorage.getItem(PREF_KEYS.lang);
    if (lang && VALID_LANGS_SET.has(lang)) {
      state.options.lang = lang;
      optLang.value = lang;
    }
    const extended = localStorage.getItem(PREF_KEYS.extended);
    if (extended === 'true' || extended === 'false') {
      state.options.extended = extended !== 'false';
      optExtended.checked = state.options.extended;
      optExtended.setAttribute('aria-checked', extended);
    }
    const normalize = localStorage.getItem(PREF_KEYS.normalize);
    if (normalize === 'true' || normalize === 'false') {
      state.options.normalize = normalize !== 'false';
      optNormalize.checked = state.options.normalize;
      optNormalize.setAttribute('aria-checked', normalize);
    }
    const hyphens = localStorage.getItem(PREF_KEYS.hyphens);
    if (hyphens === 'true' || hyphens === 'false') {
      state.options.hyphens = hyphens !== 'false';
      optHyphens.checked = state.options.hyphens;
      optHyphens.setAttribute('aria-checked', hyphens);
    }
  } catch {}
}

// ─── Copy/download advisory ───────────────────────────────────────────────────

function showAdvisoryOnce(callback) {
  try {
    if (localStorage.getItem(ADVISORY_KEY) === 'true') { callback?.(); return; }
  } catch { callback?.(); return; }

  const overlay = document.createElement('div');
  overlay.className = 'advisory-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'advisory-msg-title');

  const box = document.createElement('div');
  box.className = 'advisory-box';

  const title = document.createElement('p');
  title.id = 'advisory-msg-title';
  title.className = 'advisory-title';
  title.textContent = 'Before you share this file';

  const msg = document.createElement('p');
  msg.className = 'advisory-msg';
  msg.textContent = "This file contains extracted document text. Handle it with the same care as the original. HeyMark’s privacy guarantee does not extend to tools you paste this text into.";

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = 'Got it';
  btn.addEventListener('click', () => {
    try { localStorage.setItem(ADVISORY_KEY, 'true'); } catch {}
    overlay.remove();
    callback?.();
  });

  box.appendChild(title);
  box.appendChild(msg);
  box.appendChild(btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  btn.focus();
}

loadPrefs();

// ─── Keyboard: drop zone ──────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    // handled by paste event above
  }
});
