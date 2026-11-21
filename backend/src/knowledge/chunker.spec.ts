import { describe, expect, it } from 'vitest';
import { chunkParsedBlocks, textToBlocks } from './chunker.js';

describe('官方材料切分', () => {
  it('段落按长度合并，并保留每个块的可回读定位', () => {
    const blocks = textToBlocks('第一条 报考条件\n第二条 学历要求\n第三条 报名时间');
    const chunks = chunkParsedBlocks(blocks, 18);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.content).toContain('第一条');
    for (const chunk of chunks) {
      expect(chunk.locator.kind).toBe('excerpt');
      expect(chunk.spans.length).toBeGreaterThan(0);
      expect(chunk.content.length).toBeLessThanOrEqual(18);
    }
  });

  it('标题进入 headingPath，正文不含标题前缀', () => {
    const blocks = [
      {
        kind: 'heading' as const,
        text: '招聘岗位表',
        locator: { kind: 'html' as const, selector: '#title', textFragment: '招聘岗位表' },
      },
      {
        kind: 'paragraph' as const,
        text: '语文教师 2 名，要求本科及以上。',
        locator: { kind: 'html' as const, selector: '#content', textFragment: '要求' },
      },
    ];
    const chunks = chunkParsedBlocks(blocks);
    expect(chunks[0]!.headingPath).toEqual(['招聘岗位表']);
    expect(chunks[0]!.content).toBe('语文教师 2 名，要求本科及以上。');
  });

  it('工作表按行聚合，单元格地址可定位', () => {
    const blocks = [
      {
        kind: 'table-cell' as const,
        text: '语文',
        locator: { kind: 'worksheet' as const, sheet: '岗位表', row: 2, column: 1, cell: 'A2' },
      },
      {
        kind: 'table-cell' as const,
        text: '2',
        locator: { kind: 'worksheet' as const, sheet: '岗位表', row: 2, column: 2, cell: 'B2' },
      },
      {
        kind: 'table-cell' as const,
        text: '数学',
        locator: { kind: 'worksheet' as const, sheet: '岗位表', row: 3, column: 1, cell: 'A3' },
      },
    ];
    const chunks = chunkParsedBlocks(blocks);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.kind).toBe('table_row');
    expect(chunks[0]!.content).toContain('工作表「岗位表」第 2 行');
    expect(chunks[0]!.content).toContain('A2=语文');
    expect(chunks[0]!.content).toContain('B2=2');
    expect(chunks[0]!.locator).toMatchObject({ cell: 'A2' });
    expect(chunks[1]!.content).toContain('A3=数学');
  });
});
