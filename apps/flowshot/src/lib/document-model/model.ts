import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Root, RootContent, Element, Text } from 'hast';
import type { DocumentModel, TextSegment, TocItem } from './types';
import { classifyLink, localAssetCandidate } from './targets';
const encoder = new TextEncoder();
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const hash = (value: string) => bytesToHex(sha256(encoder.encode(value)));
const blockedTags = new Set(['script','style','iframe','object','embed','form','input','button','select','textarea','option','svg','math','template','noscript','audio','video','source','link','meta','base']);
const schema: NonNullable<Parameters<typeof rehypeSanitize>[0]> = {
  ...defaultSchema,
  tagNames: ['a','p','div','span','br','hr','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','input','pre','code','em','strong','del','s','table','caption','thead','tbody','tfoot','tr','th','td','img','sup','sub','kbd','samp','details','summary'],
  attributes: {
    a: ['href','title'], img: ['src','alt','title'],
    code: [['className', /^language-[a-z0-9_-]+$/i]],
    input: [['type','checkbox'], 'checked', 'disabled'],
    ol: ['start'], th: ['align'], td: ['align'],
  },
  clobber: [],
};
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml','toml']).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
const safe = unified().use(rehypeSanitize, schema).use(rehypeHighlight, { detect: false, ignoreMissing: true, subset: ['javascript','typescript','python','json','bash','css','xml','sql'] });
const stringifier = unified().use(rehypeStringify);
function prune(parent: Root | Element) {
  parent.children = parent.children.filter(node => {
    if (node.type !== 'element') return node.type === 'text';
    if ('hidden' in node.properties) return false;
    // The sole input exception is an inert GFM task checkbox.
    if (node.tagName === 'input' && node.properties.type === 'checkbox' && node.properties.disabled === true) return true;
    return !blockedTags.has(node.tagName);
  });
  for (const node of parent.children) if (node.type === 'element') prune(node);
}
/** Keep sanitized HAST valid before wrappers can trigger HTML foster parenting. */
function normalizeTables(parent: Root | Element) {
  const children: (Element | Text)[] = [];
  for (const node of parent.children) {
    if (node.type === 'text') { children.push(node); continue; }
    if (node.type !== 'element') continue;
    normalizeTables(node);
    if (node.tagName === 'table') {
      const lifted: Element[] = [];
      const flow = (content: Element | Text): Element => {
        // An orphan table-only container is not valid ordinary flow content.
        function ordinary(element: Element) {
          if (element.tagName === 'table') return;
          if (['caption','thead','tbody','tfoot','tr','th','td'].includes(element.tagName)) element.tagName = 'div';
          for (const child of element.children) if (child.type === 'element') ordinary(child);
        }
        if (content.type === 'element') ordinary(content);
        return { type: 'element', tagName: 'div', properties: { className: ['flowshot-table-content'] }, children: [content] };
      };
      function structure(container: Element, allowed: readonly string[]) {
        const kept: (Element | Text)[] = [];
        for (const content of container.children) {
          if (content.type === 'text' && /^[\t\n\f\r ]*$/u.test(content.value)) { kept.push(content); continue; }
          if (content.type === 'element' && allowed.includes(content.tagName)) {
            if (['thead','tbody','tfoot'].includes(content.tagName)) structure(content,['tr']);
            else if (content.tagName === 'tr') structure(content,['th','td']);
            kept.push(content);
          } else if (content.type === 'element' || content.type === 'text') lifted.push(flow(content));
        }
        container.children = kept;
      }
      structure(node,['thead','tbody','tfoot','tr']);
      children.push(...lifted);
    }
    children.push(node);
  }
  parent.children = children;
}
function adapters(parent: Root | Element) {
  for (const node of parent.children) {
    if (node.type !== 'element') continue;
    if (node.tagName === 'details') node.tagName = 'div';
    if (node.tagName === 'summary') node.tagName = 'p';
    if (node.tagName === 'a') {
      const target = typeof node.properties.href === 'string' ? classifyLink(node.properties.href) : { kind: 'blocked', target: '' };
      node.tagName = target.kind === 'blocked' ? 'span' : 'button';
      node.properties = target.kind === 'blocked' ? {} : { type: 'button', role: 'link', dataFlowshotLinkKind: target.kind, dataFlowshotTarget: target.target };
    }
    if (node.tagName === 'img') {
      const alt = typeof node.properties.alt === 'string' ? node.properties.alt : '';
      const asset = typeof node.properties.src === 'string' ? localAssetCandidate(node.properties.src) : undefined;
      node.tagName = 'span';
      node.properties = { className: ['flowshot-image-caption'], ...(asset ? { dataFlowshotAsset: asset } : {}) };
      node.children = alt ? [{ type: 'text', value: alt }] : [];
    }
    adapters(node);
  }
}
type Leaf = { node: Text; parent: Element | Root; index: number; path: string; kind: 'code' | 'prose'; original: string };
type Event = { type: 'leaf'; leaf: Leaf } | { type: 'boundary' | 'break' | 'cell' };
const blocks = new Set(['p','div','h1','h2','h3','h4','h5','h6','blockquote','li','pre','tr','summary','details','hr']);
const structural = new Set(['ul','ol','table','thead','tbody','tfoot','tr','root']);
function eventsFor(root: Root): Event[] {
  const events: Event[] = [];
  function walk(parent: Root | Element, path: string, code: boolean) {
    parent.children.forEach((node, index) => {
      const childPath = `${path}.${index}`;
      if (node.type === 'text') {
        const tag = parent.type === 'root' ? 'root' : parent.tagName;
        if (structural.has(tag) && /^\s*$/u.test(node.value)) { node.value = ''; return; }
        events.push({ type: 'leaf', leaf: { node, parent, index, path: childPath, kind: code ? 'code' : 'prose', original: node.value } });
      } else if (node.type === 'element') {
        const block = blocks.has(node.tagName);
        if (block) events.push({ type: 'boundary' });
        if (node.tagName === 'br') events.push({ type: 'break' });
        else walk(node,childPath,code || node.tagName === 'code' || node.tagName === 'pre');
        if (node.tagName === 'td' || node.tagName === 'th') events.push({ type: 'cell' });
        if (block) events.push({ type: 'boundary' });
      }
    });
  }
  walk(root,'0',false);
  return events;
}
function normalizeRun(leaves: Leaf[], trimStart: boolean, trimEnd: boolean) {
  if (!leaves.length) return;
  const source = leaves.map(leaf => leaf.original).join('');
  const code = leaves[0]!.kind === 'code';
  const malformed = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u;
  // Most runs are already NFC. Preserve ownership directly and avoid one object per grapheme.
  if (source === source.normalize('NFC') && !source.includes('\r') && leaves.every(leaf => !malformed.test(leaf.original))) {
    let previousSpace = trimStart;
    for (const leaf of leaves) {
      let text = code ? leaf.original : leaf.original.replace(/[\t\n\p{Zs}]+/gu,' ');
      if (!code && previousSpace && text.startsWith(' ')) text = text.slice(1);
      if (text) previousSpace = text.endsWith(' ');
      leaf.node.value = text;
    }
    if (!code && trimEnd) {
      for (let i = leaves.length-1; i >= 0; i--) {
        const leaf = leaves[i]!;
        if (leaf.node.value) { if (leaf.node.value.endsWith(' ')) leaf.node.value = leaf.node.value.slice(0,-1); break; }
      }
    }
    return;
  }
  const starts: number[] = []; let length = 0;
  for (const leaf of leaves) { starts.push(length); length += leaf.original.length; leaf.node.value = ''; }
  const pieces: { owner: number; text: string }[] = [];
  let owner = 0; let previousSpace = false;
  for (const cluster of graphemes.segment(source)) {
    while (owner + 1 < starts.length && starts[owner + 1]! <= cluster.index) owner++;
    let text = cluster.segment.normalize('NFC').replace(/\r\n?/gu,'\n');
    if (!code && /^[\t\n\r\p{Zs}]+$/u.test(text)) {
      if (previousSpace) continue;
      text = ' '; previousSpace = true;
    } else previousSpace = false;
    pieces.push({ owner, text });
  }
  if (!code && trimStart && pieces[0]?.text === ' ') pieces.shift();
  if (!code && trimEnd && pieces.at(-1)?.text === ' ') pieces.pop();
  for (const piece of pieces) leaves[piece.owner]!.node.value += piece.text;
}
function sourceOffsets(source: string): Uint32Array {
  const result = new Uint32Array(source.length + 1); let bytes = 0;
  for (let i = 0; i < source.length;) {
    result[i] = bytes;
    const point = source.codePointAt(i)!; const width = point > 0xffff ? 2 : 1;
    if (width === 2) result[i+1] = bytes;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    i += width; result[i] = bytes;
  }
  return result;
}
/** Internal benchmark seam: hints can be disabled without changing canonicalization. */
export function buildModel(source: string, includeSourceHints = true, stage?: (name: string) => void): DocumentModel {
  if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(source)) throw new TypeError('Source must be valid Unicode');
  const sourceHash = hash(source);
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const markdown = parser.parse(source.slice(bom));
  stage?.('markdownParse');
  const parsed = parser.runSync(markdown) as Root;
  prune(parsed);
  stage?.('parseRawPrune');
  const tree = safe.runSync(parsed) as Root;
  normalizeTables(tree);
  adapters(tree);
  stage?.('sanitizeHighlightAdapters');
  const hints = includeSourceHints ? sourceOffsets(source) : undefined;
  stage?.('sourceMapIndex');
  const events = eventsFor(tree);
  let run: Leaf[] = []; let atBoundary = true;
  function flush(trimEnd: boolean) { normalizeRun(run,atBoundary,trimEnd); if (run.some(l => l.node.value)) atBoundary = false; run = []; }
  for (const event of events) {
    if (event.type === 'leaf') {
      if (run.length && run[0]!.kind !== event.leaf.kind) flush(false);
      run.push(event.leaf);
    } else { flush(true); atBoundary = true; }
  }
  flush(true);
  const canonical: string[] = []; const segments: TextSegment[] = [];
  let offset = 0; let pending: '' | '\n' | ' ' = ''; let lastCharacter = '';
  function append(text: string) { canonical.push(text); offset += encoder.encode(text).length; lastCharacter = text.at(-1) ?? lastCharacter; }
  function separator() { if (offset && pending && !(pending === '\n' && lastCharacter === '\n')) append(pending); pending = ''; }
  for (const event of events) {
    if (event.type !== 'leaf') {
      if (event.type === 'break') { pending = ''; append('\n'); }
      else if (event.type === 'boundary') pending = '\n';
      else if (pending !== '\n') pending = ' ';
      continue;
    }
    const leaf = event.leaf; const text = leaf.node.value;
    if (!text) continue;
    separator();
    const segment: TextSegment = { id: `flowshot-segment-${leaf.path}`, kind: leaf.kind, canonicalStart: offset, canonicalEnd: offset + encoder.encode(text).length };
    const position = leaf.node.position;
    const start = position?.start.offset; const end = position?.end.offset;
    if (hints && start !== undefined && end !== undefined && source.slice(start+bom,end+bom) === text) {
      segment.sourceStart = hints[start+bom]; segment.sourceEnd = hints[end+bom];
      segment.sourceStartLine = position!.start.line; segment.sourceEndLine = position!.end.line;
    }
    segments.push(segment); append(text);
    const wrapper: Element = { type: 'element', tagName: 'span', properties: { dataFlowshotSegment: segment.id, dataCanonicalStart: segment.canonicalStart, dataCanonicalEnd: segment.canonicalEnd }, children: [{ type: 'text', value: text }] };
    leaf.parent.children[leaf.index] = wrapper;
  }
  const toc: TocItem[] = []; const used = new Set<string>(); const nextSuffix = new Map<string, number>();
  function visible(node: RootContent): string { return node.type === 'text' ? node.value : node.type === 'element' ? node.tagName === 'br' ? '\n' : node.children.map(visible).join('') : ''; }
  function headings(parent: Root | Element) {
    for (const node of parent.children) if (node.type === 'element') {
      if (/^h[1-6]$/u.test(node.tagName)) {
        const text = visible(node);
        const slug = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,'-').replace(/^-|-$/gu,'') || 'section';
        const base = `flowshot-heading-${slug}`; let id = base; let suffix = nextSuffix.get(base) ?? 2;
        while (used.has(id)) id = `${base}-${suffix++}`;
        nextSuffix.set(base, suffix);
        used.add(id); node.properties.id = id; toc.push({ id, depth: Number(node.tagName[1]), text });
      }
      headings(node);
    }
  }
  headings(tree);
  const canonicalText = canonical.join('');
  stage?.('canonicalizeSegmentsToc');
  const html = stringifier.stringify(tree);
  const canonicalHash = hash(canonicalText);
  stage?.('stringifyHash');
  return { schemaVersion: 1, sourceHash, canonicalText, canonicalHash, html, toc, segments };
}
