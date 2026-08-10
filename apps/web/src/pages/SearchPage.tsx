import { useQuery } from '@tanstack/react-query';
import type { Project,ReportItemType,Tag } from '@zhoubao/shared';
import { CalendarRange,ChevronRight,Search,SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { EmptyState,ErrorState,Loading } from '../components';
import { Markdown,sectionLabels } from '../lib';

type Result={id:string;contentMd:string;type:ReportItemType;projectId:string|null;weekYear:number;weekNumber:number;weekStart:string;projectName:string|null;projectColor:string|null;tags:Tag[]};

export function SearchPage(){
  const [filters,setFilters]=useState({q:'',from:'',to:'',projectId:'',type:'',tagId:'',tagMode:'all'});const [submitted,setSubmitted]=useState(filters);
  const projects=useQuery({queryKey:['projects'],queryFn:()=>api<{projects:Project[]}>('/api/projects')});const tags=useQuery({queryKey:['tags'],queryFn:()=>api<{tags:Tag[]}>('/api/tags')});
  const results=useQuery({queryKey:['search',submitted],queryFn:()=>{const query=new URLSearchParams(Object.entries(submitted).filter(([,v])=>v).map(([k,v])=>[k==='tagId'?'tagIds':k,v]));return api<{items:Result[];hasMore:boolean}>(`/api/search?${query}`);}});
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">Archive</span><h1>搜索周报</h1><p>从项目、标签和时间里，找回曾经做过的事。</p></div></div>
    <form className="search-panel" onSubmit={e=>{e.preventDefault();setSubmitted({...filters});}}><div className="search-box"><Search size={20}/><input value={filters.q} onChange={e=>setFilters({...filters,q:e.target.value})} placeholder="搜索周报内容……"/><button className="button" type="submit">搜索</button></div><div className="filter-row"><label><CalendarRange size={15}/><input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/><span>至</span><input type="date" value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label><select value={filters.projectId} onChange={e=>setFilters({...filters,projectId:e.target.value})}><option value="">全部项目</option>{projects.data?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><select value={filters.type} onChange={e=>setFilters({...filters,type:e.target.value})}><option value="">全部类型</option>{Object.entries(sectionLabels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select><select value={filters.tagId} onChange={e=>setFilters({...filters,tagId:e.target.value})}><option value="">全部标签</option>{tags.data?.tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><button type="button" className="button secondary" onClick={()=>{const empty={q:'',from:'',to:'',projectId:'',type:'',tagId:'',tagMode:'all'};setFilters(empty);setSubmitted(empty);}}><SlidersHorizontal size={16}/>清除</button></div></form>
    {results.isLoading?<Loading/>:results.error?<ErrorState message={results.error.message} onRetry={()=>results.refetch()}/>:results.data!.items.length?<div className="search-results">{results.data!.items.map(result=><article className="search-result" key={result.id}><div className="result-meta"><span className="week-pill">{result.weekYear} · W{String(result.weekNumber).padStart(2,'0')}</span><span>{sectionLabels[result.type]}</span>{result.projectName&&<span className="project-label"><i style={{background:result.projectColor??'#78909c'}}/>{result.projectName}</span>}</div><Markdown content={result.contentMd}/><div className="result-foot"><div>{result.tags.map(tag=><span className="tag-chip" key={tag.id}>{tag.name}</span>)}</div><Link to={`/week/${result.weekYear}/${result.weekNumber}`}>打开这一周<ChevronRight size={15}/></Link></div></article>)}</div>:<EmptyState icon={<Search/>} heading="没有找到相符内容" body="试试减少筛选条件，或者换一个更短的关键词。"/>}
  </div>;
}
