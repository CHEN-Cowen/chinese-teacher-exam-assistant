/** 七个虚构示例的滚动时间轴。测试仍可直接使用固定基准 catalog。 */
import type { EvidenceAnchor, RecruitmentAnnouncement } from './types.js';
import { CATALOG_ANNOUNCEMENTS } from './catalog.js';

const BASE_DAY = Date.UTC(2026, 9, 4);
const DAY_MS = 24 * 60 * 60 * 1000;

function demoDay(now: Date): number {
  const chinaDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return Date.parse(`${chinaDate}T00:00:00Z`);
}

function shift(value: string | undefined, days: number): string | undefined {
  if (!value) return value;
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10) + value.slice(10);
}

function shiftAnchor(anchor: EvidenceAnchor, days: number): EvidenceAnchor {
  return { ...anchor, checkedAt: shift(anchor.checkedAt, days) ?? anchor.checkedAt };
}

export function getRollingCatalogAnnouncements(now: Date = new Date()): RecruitmentAnnouncement[] {
  const days = Math.round((demoDay(now) - BASE_DAY) / DAY_MS);
  return CATALOG_ANNOUNCEMENTS.map((announcement) => ({
    ...announcement,
    firstPublishedAt: shift(announcement.firstPublishedAt, days) ?? announcement.firstPublishedAt,
    sourceHealth: announcement.sourceHealth
      ? {
          ...announcement.sourceHealth,
          checkedAt: shift(announcement.sourceHealth.checkedAt, days) ?? announcement.sourceHealth.checkedAt,
        }
      : undefined,
    versions: announcement.versions.map((version) => ({
      ...version,
      publishedAt: shift(version.publishedAt, days) ?? version.publishedAt,
      supersededAt: shift(version.supersededAt, days),
      officialSource: shiftAnchor(version.officialSource, days),
      timeline: {
        ...version.timeline,
        registrationStart: shift(version.timeline.registrationStart, days) ?? version.timeline.registrationStart,
        registrationEnd: shift(version.timeline.registrationEnd, days) ?? version.timeline.registrationEnd,
        paymentDeadline: shift(version.timeline.paymentDeadline, days),
        admitTicketStart: shift(version.timeline.admitTicketStart, days),
        writtenExamDate: shift(version.timeline.writtenExamDate, days),
        scoreDate: shift(version.timeline.scoreDate, days),
        interviewDate: shift(version.timeline.interviewDate, days),
      },
      units: version.units.map((unit) => ({
        ...unit,
        requirements: unit.requirements.map((requirement) => ({
          ...requirement,
          evidence: shiftAnchor(requirement.evidence, days),
        })),
        materials: unit.materials?.map((material) => ({
          ...material,
          source: shiftAnchor(material.source, days),
        })),
      })),
    })),
  }));
}
