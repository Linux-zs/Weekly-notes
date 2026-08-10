import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Modal({open,onOpenChange,title,description,children,wide=false}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description?:string;children:ReactNode;wide?:boolean}){
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className={`dialog-content ${wide?'dialog-wide':''}`}><div className="dialog-heading"><div><Dialog.Title>{title}</Dialog.Title>{description&&<Dialog.Description>{description}</Dialog.Description>}</div><Dialog.Close className="icon-button" aria-label="关闭"><X size={18}/></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function EmptyState({icon,heading,body,action}:{icon:ReactNode;heading:string;body:string;action?:ReactNode}){return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{heading}</h3><p>{body}</p>{action}</div>;}
export function Loading(){return <div className="loading-stack" aria-label="加载中"><span/><span/><span/></div>;}
export function ErrorState({message,onRetry}:{message:string;onRetry?:()=>void}){return <div className="error-state"><strong>加载失败</strong><p>{message}</p>{onRetry&&<button className="button secondary" onClick={onRetry}>重新加载</button>}</div>;}
