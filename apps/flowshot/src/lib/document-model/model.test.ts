import { describe, expect, it } from 'vitest';
import { buildDocumentModel, classifyLink, localAssetCandidate, segmentDomOffset } from './index';
const utf8 = new TextEncoder();
function assertLeaves(source: string) {
  const model = buildDocumentModel(source);
  const dom = new DOMParser().parseFromString(model.html, 'text/html');
  const walker = dom.createTreeWalker(dom.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent) expect(node.parentElement?.closest('[data-flowshot-segment]')).not.toBeNull();
  }
  expect([...dom.querySelectorAll<HTMLElement>('[data-flowshot-segment]')].map(leaf => leaf.dataset.flowshotSegment)).toEqual(model.segments.map(segment => segment.id));
  let previous = 0;
  for (const segment of model.segments) {
    const leaf = dom.querySelector(`[data-flowshot-segment="${segment.id}"]`)!;
    expect(leaf).not.toBeNull();
    expect(segment.canonicalStart).toBeGreaterThanOrEqual(previous);
    const bytes = utf8.encode(model.canonicalText).slice(segment.canonicalStart, segment.canonicalEnd);
    expect(new TextDecoder().decode(bytes)).toBe(leaf.textContent);
    expect(segmentDomOffset(segment, leaf.textContent!, leaf.textContent!.length)).toBe(segment.canonicalEnd);
    previous = segment.canonicalEnd;
  }
  return model;
}
describe('N03 canonical v1', () => {
  it('normalizes prose across inline markup and preserves code/hard breaks', () => {
    const m = assertLeaves('e*\u0301*   \u00a0中文 😀\nsoft  \nbreak\n\n```unknown\n  x   y\n```');
    expect(m.canonicalText).toBe('é 中文 😀 soft\nbreak\n  x   y\n');
    expect(m.html).toContain('language-unknown');
  });
  it('excludes YAML/TOML and hashes original BOM and CRLF bytes', () => {
    expect(buildDocumentModel('---\nsecret: yes\n---\n# Hi').canonicalText).toBe('Hi');
    expect(buildDocumentModel('+++\nsecret = true\n+++\n# Hi').canonicalText).toBe('Hi');
    expect(buildDocumentModel('\ufeff# Hi\r\n').sourceHash).not.toBe(buildDocumentModel('# Hi\n').sourceHash);
    expect(buildDocumentModel('\ufeff# Hi\r\n').canonicalText).toBe('Hi');
    expect(() => buildDocumentModel('\ud800')).toThrow(/Unicode/);
  });
  it('preserves interior BOM and non-horizontal Unicode separators', () => {
    expect(assertLeaves('a\ufeffb\u2028c').canonicalText).toBe('a\ufeffb\u2028c');
  });
  it('uses independent SHA256 vectors and exact original-byte source hints', () => {
    expect(buildDocumentModel('abc').sourceHash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(buildDocumentModel('abc').canonicalHash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const m = assertLeaves('\ufeffHello\r\n\r\nworld');
    expect(m.segments[1]).toMatchObject({ sourceStart:12, sourceEnd:17, sourceStartLine:3, sourceEndLine:3 });
    expect(assertLeaves('ᄀ*ᅡ*').canonicalText).toBe('가');
  });
  it('has globally collision-free deterministic headings', () => {
    const m = assertLeaves('# Foo\n# Foo\n# Foo-2\n# 中文 😀\n# !!!\n# !!!');
    expect(m.toc.map(h => h.id)).toEqual(['flowshot-heading-foo','flowshot-heading-foo-2','flowshot-heading-foo-2-2','flowshot-heading-中文','flowshot-heading-section','flowshot-heading-section-2']);
  });
  it('keeps browser DOM order and canonical slices valid after table sanitization', () => {
    const cases: [string, string][] = [
      ['<table><tr><td>Cell</td></tr><caption>Caption</caption></table>', 'Caption\nCell'],
      ['<table><caption>Caption</caption><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>', 'Caption\nHeader\nCell'],
      ['<table><tfoot><tr><td>Footer</td></tr></tfoot><caption>Caption <em>emphasis</em></caption></table>', 'Caption emphasis\nFooter'],
      ['<table><caption><section>Caption</section></caption><tr><td><section>Cell</section></td></tr></table>', 'Caption\nCell'],
      ['<table><thead><tr><th>Header</th></tr></thead><tr><td>Cell</td></tr><caption><p>Caption</p><p>Second</p></caption></table>', 'Caption\nSecond\nHeader\nCell'],
      ['<table><caption>First</caption><tr><td>Cell</td></tr><caption>Second</caption></table>', 'First\nSecond\nCell'],
      ['<table><tr><td>Outer<table><tr><td>Inner</td></tr><caption>Inner caption</caption></table>Tail</td></tr><caption>Outer caption</caption></table>', 'Outer caption\nOuter\nInner caption\nInner\nTail'],
    ];
    for (const [source, expected] of cases) {
      const m = assertLeaves(source);
      const dom = new DOMParser().parseFromString(m.html, 'text/html');
      expect(m.canonicalText).toBe(expected);
      expect(dom.querySelector('table > span, tbody > span, thead > span, tfoot > span, tr > span')).toBeNull();
    }
  });
  it('uses visible table/list block separators and no final synthetic separator', () => {
    expect(assertLeaves('| a | b |\n|---|---|\n| 中 | 文 |\n\n- one\n- two').canonicalText).toBe('a b\n中 文\none\ntwo');
  });
  it('prunes executable/hidden HTML, forged metadata, URLs and styles', () => {
    const m = assertLeaves('<script>secret</script><style>secret</style><svg><text>secret</text></svg>\n\n<div hidden>secret</div><div style="display:none" onclick="bad()" id="evil" data-flowshot-segment="forged">visible</div>\n\n<a href="javascript:alert(1)">bad</a><img src="https://evil/a.png" onerror="bad()" alt="caption">');
    expect(m.canonicalText).not.toContain('secret');
    expect(m.html).not.toMatch(/<script|<style|<svg|onclick|onerror|href=|src=|style=|id="evil"|forged/);
    expect(m.canonicalText).toContain('caption');
  });
  it('blocks hostile raw URL and executable HTML corpus without losing visible siblings', () => {
    const corpus = [
      '<a href="java&#x73;cript:alert(1)">safe</a>',
      '<a href="%6aavascript%3aalert(1)">safe</a>',
      '<a href="//evil.test/file.md">safe</a>',
      '<a href="file:///private/file.md">safe</a>',
      '<img src="a.svg" srcset="https://evil/a.png 1x" alt="safe">',
      '<form><p>SECRET</p></form><p>safe</p>',
      '<math><mtext>SECRET</mtext></math><p>safe</p>',
      '<template>SECRET</template><p>safe</p>',
      '<span hidden="false">SECRET</span><span data-flowshot-target="javascript:x" data-canonical-end="999">safe</span>',
    ];
    for (const source of corpus) {
      const m = assertLeaves(source);
      const dom = new DOMParser().parseFromString(m.html,'text/html');
      expect(dom.querySelector('[href],[src],[srcset],[style],[onclick],[onerror],script,svg,math,form,template')).toBeNull();
      expect(m.canonicalText).toBe('safe');
      expect(m.html).not.toContain('javascript:');
    }
  });
  it('renders unsupported disclosure content as ordinary visible blocks', () => {
    const m = assertLeaves('<details><summary>Label</summary>Visible body</details>');
    expect(m.html).not.toMatch(/<details|<summary/);
    expect(m.canonicalText).toBe('Label\nVisible body');
  });
  it('classifies only controlled targets', () => {
    for (const bad of ['javascript:x','java\nscript:x','file:/x','//evil/x','data:x','%6aavascript%3ax','https%3a//evil','x%253a.md','unknown:x']) expect(classifyLink(bad).kind).toBe('blocked');
    expect(classifyLink('#a').kind).toBe('heading');
    expect(classifyLink('../notes.md#x').kind).toBe('document');
    expect(classifyLink('https://example.test').kind).toBe('external');
    expect(localAssetCandidate('assets/a.png')).toBe('assets/a.png');
    for (const bad of ['a.svg','https://x/a.png','data:x','//x/a.png','x%2fa.png']) expect(localAssetCandidate(bad)).toBeUndefined();
  });
  it('rejects invalid DOM offsets and split UTF16 surrogate pairs', () => {
    const m = assertLeaves('😀'); const s = m.segments[0]!;
    expect(() => segmentDomOffset(s,'😀',1)).toThrow();
    expect(() => segmentDomOffset(s,'😀',3)).toThrow();
  });
});
