export const MODEL='team-logit-v1';
export const RULES='club-v1';
export type Role='civilian'|'sheriff'|'mafia'|'don';
export type Player={id:string;name:string;active:boolean;rev:number};
export type Season={id:string;name:string;archived:boolean;rev:number};
export type Session={id:string;name:string;date:string;seasonId:string;attendees:string[];closed:boolean;legacy?:boolean;rev:number};
export type Seat={playerId:string;seat:number|null;role:Role;fouls:number|null;removed:boolean|null;legacyMvp?:boolean;legacySide?:'red'|'black';roleConflict?:boolean};
export type Game={id:string;sessionId:string;number:number;winner:'red'|'black'|null;type:'normal'|'technical'|'cancelled'|'legacy';reason:string;players:Seat[];eligible:boolean;eligibilityReason:string;legacy?:boolean;voided:boolean;modelVersion:string;rulesVersion:string;createdAt:string;rev:number};
export type State={revision:number;players:Player[];seasons:Season[];sessions:Session[];games:Game[]};
export const roleNames:Record<Role,string>={civilian:'Мирный',sheriff:'Шериф',mafia:'Мафия',don:'Дон'};
export const side=(r:Role)=>r==='mafia'||r==='don'?'black':'red';
export const playerSide=(p:Seat)=>p.legacySide||side(p.role);
export const sigmoid=(x:number)=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
export function eligibility(g:Game){
 if(g.legacy)return 'Архив: только описательная статистика';
 if(g.voided)return 'Запись отменена';
 if(g.type!=='normal')return g.type==='technical'?'Технический результат':'Партия без результата';
 if(g.players.length!==10)return 'Неполный состав';
 if(g.players.some(p=>p.removed))return 'Удаление: исключено из Skill';
 return '';
}
export function validateGame(g:Game,s:State){
 const errors:string[]=[];const session=s.sessions.find(x=>x.id===g.sessionId);
 if(!session||session.legacy)errors.push('Выберите игровой вечер.');
 if(!Number.isInteger(g.number)||g.number<1)errors.push('Номер партии должен быть положительным целым числом.');
 if(s.games.some(x=>x.id!==g.id&&!x.voided&&x.sessionId===g.sessionId&&x.number===g.number)&&!g.voided)errors.push('Партия с таким номером уже существует в этом вечере.');
 if(g.players.length!==10||new Set(g.players.map(x=>x.playerId)).size!==10)errors.push('Нужно ровно 10 разных игроков.');
 if(g.players.some(x=>!s.players.some(p=>p.id===x.playerId)))errors.push('Выберите игрока на каждом месте.');
 if(g.players.some(x=>!session?.attendees.includes(x.playerId)))errors.push('Все игроки должны быть в составе вечера.');
 if(new Set(g.players.map(x=>x.seat)).size!==10||g.players.some(x=>!Number.isInteger(x.seat)||Number(x.seat)<1||Number(x.seat)>10))errors.push('Места должны быть от 1 до 10 без повторов.');
 const count=(r:Role)=>g.players.filter(x=>x.role===r).length;
 if(count('civilian')!==6||count('sheriff')!==1||count('mafia')!==2||count('don')!==1)errors.push('Роли: 6 мирных, 1 шериф, 2 мафии, 1 дон.');
 if(!['normal','technical','cancelled'].includes(g.type))errors.push('Некорректный тип результата.');
 if(g.type!=='cancelled'&&!['red','black'].includes(g.winner||''))errors.push('Выберите победителя.');
 if(g.type==='cancelled'&&g.winner!==null)errors.push('У отменённой партии нет победителя.');
 if((g.type!=='normal'||g.players.some(p=>p.removed)||g.voided)&&!g.reason.trim())errors.push('Укажите причину необычного результата или отмены.');
 if(g.players.some(p=>!Number.isInteger(p.fouls)||Number(p.fouls)<0||Number(p.fouls)>20||typeof p.removed!=='boolean'))errors.push('Проверьте фолы и удаления.');
 return errors;
}
export const orderedGames=(s:State)=>s.games.filter(g=>!g.voided).sort((a,b)=>{
 const sa=s.sessions.find(x=>x.id===a.sessionId),sb=s.sessions.find(x=>x.id===b.sessionId);
 return (sa?.date||'').localeCompare(sb?.date||'')||a.sessionId.localeCompare(b.sessionId)||a.number-b.number||a.id.localeCompare(b.id);
});
// Joint Gaussian approximation to a regularized team logistic model.
// Full covariance retains uncertainty shared by repeated teammates.
export function rate(s:State,seasonId?:string){
 const ids=s.players.map(p=>p.id);const seasons=s.seasons.filter(p=>p.id!=='legacy').map(p=>p.id);
 const keys=[...ids,...seasons.map(x=>'@'+x)],N=keys.length;const idx=new Map(keys.map((x,i)=>[x,i]));
 const mean:number[]=Array(N).fill(0),C:number[][]=Array.from({length:N},(_,i)=>Array.from({length:N},(_,j)=>i===j?(i<ids.length?1:.64):0));
 const counts:Record<string,number>={},history:Record<string,{gameId:string;rating:number;sd:number}[]>={};let predictions:{gameId:string;p:number;y:number}[]=[];
 for(const g of orderedGames(s)){
  const session=s.sessions.find(x=>x.id===g.sessionId)!;
  if(eligibility(g)||!g.eligible||(seasonId&&session.seasonId!==seasonId))continue;
  const x=Array(N).fill(0);x[idx.get('@'+session.seasonId)!]=1;
  for(const p of g.players)x[idx.get(p.playerId)!]=side(p.role)==='black'?1/3:-1/7;
  const z=x.reduce((v,a,i)=>v+a*mean[i],0),cx=C.map(row=>row.reduce((v,a,i)=>v+a*x[i],0));
  const v=x.reduce((a,b,i)=>a+b*cx[i],0),p=sigmoid(z),h=p*(1-p),den=1+h*v,y=g.winner==='black'?1:0;
  predictions.push({gameId:g.id,p:sigmoid(z/Math.sqrt(1+Math.PI*v/8)),y});
  for(let i=0;i<N;i++)mean[i]+=cx[i]*(y-p)/den;
  for(let i=0;i<N;i++)for(let j=0;j<N;j++)C[i][j]-=h*cx[i]*cx[j]/den;
  for(const q of g.players){counts[q.playerId]=(counts[q.playerId]||0)+1;const i=idx.get(q.playerId)!;(history[q.playerId]??=[]).push({gameId:g.id,rating:1000+100*mean[i],sd:100*Math.sqrt(Math.max(C[i][i],0))});}
 }
 const players=Object.fromEntries(ids.map((id,i)=>{const n=counts[id]||0,sd=100*Math.sqrt(Math.max(C[i][i],0)),rating=1000+100*mean[i];return[id,{rating,sd,low:rating-1.96*sd,high:rating+1.96*sd,n,provisional:n<20||sd>75,history:history[id]||[]}]}));
 return {players,predictions,baseline:Object.fromEntries(seasons.map(id=>[id,sigmoid(mean[idx.get('@'+id)!])]))};
}
export function stats(s:State,playerId:string,seasonId?:string,form=false){
 let games=orderedGames(s).filter(g=>g.winner&&g.type!=='cancelled'&&g.players.some(p=>p.playerId===playerId)&&(!seasonId||s.sessions.find(x=>x.id===g.sessionId)?.seasonId===seasonId));
 if(form)games=games.filter(g=>!eligibility(g)&&g.eligible).slice(-10);
 const entries=games.map(g=>({g,p:g.players.find(p=>p.playerId===playerId)!}));
 const summarize=(items:typeof entries)=>{const n=items.length,w=items.filter(({g,p})=>g.winner===playerSide(p)).length;return {n,w,wr:n?w/n:null};};
 const overall=summarize(entries);let streak=0;for(const {g,p} of [...entries].reverse()){if(g.winner===playerSide(p))streak++;else break;}
 return {...overall,unknownRoles:entries.filter(e=>e.p.roleConflict).length,technical:games.filter(g=>g.type==='technical').length,streak,roles:Object.fromEntries(Object.keys(roleNames).map(r=>[r,summarize(entries.filter(e=>e.p.role===r&&!e.p.roleConflict))])),sides:Object.fromEntries(['red','black'].map(r=>[r,summarize(entries.filter(e=>playerSide(e.p)===r))])),recent:entries.slice(-10).map(({g,p})=>g.winner===playerSide(p)),games};
}
