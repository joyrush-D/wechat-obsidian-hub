import { describe, it, expect } from 'vitest';
import {
  formatDate,
  dailyNotePath,
  pickLatestBriefingForDate,
  buildBriefingSection,
  insertOrReplaceBriefingSection,
} from '../../src/obsidian/daily-note';

describe('formatDate', () => {
  it('formats YYYY-MM-DD', () => {
    expect(formatDate(new Date('2026-04-18T10:00:00'), 'YYYY-MM-DD')).toBe('2026-04-18');
  });

  it('zero-pads single-digit month + day', () => {
    expect(formatDate(new Date(2026, 0, 5), 'YYYY-MM-DD')).toBe('2026-01-05');
  });

  it('supports custom patterns', () => {
    expect(formatDate(new Date('2026-04-18T10:00:00'), 'YYYY/MM/DD')).toBe('2026/04/18');
    expect(formatDate(new Date('2026-04-18T10:00:00'), 'DD-MM-YYYY')).toBe('18-04-2026');
  });
});

describe('dailyNotePath', () => {
  const d = new Date('2026-04-18T10:00:00');

  it('returns just <date>.md when folder is empty', () => {
    expect(dailyNotePath(d, '', 'YYYY-MM-DD')).toBe('2026-04-18.md');
  });

  it('returns just <date>.md when folder is "/"', () => {
    expect(dailyNotePath(d, '/', 'YYYY-MM-DD')).toBe('2026-04-18.md');
  });

  it('joins folder + filename', () => {
    expect(dailyNotePath(d, 'Daily Notes', 'YYYY-MM-DD')).toBe('Daily Notes/2026-04-18.md');
  });

  it('strips trailing slash from folder', () => {
    expect(dailyNotePath(d, 'Daily Notes/', 'YYYY-MM-DD')).toBe('Daily Notes/2026-04-18.md');
  });
});

describe('pickLatestBriefingForDate', () => {
  const FILES = [
    '2026-04-17-2330.md',
    '2026-04-18-0830.md',
    '2026-04-18-1341.md',   // <- latest today
    '2026-04-18-1010.md',
    '2026-04-19-0900.md',
    'gdelt-Ghana-2026-04-18-0900.md',   // looks similar but not a daily briefing
  ];

  it('picks the latest briefing for today by HH:MM suffix', () => {
    const out = pickLatestBriefingForDate(FILES, '2026-04-18', 'WeChat-Briefings');
    expect(out).toBe('WeChat-Briefings/2026-04-18-1341');
  });

  it('returns null when no briefing matches the date', () => {
    expect(pickLatestBriefingForDate(FILES, '2026-04-20', 'WeChat-Briefings')).toBeNull();
  });

  it('handles single-match', () => {
    const single = ['2026-04-17-2330.md'];
    expect(pickLatestBriefingForDate(single, '2026-04-17', 'WeChat-Briefings'))
      .toBe('WeChat-Briefings/2026-04-17-2330');
  });

  it('strips .md extension from input filenames', () => {
    const out = pickLatestBriefingForDate(FILES, '2026-04-19', 'WeChat-Briefings');
    expect(out).toBe('WeChat-Briefings/2026-04-19-0900');
  });

  it('handles full-path inputs by using basename', () => {
    const withPaths = FILES.map(f => 'WeChat-Briefings/' + f);
    const out = pickLatestBriefingForDate(withPaths, '2026-04-18', 'WeChat-Briefings');
    expect(out).toBe('WeChat-Briefings/2026-04-18-1341');
  });
});

describe('buildBriefingSection', () => {
  it('uses transclusion syntax', () => {
    const section = buildBriefingSection('WeChat-Briefings/2026-04-18-1341', new Date('2026-04-18T13:42:00'));
    expect(section).toContain('![[WeChat-Briefings/2026-04-18-1341]]');
  });

  it('includes section heading and timestamp', () => {
    const section = buildBriefingSection('WeChat-Briefings/abc', new Date('2026-04-18T13:42:00'));
    expect(section).toContain('## 📰 今日微信简报');
    expect(section).toMatch(/2026-04-18 13:42/);
  });

  it('wraps in BEGIN/END markers', () => {
    const section = buildBriefingSection('x', new Date());
    expect(section).toContain('<!-- OWH-briefing-begin -->');
    expect(section).toContain('<!-- OWH-briefing-end -->');
  });
});

describe('insertOrReplaceBriefingSection', () => {
  const SECTION_V1 = buildBriefingSection('WeChat-Briefings/2026-04-18-1010', new Date('2026-04-18T10:11:00'));
  const SECTION_V2 = buildBriefingSection('WeChat-Briefings/2026-04-18-1341', new Date('2026-04-18T13:42:00'));

  it('first insertion appends at end with divider', () => {
    const daily = '# 2026-04-18\n\n- 早会备忘\n- 跑步 5km';
    const out = insertOrReplaceBriefingSection(daily, SECTION_V1);
    expect(out).toContain('# 2026-04-18');
    expect(out).toContain('- 早会备忘');
    expect(out).toContain('---');
    expect(out).toContain('OWH-briefing-begin');
    expect(out).toContain('![[WeChat-Briefings/2026-04-18-1010]]');
  });

  it('preserves user content above the section across regenerations', () => {
    const daily = '# 2026-04-18\n\n## 私人日记\n今天天气不错。';
    const v1 = insertOrReplaceBriefingSection(daily, SECTION_V1);
    const v2 = insertOrReplaceBriefingSection(v1, SECTION_V2);
    expect(v2).toContain('## 私人日记');
    expect(v2).toContain('今天天气不错');
    // Old transclusion replaced
    expect(v2).not.toContain('2026-04-18-1010');
    expect(v2).toContain('![[WeChat-Briefings/2026-04-18-1341]]');
  });

  it('preserves user content BELOW the section too', () => {
    const daily = `初始笔记\n\n${SECTION_V1}\n\n下方私人备注`;
    const out = insertOrReplaceBriefingSection(daily, SECTION_V2);
    expect(out).toContain('初始笔记');
    expect(out).toContain('下方私人备注');
    expect(out).toContain('![[WeChat-Briefings/2026-04-18-1341]]');
    expect(out).not.toContain('2026-04-18-1010');
  });

  it('handles empty daily note', () => {
    const out = insertOrReplaceBriefingSection('', SECTION_V1);
    expect(out).toContain('OWH-briefing-begin');
    // No leading divider for empty file
    expect(out.startsWith('---')).toBe(false);
  });

  it('only includes ONE section after multiple insertions (idempotent replace)', () => {
    let out = '# Note';
    for (let i = 0; i < 5; i++) {
      out = insertOrReplaceBriefingSection(out, SECTION_V1);
    }
    const beginCount = (out.match(/OWH-briefing-begin/g) || []).length;
    const endCount = (out.match(/OWH-briefing-end/g) || []).length;
    expect(beginCount).toBe(1);
    expect(endCount).toBe(1);
  });
});
