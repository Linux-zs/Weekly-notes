import { z } from 'zod';

export const reportItemTypes = ['completed', 'next_plan', 'other'] as const;
export type ReportItemType = (typeof reportItemTypes)[number];
export const reportItemProgresses = ['completed', 'answered', 'incomplete'] as const;
export type ReportItemProgress = (typeof reportItemProgresses)[number];
export const authProviders = ['google', 'microsoft', 'github', 'apple'] as const;
export type AuthProvider = (typeof authProviders)[number];
export const maxReportItemTags = 20;

export const reportItemInputSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  type: z.enum(reportItemTypes),
  contentMd: z.string().max(30_000),
  occurredOn: z.iso.date().nullable().optional(),
  progress: z.enum(reportItemProgresses).optional(),
  note: z.string().max(2_000).optional(),
  tagIds: z
    .array(z.string().uuid())
    .max(maxReportItemTags)
    .refine((ids) => new Set(ids).size === ids.length, '标签不能重复')
    .default([]),
  position: z.number().int().min(0).optional()
});

export const reportCategoryInputSchema = z.object({
  name: z.string().trim().min(1).max(40)
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#61758A')
});

export interface UserSummary {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}
export interface Project {
  id: string;
  name: string;
  color: string;
  archivedAt: string | null;
  position: number;
}

export interface ReportCategory {
  id: string;
  name: string;
  position: number;
  archivedAt: string | null;
}

export interface ReportItem {
  id: string;
  reportId: string;
  importedFromItemId: string | null;
  projectId: string | null;
  categoryId: string | null;
  type: ReportItemType;
  contentMd: string;
  occurredOn: string | null;
  progress: ReportItemProgress;
  note: string;
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
  calendarDays: Array<{ date: string; kind: 'holiday' | 'adjusted_workday'; name: string }>;
  holidayDataAvailable: boolean;
}
