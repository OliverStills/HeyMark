/**
 * docx-worker.js — runs Mammoth.js in an isolated Web Worker.
 * Receives: { type: 'convert', id, buf: ArrayBuffer }
 * Sends:    { type: 'result',  id, html, messages }
 *        or { type: 'error',   id, message }
 * No document content is ever transmitted outside this worker.
 */

importScripts('/vendor/mammoth/mammoth.browser.min.js');

self.onmessage = async (e) => {
  const { type, id, buf } = e.data;
  if (type !== 'convert') return;

  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buf },
      { includeDefaultStyleMap: false }
    );
    self.postMessage({ type: 'result', id, html: result.value, messages: result.messages });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err?.message || 'DOCX conversion failed' });
  }
};
