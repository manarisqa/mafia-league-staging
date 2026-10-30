// Device-only observed protocol. No network, credentials, Core writes, or AI decisions.
import { z } from 'zod';
import { MODEL, RULES, SHORT_RULES, type Game, type State, type Role } from './model';
export const SCHEMA = 'mafia-league-referee-protocol-v1';
export const REGULATION = 'mafia-league-game-regulations-v1-2026-10-18';
// Explicit owner-approved edition for newly created release protocols; no date-based migration.
export const CURRENT_REGULATION = 'mafia-league-game-regulations-v1.1-owner-2026-10-29';
export const EFFECTIVE = '2026-10-18T22:00:00Z';
export const MAX_BYTES = 2_000_000;
const text = (max = 500) => z.string().max(max).regex(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/, 'Недопустимые символы в тексте');
const seatNo = z.number().int().min(1).max(10), role = z.enum(['civilian','sheriff','mafia','don']);
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const stamp = z.string().datetime({offset:true});
const initialSeat = z.object({number:seatNo,localNickname:text(64).min(1),optionalPublicPlayerId:id.optional(),role:role.nullable()}).strict();
const commandSchemas = [
 z.object({type:z.literal('seat_assigned'),seat:seatNo,name:text(64).min(1),playerId:id.optional()}).strict(),
 z.object({type:z.literal('role_recorded'),seat:seatNo,role:role.nullable()}).strict(),
 z.object({type:z.literal('role_confirmed'),seat:seatNo,role:role.nullable(),reason:text().min(1)}).strict(),
 z.object({type:z.literal('seat_name_corrected'),seat:seatNo,name:text(64).min(1),reason:text().min(1)}).strict(),
 z.object({type:z.literal('phase_started'),next:z.enum(['night','day'])}).strict(),
 z.object({type:z.literal('speech_started'),seat:seatNo}).strict(),
 z.object({type:z.literal('nomination_accepted'),actor:seatNo,target:seatNo,correctionReason:text().optional()}).strict(),
 z.object({type:z.literal('vote_started')}).strict(),
 z.object({type:z.literal('votes_counted'),counts:z.array(z.number().int().min(0).max(10)).max(10),source:z.literal('referee_count_only')}).strict(),
 z.object({type:z.literal('vote_stage_closed')}).strict(),
 z.object({type:z.literal('tie_defense'),seat:seatNo}).strict(),
 z.object({type:z.literal('joint_exit_yes_vote'),yes:z.number().int().min(0).max(10)}).strict(),
 z.object({type:z.literal('day_result')}).strict(),
 z.object({type:z.literal('ordinary_foul'),seat:seatNo}).strict(),
 z.object({type:z.literal('technical_warning_manual'),seat:seatNo,reason:text().min(1)}).strict(),
 z.object({type:z.literal('removed'),seat:seatNo,reason:text().min(1)}).strict(),
 z.object({type:z.literal('shot_observation'),mode:z.enum(['target','miss','unknown','independent']),target:seatNo.optional(),shots:z.array(z.object({actor:seatNo,target:seatNo.nullable()}).strict()).max(3).optional()}).strict(),
 z.object({type:z.literal('role_check'),kind:z.enum(['don','sheriff']),target:seatNo.nullable(),result:z.enum(['red','black','sheriff','not_sheriff','unknown','absent']),seconds:z.number().min(0).max(20).optional()}).strict(),
 z.object({type:z.literal('night_result'),unobservedConfirmed:z.boolean()}).strict(),
 z.object({type:z.literal('best_move'),trio:z.array(seatNo).length(3),seconds:z.number().min(0).max(20).optional()}).strict(),
 z.object({type:z.literal('episode_disputed'),note:text(2000).min(1)}).strict(),
 z.object({type:z.literal('game_finished'),outcome:z.enum(['normal','technical','draw','cancelled']),winner:z.enum(['red','black']).nullable(),basis:text(1000).min(1),confidence:z.enum(['observed','uncertain'])}).strict(),
 z.object({type:z.literal('observation_undone'),target:id,reason:text().min(1)}).strict(),
 z.object({type:z.literal('observation_redone'),target:id,reason:text().min(1)}).strict(),
] as const;
export const CommandSchema = z.discriminatedUnion('type',commandSchemas);
export type Command = z.infer<typeof CommandSchema>;
const EventSchema = z.object({id,sequence:z.number().int().positive(),observedAt:stamp,phase:text(30),source:z.literal('referee_manual'),command:CommandSchema}).strict();
export type RefEvent = z.infer<typeof EventSchema>;
const DraftSchema = z.object({schema:z.literal(SCHEMA),draftId:id,clientRevision:z.number().int().nonnegative(),gameStartAt:stamp,timezone:text(80).min(1).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Неизвестный часовой пояс'),normativeRegulationId:z.enum([REGULATION,CURRENT_REGULATION,'pre-effective-rules-unconfirmed']),drawCountingVersion:z.literal('shoot-capable-v1').optional(),format:z.enum(['classic10','short9']),title:text(100).min(1),host:z.object({localNickname:text(64).min(1),optionalPublicPlayerId:id.optional()}).strict().optional(),seats:z.array(initialSeat).min(9).max(10),events:z.array(EventSchema).max(2000),status:z.enum(['draft','completed_unapproved'])}).strict();
export type Draft = z.infer<typeof DraftSchema>;
export type LiveSeat = z.infer<typeof initialSeat> & {alive:boolean;fouls:number;technical:number;removed:boolean;debt:boolean;speechDay:number;speechSeconds:number};
export type Vote = {candidates:number[];counts:number[];stage:number;status:'open'|'defense'|'joint'|'ready'|'announced'|'cancelled';defended:number[];exits:number[];allJoint:boolean};
export type Table = {shootCapableDraw?:boolean;short9v11?:boolean;seats:LiveSeat[];phase:'setup'|'night'|'day';round:number;nominations:{actor:number;target:number}[];vote:Vote|null;skipDay:number|null;shot:{mode:'target'|'miss'|'unknown';target?:number}|null;checks:Extract<Command,{type:'role_check'}>[];nightResolved:boolean;nightStartAlive:number;quietNights:number;quietCycle:boolean;bestEligible:number|null;bestTrio:number[]|null;result:Extract<Command,{type:'game_finished'}>|null;forcedDraw:boolean;gaps:string[];message:string};
function need(ok:unknown, message:string):asserts ok {if(!ok)throw Error(message);}
export const activeSeats = (s:Table) => s.seats.filter(p=>p.alive);
export function roleErrors(seats:{role:Role|null}[],n=seats.length){if(seats.some(p=>p.role===null))return ['Не все роли известны.'];return (['civilian','sheriff','mafia','don'] as const).some((r,i)=>seats.filter(p=>p.role===r).length!==[n-4,1,2,1][i])?['Неверный состав ролей.']:[];}
export function suggestedResult(s:Table):'red'|'black'|'draw'|null {
 if(s.forcedDraw)return 'draw';if(roleErrors(s.seats).length)return null;
 const a=activeSeats(s),black=a.filter(p=>p.role==='mafia'||p.role==='don').length;
 return a.length===0?null:black===0?'red':black>=a.length-black?'black':null;
}
export const shotRequired = (s:Table) => s.round > (s.short9v11 ? 1 : 0);
const normalizedName = (name:string) => name.trim().normalize('NFKC').toLocaleLowerCase();
function assertHost(d:Draft,seats:{localNickname:string;optionalPublicPlayerId?:string}[]){
 if(d.normativeRegulationId!==CURRENT_REGULATION)return;
 need(d.host?.localNickname.trim(),'Укажите отдельного неиграющего ведущего.');
 need(!seats.some(p=>normalizedName(p.localNickname)===normalizedName(d.host!.localNickname)||!!d.host!.optionalPublicPlayerId&&p.optionalPublicPlayerId===d.host!.optionalPublicPlayerId),'Ведущий не может занимать игровое место в этой партии.');
}
function base(d:Draft):Table{return {...(d.drawCountingVersion==='shoot-capable-v1'?{shootCapableDraw:true}:{}),...(d.format==='short9'&&d.normativeRegulationId===CURRENT_REGULATION?{short9v11:true}:{}),seats:d.seats.map(p=>({...p,alive:true,fouls:0,technical:0,removed:false,debt:false,speechDay:0,speechSeconds:60})),phase:'setup',round:0,nominations:[],vote:null,skipDay:null,shot:null,checks:[],nightResolved:false,nightStartAlive:d.seats.length,quietNights:0,quietCycle:true,bestEligible:null,bestTrio:null,result:null,forcedDraw:false,gaps:[],message:''};}
function eliminate(s:Table,nums:number[],discipline=false){for(const n of nums){const p=s.seats[n-1];if(p.alive){p.alive=false;if(discipline)p.removed=true;}}if(nums.length){s.quietNights=0;s.quietCycle=false;}}
function removal(s:Table,n:number){eliminate(s,[n],true);if(s.phase==='day'&&s.vote?.status!=='announced'){s.vote={candidates:[],counts:[],stage:0,status:'cancelled',defended:[],exits:[],allJoint:false};s.skipDay=null;s.message='Удаление без последнего слова. Голосование текущего дня отменено. Проверьте итог.';}else{s.skipDay=s.phase==='night'?s.round+1:s.round+1;s.message='Удаление без последнего слова. Голосование ближайшего дня отменяется. Проверьте итог.';}}
function apply(s:Table,c:Command,d:Draft){
 s.message='';
 const get=(n:number,alive=false)=>{need(n<=s.seats.length,'Такого места нет.');const p=s.seats[n-1];need(!alive||p.alive,'Игрок уже выбыл.');return p;};
 if(c.type==='role_confirmed'){
  get(c.seat).role=c.role;need((['civilian','sheriff','mafia','don'] as const).every((r,i)=>s.seats.filter(p=>p.role===r).length<=[s.seats.length-4,1,2,1][i]),'Роль уже распределена полностью. Сначала снимите ошибочную роль с другого места.');
  if(s.phase!=='setup')s.gaps.push('Роль места '+c.seat+' уточнена позднее: '+c.reason+'. Ранние неизвестные наблюдения не дополнены задним числом.');s.message='Роль уточнена с сохранением первоначальной записи.';return;
 }
 if(c.type==='seat_name_corrected'){
  need(!s.seats.some(p=>p.number!==c.seat&&p.localNickname.trim().toLocaleLowerCase()===c.name.trim().toLocaleLowerCase()),'Имя уже используется.');get(c.seat).localNickname=c.name;assertHost(d,s.seats);s.message='Имя исправлено; место и история сохранены.';return;
 }
 if(c.type==='episode_disputed'){s.gaps.push(c.note);s.message='Примечание сохранено.';return;}
 need(!s.result,'Партия завершена. Сначала отмените завершение с причиной.');
 if(!['game_finished','best_move','seat_assigned','role_recorded'].includes(c.type))need(!suggestedResult(s),'Есть условия завершения: сначала проверьте и завершите партию.');
 switch(c.type){
 case 'seat_assigned':need(s.phase==='setup','Состав фиксируется до начала. Для исправления отмените последующие действия.');need(!s.seats.some(p=>p.number!==c.seat&&(p.localNickname.trim().toLocaleLowerCase()===c.name.trim().toLocaleLowerCase()||(c.playerId&&p.optionalPublicPlayerId===c.playerId))),'Этот участник уже за столом.');Object.assign(get(c.seat),{localNickname:c.name,optionalPublicPlayerId:c.playerId});assertHost(d,s.seats);break;
 case 'role_recorded':need(s.phase==='setup','Роли фиксируются до начала. Для исправления отмените последующие действия.');get(c.seat).role=c.role;need((['civilian','sheriff','mafia','don'] as const).every((r,i)=>s.seats.filter(p=>p.role===r).length<=[s.seats.length-4,1,2,1][i]),'Роль уже распределена полностью. Сначала снимите ошибочную роль с другого места.');break;
 case 'phase_started':
  if(c.next==='night'){
   need(s.phase==='setup'||(s.phase==='day'&&['announced','cancelled'].includes(s.vote?.status||'')),'Сначала объявите дневной итог.');
   if(s.phase==='setup'){
    assertHost(d,s.seats);
    need(new Set(s.seats.map(p=>p.localNickname.trim().toLocaleLowerCase())).size===s.seats.length,'Повторяющиеся имена.');
    need(new Set(s.seats.filter(p=>p.optionalPublicPlayerId).map(p=>p.optionalPublicPlayerId)).size===s.seats.filter(p=>p.optionalPublicPlayerId).length,'Повторяющиеся участники.');
    need((['civilian','sheriff','mafia','don'] as const).every((r,i)=>s.seats.filter(p=>p.role===r).length<=[s.seats.length-4,1,2,1][i]),'Неверный состав ролей.');
   }
   s.quietCycle=true;s.phase='night';s.shot=null;s.checks=[];s.nightResolved=false;s.nightStartAlive=activeSeats(s).length;s.bestEligible=null;s.bestTrio=null;
  }else{
   need(s.phase==='night'&&s.nightResolved,'Сначала завершите ночные действия.');need(s.shot?.mode!=='unknown','Неустановленный отстрел: завершите без результата (§15.4).');s.phase='day';s.round++;s.nominations=[];s.vote=s.skipDay===s.round?{candidates:[],counts:[],stage:0,status:'cancelled',defended:[],exits:[],allJoint:false}:null;if(s.skipDay===s.round)s.skipDay=null;
  }break;
 case 'speech_started':{
  need(s.phase==='day'&&(!s.vote||s.vote.status==='cancelled'),'Основные речи идут до голосования; отмена голосования речи сохраняет.');const p=get(c.seat,true);need(p.speechDay!==s.round,'Речь уже отмечена в этом дне.');p.speechSeconds=p.debt?([3,4].includes(activeSeats(s).length)?30:0):60;p.debt=false;p.speechDay=s.round;s.message=`Место ${c.seat}: ${p.speechSeconds?String(p.speechSeconds)+' секунд':'пропуск ближайшей речи'}.`;break;}
 case 'nomination_accepted':
  need(s.phase==='day'&&!s.vote,'Выставления закрыты. Позднюю коррекцию оформите отменой стадии с причиной.');get(c.actor,true);get(c.target,true);
  need(!s.nominations.some(n=>n.target===c.target),'Кандидат уже выставлен.');need(!s.nominations.some(n=>n.actor===c.actor),'Одно выставление от говорящего.');s.nominations.push({actor:c.actor,target:c.target});break;
 case 'vote_started':{
  need(s.phase==='day'&&!s.vote,'Голосование уже начато или отменено.');const candidates=s.nominations.map(n=>n.target);
  const ready=candidates.length===0||(s.round===1&&candidates.length===1)||candidates.length===1;
  s.vote={candidates,counts:candidates.map(()=>candidates.length===1&&s.round>1?activeSeats(s).length:0),stage:1,status:ready?'ready':'open',defended:[],exits:candidates.length===1&&s.round>1?candidates:[],allJoint:false};break;}
 case 'votes_counted':{
  const v=s.vote;need(s.phase==='day'&&v?.status==='open','Нет открытой стадии голосования.');need(c.counts.length===v.candidates.length,'Счёт для каждой кандидатуры.');need(c.counts.reduce((a,b)=>a+b,0)<=activeSeats(s).length,'Сумма голосов больше числа действующих.');v.counts=[...c.counts];break;}
 case 'vote_stage_closed':{
  const v=s.vote;need(v?.status==='open','Нет открытой стадии.');const n=activeSeats(s).length;v.counts[v.counts.length-1]+=n-v.counts.reduce((a,b)=>a+b,0);
  const max=Math.max(...v.counts),leaders=v.candidates.filter((_,i)=>v.counts[i]===max);
  if(leaders.length===1){v.exits=leaders;v.status='ready';}
  else if(v.stage>1&&leaders.length===v.candidates.length){v.candidates=leaders;v.status='joint';}
  else {v.candidates=leaders;v.counts=leaders.map(()=>0);v.status='defense';v.defended=[];}
  break;}
 case 'tie_defense':{
  const v=s.vote;need(v?.status==='defense'&&v.candidates.includes(c.seat),'Защита только текущих лидеров.');need(!v.defended.includes(c.seat),'Защита уже отмечена.');v.defended.push(c.seat);s.message=`Место ${c.seat}: защита 30 секунд.`;
  if(v.defended.length===v.candidates.length){v.stage++;v.status='open';v.counts=v.candidates.map(()=>0);}break;}
 case 'joint_exit_yes_vote':{
  const v=s.vote;need(v?.status==='joint','Нет вопроса о совместном выходе.');need(c.yes<=activeSeats(s).length,'Слишком много голосов.');v.exits=c.yes>activeSeats(s).length/2?[...v.candidates]:[];v.allJoint=v.exits.length===activeSeats(s).length;v.status='ready';break;}
 case 'day_result':need(s.phase==='day'&&(s.vote?.status==='ready'||s.vote?.status==='cancelled'),'Сначала завершите фактическое голосование.');if(s.vote.status==='ready'){eliminate(s,s.vote.exits);s.forcedDraw=s.vote.allJoint;s.vote.status='announced';}break;
 case 'ordinary_foul':{
  const p=get(c.seat,true);need(p.fouls<4,'Четвёртый фол уже зафиксирован.');p.fouls++;if(p.fouls===3){p.debt=true;s.message='Третий фол: ближайшая ещё не начатая речь пропускается; при 3–4 действующих — 30 секунд. При пропуске речи остаётся до 10 секунд на выставление без доводов.';}if(p.fouls===4)removal(s,c.seat);break;}
 case 'technical_warning_manual':{const p=get(c.seat,true);p.technical++;s.message='Техническое предупреждение: '+c.reason;if(p.technical===2)removal(s,c.seat);break;}
 case 'removed':get(c.seat,true);removal(s,c.seat);break;
 case 'shot_observation':{
  need(s.phase==='night'&&shotRequired(s)&&!s.nightResolved&&!s.shot,'Отстрел недоступен в этой ночи или уже записан.');need(s.checks.length===0,'Отстрел фиксируется до проверок.');
  if(c.mode==='target'){need(c.target!==undefined,'Выберите цель.');get(c.target,true);s.shot={mode:'target',target:c.target};}
  else if(c.mode==='independent'){
   need(!roleErrors(s.seats).length,'Для независимых выстрелов нужны подтверждённые роли.');const black=activeSeats(s).filter(p=>p.role==='mafia'||p.role==='don');const shots=c.shots||[];
   need(shots.length===black.length&&new Set(shots.map(x=>x.actor)).size===black.length&&shots.every(x=>black.some(p=>p.number===x.actor)),'Нужны наблюдения каждого действующего чёрного.');
   const target=shots[0]?.target;const hit=target!==null&&target!==undefined&&target<=s.seats.length&&shots.every(x=>x.target===target)&&get(target).alive;s.shot=hit?{mode:'target',target:target!}:{mode:'miss'};
  }else s.shot={mode:c.mode};break;}
 case 'role_check':{
  need(s.phase==='night'&&!s.nightResolved&&(s.round>0||d.format==='short9'),'Classic10 N0 без проверок.');need(!shotRequired(s)||!!s.shot,'Сначала зафиксируйте отстрел.');need(!s.checks.some(x=>x.kind===c.kind),'Проверка уже записана.');need(c.kind!=='sheriff'||s.checks.some(x=>x.kind==='don'),'Сначала вызов Дона.');
  const actor=s.seats.find(p=>p.role===c.kind);if(c.target===null){need(c.result==='absent'||c.result==='unknown','Нет цели — нет результата.');}else{
   const target=get(c.target,true);need(!actor||actor.alive,'Проверяющий удалён/выбыл.');need(actor?.number!==c.target,'Себя проверять нельзя.');need(['unknown',...(c.kind==='don'?['sheriff','not_sheriff']:['red','black'])].includes(c.result),'Ответ не соответствует виду проверки.');
   if(target.role&&c.result!=='unknown'){const expected=c.kind==='don'?(target.role==='sheriff'?'sheriff':'not_sheriff'):(target.role==='mafia'||target.role==='don'?'black':'red');if(c.result!==expected)s.gaps.push('Наблюдавшийся ответ проверки расходится с ролью: '+c.target);}
  }s.checks.push(c);break;}
 case 'night_result':{
  need(s.phase==='night'&&!s.nightResolved,'Ночь уже завершена.');const checksRequired=s.round>0||d.format==='short9';need(!checksRequired||s.checks.length===2||c.unobservedConfirmed,'Отметьте оба вызова или явно подтвердите пробел наблюдения.');need(!shotRequired(s)||!!s.shot,'Отметьте цель, промах или неизвестный отстрел.');
  if(checksRequired&&s.checks.length!==2)s.gaps.push(`N${s.round}: проверки наблюдались не полностью.`);
  if(s.shot?.mode==='unknown')s.gaps.push(`N${s.round}: результат отстрела не установлен. Продолжение без достоверного результата недопустимо (§15.4).`);
  const target=s.shot?.mode==='target'?s.shot.target:undefined;
  if(target&&get(target).alive){eliminate(s,[target]);if(!s.short9v11&&s.round===1&&s.nightStartAlive>=s.seats.length-1&&!suggestedResult(s))s.bestEligible=target;}
  if(s.shootCapableDraw?shotRequired(s):s.round>0){if(s.quietCycle)s.quietNights++;else s.quietNights=0;s.quietCycle=true;if(s.quietNights>=3)s.forcedDraw=true;}
  s.nightResolved=true;break;}
 case 'best_move':need(!s.short9v11,'В Short9 v1.1 лучший ход не предоставляется.');need(s.phase==='night'&&s.nightResolved&&s.bestEligible!==null&&!s.bestTrio,'Лучший ход только после проверок N1 при соблюдении §11.3.');need(new Set(c.trio).size===3&&!c.trio.includes(s.bestEligible)&&c.trio.every(n=>n<=s.seats.length),'Три разных места, кроме убитого.');s.bestTrio=c.trio;break;
 case 'game_finished':{
  need(s.phase!=='setup','Сначала начните партию.');need((c.outcome==='normal'||c.outcome==='technical')?c.winner!==null:c.winner===null,'Проверьте тип и победителя.');
  const expected=suggestedResult(s);if(c.outcome==='normal'&&expected)need(c.winner===expected,'Исход расходится с фактическим составом.');if(c.outcome==='normal'&&!expected)s.gaps.push('Итог указан вручную: полная последовательность выбытия или роли не подтверждены журналом. Владелец должен проверить.');if(c.outcome==='draw'&&c.confidence==='observed')need(expected==='draw','Ничья требует установленного основания. Отметьте неопределённость и основание.');
  if(s.gaps.some(g=>g.includes('результат отстрела не установлен')))need(c.outcome==='cancelled','При неустановленном отстреле — без результата (§15.4).');s.result=c;break;}
 default:throw Error('Неизвестная команда.');
 }
}
function isCorrection(c:Command){return c.type==='observation_undone'||c.type==='observation_redone';}
export function effectiveEvents(d:Draft){const active:RefEvent[]=[],redo:RefEvent[]=[];for(const e of d.events){const c=e.command;if(c.type==='observation_undone'){need(active.at(-1)?.id===c.target,'Отмена должна ссылаться на последнее действующее событие.');redo.push(active.pop()!);}else if(c.type==='observation_redone'){need(redo.at(-1)?.id===c.target,'Невозможно повторить это событие.');active.push(redo.pop()!);}else{active.push(e);redo.length=0;}}return {active,redo};}
export function derive(d:Draft){const s=base(d);for(const e of effectiveEvents(d).active)apply(s,e.command,d);return s;}
// Entry safeguards apply to new observations only. Historical v1 replay stays exact.
export function meaningfulBasis(value:string){return value.trim().length>=8&&/\p{L}/u.test(value);}
export function append(d:Draft,command:Command):Draft {
 const c=CommandSchema.parse(command),s=derive(d);
 if(c.type==='game_finished')need(meaningfulBasis(c.basis),'Опишите фактическое основание: минимум 8 символов, включая слова. Одного числа недостаточно.');
 if(c.type==='best_move')need(!suggestedResult(s),'После определения исхода лучший ход не предоставляется (§11.3).');
 if(c.type==='vote_stage_closed'){
  const boundary=effectiveEvents(d).active.findLast(e=>['vote_started','tie_defense','vote_stage_closed','votes_counted'].includes(e.command.type));
  need(boundary?.command.type==='votes_counted','Сначала явно запишите счёт каждой кандидатуры, включая ноль.');
 }
 if(!isCorrection(c))apply(s,c,d);
 const e:RefEvent={id:crypto.randomUUID(),sequence:d.events.length+1,observedAt:new Date().toISOString(),phase:s.phase==='setup'?'setup':`${s.phase==='night'?'N':'D'}${s.round}`,source:'referee_manual',command:c};
 const next={...d,clientRevision:d.clientRevision+1,events:[...d.events,e]};const state=derive(next);next.status=state.result?'completed_unapproved':'draft';need(next.events.length<=2000,'Лимит 2000 действий. Экспортируйте протокол.');return next;
}
export function createDraft(format:Draft['format'],title='Партия ведущего',startedAt=new Date().toISOString()):Draft {
 return {schema:SCHEMA,draftId:crypto.randomUUID(),clientRevision:0,gameStartAt:startedAt,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/Vienna',normativeRegulationId:Date.parse(startedAt)>=Date.parse(EFFECTIVE)?REGULATION:'pre-effective-rules-unconfirmed',format,title,seats:Array.from({length:format==='short9'?9:10},(_,i)=>({number:i+1,localNickname:`Игрок ${i+1}`,role:null})),events:[],status:'draft'};
}
// Legacy factory above is retained for exact old-fixture/replay compatibility.
export function createCurrentDraft(format:Draft['format'],title:string,host:NonNullable<Draft['host']>,startedAt=new Date().toISOString()):Draft {
 const d:Draft={...createDraft(format,title,startedAt),normativeRegulationId:CURRENT_REGULATION,drawCountingVersion:'shoot-capable-v1',host};
 validateDraft(d);return d;
}
export function canonical(v:unknown):string {if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).filter(k=>(v as Record<string,unknown>)[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(v);}
export async function checksum(v:unknown){const bytes=new TextEncoder().encode(canonical(v));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function validateDraft(value:unknown):Draft {
 const d=DraftSchema.parse(value),n=d.format==='short9'?9:10;need(d.seats.length===n&&d.seats.every((p,i)=>p.number===i+1),'Места по порядку без повторов.');need(d.clientRevision===d.events.length,'Повреждена ревизия.');need(new Set(d.events.map(e=>e.id)).size===d.events.length,'Повторяющиеся события.');
 assertHost(d,d.seats);
 if(d.normativeRegulationId!==CURRENT_REGULATION)need(d.normativeRegulationId===(Date.parse(d.gameStartAt)>=Date.parse(EFFECTIVE)?REGULATION:'pre-effective-rules-unconfirmed'),'Редакция не соответствует дате старта.');
 let prefix={...d,events:[] as RefEvent[],clientRevision:0,status:'draft' as Draft['status']};for(let i=0;i<d.events.length;i++){const e=d.events[i];need(e.sequence===i+1,'Порядок событий повреждён.');const s=derive(prefix);if(!isCorrection(e.command))apply(s,e.command,prefix);need(e.phase===(s.phase==='setup'?'setup':`${s.phase==='night'?'N':'D'}${s.round}`),'Фаза события повреждена.');prefix={...prefix,events:[...prefix.events,e],clientRevision:i+1};derive(prefix);}
 const final=derive(d);assertHost(d,final.seats);need(new Set(final.seats.map(p=>p.localNickname.trim().toLocaleLowerCase())).size===n,'Повторяющиеся участники.');const ids=final.seats.flatMap(p=>p.optionalPublicPlayerId?[p.optionalPublicPlayerId]:[]);need(new Set(ids).size===ids.length,'Повторяющиеся ID игроков.');need((['civilian','sheriff','mafia','don'] as const).every((r,i)=>final.seats.filter(p=>p.role===r).length<=[n-4,1,2,1][i]),'Неверный состав ролей.');need(d.status===(final.result?'completed_unapproved':'draft'),'Статус не соответствует журналу.');return d;
}
export async function exportProtocol(d:Draft){validateDraft(d);return JSON.stringify({payload:d,sha256:await checksum(d)},null,2);}
export async function importProtocol(raw:string){need(new TextEncoder().encode(raw).length<=MAX_BYTES,'Файл больше 2 МБ.');let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('Некорректный JSON.');}const envelope=z.object({payload:DraftSchema,sha256:z.string().regex(/^[0-9a-f]{64}$/)}).strict().parse(value);need(await checksum(envelope.payload)===envelope.sha256,'Контрольная сумма не совпадает.');return validateDraft(envelope.payload);}
export function reviewSummary(d:Draft,privateRoles=false){const s=derive(d);const reveal=privateRoles||!!s.result;return [`MAFIA LEAGUE · ПРОТОКОЛ ВЕДУЩЕГО`,d.title,`${d.format} · ${d.gameStartAt} · ${d.timezone}`,`Черновик ${d.draftId} · не утверждён владельцем`,`${d.normativeRegulationId}`,`Результат: ${s.result?`${s.result.outcome} / ${s.result.winner||'без победителя'} · ${s.result.basis}`:'не установлен'}`,...s.seats.map(p=>`${p.number}. ${p.localNickname}${reveal?' · '+(p.role||'роль неизвестна'):''} · фолы ${p.fouls} · ${p.removed?'удалён':p.alive?'в игре':'выбыл'}`),...s.gaps.map(g=>'ПРОБЕЛ / СПОР: '+g),...(privateRoles?d.events.map(e=>`${e.sequence} ${e.phase} ${e.observedAt} ${JSON.stringify(e.command)}`):['Подробный журнал и незавершённые роли находятся только в приватном JSON.'])].join('\n');}
// Projection is deliberate: no event/check/best-move enrichment into incompatible Core fields.
export function projectForOwner(d:Draft,state:State,sessionId:string,mapping:Record<number,string>):Game {
 const s=derive(d),r=s.result;need(r,'Сначала завершите локальный протокол.');need(!roleErrors(s.seats).length,'Все роли должны быть проверены.');const night=state.sessions.find(n=>n.id===sessionId);need(night&&!night.deleted&&!night.closed&&!night.legacy,'Выберите открытый вечер.');
 need(s.seats.every(p=>state.players.some(x=>x.id===mapping[p.number])&&night.attendees.includes(mapping[p.number])),'Сопоставьте все места с участниками выбранного вечера.');need(new Set(Object.values(mapping)).size===s.seats.length,'Игроки не должны повторяться.');
 if(d.host)need(!s.seats.some(p=>mapping[p.number]===d.host!.optionalPublicPlayerId||normalizedName(state.players.find(x=>x.id===mapping[p.number])!.name)===normalizedName(d.host!.localNickname)),'Ведущий не может занимать игровое место.');
 return {...(d.host?{refereeHost:{name:d.host.localNickname,...(d.host.optionalPublicPlayerId?{playerId:d.host.optionalPublicPlayerId}:{})}}:{}),id:'referee-'+d.draftId,format:d.format,sessionId,number:Math.max(0,...state.games.filter(g=>g.sessionId===sessionId).map(g=>g.number))+1,winner:r.winner,type:r.outcome==='draw'?'cancelled':r.outcome,reason:`Протокол ${d.draftId}. ${r.outcome==='draw'?'Ничья. ':''}${r.basis}`.slice(0,1500),players:s.seats.map(p=>({seat:p.number,playerId:mapping[p.number],role:p.role!,fouls:p.fouls,removed:p.removed})),eligible:true,eligibilityReason:'',voided:false,modelVersion:MODEL,rulesVersion:d.format==='short9'?SHORT_RULES:RULES,createdAt:'',rev:0};
}
export function possibleDuplicates(d:Draft,state:State,mapping:Record<number,string>){const s=derive(d),ids=Object.values(mapping).sort().join('|'),day=new Date(d.gameStartAt).toLocaleDateString('en-CA',{timeZone:d.timezone});return state.games.filter(g=>g.id==='referee-'+d.draftId||g.reason?.includes(d.draftId)||(g.players.map(p=>p.playerId).sort().join('|')===ids&&g.winner===s.result?.winner&&state.sessions.find(n=>n.id===g.sessionId)?.date===day));}
