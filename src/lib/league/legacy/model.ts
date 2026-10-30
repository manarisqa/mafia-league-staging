export const MODEL='team-logit-v1';
export const RULES='club-v1';
export const SHORT_RULES='club-short9-no-first-shot-v1';
export type Format='classic10'|'short9';
export type FormatFilter=Format|'all';
export const formatOf=(g:Game):Format=>g.format??'classic10';
export type CheckEvent={id:string;kind:'sheriff_check'|'don_check';targetPlayerId:string;result:'red'|'black'|'sheriff'|'not_sheriff';round?:number;source:'manual';confidence:1;verifiedByAdmin:true};
export type Details={firstNight?:{status:'killed'|'miss'|'unknown'|'not_reached'|'no_shot_by_rules';targetPlayerId?:string};checks?:CheckEvent[]};
export type Settings={id:'display';rev:number;roleMin:number;seatMin:number;pairMin:number;tripleMin:number;opponentMin:number;recordMin:number};
export const DEFAULT_SETTINGS:Settings={id:'display',rev:0,roleMin:10,seatMin:5,pairMin:5,tripleMin:5,opponentMin:5,recordMin:10};
export const settingsOf=(s:State)=>s.settings?.[0]??DEFAULT_SETTINGS;
export const MODEL_CONFIG={playerPriorMean:0,playerPriorVariance:1,seasonPriorMean:0,seasonPriorVariance:.64,blackWeight:1/3,redWeight:-1/7,displayBase:1000,displayScale:100,intervalZ:1.96,provisionalN:20,provisionalSD:75,sigmoidClip:30,predictiveVarianceFactor:Math.PI/8,processNoise:0,returningInflation:0} as const;

export type Role='civilian'|'sheriff'|'mafia'|'don';
export type Player={id:string;name:string;active:boolean;rev:number};
export type Season={id:string;name:string;archived:boolean;rev:number};
export type Session={id:string;name:string;date:string;seasonId:string;attendees:string[];closed:boolean;deleted?:boolean;legacy?:boolean;rev:number};
export type Seat={playerId:string;seat:number|null;role:Role;fouls:number|null;removed:boolean|null;legacyMvp?:boolean;legacySide?:'red'|'black';roleConflict?:boolean};
export type Game={format?:Format;details?:Details;id:string;sessionId:string;number:number;winner:'red'|'black'|null;type:'normal'|'technical'|'cancelled'|'legacy';reason:string;players:Seat[];eligible:boolean;eligibilityReason:string;legacy?:boolean;voided:boolean;modelVersion:string;rulesVersion:string;createdAt:string;rev:number};
export type State={revision:number;players:Player[];seasons:Season[];sessions:Session[];games:Game[];settings?:Settings[]};
export const roleNames:Record<Role,string>={civilian:'Мирный',sheriff:'Шериф',mafia:'Мафия',don:'Дон'};
export const side=(r:Role)=>r==='mafia'||r==='don'?'black':'red';
export const playerSide=(p:Seat)=>p.legacySide||side(p.role);
export const sigmoid=(x:number)=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
export function structureErrors(g:Game):string[]{
 const n=formatOf(g)==='short9'?9:10, errors:string[]=[];
 if(!['classic10','short9'].includes(formatOf(g))||g.rulesVersion!==(n===9?SHORT_RULES:RULES)||g.modelVersion!==MODEL)errors.push('Неизвестный формат, правила или модель.');
 if(!Array.isArray(g.players)||g.players.length!==n||new Set(g.players.map(p=>p?.playerId)).size!==n||g.players.some(p=>!p||typeof p.playerId!=='string'||!p.playerId))return [...errors,`Нужно ровно ${n} разных игроков.`];
 if(new Set(g.players.map(p=>p.seat)).size!==n||g.players.some(p=>!Number.isInteger(p.seat)||Number(p.seat)<1||Number(p.seat)>n))errors.push(`Места 1–${n} без повторов.`);
 const count=(r:Role)=>g.players.filter(p=>p.role===r).length;
 if(count('civilian')!==n-4||count('sheriff')!==1||count('mafia')!==2||count('don')!==1)errors.push(`Роли: ${n-4} мирных, 1 шериф, 2 мафии, 1 дон.`);
 if(!['normal','technical','cancelled'].includes(g.type)||((g.type==='normal'||g.type==='technical')&&!['red','black'].includes(g.winner||''))||(g.type==='cancelled'&&g.winner!==null))errors.push('Выберите корректный результат.');
 if(typeof g.voided!=='boolean'||g.players.some(p=>!Number.isInteger(p.fouls)||Number(p.fouls)<0||Number(p.fouls)>20||typeof p.removed!=='boolean'))errors.push('Проверьте фолы и удаления.');
 return errors;
}
export function eligibility(g:Game){
 if(g.legacy)return 'Архив: только описательная статистика';
 if(g.voided)return 'Запись отменена';
 if(structureErrors(g).length)return 'Некорректная партия: исключена из Skill';
 if(g.type!=='normal')return g.type==='technical'?'Технический результат':'Партия без результата';
 if(g.players.some(p=>p.removed))return 'Удаление: исключено из Skill';
 if(formatOf(g)==='short9')return 'Short 9: без основного Skill';
 return '';
}
export function validateDetails(g:Game){
 const d=g.details,errors:string[]=[];if(d===undefined)return errors;
 if(!d||typeof d!=='object'||Array.isArray(d))return ['Некорректные подробности.'];
 if(Object.keys(d).some(k=>!['firstNight','checks'].includes(k)))errors.push('Неизвестный тип события.');
 const ids=new Set(g.players.map(p=>p.playerId));
 if(d.firstNight){const f=d.firstNight;
  if(!['killed','miss','unknown','not_reached','no_shot_by_rules'].includes(f.status)||(formatOf(g)==='short9'&&f.status!=='no_shot_by_rules')||(formatOf(g)==='classic10'&&f.status==='no_shot_by_rules')||(f.status==='killed'?!ids.has(f.targetPlayerId||''):f.targetPlayerId!==undefined))errors.push('Проверьте первую ночь.');
 }
 if(d.checks!==undefined){if(!Array.isArray(d.checks)||d.checks.length>100)return [...errors,'Слишком много проверок.'];
 const seen=new Set<string>(),rounds=new Set<string>();
 for(const c of d.checks){if(!c||typeof c.id!=='string'||!c.id||seen.has(c.id)||!['sheriff_check','don_check'].includes(c.kind)||!ids.has(c.targetPlayerId)||c.source!=='manual'||c.confidence!==1||c.verifiedByAdmin!==true||(c.round!==undefined&&(!Number.isInteger(c.round)||c.round<1||c.round>30))){errors.push('Некорректная проверка.');continue;}seen.add(c.id);
 const actor=g.players.find(p=>p.role===(c.kind==='sheriff_check'?'sheriff':'don')),target=g.players.find(p=>p.playerId===c.targetPlayerId)!;
 const expected=c.kind==='sheriff_check'?side(target.role):(target.role==='sheriff'?'sheriff':'not_sheriff');
 if(c.targetPlayerId===actor?.playerId||c.result!==expected)errors.push('Результат проверки не соответствует роли.');
 if(c.round!==undefined){const key=c.kind+':'+c.round;if(rounds.has(key))errors.push('Уже есть проверка этой роли в эту ночь.');rounds.add(key);}
 }
 }
 return errors;
}
export function validateGame(g:Game,s:State){
 const errors:string[]=[];const session=s.sessions.find(x=>x.id===g.sessionId);
 if(!session||session.legacy)errors.push('Выберите игровой вечер.');
 if(!Number.isInteger(g.number)||g.number<1)errors.push('Номер партии должен быть положительным целым числом.');
 if(s.games.some(x=>x.id!==g.id&&!x.voided&&x.sessionId===g.sessionId&&x.number===g.number)&&!g.voided)errors.push('Партия с таким номером уже существует в этом вечере.');
 errors.push(...structureErrors(g),...validateDetails(g));
 if(g.players.some(x=>!s.players.some(p=>p.id===x.playerId)))errors.push('Выберите игрока на каждом месте.');
 if(g.players.some(x=>!session?.attendees.includes(x.playerId)))errors.push('Все игроки должны быть в составе вечера.');
 if((g.type!=='normal'||g.players.some(p=>p.removed)||g.voided)&&!g.reason.trim())errors.push('Укажите причину необычного результата или отмены.');
 if(g.players.some(p=>!Number.isInteger(p.fouls)||Number(p.fouls)<0||Number(p.fouls)>20||typeof p.removed!=='boolean'))errors.push('Проверьте фолы и удаления.');
 return errors;
}
export const orderedGames=(s:State)=>{
 const sessions=new Map(s.sessions.map(n=>[n.id,n]));
 return s.games.filter(g=>!g.voided&&!sessions.get(g.sessionId)?.deleted).sort((a,b)=>{
 const sa=sessions.get(a.sessionId),sb=sessions.get(b.sessionId);
 return (sa?.date||'').localeCompare(sb?.date||'')||a.sessionId.localeCompare(b.sessionId)||a.number-b.number||a.id.localeCompare(b.id);
 });
};
// Joint Gaussian approximation to a regularized team logistic model.
// Full covariance retains uncertainty shared by repeated teammates.
export function rate(s:State,seasonId?:string,historyPlayerId?:string|null){
 const ids=s.players.map(p=>p.id);const seasons=s.seasons.filter(p=>p.id!=='legacy').map(p=>p.id);
 const keys=[...ids,...seasons.map(x=>'@'+x)],N=keys.length;const idx=new Map(keys.map((x,i)=>[x,i]));
 const mean:number[]=Array(N).fill(0),C:number[][]=Array.from({length:N},(_,i)=>Array.from({length:N},(_,j)=>i===j?(i<ids.length?1:.64):0));
 const counts:Record<string,number>=Object.create(null),history:Record<string,{gameId:string;rating:number;sd:number}[]>=Object.create(null);let predictions:{gameId:string;p:number;y:number}[]=[];
 const sessionsById=new Map(s.sessions.map(n=>[n.id,n]));
 for(const g of orderedGames(s)){
  const session=sessionsById.get(g.sessionId)!;
  if(!session||!s.seasons.some(n=>n.id===session.seasonId)||g.players.some(p=>!idx.has(p.playerId))||eligibility(g)||!g.eligible||(seasonId&&session.seasonId!==seasonId))continue;
  const x=Array(N).fill(0);x[idx.get('@'+session.seasonId)!]=1;
  for(const p of g.players)x[idx.get(p.playerId)!]=side(p.role)==='black'?1/3:-1/7;
  const z=x.reduce((v,a,i)=>v+a*mean[i],0),cx=C.map(row=>row.reduce((v,a,i)=>v+a*x[i],0));
  const v=x.reduce((a,b,i)=>a+b*cx[i],0),p=sigmoid(z),h=p*(1-p),den=1+h*v,y=g.winner==='black'?1:0;
  predictions.push({gameId:g.id,p:sigmoid(z/Math.sqrt(1+Math.PI*v/8)),y});
  for(let i=0;i<N;i++)mean[i]+=cx[i]*(y-p)/den;
  for(let i=0;i<N;i++)for(let j=0;j<N;j++)C[i][j]-=h*cx[i]*cx[j]/den;
  for(const q of g.players)counts[q.playerId]=(counts[q.playerId]||0)+1;
  // Each eligible league game updates the joint posterior, including absent players.
  if(historyPlayerId!==null)for(const id of (historyPlayerId?[historyPlayerId]:ids)){const i=idx.get(id);if(i!==undefined)(history[id]??=[]).push({gameId:g.id,rating:1000+100*mean[i],sd:100*Math.sqrt(Math.max(C[i][i],0))});}

 }
 const players=Object.fromEntries(ids.map((id,i)=>{const n=counts[id]||0,sd=100*Math.sqrt(Math.max(C[i][i],0)),rating=1000+100*mean[i];return[id,{rating,sd,low:rating-1.96*sd,high:rating+1.96*sd,n,provisional:n<20||sd>75,history:history[id]||[]}]}));
 return {players,predictions,baseline:Object.fromEntries(seasons.map(id=>[id,sigmoid(mean[idx.get('@'+id)!])]))};
}
export function stats(s:State,playerId:string,seasonId?:string,form=false,format:FormatFilter='all'){
 let games=orderedGames(s).filter(g=>(format==='all'||formatOf(g)===format)&&g.winner&&g.type!=='cancelled'&&g.players.some(p=>p.playerId===playerId)&&(!seasonId||s.sessions.find(x=>x.id===g.sessionId)?.seasonId===seasonId));
 if(form)games=games.filter(g=>g.type==='normal'&&!g.players.some(p=>p.removed)&&!structureErrors(g).length).slice(-10);
 const entries=games.map(g=>({g,p:g.players.find(p=>p.playerId===playerId)!}));
 const summarize=(items:typeof entries)=>{const n=items.length,w=items.filter(({g,p})=>g.winner===playerSide(p)).length;return {n,w,wr:n?w/n:null};};
 const overall=summarize(entries);let streak=0;for(const {g,p} of [...entries].reverse()){if(g.winner===playerSide(p))streak++;else break;}
 return {...overall,unknownRoles:entries.filter(e=>e.p.roleConflict).length,technical:games.filter(g=>g.type==='technical').length,streak,roles:Object.fromEntries(Object.keys(roleNames).map(r=>[r,summarize(entries.filter(e=>e.p.role===r&&!e.p.roleConflict))])),sides:Object.fromEntries(['red','black'].map(r=>[r,summarize(entries.filter(e=>playerSide(e.p)===r))])),recent:entries.slice(-10).map(({g,p})=>g.winner===playerSide(p)),games};
}
