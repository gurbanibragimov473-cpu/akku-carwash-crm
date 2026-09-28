const labels={booked:'Записан',arrived:'Заехал',washing:'Идёт мойка',drying:'Сушка',ready:'Готов',closed:'Автомобиль выдан'};
const next={booked:'arrived',arrived:'washing',washing:'drying',drying:'ready'};
const nextText={arrived:'Принять · заехал',washing:'Начать мойку',drying:'На сушку',ready:'Отметить готовым'};
let orders=[],filter='all',view='queue',localMode=location.protocol==='file:',editingId=null;
const $=id=>document.getElementById(id);
$('date-label').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(new Date()).toUpperCase();

function esc(value=''){return String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function money(value){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(value||0);}
function toast(text){const item=$('toast');item.textContent=text;item.classList.add('show');setTimeout(()=>item.classList.remove('show'),2800);}
function seed(){return[
 {id:'demo-1',plate:'777 AQ 02',vehicle:'Toyota Camry',service:'Комплексная мойка',price:6000,status:'washing',created_at:new Date(Date.now()-1440000).toISOString(),customers:{name:'Данияр',phone:'+7 701 234 56 78'}},
 {id:'demo-2',plate:'010 KZ 01',vehicle:'Hyundai Tucson',service:'Кузов и салон',price:8500,status:'ready',created_at:new Date(Date.now()-3060000).toISOString(),customers:{name:'Алия',phone:'+7 707 555 22 11'}},
 {id:'demo-3',plate:'555 AK 02',vehicle:'Kia Sportage',service:'Комплексная мойка',price:5000,status:'closed',created_at:new Date(Date.now()-3600000).toISOString(),updated_at:new Date().toISOString(),customers:{name:'Марат',phone:'+7 700 111 22 33'}}
];}
function localRows(){let rows=JSON.parse(localStorage.getItem('akku-orders')||'null');if(!rows){rows=seed();localStorage.setItem('akku-orders',JSON.stringify(rows));}return rows;}
function localApi(url,options={}){
 const rows=localRows(),method=options.method||'GET',body=options.body?JSON.parse(options.body):{};
 if(url==='/api/orders'&&method==='GET')return rows.filter(o=>o.status!=='closed'&&!o.voided);
 if(url==='/api/orders/archive'&&method==='GET')return rows.filter(o=>o.status==='closed'||o.voided);
 if(url==='/api/summary'){const today=new Date();today.setHours(0,0,0,0);return{active:rows.filter(o=>o.status!=='closed'&&!o.voided).length,ready:rows.filter(o=>o.status==='ready'&&!o.voided).length,todayRevenue:rows.filter(o=>o.status==='closed'&&new Date(o.updated_at||o.created_at)>=today).reduce((n,o)=>n+Number(o.price),0)};}
 if(url==='/api/orders'&&method==='POST'){const item={...body,id:crypto.randomUUID(),created_at:new Date().toISOString(),status:'arrived',customers:{name:body.name,phone:body.phone}};rows.unshift(item);localStorage.setItem('akku-orders',JSON.stringify(rows));return item;}
 const match=url.match(/^\/api\/orders\/([^/]+)(?:\/(status|close|restore))?$/);
 if(match){const item=rows.find(o=>o.id===match[1]);if(!item)throw Error('Заказ не найден.');const action=match[2];
  if(method==='PATCH'&&!action){Object.assign(item,body);item.customers={...item.customers,name:body.name,phone:body.phone};}
  else if(action==='status')item.status=body.status;
  else if(action==='close'){item.status='closed';item.updated_at=new Date().toISOString();}
  else if(action==='restore'){item.status='arrived';item.voided=false;}
  else if(method==='DELETE'){item.voided=true;item.updated_at=new Date().toISOString();}
  localStorage.setItem('akku-orders',JSON.stringify(rows));return item;
 }
 throw Error('Действие недоступно.');
}
async function api(url,options={}){
 if(localMode)return localApi(url,options);
 const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){if(response.status===401){const modal=$('login-dialog');if(!modal.open)modal.showModal();}throw Error(data.error||'Ошибка запроса.');}
 return data;
}
function updateConnection(){
 $('connection').textContent=localMode?'Демо-режим · данные сохраняются на этом устройстве':'Система подключена';
 $('connection').classList.toggle('local',localMode);
 if($('logout'))$('logout').hidden=localMode;
}
async function load(){
 try{
  const [list,summary]=await Promise.all([api(view==='archive'?'/api/orders/archive':'/api/orders'),api('/api/summary')]);
  orders=list;$('stat-active').textContent=summary.active;$('stat-ready').textContent=summary.ready;
  $('stat-money').textContent=money(summary.todayRevenue);$('count-all').textContent=list.length;$('nav-count').textContent=summary.active;
  $('title').textContent=view==='archive'?'Архив заказов':'Очередь автомобилей';
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
  document.querySelectorAll('.tab').forEach(button=>button.disabled=view==='archive');
  updateConnection();render();
 }catch(error){$('queue').innerHTML='<div class="empty">Не удалось загрузить данные.<br>'+esc(error.message)+'</div>';}
}
function render(){
 const query=$('search').value.toLowerCase().trim();
 const visible=orders.filter(order=>(view==='archive'||filter==='all'||order.status===filter)&&[order.plate,order.vehicle,order.customers?.name,order.customers?.phone,order.service].some(value=>String(value||'').toLowerCase().includes(query)));
 $('queue').innerHTML=visible.length?visible.map(order=>{
  const time=order.scheduled_for?new Date(order.scheduled_for).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):new Date(order.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  const status=order.voided?'Убран в архив':labels[order.status]||order.status;
  const stage=view==='archive'?'<span class="stage closed">'+status+'</span>':'<div class="stage-picker"><span class="stage '+order.status+'">'+status+'</span><select aria-label="Выбрать этап" class="stage-select" data-status data-id="'+order.id+'">'+['booked','arrived','washing','drying','ready'].map(key=>'<option value="'+key+'" '+(key===order.status?'selected':'')+'>'+labels[key]+'</option>').join('')+'</select></div>';
  const following=next[order.status];
  const wa=order.scheduled_for?'<button class="edit" data-whatsapp="'+esc(order.customers?.phone||'')+'" data-time="'+esc(time)+'" data-plate="'+esc(order.plate)+'">WhatsApp</button>':'';
  const action=view==='archive'?'<button class="next restore" data-restore data-id="'+order.id+'">Вернуть в очередь</button>':following?'<button class="next" data-next="'+following+'" data-id="'+order.id+'">'+nextText[following]+' →</button>':order.status==='ready'?'<button class="next" data-close data-id="'+order.id+'">Выдать · в архив</button>':'<button class="next danger" data-remove data-id="'+order.id+'">В архив</button>';
  return '<article class="order"><div><div class="plate">'+esc(order.plate)+'</div><div class="car-meta">'+esc(order.vehicle||'Автомобиль')+'</div></div><div><div class="customer">'+esc(order.customers?.name||'Клиент')+'</div><div class="phone">'+esc(order.customers?.phone||'')+'</div></div><div class="service">'+esc(order.service)+' · '+money(order.price)+'<div class="time">'+(order.scheduled_for?'Запись на ':'Заехал в ')+time+'</div></div><div>'+stage+'</div><div class="order-actions"><button class="edit" data-edit="'+order.id+'">Изменить</button>'+wa+action+'</div></article>';
 }).join(''):'<div class="empty">'+(view==='archive'?'Архив пока пуст. Выданные и убранные заказы появятся здесь.':'Очередь пуста. Добавьте первый автомобиль.')+'</div>';
}
document.querySelectorAll('.tab').forEach(button=>button.onclick=()=>{document.querySelector('.tab.selected')?.classList.remove('selected');button.classList.add('selected');filter=button.dataset.filter;render();});
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;filter='all';load();});
$('search').oninput=render;$('refresh').onclick=load;
$('add-open').onclick=()=>{editingId=null;$('dialog-title').textContent='Принять автомобиль';$('save-label').textContent='Добавить в очередь';$('new-form').reset();$('new-dialog').showModal();};
$('form-close').onclick=()=>$('new-dialog').close();
$('new-form').onsubmit=async event=>{
 event.preventDefault();$('form-error').textContent='';
 const values=Object.fromEntries(new FormData(event.currentTarget));values.price=Number(values.price||0);
 try{
  const wasEditing=Boolean(editingId);
  const saved=await api(wasEditing?'/api/orders/'+editingId:'/api/orders',{method:wasEditing?'PATCH':'POST',body:JSON.stringify(values)});
  $('new-dialog').close();event.currentTarget.reset();editingId=null;await load();
  if(saved.telegramLink&&!localMode){
   try{await navigator.clipboard.writeText(saved.telegramLink);toast('Ссылка Telegram скопирована — отправьте её клиенту.');}
   catch{window.prompt('Скопируйте и отправьте клиенту ссылку подключения Telegram:',saved.telegramLink);}
  }else toast(localMode?'Сохранено на этом устройстве':'Изменения сохранены');
 }catch(error){$('form-error').textContent=error.message;}
};
$('queue').onchange=async event=>{
 const select=event.target.closest('[data-status]');if(!select)return;
 try{await api('/api/orders/'+select.dataset.id+'/status',{method:'PATCH',body:JSON.stringify({status:select.value})});toast('Этап изменён и синхронизирован');await load();}
 catch(error){toast(error.message);await load();}
};
$('queue').onclick=async event=>{
 const wa=event.target.closest('[data-whatsapp]');if(wa){const text='Напоминаем: '+wa.dataset.plate+' записан на мойку АККУ '+wa.dataset.time+'. Будем ждать вас!';window.open('https://wa.me/'+wa.dataset.whatsapp.replace(/\D/g,'')+'?text='+encodeURIComponent(text),'_blank','noopener');return;}
 const edit=event.target.closest('[data-edit]'),button=event.target.closest('[data-next],[data-close],[data-restore],[data-remove]');
 if(edit){
  const order=orders.find(item=>item.id===edit.dataset.edit);if(!order)return;
  editingId=order.id;$('dialog-title').textContent='Изменить заказ';$('save-label').textContent='Сохранить изменения';
  for(const [key,value] of Object.entries({plate:order.plate,vehicle:order.vehicle,name:order.customers?.name,phone:order.customers?.phone,service:order.service,price:order.price}))$('new-form').elements[key].value=value??'';
  $('new-dialog').showModal();return;
 }
 if(!button)return;
 try{
  if(button.dataset.next){await api('/api/orders/'+button.dataset.id+'/status',{method:'PATCH',body:JSON.stringify({status:button.dataset.next})});toast('Этап обновлён');}
  else if(button.hasAttribute('data-close')){await api('/api/orders/'+button.dataset.id+'/close',{method:'POST',body:'{}'});toast('Автомобиль выдан и перемещён в архив');}
  else if(button.hasAttribute('data-remove')){if(!confirm('Убрать заказ в архив? Его можно будет восстановить.'))return;await api('/api/orders/'+button.dataset.id,{method:'DELETE'});toast('Заказ в архиве — его можно вернуть');}
  else if(button.hasAttribute('data-restore')){await api('/api/orders/'+button.dataset.id+'/restore',{method:'POST',body:'{}'});toast('Заказ возвращён в очередь');}
  await load();
 }catch(error){toast(error.message);}
};
$('login-form').onsubmit=async event=>{
 event.preventDefault();$('login-error').textContent='';
 try{const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:$('staff-password').value})}),data=await response.json();if(!response.ok)throw Error(data.error||'Не удалось войти');$('login-dialog').close();$('staff-password').value='';await load();}
 catch(error){$('login-error').textContent=error.message;}
};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});}finally{location.reload();}};
updateConnection();
if(!localMode)api('/api/session').then(session=>{if(!session.authenticated)$('login-dialog').showModal();}).catch(()=>{});
load();setInterval(()=>{if(!localMode)load();},15000);
