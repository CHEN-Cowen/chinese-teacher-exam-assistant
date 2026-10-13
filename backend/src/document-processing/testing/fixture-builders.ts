/**
 * v7.2 附件解析：运行时生成的脱敏测试夹具（不提交任何二进制 blob）。
 *
 * 全部内容为合成的假数据（"杭州市/test"，无真实个人信息）：
 * - 最小合法 PDF（文本页 / 多页 / 扫描页 / 加密头 / 损坏）；
 * - SheetJS 生成 XLSX / XLSB；ET 用 BIFF8（xls bookType）字节改名 .et
 *   （WPS 旧版 ET 与 BIFF8 同系，魔数一致）；
 * - HTML 片段（含恶意 script/iframe）。
 */
import * as XLSX from 'xlsx';

type PdfPageSpec =
  | { kind: 'text'; lines: string[] }
  | { kind: 'scan' };

/**
 * 手工构造最小合法 PDF（计算 xref 偏移）。
 * - text 页：Helvetica 文本行（ASCII，保证 Type1 编码可靠）；
 * - scan 页：1x1 图片 XObject + 极少文本（触发扫描件判定）；
 * - encrypted：trailer 挂 /Encrypt（pdfjs 抛 PasswordException）。
 */
export function buildPdf(pages: PdfPageSpec[], encrypted = false): Buffer {
  const n = pages.length;
  // 对象编号：1 catalog / 2 pages / 3 font / 4..3+n page / 4+n..3+2n content / 4+2n.. image
  const pageObj = (i: number) => 4 + i;
  const contentObj = (i: number) => 4 + n + i;
  const imageObj = (i: number) => 4 + 2 * n + i;
  const scanIndexes = pages.map((p, i) => (p.kind === 'scan' ? i : -1)).filter((i) => i >= 0);

  const bodies = new Map<number, string | { dict: string; payload: Buffer }>();

  bodies.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  bodies.set(
    2,
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`,
  );
  bodies.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pages.forEach((spec, i) => {
    const xobjs = spec.kind === 'scan' ? ` /XObject << /Im0 ${imageObj(i)} 0 R >>` : '';
    bodies.set(
      pageObj(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R >>${xobjs} >> /Contents ${contentObj(i)} 0 R >>`,
    );
    const stream =
      spec.kind === 'text'
        ? spec.lines
            .map(
              (line, li) =>
                `BT /F1 12 Tf 72 ${720 - li * 20} Td (${escapePdf(line)}) Tj ET`,
            )
            .join('\n')
        : 'q 300 0 0 300 100 100 cm /Im0 Do Q';
    bodies.set(contentObj(i), streamWithLength(Buffer.from(stream, 'latin1')));
  });

  scanIndexes.forEach((i) => {
    const img = Buffer.from([0x80]);
    bodies.set(imageObj(i), {
      dict: `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${img.length} >>`,
      payload: img,
    });
  });

  // 加密字典：注册为最后一个对象，纳入 xref 覆盖范围
  const encryptObjNum = 4 + 3 * n;
  if (encrypted) {
    bodies.set(
      encryptObjNum,
      '<< /Filter /Standard /V 1 /R 2 /O <0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f> ' +
        '/U <2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f> /P -1 >>',
    );
  }

  const chunks: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];
  const push = (data: string | Buffer) => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
    chunks.push(buf);
    offset += buf.length;
  };

  push('%PDF-1.4\n');
  const totalObjects = encrypted ? encryptObjNum : encryptObjNum - 1; // 对象总数（编号从 1 开始）
  for (let num = 1; num <= totalObjects; num += 1) {
    const body = bodies.get(num);
    if (body === undefined) continue;
    offsets[num] = offset;
    push(`${num} 0 obj\n`);
    if (typeof body === 'string') {
      push(body);
      push('\nendobj\n');
    } else {
      push(body.dict);
      push('\nstream\n');
      push(body.payload);
      push('\nendstream\nendobj\n');
    }
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let num = 1; num <= totalObjects; num += 1) {
    xref += `${String(offsets[num] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  const encryptDict = encrypted ? ` /Encrypt ${encryptObjNum} 0 R` : '';
  push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R${encryptDict} >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.concat(chunks);
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function streamWithLength(payload: Buffer): string {
  // 文本流：dict + payload 由调用方以字符串拼接（payload 为 ASCII）
  return `<< /Length ${payload.length} >>\nstream\n${payload.toString('latin1')}\nendstream`;
}

/** 文本 PDF：多行（每页 ≥60 字符避开"文本极少"告警） */
export function buildTextPdf(lines: string[]): Buffer {
  return buildPdf([{ kind: 'text', lines }]);
}

/** 多页 PDF */
export function buildMultiPagePdf(): Buffer {
  return buildPdf([
    { kind: 'text', lines: ['Hangzhou Municipal Education Bureau 2026 Teacher Recruitment Announcement', 'Registration time: October 1 to October 7, 2026'] },
    { kind: 'text', lines: ['Written exam subjects: Comprehensive Education Knowledge and Subject Knowledge', 'Planned recruitment: 50 people'] },
  ]);
}

/** 扫描件 PDF：两页均无有效文本层且含图片 */
export function buildScannedPdf(): Buffer {
  return buildPdf([
    { kind: 'scan' },
    { kind: 'scan' },
  ]);
}

/** 加密 PDF */
export function buildEncryptedPdf(): Buffer {
  return buildPdf(
    [{ kind: 'text', lines: ['secret content should not be readable'] }],
    true,
  );
}

/** 损坏 PDF：有魔数但内容非法 */
export function buildCorruptPdf(): Buffer {
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'latin1'),
    Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37) % 256)),
  ]);
}

/** 带合并单元格 / 公式 / 日期与数字格式的多工作表工作簿（合成中文脱敏数据） */
export function buildWorkbookBuffer(bookType: 'xlsx' | 'xlsb' | 'xls'): Buffer {
  const wb = XLSX.utils.book_new();

  const positions = XLSX.utils.aoa_to_sheet([
    ['岗位代码', '岗位名称', '学历要求', '专业', '招聘人数'],
    ['2026-HZ-01', '语文教师', '本科及以上', '汉语言文学', '2'],
    ['2026-HZ-02', '数学教师', '硕士研究生及以上', '数学', '1'],
  ]);
  // 表头前两列合并（左上角取值，其余不重复出块）
  positions['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  // 数字单元格与公式单元格：必须同时扩展 !ref，否则写出时会被丢弃
  positions['F2'] = { t: 'n', v: 5 };
  positions['F3'] = { t: 'n', v: 7, f: 'A2+5' };
  positions['!ref'] = 'A1:F3';
  XLSX.utils.book_append_sheet(wb, positions, 'Positions');

  const schedule = XLSX.utils.aoa_to_sheet([
    ['报名', '2026年10月1日 至 2026年10月7日'],
    ['笔试', '2026年12月13日'],
  ]);
  XLSX.utils.book_append_sheet(wb, schedule, 'Schedule');

  return XLSX.write(wb, { bookType, type: 'buffer' }) as Buffer;
}

/** XLSX 字节（ZIP 容器含 xl/workbook.xml） */
export function buildXlsxFixture(): Buffer {
  return buildWorkbookBuffer('xlsx');
}

/** XLSB 字节（ZIP 容器含 xl/workbook.bin） */
export function buildXlsbFixture(): Buffer {
  return buildWorkbookBuffer('xlsb');
}

/** ET 字节：BIFF8（OLE2 魔数）——WPS 旧版 ET 同系 */
export function buildEtFixture(): Buffer {
  return buildWorkbookBuffer('xls');
}

/** 恶意 HTML：script/iframe 必须被剥离 */
export const MALICIOUS_HTML = `<!doctype html>
<html><head><title>Hangzhou 2026 Teacher Recruitment Announcement</title>
<script>alert('xss')</script></head>
<body><p>Education requirement: Bachelor degree or above.</p>
<iframe src="https://evil.example.com"></iframe>
<p>Registration time: October 1 to October 7, 2026.</p>
</body></html>`;
