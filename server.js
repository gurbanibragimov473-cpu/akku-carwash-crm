require('dotenv').config();
const express=require('express'),crypto=require('node:crypto'),path=require('node:path');
const {createClient}=require('@supabase/supabase-js');
const app=express();app.use(express.json({limit:'100kb'}));
const sessions=new Map(),SESSION_MS=12*60*60*1000;
const cookieToken=req=>{const pair=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('akku_session='));return pair?decodeURIComponent(pair.split('=').slice(1).join('=')):'';};
app.use('/api',(req,res,next)=>{
 if(['/login','/session','/telegram/webhook','/bookings'].includes(req.path))return next();
 if(!process.env.STAFF_PASSWORD)return res.status(503).json({error:'Администраторский пароль STAFF_PASSWORD не настроен.'});
 const token=cookieToken(req),expiry=sessions.get(token);
 if(!expiry||expiry<Date.now()){if(token)sessions.delete(token);return res.status(401).json({error:'Требуется вход сотрудника.'});}
 next();
});
app.use(express.static(path.join(__dirname,'public')));
const db=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null;
const bookingRate=new Map();
app.post('/api/bookings',async(req,res)=>{
 const ip=req.ip||'unknown',now=Date.now(),hits=(bookingRate.get(ip)||[]).filter(t=>now-t<60000);
 if(hits.length>=4)return res.status(429).json({error:'Слишком много попыток. Попробуйте позже.'});
 bookingRate.set(ip,[...hits,now]);
 if(!db)return res.status(503).json({error:'Онлайн-запись временно недоступна.'});
 const {name='',phone='',plate='',vehicle='',service='Комплексная мойка',scheduled_for}=req.body||{},date=new Date(scheduled_for);
 if(!name.trim()||!phone.trim()||!plate.trim()||!Number.isFinite(date.getTime())||date<Date.now()+1800000||date>Date.now()+30*86400000)
  return res.status(400).json({error:'Укажите имя, телефон, госномер и время записи за 30 минут — 30 дней.'});
 const busy=await db.from('wash_orders').select('id').eq('status','booked').eq('voided',false).gte('scheduled_for',new Date(date.getTime()-3600000).toISOString()).lte('scheduled_for',new Date(date.getTime()+3600000).toISOString()).limit(1);
 if(busy.error)return res.status(500).json({error:busy.error.message});
 if(busy.data?.length)return res.status(409).json({error:'Это время уже занято. Выберите другое.'});
 const {data:c,error:ce}=await db.from('customers').upsert({name:name.trim(),phone:phone.trim()},{onConflict:'phone'}).select().single();
 if(ce)return res.status(400).json({error:ce.message});
 const code=c.telegram_chat_id?null:(c.link_code||crypto.randomBytes(12).toString('hex'));
 await db.from('customers').update({link_code:code}).eq('id',c.id);
 const {data:o,error}=await db.from('wash_orders').insert({customer_id:c.id,plate:plate.trim().toUpperCase(),vehicle:vehicle.trim(),service:service.trim(),price:0,status:'booked',scheduled_for:date.toISOString()}).select('id,scheduled_for').single();
 if(error)return res.status(500).json({error:error.message});
 res.status(201).json({order:o,telegramLink:code&&process.env.TELEGRAM_BOT_USERNAME?'https://t.me/'+process.env.TELEGRAM_BOT_USERNAME+'?start='+code:null});
});
const stages={booked:'Автомобиль записан',arrived:'Автомобиль заехал',washing:'Идёт мойка',drying:'Сушка',ready:'Автомобиль готов',closed:'Автомобиль выдан'};
app.get('/api/session',(req,res)=>{const t=cookieToken(req);res.json({configured:Boolean(process.env.STAFF_PASSWORD),authenticated:Boolean(t&&sessions.get(t)>Date.now())});});
app.post('/api/login',(req,res)=>{
 const expected=process.env.STAFF_PASSWORD||'',provided=String(req.body?.password||''),a=Buffer.from(expected),b=Buffer.from(provided);
 if(!expected||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:expected?'Неверный пароль.':'Задайте STAFF_PASSWORD на сервере.'});
 const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+SESSION_MS);
 const secure=process.env.NODE_ENV==='production'?'; Secure':'';
 res.setHeader('Set-Cookie','akku_session='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200'+secure);res.json({ok:true});
});
app.post('/api/logout',(req,res)=>{sessions.delete(cookieToken(req));res.setHeader('Set-Cookie','akku_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.json({ok:true});});const guard=(req,res,next)=>db?next():res.status(503).json({error:'Добавьте переменные Supabase на сервер.'});
function normalizePhone(value=''){let d=String(value).replace(/\D/g,'');if(d.length===11&&d[0]==='8')d='7'+d.slice(1);if(d.length===10)d='7'+d;return d;}
async function telegram(method,payload){
 if(!process.env.TELEGRAM_BOT_TOKEN)return null;
 const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 const body=await response.json().catch(()=>({}));
 if(!response.ok||!body.ok){console.error('Telegram API error:',body.description||response.statusText);return null;}
 return body.result;
}
async function replaceStatusMessage(order,text){
 if(!order?.customers?.telegram_chat_id)return;
 const chatId=order.customers.telegram_chat_id;
 const sent=await telegram('sendMessage',{chat_id:chatId,text});
 if(!sent?.message_id)return;
 if(order.telegram_message_id){
  const deleted=await telegram('deleteMessage',{chat_id:chatId,message_id:order.telegram_message_id});
  if(!deleted){
   const edited=await telegram('editMessageText',{chat_id:chatId,message_id:order.telegram_message_id,text});
   if(edited){await telegram('deleteMessage',{chat_id:chatId,message_id:sent.message_id});return;}
  }
 }
 await db.from('wash_orders').update({telegram_message_id:sent.message_id}).eq('id',order.id);
}
app.get('/api/orders',guard,async(req,res)=>{
 const {data,error}=await db.from('wash_orders').select('*, customers(name,phone,telegram_chat_id)').eq('voided',false).neq('status','closed').order('created_at',{ascending:false});
 if(error)return res.status(500).json({error:error.message});res.json(data);
});
app.get('/api/orders/archive',guard,async(req,res)=>{
 const {data,error}=await db.from('wash_orders').select('*, customers(name,phone,telegram_chat_id)').or('status.eq.closed,voided.eq.true').order('updated_at',{ascending:false});
 if(error)return res.status(500).json({error:error.message});res.json(data);
});
app.get('/api/summary',guard,async(req,res)=>{
 const {data,error}=await db.from('wash_orders').select('id,status,price,created_at,updated_at,voided');
 if(error)return res.status(500).json({error:error.message});
 const today=new Date();today.setHours(0,0,0,0);const rows=data||[];
 res.json({active:rows.filter(x=>x.status!=='closed'&&x.status!=='booked'&&!x.voided).length,ready:rows.filter(x=>x.status==='ready'&&!x.voided).length,todayRevenue:rows.filter(x=>x.status==='closed'&&new Date(x.updated_at||x.created_at)>=today).reduce((n,x)=>n+Number(x.price||0),0)});
});
app.post('/api/orders',guard,async(req,res)=>{
 const {name='',phone,plate,vehicle='',service='Комплексная мойка',price=0}=req.body||{};
 if(!phone?.trim()||!plate?.trim())return res.status(400).json({error:'Укажите телефон клиента и госномер автомобиля.'});
 const {data:customer,error:ce}=await db.from('customers').upsert({name:name.trim(),phone:phone.trim()},{onConflict:'phone'}).select().single();
 if(ce)return res.status(500).json({error:ce.message});
 const code=customer.telegram_chat_id?null:(customer.link_code||crypto.randomBytes(12).toString('hex'));
 const {error:le}=await db.from('customers').update({link_code:code}).eq('id',customer.id);
 if(le)return res.status(500).json({error:le.message});
 const {data:order,error}=await db.from('wash_orders').insert({customer_id:customer.id,plate:plate.trim().toUpperCase(),vehicle:vehicle.trim(),service,price:Math.max(0,Number(price)||0)}).select('*, customers(name,phone,telegram_chat_id)').single();
 if(error)return res.status(500).json({error:error.message});
 if(customer.telegram_chat_id)await replaceStatusMessage(order,'🚗 '+order.plate+' — '+stages.arrived+'. Мы пришлём обновление о готовности.');
 if(code&&process.env.TELEGRAM_BOT_USERNAME)order.telegramLink='https://t.me/'+process.env.TELEGRAM_BOT_USERNAME+'?start='+code;
 res.status(201).json(order);
});
app.patch('/api/orders/:id',guard,async(req,res)=>{
 const {name='',phone,plate,vehicle='',service='Комплексная мойка',price=0}=req.body||{};
 if(!phone?.trim()||!plate?.trim())return res.status(400).json({error:'Укажите телефон клиента и госномер автомобиля.'});
 const {data:old,error:findError}=await db.from('wash_orders').select('id,customer_id,telegram_message_id,customers(name,phone,telegram_chat_id)').eq('id',req.params.id).single();
 if(findError)return res.status(404).json({error:'Заказ не найден.'});
 const phoneChanged=normalizePhone(old.customers.phone)!==normalizePhone(phone.trim());
 if(phoneChanged&&old.customers.telegram_chat_id){
  const {data:customerOrders}=await db.from('wash_orders').select('id,telegram_message_id').eq('customer_id',old.customer_id);
  for(const item of customerOrders||[])if(item.telegram_message_id)await telegram('deleteMessage',{chat_id:old.customers.telegram_chat_id,message_id:item.telegram_message_id});
  await db.from('wash_orders').update({telegram_message_id:null}).eq('customer_id',old.customer_id);
 }
 const update={name:name.trim(),phone:phone.trim()};
 if(phoneChanged){update.telegram_chat_id=null;update.telegram_pending_chat_id=null;update.link_code=crypto.randomBytes(12).toString('hex');}
 const {error:customerError}=await db.from('customers').update(update).eq('id',old.customer_id);
 if(customerError)return res.status(400).json({error:customerError.message});
 const {data,error}=await db.from('wash_orders').update({plate:plate.trim().toUpperCase(),vehicle:vehicle.trim(),service,price:Math.max(0,Number(price)||0),updated_at:new Date().toISOString()}).eq('id',req.params.id).select('*, customers(name,phone,telegram_chat_id,link_code)').single();
 if(error)return res.status(400).json({error:error.message});
 if(data.customers?.telegram_chat_id)await replaceStatusMessage(data,'🚘 '+data.plate+' — '+stages[data.status]+'.');
 else if(data.customers?.link_code&&process.env.TELEGRAM_BOT_USERNAME)data.telegramLink='https://t.me/'+process.env.TELEGRAM_BOT_USERNAME+'?start='+data.customers.link_code;
 res.json(data);
});app.patch('/api/orders/:id/status',guard,async(req,res)=>{
 const {status}=req.body||{};if(!Object.hasOwn(stages,status)||status==='closed')return res.status(400).json({error:'Недопустимый этап.'});
 const {data,error}=await db.from('wash_orders').update({status,updated_at:new Date().toISOString()}).eq('id',req.params.id).select('*, customers(name,phone,telegram_chat_id)').single();
 if(error)return res.status(500).json({error:error.message});
 await replaceStatusMessage(data,'🚘 '+data.plate+' — '+stages[status]+'.');
 res.json(data);
});
app.post('/api/orders/:id/close',guard,async(req,res)=>{
 const {data,error}=await db.from('wash_orders').update({status:'closed',updated_at:new Date().toISOString()}).eq('id',req.params.id).select('*, customers(name,phone,telegram_chat_id)').single();
 if(error)return res.status(500).json({error:error.message});
 await replaceStatusMessage(data,'✅ '+data.plate+' — автомобиль выдан. Спасибо, что выбрали АККУ!');
 res.json(data);
});
app.post('/api/orders/:id/restore',guard,async(req,res)=>{
 const {data,error}=await db.from('wash_orders').update({status:'arrived',voided:false,updated_at:new Date().toISOString()}).eq('id',req.params.id).select().single();
 if(error)return res.status(500).json({error:error.message});res.json(data);
});
app.delete('/api/orders/:id',guard,async(req,res)=>{
 const {data,error}=await db.from('wash_orders').update({voided:true,updated_at:new Date().toISOString()}).eq('id',req.params.id).select().single();
 if(error)return res.status(500).json({error:error.message});res.json(data);
});
app.post('/api/telegram/webhook',guard,async(req,res)=>{
 if(!process.env.WEBHOOK_SECRET||req.get('x-telegram-bot-api-secret-token')!==process.env.WEBHOOK_SECRET)return res.sendStatus(401);
 const m=req.body?.message,chatId=String(m?.chat?.id||'');if(!m)return res.sendStatus(200);
 const contactPrompt=async text=>telegram('sendMessage',{chat_id:chatId,text,reply_markup:{keyboard:[[{text:'Поделиться номером телефона',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true}});
 const start=m.text?.match(/^\/start(?:\s+([a-f0-9]{24}))?$/i);
 if(start){
  if(start[1]){
   const {data:c}=await db.from('customers').select('id').eq('link_code',start[1]).maybeSingle();
   if(c)await db.from('customers').update({telegram_pending_chat_id:chatId}).eq('id',c.id);
   else{await contactPrompt('Ссылка не найдена или устарела. Можно подтвердить номер телефона, который указали при приёме автомобиля.');return res.sendStatus(200);}
  }
  await contactPrompt('Чтобы получать статусы мойки, подтвердите номер телефона, который указали сотруднику АККУ.');
 }else if(m.contact&&m.contact.user_id===m.from?.id){
  let {data:customer}=await db.from('customers').select('id,phone,telegram_chat_id').eq('telegram_pending_chat_id',chatId).maybeSingle();
  if(!customer){
   const {data:linked}=await db.from('customers').select('id,phone,telegram_chat_id').eq('telegram_chat_id',chatId).maybeSingle();
   if(linked)customer=linked;
   else{
    const {data:candidates}=await db.from('customers').select('id,phone,telegram_chat_id').is('telegram_chat_id',null);
    const matches=(candidates||[]).filter(c=>normalizePhone(c.phone)===normalizePhone(m.contact.phone_number));
    if(matches.length===1)customer=matches[0];
    else if(matches.length>1)return await contactPrompt('Номер найден в нескольких карточках. Попросите сотрудника мойки помочь привязать Telegram.');
   }
  }
  if(!customer)await telegram('sendMessage',{chat_id:chatId,text:'Не нашёл заказ с этим номером. Проверьте, что сотрудник указал ваш номер без ошибки.'});
  else if(normalizePhone(customer.phone)!==normalizePhone(m.contact.phone_number))await telegram('sendMessage',{chat_id:chatId,text:'Номер телефона не совпадает с номером в заказе. Обратитесь к сотруднику АККУ.'});
  else{
   await db.from('customers').update({telegram_chat_id:chatId,telegram_pending_chat_id:null,link_code:null}).eq('id',customer.id);
   await telegram('sendMessage',{chat_id:chatId,text:'✅ Номер подтверждён! Теперь сюда будут приходить сообщения об этапах мойки.',reply_markup:{remove_keyboard:true}});
   const {data:active}=await db.from('wash_orders').select('*, customers(name,phone,telegram_chat_id)').eq('customer_id',customer.id).eq('voided',false).neq('status','closed');
   for(const order of active||[])await replaceStatusMessage(order,'🚘 '+order.plate+' — '+stages[order.status]+'.');
  }
 }else if(/^\/status(@\w+)?$/.test(m.text||'')){
  const {data:c}=await db.from('customers').select('id').eq('telegram_chat_id',chatId).maybeSingle();
  if(!c)await contactPrompt('Сначала поделитесь номером телефона, указанным при оформлении заказа.');
  else{const {data:active}=await db.from('wash_orders').select('plate,status').eq('customer_id',c.id).eq('voided',false).neq('status','closed');const text=active?.length?active.map(o=>'🚘 '+o.plate+' — '+stages[o.status]).join('\n'):'Активных автомобилей сейчас нет.';await telegram('sendMessage',{chat_id:chatId,text});}
 }else if(/^\/start/.test(m.text||''))await contactPrompt('Поделитесь номером телефона, который указали сотруднику АККУ.');
 res.sendStatus(200);
});
app.get('/health',(req,res)=>res.json({ok:true}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Внутренняя ошибка сервера.'});});
app.listen(process.env.PORT||3000,()=>console.log('АККУ CRM ready'));
