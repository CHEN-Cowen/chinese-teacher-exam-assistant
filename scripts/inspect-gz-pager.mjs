import { readFileSync } from 'node:fs';

for (const f of ['tzgg-index']) {
  const t = readFileSync(`.tmp-gz/${f}.html`, 'utf8');
  console.log('===', f, '===');
  const m = t.match(/createPageHTML\s*\([\s\S]{0,200}?\)/);
  console.log('createPageHTML call:', m ? m[0].replace(/\s+/g, ' ') : '(not found)');
  const scripts = [...t.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((x) => x[1]);
  console.log('scripts:', [...new Set(scripts)].slice(0, 12));
  const inline = [...t.matchAll(/<script[^>]*>([\s\S]{0,400}?)<\/script>/gi)]
    .map((x) => x[1])
    .filter((x) => /page|Page|pageTotal|total/i.test(x));
  console.log('inline page scripts:', inline.slice(0, 6).map((x) => x.replace(/\s+/g, ' ').slice(0, 260)));
  // 栏目导航
  const nav = [...t.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,60}?)<\/a>/gi)]
    .map((x) => [x[1], x[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()])
    .filter(([u, tx]) => tx && /(通知公告|网上公示|人事|招聘|招考|公示|教师)/.test(tx));
  console.log('nav:', [...new Map(nav.map(([u, t]) => [u, t]))].slice(0, 25));
}
