import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ErrorState, Loading, Modal } from '../components';

type ArchivedReport = {
  id: string;
  authorName: string;
  weekYear: number;
  weekNumber: number;
  items: Array<{ id: string; contentMd: string; note: string; projectName: string | null }>;
};

export function DepartedReports() {
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<ArchivedReport | null>(null);
  const qc = useQueryClient();
  const reports = useQuery({
    queryKey: ['departed-reports', page],
    queryFn: () =>
      api<{ reports: ArchivedReport[]; hasMore: boolean }>(`/api/settings/departed-reports?page=${page}`)
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/settings/departed-reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ['departed-reports'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    }
  });
  return (
    <section className="settings-card vertical">
      <h2>已移除成员的历史周报</h2>
      <p>历史记录继续保留在当前空间。所有者可查看原文并清理不再需要的周报，解除对共享项目的引用。</p>
      {reports.isPending ? (
        <Loading />
      ) : reports.error ? (
        <ErrorState message={reports.error.message} onRetry={() => reports.refetch()} />
      ) : (
        <>
          {reports.data.reports.length === 0 && <p>暂无已移除成员的历史周报。</p>}
          {reports.data.reports.map((report) => (
            <details key={report.id}>
              <summary>
                {report.authorName} · {report.weekYear} 年第 {report.weekNumber} 周 · {report.items.length} 条
              </summary>
              {report.items.map((item) => (
                <div key={item.id}>
                  <strong>{item.projectName ?? '未归属项目'}</strong>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.contentMd}</pre>
                  {item.note && <p>备注：{item.note}</p>}
                </div>
              ))}
              <button
                className="button secondary danger-text"
                onClick={() => {
                  remove.reset();
                  setTarget(report);
                }}
              >
                删除此历史周报
              </button>
            </details>
          ))}
          <div className="dialog-actions">
            <button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span>第 {page} 页</span>
            <button
              className="button secondary"
              disabled={!reports.data.hasMore}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
      {target && (
        <Modal
          open
          title="删除已移除成员的历史周报"
          description={`${target.authorName} · ${target.weekYear} 年第 ${target.weekNumber} 周`}
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setTarget(null);
          }}
        >
          <p>将永久删除这份周报及其条目、标签关联和附件文件。其他成员与其他空间的数据不受影响。</p>
          {remove.error && <p role="alert">{remove.error.message}</p>}
          <div className="dialog-actions">
            <button className="button secondary" disabled={remove.isPending} onClick={() => setTarget(null)}>
              取消
            </button>
            <button
              className="button destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(target.id)}
            >
              确认永久删除
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
