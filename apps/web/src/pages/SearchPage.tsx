import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Project, ReportItemType, Tag } from '@zhoubao/shared';
import { CalendarRange, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { EmptyState, ErrorState, Loading } from '../components';
import { formatDate, sectionLabels } from '../lib';

type Result = {
  id: string;
  contentMd: string;
  type: ReportItemType;
  projectId: string | null;
  weekYear: number;
  weekNumber: number;
  weekStart: string;
  projectName: string | null;
  projectColor: string | null;
  occurredOn: string | null;
  tags: Tag[];
};
type Filters = {
  q: string;
  from: string;
  to: string;
  projectId: string;
  type: string;
  tagIds: string[];
  tagMode: 'all' | 'any';
};
const emptyFilters: Filters = {
  q: '',
  from: '',
  to: '',
  projectId: '',
  type: '',
  tagIds: [],
  tagMode: 'all'
};

function summarizeResult(content: string) {
  return (
    content
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[`#>*_~|=-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || '暂无内容'
  );
}

export function SearchPage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [submitted, setSubmitted] = useState<Filters>(emptyFilters);
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: Project[] }>('/api/projects')
  });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<{ tags: Tag[] }>('/api/tags') });
  const results = useInfiniteQuery({
    queryKey: ['search', submitted],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (submitted.q) query.set('q', submitted.q);
      if (submitted.from) query.set('from', submitted.from);
      if (submitted.to) query.set('to', submitted.to);
      if (submitted.projectId) query.set('projectId', submitted.projectId);
      if (submitted.type) query.set('type', submitted.type);
      if (submitted.tagIds.length) {
        query.set('tagIds', submitted.tagIds.join(','));
        query.set('tagMode', submitted.tagMode);
      }
      query.set('page', String(pageParam));
      return api<{ items: Result[]; page: number; hasMore: boolean }>(`/api/search?${query}`);
    },
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined)
  });
  const items = results.data?.pages.flatMap((page) => page.items) ?? [];
  const dateInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);
  if (projects.isLoading || tags.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (projects.error || tags.error)
    return (
      <div className="page">
        <ErrorState
          message={(projects.error ?? tags.error)!.message}
          onRetry={() => {
            projects.refetch();
            tags.refetch();
          }}
        />
      </div>
    );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">资料检索</span>
          <h1>搜索周报</h1>
          <p>按项目、时间、标签和类型快速定位历史工作记录。</p>
        </div>
      </div>
      <form
        className="search-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dateInvalid) setSubmitted({ ...filters });
        }}
      >
        <div className="search-box">
          <Search size={20} />
          <input
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
            placeholder="搜索周报内容……"
          />
          <button className="button" type="submit" disabled={dateInvalid}>
            搜索
          </button>
        </div>
        <div className="filter-row">
          <label>
            <CalendarRange size={15} />
            <span className="filter-label">周报周次</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
            <span>至</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </label>
          <select
            value={filters.projectId}
            onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}
          >
            <option value="">全部项目</option>
            {projects.data!.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            value={filters.type}
            onChange={(event) => setFilters({ ...filters, type: event.target.value })}
          >
            <option value="">全部类型</option>
            {Object.entries(sectionLabels).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setFilters(emptyFilters);
              setSubmitted(emptyFilters);
            }}
          >
            <SlidersHorizontal size={16} />
            清除
          </button>
        </div>
        {dateInvalid && <div className="form-error">开始日期不能晚于结束日期。</div>}
        {tags.data!.tags.length > 0 && (
          <div className="search-tag-row">
            <span>标签</span>
            <div>
              {tags.data!.tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={`tag-choice${filters.tagIds.includes(tag.id) ? ' selected' : ''}`}
                  onClick={() =>
                    setFilters({
                      ...filters,
                      tagIds: filters.tagIds.includes(tag.id)
                        ? filters.tagIds.filter((id) => id !== tag.id)
                        : [...filters.tagIds, tag.id]
                    })
                  }
                >
                  <i style={{ background: tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
            {filters.tagIds.length > 1 && (
              <select
                value={filters.tagMode}
                onChange={(event) => setFilters({ ...filters, tagMode: event.target.value as 'all' | 'any' })}
              >
                <option value="all">同时包含</option>
                <option value="any">包含任一</option>
              </select>
            )}
          </div>
        )}
      </form>
      {results.isLoading ? (
        <Loading />
      ) : results.error ? (
        <ErrorState message={results.error.message} onRetry={() => results.refetch()} />
      ) : items.length ? (
        <>
          <div className="search-results">
            {items.map((result) => (
              <article className="search-result" key={result.id}>
                <span className="week-pill">
                  {result.weekYear} · W{String(result.weekNumber).padStart(2, '0')}
                </span>
                <div className="result-context">
                  <span>{sectionLabels[result.type]}</span>
                  {result.projectName && (
                    <span className="project-label">
                      <i style={{ background: result.projectColor ?? '#78909c' }} />
                      {result.projectName}
                    </span>
                  )}
                  {result.occurredOn && (
                    <span className="occurred-date">
                      <CalendarRange size={12} />
                      发生于 {formatDate(result.occurredOn)}
                    </span>
                  )}
                  {result.tags.map((tag) => (
                    <span className="result-tag" key={tag.id}>
                      <i style={{ background: tag.color }} />
                      {tag.name}
                    </span>
                  ))}
                </div>
                <p className={`result-summary${result.contentMd.trim() ? '' : ' empty'}`}>
                  {summarizeResult(result.contentMd)}
                </p>
                <Link
                  className="result-open"
                  to={`/week/${result.weekYear}/${result.weekNumber}?item=${encodeURIComponent(result.id)}`}
                  aria-label={`打开 ${result.weekYear} 年第 ${result.weekNumber} 周`}
                >
                  <span>打开</span>
                  <ChevronRight size={15} />
                </Link>
              </article>
            ))}
          </div>
          {results.hasNextPage && (
            <div className="load-more">
              <button
                className="button secondary"
                onClick={() => results.fetchNextPage()}
                disabled={results.isFetchingNextPage}
              >
                {results.isFetchingNextPage ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Search />}
          heading="没有找到相符内容"
          body="试试减少筛选条件，或者换一个更短的关键词。"
        />
      )}
    </div>
  );
}
