import { closestCenter,DndContext,KeyboardSensor,PointerSensor,useSensor,useSensors,type DragEndEvent } from '@dnd-kit/core';
import { arrayMove,SortableContext,sortableKeyboardCoordinates,verticalListSortingStrategy,useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import type { Project,ReportItem,ReportItemType,WeeklyReport } from '@zhoubao/shared';
import { AlertTriangle,ArrowLeft,ArrowRight,CalendarDays,ChevronDown,GripVertical,ImagePlus,Pencil,Plus,RefreshCcw,Trash2 } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import { useNavigate,useParams } from 'react-router';
import { api,ApiError } from '../api';
import { ErrorState,Loading,Modal } from '../components';
import { addDays,formatDate,isoWeekForDate,Markdown,sectionHints,sectionLabels,todayShanghai,weeksInIsoYear } from '../lib';

const sections=Object.keys(sectionLabels) as ReportItemType[];
type User={id:string;displayName:string;email:string|null;avatarUrl:string|null};
type ReportWeekSummary={year:number;weeks:Array<{weekNumber:number;itemCount:number}>};
type ProjectItemGroup={key:string;project:Project|null;items:ReportItem[]};
type ItemProgress='completed'|'answered'|'incomplete';
type LocalItemMeta={progress:ItemProgress;note:string};
const progressLabels:Record<ItemProgress,string>={completed:'已完成',answered:'已解答',incomplete:'未完成'};

function readLocalItemMeta(item:ReportItem):LocalItemMeta{
  const fallback:LocalItemMeta={progress:item.type==='completed'?'completed':'incomplete',note:''};
  try{const value=localStorage.getItem(`weekly-notes:item-meta:${item.id}`);return value?{...fallback,...JSON.parse(value)}:fallback;}catch{return fallback;}
}

export function ReportPage({user}:{user:User}){
  const params=useParams();
  const current=isoWeekForDate(todayShanghai());
  const year=Number(params.year)||current.year;
  const week=Number(params.week)||current.week;
  const [activeSection,setActiveSection]=useState(0);
  const navigate=useNavigate();
  const qc=useQueryClient();
  const report=useQuery({queryKey:['report',year,week],queryFn:()=>api<WeeklyReport>(`/api/reports/${year}/${week}`)});
  const reportWeeks=useQuery({queryKey:['report-weeks',year],queryFn:()=>api<ReportWeekSummary>(`/api/report-weeks/${year}`)});
  const projects=useQuery({queryKey:['projects'],queryFn:()=>api<{projects:Project[]}>('/api/projects')});
  useEffect(()=>setActiveSection(0),[year,week]);
  const addMutation=useMutation({
    mutationFn:async({type,projectId}:{type:ReportItemType;projectId:string|null})=>{
      let data=report.data!;
      if(!data.id)data=await api<WeeklyReport>(`/api/reports/${year}/${week}`,{method:'PUT',body:'{}'});
      return api(`/api/reports/${data.id}/items`,{method:'POST',body:JSON.stringify({type,projectId,contentMd:''})});
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:['report',year,week]});qc.invalidateQueries({queryKey:['report-weeks',year]});}
  });

  if(report.isLoading||reportWeeks.isLoading||projects.isLoading)return <PageFrame title="周报"><Loading/></PageFrame>;
  if(report.error||reportWeeks.error)return <PageFrame title="周报"><ErrorState message={(report.error??reportWeeks.error)!.message} onRetry={()=>{report.refetch();reportWeeks.refetch();}}/></PageFrame>;

  const data=report.data!;
  const activeProjects=projects.data!.projects.filter(project=>!project.archivedAt);
  const activeType=sections[activeSection];
  const move=(delta:number)=>{const next=isoWeekForDate(addDays(data.weekStart,delta*7));navigate(next.year===current.year&&next.week===current.week?'/':`/week/${next.year}/${next.week}`);};
  return <div className="page report-page">
    <header className="week-hero">
      <div className="week-kicker"><CalendarDays size={16}/><span>{year} · WEEK {String(week).padStart(2,'0')}</span></div>
      <div className="week-title-row"><div><h1>第 {week} 周</h1><p>{formatDate(data.weekStart)} — {formatDate(data.weekEnd)} · {user.displayName} 的工作记录</p><HolidaySummary report={data}/></div><div className="week-nav"><button className="icon-button bordered" onClick={()=>move(-1)} aria-label="上一周"><ArrowLeft/></button><button className="button secondary compact-button" onClick={()=>navigate('/')}>回到本周</button><button className="icon-button bordered" onClick={()=>move(1)} aria-label="下一周"><ArrowRight/></button></div></div>
      <WeekNavigator year={year} selectedWeek={week} current={current} weeks={reportWeeks.data!.weeks} onSelect={target=>navigate(target===current.week&&year===current.year?'/':`/week/${year}/${target}`)}/>
    </header>
    {!data.holidayDataAvailable&&<div className="notice"><AlertTriangle size={17}/><span>{year} 年节假日数据尚未导入，当前仅按普通周末显示。</span></div>}
    <div className="report-sections report-sections-focused"><ReportSection key={activeType} index={activeSection} type={activeType} items={data.items.filter(item=>item.type===activeType)} report={data} projects={activeProjects} onAdd={projectId=>addMutation.mutate({type:activeType,projectId})} onPrevious={()=>setActiveSection(index=>Math.max(0,index-1))} onNext={()=>setActiveSection(index=>Math.min(sections.length-1,index+1))} canPrevious={activeSection>0} canNext={activeSection<sections.length-1}/></div>
  </div>;
}

function PageFrame({title,children}:{title:string;children:React.ReactNode}){return <div className="page"><div className="page-heading"><div><span className="eyebrow">Workspace</span><h1>{title}</h1></div></div>{children}</div>;}

function HolidaySummary({report}:{report:WeeklyReport}){if(!report.calendarDays.length)return null;return <div className="holiday-summary">{report.calendarDays.map(day=><span className={day.kind} key={day.date}>{formatDate(day.date)} · {day.kind==='holiday'?day.name:'调休上班'}</span>)}</div>;}

function WeekNavigator({year,selectedWeek,current,weeks,onSelect}:{year:number;selectedWeek:number;current:{year:number;week:number};weeks:Array<{weekNumber:number;itemCount:number}>;onSelect:(week:number)=>void}){
  const [open,setOpen]=useState(false);
  const populated=new Set(weeks.map(item=>item.weekNumber));
  const total=weeksInIsoYear(year);
  return <div className={`year-weeks${open?' open':''}`}>
    <button className="year-weeks-toggle" onClick={()=>setOpen(value=>!value)} aria-expanded={open}><span><CalendarDays size={14}/>选择周次</span><small>{year} · 共 {total} 周</small><strong>第 {selectedWeek} 周</strong><ChevronDown size={16}/></button>
    {open&&<div className="year-weeks-panel"><div className="year-weeks-heading"><span>{year} 全年周次</span><div className="week-legend"><span className="legend-current">本周</span><span className="legend-selected">当前选择</span><span className="legend-filled">有内容</span></div></div><div className="week-grid">{Array.from({length:total},(_,index)=>index+1).map(number=>{const selected=number===selectedWeek;const isCurrent=year===current.year&&number===current.week;const hasContent=populated.has(number);return <button key={number} className={`week-number${hasContent?' has-report':' empty'}${isCurrent?' current':''}${selected?' selected':''}`} onClick={()=>{setOpen(false);onSelect(number);}} aria-current={selected?'page':undefined} aria-label={`第 ${number} 周${hasContent?'，有周报内容':'，暂无周报内容'}${isCurrent?'，本周':''}`}>{number}{isCurrent&&<i aria-hidden="true"/>}</button>;})}</div></div>}
  </div>;
}

function groupItemsByProject(items:ReportItem[],projects:Project[]){
  const projectById=new Map(projects.map(project=>[project.id,project]));
  const groups=new Map<string,ProjectItemGroup>();
  for(const item of items){
    const project=item.projectId?projectById.get(item.projectId)??null:null;
    const key=project?.id??'unassigned';
    const group=groups.get(key)??{key,project,items:[]};
    group.items.push(item);groups.set(key,group);
  }
  return [...groups.values()];
}

function ReportSection({type,items,report,projects,onAdd,index,onPrevious,onNext,canPrevious,canNext}:{type:ReportItemType;items:ReportItem[];report:WeeklyReport;projects:Project[];onAdd:(projectId:string|null)=>void;index:number;onPrevious:()=>void;onNext:()=>void;canPrevious:boolean;canNext:boolean}){
  const qc=useQueryClient();
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const reorder=useMutation({mutationFn:(ids:string[])=>api(`/api/reports/${report.id}/reorder`,{method:'POST',body:JSON.stringify({type,ids})}),onSuccess:()=>qc.invalidateQueries({queryKey:['report',report.weekYear,report.weekNumber]})});
  const dragEnd=(event:DragEndEvent)=>{if(!event.over||event.active.id===event.over.id)return;const old=items.findIndex(item=>item.id===event.active.id);const next=items.findIndex(item=>item.id===event.over!.id);reorder.mutate(arrayMove(items,old,next).map(item=>item.id));};
  const groups=groupItemsByProject(items,projects);
  return <section className="report-section project-table-section" style={{'--section-index':index} as React.CSSProperties}>
    <div className="section-heading"><div><span className={`section-index section-${type}`}>{String(index+1).padStart(2,'0')}</span><div><div className="section-title-line"><h2>{sectionLabels[type]}</h2><nav className="section-switcher" aria-label="切换周报分类"><button onClick={onPrevious} disabled={!canPrevious} aria-label="上一个分类"><ArrowLeft size={14}/></button><span>{index+1} / {sections.length}</span><button onClick={onNext} disabled={!canNext} aria-label="下一个分类"><ArrowRight size={14}/></button></nav></div><p>{sectionHints[type]}</p></div></div><button className="button ghost" onClick={()=>onAdd(null)}><Plus size={17}/>添加</button></div>
    {items.length?<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={items.map(item=>item.id)} strategy={verticalListSortingStrategy}><div className="project-report-groups">{groups.map(group=><ProjectReportGroup key={group.key} group={group} report={report} onAdd={()=>onAdd(group.project?.id??null)}/>)}</div></SortableContext></DndContext>:<button className="section-empty" onClick={()=>onAdd(null)}><Plus size={18}/><span>添加一条{sectionLabels[type]}</span></button>}
  </section>;
}

function ProjectReportGroup({group,report,onAdd}:{group:ProjectItemGroup;report:WeeklyReport;onAdd:()=>void}){
  const qc=useQueryClient();
  const [renaming,setRenaming]=useState(false);
  const [projectName,setProjectName]=useState(group.project?.name??'');
  useEffect(()=>setProjectName(group.project?.name??''),[group.project?.id,group.project?.name]);
  const renameProject=useMutation({mutationFn:(name:string)=>api(`/api/projects/${group.project!.id}`,{method:'PATCH',body:JSON.stringify({name})}),onSuccess:()=>qc.invalidateQueries({queryKey:['projects']})});
  const finishRename=()=>{const name=projectName.trim();setRenaming(false);if(group.project&&name&&name!==group.project.name)renameProject.mutate(name);else setProjectName(group.project?.name??'');};
  return <section className="project-report-group">
    <div className="project-group-label"><i style={{background:group.project?.color??'#98A2B3'}}/><div className="project-name-control">{renaming&&group.project?<input autoFocus value={projectName} onChange={event=>setProjectName(event.target.value)} onBlur={finishRename} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){setProjectName(group.project!.name);setRenaming(false);}}} aria-label="编辑项目名称"/>:<>{group.project?<button className="project-name-display" onDoubleClick={()=>setRenaming(true)} title="双击改名">{group.project.name}</button>:<strong>未归属</strong>}{group.project&&<button className="project-rename-button" onClick={()=>setRenaming(true)} aria-label="编辑项目名称"><Pencil size={12}/></button>}</>}</div><span>{group.items.length} 条</span></div>
    <div className="project-group-rows">{group.items.map((item,index)=><ReportItemRow key={item.id} item={item} sequence={index+1} report={report}/>)}<button className="project-row-add" onClick={onAdd}><Plus size={13}/>添加一条</button></div>
  </section>;
}

function summarizeMarkdown(content:string){return content.replace(/!\[([^\]]*)\]\([^)]+\)/g,'[图片] $1').replace(/[#*_`>]/g,'').replace(/\s+/g,' ').trim();}

function ReportItemRow({item,report,sequence}:{item:ReportItem;report:WeeklyReport;sequence:number}){
  const qc=useQueryClient();
  const [content,setContent]=useState(item.contentMd);
  const [localMeta,setLocalMeta]=useState<LocalItemMeta>(()=>readLocalItemMeta(item));
  const [inlineEditing,setInlineEditing]=useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [detailEditing,setDetailEditing]=useState(false);
  const [status,setStatus]=useState<'saved'|'saving'|'error'|'conflict'>('saved');
  const version=useRef(item.version);
  const initial=useRef(true);
  const clickTimer=useRef<number|undefined>(undefined);
  const textareaRef=useRef<HTMLTextAreaElement>(null);
  const fileInputRef=useRef<HTMLInputElement>(null);
  const sortable=useSortable({id:item.id});
  const style={transform:CSS.Transform.toString(sortable.transform),transition:sortable.transition};

  useEffect(()=>{setContent(item.contentMd);version.current=item.version;},[item.id,item.version]);
  useEffect(()=>{localStorage.setItem(`weekly-notes:item-meta:${item.id}`,JSON.stringify(localMeta));},[item.id,localMeta]);
  useEffect(()=>()=>window.clearTimeout(clickTimer.current),[]);
  const save=useMutation({
    mutationFn:()=>api<ReportItem>(`/api/report-items/${item.id}`,{method:'PATCH',body:JSON.stringify({contentMd:content,expectedVersion:version.current})}),
    onMutate:()=>setStatus('saving'),
    onSuccess:data=>{version.current=data.version;setStatus('saved');qc.setQueryData<WeeklyReport>(['report',report.weekYear,report.weekNumber],old=>old?{...old,items:old.items.map(existing=>existing.id===data.id?data:existing)}:old);qc.invalidateQueries({queryKey:['report-weeks',report.weekYear]});},
    onError:error=>setStatus(error instanceof ApiError&&error.status===409?'conflict':'error')
  });
  useEffect(()=>{if(initial.current){initial.current=false;return;}const timer=window.setTimeout(()=>save.mutate(),800);return()=>window.clearTimeout(timer);},[content]);
  const upload=useMutation({
    mutationFn:async({file}:{file:File;insertAt:number})=>{const form=new FormData();form.append('image',file);return api<{id:string;originalName:string;url:string}>(`/api/report-items/${item.id}/images`,{method:'POST',body:form});},
    onSuccess:(data,{file,insertAt})=>{const alt=file.name.replace(/\.[^.]+$/,'').replace(/[\[\]\\]/g,' ').trim()||'图片';let nextCursor=insertAt;setContent(current=>{const point=Math.min(insertAt,current.length);const before=current.slice(0,point);const after=current.slice(point);const leading=before&&!before.endsWith('\n')?'\n\n':'';const trailing=after&&!after.startsWith('\n')?'\n\n':'\n';const markdown=`${leading}![${alt}](${data.url})${trailing}`;nextCursor=point+markdown.length;return before+markdown+after;});requestAnimationFrame(()=>{textareaRef.current?.focus();textareaRef.current?.setSelectionRange(nextCursor,nextCursor);});}
  });
  const remove=useMutation({mutationFn:()=>api(`/api/report-items/${item.id}`,{method:'DELETE'}),onSuccess:()=>{qc.invalidateQueries({queryKey:['report',report.weekYear,report.weekNumber]});qc.invalidateQueries({queryKey:['report-weeks',report.weekYear]});}});
  const singleClick=()=>{window.clearTimeout(clickTimer.current);clickTimer.current=window.setTimeout(()=>setInlineEditing(true),210);};
  const doubleClick=()=>{window.clearTimeout(clickTimer.current);setInlineEditing(false);setDetailEditing(false);setDetailsOpen(true);};
  const displayContent=summarizeMarkdown(content)||'点击填写内容';

  return <article ref={sortable.setNodeRef} style={style} className={`report-table-row ${status==='conflict'?'item-conflict':''} ${status==='error'?'item-save-error':''}`}>
    <div className="report-row-main">
      <button className="row-sequence" {...sortable.attributes} {...sortable.listeners} aria-label={`第 ${sequence} 条，拖动排序`}><span>{sequence}</span><GripVertical size={12}/></button>
      <div className="row-content-cell">{inlineEditing?<textarea ref={textareaRef} autoFocus value={content} rows={1} onChange={event=>setContent(event.target.value)} onBlur={()=>setInlineEditing(false)} onKeyDown={event=>{if(event.key==='Escape'){setContent(item.contentMd);setInlineEditing(false);}}} aria-label={`${sectionLabels[item.type]}第 ${sequence} 条内容`}/>:<button className={`row-content-preview${content?'':' placeholder'}`} onClick={singleClick} onDoubleClick={doubleClick} title="单击编辑，双击打开详情">{displayContent}</button>}</div>
      <label className={`item-progress-cell progress-${localMeta.progress}`}><span className="visually-hidden">进度</span><select value={localMeta.progress} onChange={event=>setLocalMeta(value=>({...value,progress:event.target.value as ItemProgress}))} aria-label={`第 ${sequence} 条进度`}>{Object.entries(progressLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <label className="item-note-cell"><span className="visually-hidden">备注</span><input value={localMeta.note} onChange={event=>setLocalMeta(value=>({...value,note:event.target.value}))} placeholder="添加备注" aria-label={`第 ${sequence} 条备注`}/></label>
      <div className="row-actions">{(status==='error'||status==='conflict')&&<span className={`save-status ${status}`}>{status==='conflict'?'冲突':'保存失败'}</span>}<button className="icon-button danger" onClick={()=>{if(confirm('删除这条周报内容？'))remove.mutate();}} aria-label="删除"><Trash2 size={15}/></button></div>
    </div>
    {status==='conflict'&&<div className="conflict-bar"><span>服务器上的内容已经变化，当前编辑未覆盖。</span><button onClick={()=>qc.invalidateQueries({queryKey:['report',report.weekYear,report.weekNumber]})}>载入最新内容</button><button onClick={()=>{version.current=item.version;save.mutate();}}>重新应用</button></div>}
    <Modal open={detailsOpen} onOpenChange={open=>{setDetailsOpen(open);if(!open)setDetailEditing(false);}} title={`周报详情 · 第 ${sequence} 条`} description={detailEditing?'直接修改 Markdown；图片会插入当前光标位置。':'完整预览周报内容，点击编辑按钮可原地修改 Markdown。'} wide>
      <div className="report-detail-editor markdown-only-editor">
        <div className="detail-editor-status"><span className={`save-status ${status}`}>{status==='saving'?'保存中':status==='saved'?'已保存':status==='conflict'?'内容有冲突':'保存失败'}</span><div className="detail-edit-actions">{detailEditing&&<div className="detail-tools"><input ref={fileInputRef} className="visually-hidden" type="file" tabIndex={-1} aria-hidden="true" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event=>{const file=event.target.files?.[0];if(file)upload.mutate({file,insertAt:textareaRef.current?.selectionStart??content.length});event.currentTarget.value='';}}/><button className="button secondary" onClick={()=>fileInputRef.current?.click()} disabled={upload.isPending}>{upload.isPending?<RefreshCcw size={15} className="spin"/>:<ImagePlus size={15}/>}添加图片</button><span>PNG / JPEG / GIF / WebP，最大 8 MB</span>{upload.error&&<strong>{upload.error.message}</strong>}</div>}<button className={`button ${detailEditing?'secondary':''}`} onClick={()=>setDetailEditing(value=>!value)}><Pencil size={15}/>{detailEditing?'完成编辑':'编辑 Markdown'}</button></div></div>
        {detailEditing?<div className="markdown-editor-pane markdown-editor-single"><span>MARKDOWN</span><textarea ref={textareaRef} autoFocus value={content} onChange={event=>setContent(event.target.value)} rows={16} placeholder="写下一件值得回看的事……" aria-label="Markdown 内容"/></div>:<div className="detail-preview detail-preview-only"><Markdown content={content}/></div>}
      </div>
    </Modal>
  </article>;
}
