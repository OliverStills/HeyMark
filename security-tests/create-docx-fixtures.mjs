/**
 * Generates synthetic DOCX test fixtures.
 * DOCX = ZIP containing XML. No real client documents used.
 * Run: node security-tests/create-docx-fixtures.mjs
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'security-tests/fixtures/docx';
mkdirSync(OUT, { recursive: true });

// Minimal valid DOCX XML components
const CONTENT_TYPES_DOCX = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const CONTENT_TYPES_XLSX = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`;

const CONTENT_TYPES_PPTX = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;

const CONTENT_TYPES_DOCM = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroenabled.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function docXml(bodyContent) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyContent}</w:body>
</w:document>`;
}

function para(text) {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

// ── JSZip for building ZIP archives ──────────────────────────────────────────
// We need JSZip in Node; import dynamically so this file stays ESM
async function loadJSZip() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  try {
    return require('jszip');
  } catch {
    console.error('JSZip not available — run: npm install --no-save jszip');
    process.exit(1);
  }
}

async function writeZip(zip, filename) {
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(OUT, filename), buf);
  console.log(`  wrote ${filename} (${buf.length} bytes)`);
}

async function main() {
  const JSZip = await loadJSZip();
  console.log('Creating DOCX fixtures…');

  // 1 — valid DOCX with text and table
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_DOCX);
    zip.file('_rels/.rels', RELS);
    zip.file('word/document.xml', docXml(
      para('HeyMark DOCX Test Document') +
      para('This is a paragraph of body text for testing conversion fidelity.') +
      `<w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>Column A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Column B</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>Value 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value 2</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>`
    ));
    await writeZip(zip, 'valid-text.docx');
  }

  // 2 — DOCX with tracked changes (revision marks)
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_DOCX);
    zip.file('_rels/.rels', RELS);
    zip.file('word/document.xml', docXml(
      `<w:p><w:ins w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Inserted text</w:t></w:r></w:ins></w:p>` +
      `<w:p><w:del w:id="2" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Deleted text</w:delText></w:r></w:del></w:p>` +
      para('Normal paragraph after tracked changes.')
    ));
    await writeZip(zip, 'tracked-changes.docx');
  }

  // 3 — DOCX with comment
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_DOCX);
    zip.file('_rels/.rels', RELS);
    zip.file('word/document.xml', docXml(
      `<w:p><w:r><w:t>Text with a </w:t></w:r>` +
      `<w:commentRangeStart w:id="1"/><w:r><w:t>commented section</w:t></w:r><w:commentRangeEnd w:id="1"/>` +
      `<w:r><w:commentReference w:id="1"/></w:r><w:r><w:t>.</w:t></w:r></w:p>`
    ));
    await writeZip(zip, 'with-comments.docx');
  }

  // 4 — DOCX with javascript: hyperlink
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_DOCX);
    zip.file('_rels/.rels', RELS);
    // Add relationship pointing to javascript: URI
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
</Relationships>`);
    zip.file('word/document.xml', docXml(
      `<w:p><w:hyperlink r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<w:r><w:t>Click me</w:t></w:r></w:hyperlink></w:p>`
    ));
    await writeZip(zip, 'malicious-link.docx');
  }

  // 5 — ZIP without [Content_Types].xml (invalid DOCX)
  {
    const zip = new JSZip();
    zip.file('word/document.xml', docXml(para('No content types file')));
    await writeZip(zip, 'missing-content-types.docx');
  }

  // 6 — XLSX renamed as .docx
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_XLSX);
    zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook/>');
    await writeZip(zip, 'xlsx-as-docx.docx');
  }

  // 7 — PPTX renamed as .docx
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_PPTX);
    zip.file('ppt/presentation.xml', '<?xml version="1.0"?><presentation/>');
    await writeZip(zip, 'pptx-as-docx.docx');
  }

  // 8 — Macro-enabled DOCM
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_DOCM);
    zip.file('_rels/.rels', RELS);
    zip.file('word/document.xml', docXml(para('Macro-enabled document')));
    zip.file('word/vbaProject.bin', Buffer.from([0xD0, 0xCF, 0x11, 0xE0])); // OLE magic
    await writeZip(zip, 'macro-docm.docx');
  }

  // 9 — Not a ZIP at all (plain text disguised as docx)
  {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(OUT, 'not-a-zip.docx'), Buffer.from('This is plain text, not a ZIP archive.'));
    console.log('  wrote not-a-zip.docx');
  }

  // 10 — Excessive entry count
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_DOCX);
    zip.file('_rels/.rels', RELS);
    zip.file('word/document.xml', docXml(para('Excessive entries')));
    for (let i = 0; i < 200; i++) {
      zip.file(`word/extra/file${i}.xml`, `<?xml version="1.0"?><data>${i}</data>`);
    }
    await writeZip(zip, 'excessive-entries.docx');
  }

  // 11 — Empty DOCX (empty body)
  {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_DOCX);
    zip.file('_rels/.rels', RELS);
    zip.file('word/document.xml', docXml(''));
    await writeZip(zip, 'empty-body.docx');
  }

  console.log(`\nDone — ${11} fixtures written to ${OUT}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
