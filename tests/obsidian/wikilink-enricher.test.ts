import { describe, it, expect } from 'vitest';
import { enrichWithPersonWikilinks, transformProseRegions, type PersonMention } from '../../src/obsidian/wikilink-enricher';

const PEOPLE: PersonMention[] = [
  { name: '罗俊', aliases: ['罗俊', 'Dexter', '罗总'], folder: 'WeChat-People' },
  { name: '张姝 Shu', aliases: ['Shu 张姝', '张姝'], folder: 'WeChat-People' },
  { name: '老豹亲妈', aliases: ['老豹亲妈', '罗舒扬妈妈'], folder: 'WeChat-People' },
];

describe('enrichWithPersonWikilinks', () => {
  it('replaces a single name with a wikilink', () => {
    const md = '今日 罗俊 出差宁波。';
    const { enriched, linkedNames } = enrichWithPersonWikilinks(md, PEOPLE);
    expect(enriched).toContain('[[WeChat-People/罗俊|罗俊]]');
    expect(linkedNames.has('罗俊')).toBe(true);
  });

  it('preserves the original alias text in the link display', () => {
    const md = 'Dexter 说要改宁波。';
    const { enriched } = enrichWithPersonWikilinks(md, PEOPLE);
    expect(enriched).toContain('[[WeChat-People/罗俊|Dexter]]');
  });

  it('matches longest alias first', () => {
    const md = '今天 Shu 张姝 提到加纳。';
    const { enriched } = enrichWithPersonWikilinks(md, PEOPLE);
    // Should match "Shu 张姝" not just "张姝"
    expect(enriched).toContain('[[WeChat-People/张姝 Shu|Shu 张姝]]');
    expect(enriched).not.toContain('Shu [[');
  });

  it('skips matches inside existing wikilinks', () => {
    const md = '请看 [[WeChat-People/罗俊]] 的档案。';
    const { enriched } = enrichWithPersonWikilinks(md, PEOPLE);
    // Should NOT add another wikilink inside the existing one
    const matches = (enriched.match(/罗俊/g) || []).length;
    expect(matches).toBe(1);
    expect(enriched).toBe(md);
  });

  it('skips matches inside fenced code blocks', () => {
    const md = '提到 罗俊 \n```\nconst name = "罗俊";\n```\n再次提到 罗俊。';
    const { enriched } = enrichWithPersonWikilinks(md, PEOPLE);
    // First and last "罗俊" linked, code block "罗俊" untouched
    expect(enriched).toContain('提到 [[WeChat-People/罗俊|罗俊]]');
    expect(enriched).toContain('再次提到 [[WeChat-People/罗俊|罗俊]]');
    expect(enriched).toContain('const name = "罗俊"');   // unchanged
  });

  it('skips matches inside inline code', () => {
    const md = 'Variable `Dexter` is set. Person Dexter spoke.';
    const { enriched } = enrichWithPersonWikilinks(md, PEOPLE);
    expect(enriched).toContain('`Dexter`');
    expect(enriched).toContain('Person [[WeChat-People/罗俊|Dexter]] spoke');
  });

  it('skips matches that would be partial English-word substrings', () => {
    const md = 'Dexterity is a stat, not Dexter.';
    const { enriched } = enrichWithPersonWikilinks(md, PEOPLE);
    expect(enriched).toContain('Dexterity is a stat');   // not wikilinked
    expect(enriched).toContain('not [[WeChat-People/罗俊|Dexter]].');
  });

  it('preserves frontmatter unchanged', () => {
    const md = '---\ntitle: 罗俊 spoke today\nauthor: Dexter\n---\n\nBody mentions 罗俊.';
    const { enriched } = enrichWithPersonWikilinks(md, PEOPLE);
    // Frontmatter stays as-is; only body gets wikilinks
    expect(enriched).toContain('---\ntitle: 罗俊 spoke today\nauthor: Dexter\n---');
    expect(enriched).toContain('Body mentions [[WeChat-People/罗俊|罗俊]]');
  });

  it('replaces multiple distinct people', () => {
    const md = '罗俊 找 老豹亲妈 商量。';
    const { enriched, linkedNames } = enrichWithPersonWikilinks(md, PEOPLE);
    expect(enriched).toContain('[[WeChat-People/罗俊|罗俊]]');
    expect(enriched).toContain('[[WeChat-People/老豹亲妈|老豹亲妈]]');
    expect(linkedNames.size).toBe(2);
  });

  it('skips 1-character aliases (too noisy)', () => {
    const tiny: PersonMention[] = [{ name: 'A 全名', aliases: ['A'], folder: 'WeChat-People' }];
    const md = 'A few words about A.';
    const { enriched } = enrichWithPersonWikilinks(md, tiny);
    expect(enriched).toBe(md);   // no change
  });

  it('returns empty linkedNames when nothing matched', () => {
    const md = '今日没有提到任何人。';
    const { linkedNames } = enrichWithPersonWikilinks(md, PEOPLE);
    expect(linkedNames.size).toBe(0);
  });

  it('handles regex special chars in alias safely', () => {
    const tricky: PersonMention[] = [{ name: 'Q.A. 工程师', aliases: ['Q.A.'], folder: 'WeChat-People' }];
    const md = '请联系 Q.A. 处理。';
    const { enriched } = enrichWithPersonWikilinks(md, tricky);
    expect(enriched).toContain('[[WeChat-People/Q.A. 工程师|Q.A.]]');
  });
});

describe('transformProseRegions', () => {
  it('passes prose through transform but skips code fences', () => {
    const md = 'Hello world.\n```\nSkip this.\n```\nMore prose.';
    const out = transformProseRegions(md, s => s.toUpperCase());
    expect(out).toContain('HELLO WORLD');
    expect(out).toContain('Skip this');   // inside fence — not uppercased
    expect(out).toContain('MORE PROSE');
  });

  it('skips inline code spans', () => {
    const md = 'before `keep me` after';
    const out = transformProseRegions(md, s => s.toUpperCase());
    expect(out).toBe('BEFORE `keep me` AFTER');
  });

  it('preserves frontmatter', () => {
    const md = '---\nfoo: bar\n---\nhello';
    const out = transformProseRegions(md, s => s.toUpperCase());
    expect(out).toContain('---\nfoo: bar\n---');
    expect(out).toContain('HELLO');
  });
});
