# HeyMark — Privacy Statement

**Version:** 1.1.0
**Date:** 2026-06-27

---

## Summary

HeyMark converts PDF documents to Markdown in your browser. Your documents are
never uploaded to any server. HeyMark does not collect, store, or transmit your
documents or any content derived from them.

---

## What HeyMark processes

When you use HeyMark:

1. You select or drag a PDF file.
2. The file is read into your browser's memory using the browser's FileReader API.
3. The PDF is parsed by pdf.js, a library running locally in your browser.
4. Text is extracted (or, for scanned documents, recognized by Tesseract.js OCR)
   and converted to Markdown.
5. The resulting Markdown is displayed in your browser and available to copy or
   download.

All of these steps happen entirely within your browser. No file content, extracted
text, OCR output, or generated Markdown is sent to HeyMark's servers or any
third-party service during this process.

---

## What HeyMark does not collect

HeyMark does not collect:

- The documents you convert
- Extracted document text
- OCR output
- Generated Markdown
- Filenames
- Document metadata (author, title, creation date)
- Usage patterns (which features you use, how many files you convert)
- Analytics or telemetry of any kind
- Personal information

There is no analytics code, session recording, remote error reporting, or
advertising in HeyMark.

---

## Network requests

The only network requests HeyMark makes are to load its own static assets
(JavaScript, CSS, fonts, libraries) from `heymark.io`. These requests happen
on page load. No network request is made during or after document conversion.

The browser's Content Security Policy enforces this: it blocks all connections
to third-party origins at the network level, independently of HeyMark's code.

---

## Browser storage

HeyMark does not use:

- localStorage (for document content)
- sessionStorage
- IndexedDB
- Cookies
- Cache Storage (for document content)

HeyMark may store limited user preferences (such as the last-selected conversion
mode) in localStorage under the `heymark:` namespace. These preferences contain
no document content.

---

## What happens to your document after conversion

Once you copy or download the Markdown:

- HeyMark discards all references to the source PDF and generated Markdown.
- Object URLs are revoked.
- The file input is cleared.
- No copy of the document or its contents is retained by HeyMark.

**The Markdown you produce is your responsibility once it leaves HeyMark.** If
you paste it into a cloud service, AI tool, or email, that service's privacy
policy applies. Choose downstream tools appropriate for the sensitivity of your
documents.

---

## Hosting provider

HeyMark is served by Cloudflare Pages. Cloudflare receives standard web server
request logs: your IP address, the path requested, your browser's user-agent
string, and the response code. This is standard for any website. Cloudflare does
not receive document content.

---

## Browser extensions

Browser extensions installed in your browser can, in general, read the content
of any web page. HeyMark cannot control or audit what extensions you have
installed. If you are converting sensitive documents, consider using a browser
profile without extensions.

---

## Children

HeyMark is a professional document tool not directed at children. It collects
no personal information from anyone.

---

## Changes to this statement

If HeyMark changes its privacy practices in a material way, this document will
be updated and the change will be noted in the release notes.

---

## Contact

Oliver Sandoval — oliver.sandoval312@gmail.com
