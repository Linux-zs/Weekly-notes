import { z } from 'zod';

export const reportItemTypes = ['completed', 'next_plan', 'risk', 'other'] as const;
export type ReportItemType = (typeof reportItemTypes)[number];
export const authProviders = ['google', 'microsoft', 'github', 'apple'] as const;
export type AuthProvider = (typeof authProviders)[number];

export const reportItemInputSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  type: z.enum(reportItemTypes),
  contentMd: z.string().max(30_000),
  occurredOn: z.iso.date().nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  position: z.number().int().min(0).optional()
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#61758A')
});

export const memoInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  contentMd: z.string().max(30_000).default(''),
  projectId: z.string().uuid().nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#F2C66D'),
  pinned: z.boolean().default(false)
});

export interface UserSummary {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface Tag { id: string; name: string; color: string; }
export interface Project { id: string; name: string; color: string; archivedAt: string | null; }

export interface ReportItem {
  id: string;
  reportId: string;
  projectId: string | null;
  type: ReportItemType;
  contentMd: string;
  occurredOn: string | null;
  position: number;
  version: number;
  tags: Tag[];
}

export interface WeeklyReport {
  id: string | null;
  weekYear: number;
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  version: number;
  author: UserSummary;
  items: ReportItem[];
  calendarDays: Array<{ date: string; kind: 'holiday' | 'adjusted_workday'; name: string; }>;
  holidayDataAvailable: boolean;
}
