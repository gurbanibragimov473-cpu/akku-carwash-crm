const labels={booked:'Записан',arrived:'Заехал',washing:'Идёт мойка',drying:'Сушка',ready:'Готов',closed:'Автомобиль выдан'};
const next={booked:'arrived',arrived:'washing',washing:'drying',drying:'ready'};
const nextText={arrived:'Автомобиль заехал',washing:'Начать мойку',drying:'На сушку',ready:'Отметить готовым'};
const sites={akku:'АККУ ОСНОВНОЙ',premium:'АККУ PREMIUM'};
let orders=[],customers=[],filter='all',view='queue',role='staff',editingId=null,cancelId=null,suggestTimer;
const $=id=>document.getElementById(id);
$('date-label').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(new Date()).toUpperCase();
function esc(v=''){return String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function money(v){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(v||0);}
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),3200);}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}}),d=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401){const m=$('login-dialog');if(!m.open)m.showModal();}throw Error(d.error||'Ошибка запроса.');}return d;}
function updateRole(){document.querySelectorAll('.admin-only').forEach(e=>e.hidden=role!=='admin');}
function setView(v){view=v;filter='all';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$('queue').hidden=v==='customers';$('customer-list').hidden=v!=='customers';$('add-open').hidden=v!=='queue';$('announce-open').hidden=v==='cancelled';$('title').textContent=({queue:'Очередь автомобилей',archive:'Архив заказов',cancelled:'Отменённые заказы',customers:'Клиенты'})[v]||'Очередь автомобилей';$('subtitle').textContent=({queue:'Все этапы мойки — в одном месте.',archive:'Выданные и убранные из очереди автомобили.',cancelled:'Отмены доступны только главному администратору.',customers:'Клиенты и все автомобили из истории мойки.'})[v]||'';document.querySelectorAll('.tab').forEach(b=>b.disabled=v!=='queue');load();}
async function load(){
 try{
  const summary=await api('/api/summary');$('stat-active').textContent=summary.active;$('stat-ready').textContent=summary.ready;$('stat-money').textContent=money(summary.todayRevenue);$('nav-count').textContent=summary.active;if($('cancel-count'))$('cancel-count').textContent=summary.cancelled||0;
  if(view==='customers'){customers=await api('/api/customers');renderCustomers();return;}
  const endpoint=view==='archive'?'/api/orders/archive':view==='cancelled'?'/api/orders/cancelled':'/api/orders';
  orders=await api(endpoint);render();
 }catch(e){const target=view==='customers'?'customer-list':'queue';$(target).innerHTML='<div class="empty">Не удалось загрузить данные.<br>'+esc(e.message)+'</div>';}
}
function render(){
 const query=$('search').value.toLowerCase().trim(),visible=orders.filter(o=>(view!=='queue'||filter==='all'||o.status===filter)&&[o.plate,o.vehicle,o.customers?.name,o.customers?.phone,o.service,o.service_details,o.cancellation_reason,sites[o.wash_site]].some(v=>String(v||'').toLowerCase().includes(query)));
 $('queue').innerHTML=visible.length?visible.map(o=>{
  const when=o.scheduled_for?new Date(o.scheduled_for).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):new Date(o.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  const status=o.cancelled?'Отменён':o.voided?'Убран в архив':labels[o.status]||o.status;
  let action='';
  if(view==='cancelled')action='<button class="next restore" data-uncancel="'+o.id+'">Вернуть в очередь</button><button class="next danger" data-permanent="'+o.id+'">Удалить навсегда</button>';
  else if(view==='archive')action='<button class="next restore" data-restore data-id="'+o.id+'">Вернуть в очередь</button>';
  else {const n=next[o.status];action=(n?'<button class="next" data-next="'+n+'" data-id="'+o.id+'">'+nextText[n]+' →</button>':o.status==='ready'?'<button class="next" data-close data-id="'+o.id+'">Выдать · в архив</button>':'')+'<button class="next cancel-button" data-cancel="'+o.id+'">Отменить</button><button class="edit" data-edit="'+o.id+'">Изменить</button>';}
  const stage=view==='cancelled'?'<span class="stage cancelled-stage">'+status+'</span>':'<div class="stage-picker"><span class="stage '+o.status+'">'+status+'</span>'+(view==='queue'?'<select aria-label="Выбрать этап" class="stage-select" data-status data-id="'+o.id+'">'+(o.status==='booked'?['booked','arrived','washing','drying','ready']:['arrived','washing','drying','ready']).map(k=>'<option value="'+k+'" '+(k===o.status?'selected':'')+'>'+labels[k]+'</option>').join('')+'</select>':'')+'</div>';
  return '<article class="order"><div><div class="plate">'+esc(o.plate)+'</div><div class="car-meta">'+esc(o.vehicle||'Автомобиль')+' · '+esc(sites[o.wash_site]||sites.akku)+'</div></div><div><div class="customer">'+esc(o.customers?.name||'Клиент')+'</div><div class="phone">'+esc(o.customers?.phone||'')+'</div></div><div class="service">'+esc(o.service)+(o.service_details?' · '+esc(o.service_details):'')+' · '+money(o.price)+'<div class="time">'+(o.scheduled_for?'Запись на ':'Заехал в ')+when+'</div>'+(o.cancellation_reason?'<div class="time cancel-reason">Причина: '+esc(o.cancellation_reason)+'</div>':'')+'</div><div>'+stage+'</div><div class="order-actions">'+action+'</div></article>';
 }).join(''):'<div class="empty">'+(view==='cancelled'?'Отменённых заказов пока нет.':view==='archive'?'Архив пока пуст.':'Очередь пуста. Добавьте первый автомобиль.')+'</div>';
}
function renderCustomers(){
 const q=$('search').value.toLowerCase().trim(),list=customers.filter(c=>[c.name,c.phone,...(c.cars||[]).flatMap(x=>[x.plate,x.vehicle])].some(x=>String(x||'').toLowerCase().includes(q)));
 $('customer-list').innerHTML=list.length?list.map(c=>'<article class="customer-card"><div><strong>'+esc(c.name||'Без имени')+'</strong><div class="phone">'+esc(c.phone)+'</div></div><div class="customer-cars">'+((c.cars||[]).map(x=>'<span class="car-chip">'+esc(x.plate)+' · '+esc(x.vehicle||'Автомобиль')+'</span>').join('')||'<span class="phone">Машин в базе пока нет</span>')+'</div><div class="customer-metrics"><b>'+c.visits+'</b> визитов'+(c.lastVisit?'<small>Последний: '+new Date(c.lastVisit).toLocaleDateString('ru-RU')+'</small>':'')+'</div><div class="phone">'+(c.telegram_chat_id?'Telegram подключён':'Telegram не подключён')+(c.announcements_opt_in?' · рассылка включена':'')+'</div></article>').join(''):'<div class="empty">Клиентов пока нет. Они появятся после добавления автомобиля.</div>';
}
function fillCustomerSuggestion(x){if(x.plate){$('new-form').elements.plate.value=x.plate;$('new-form').elements.vehicle.value=x.vehicle||'';}if(x.customer){$('new-form').elements.name.value=x.customer.name||'';$('new-form').elements.phone.value=x.customer.phone||'';}else if(x.name!==undefined){$('new-form').elements.name.value=x.name||'';$('new-form').elements.phone.value=x.phone||'';}$('suggestion-list').hidden=true;}
async function searchSuggestions(){
 const q=$('plate-input').value.trim(),box=$('suggestion-list');if(q.length<2){box.hidden=true;box.innerHTML='';return;}
 try{const d=await api('/api/customers/search?q='+encodeURIComponent(q));const items=[...(d.cars||[]).map(c=>({type:'car',data:c,label:c.plate+' · '+(c.customer?.name||'Клиент')+' · '+(c.customer?.phone||'')})),...(d.customers||[]).map(c=>({type:'customer',data:c,label:(c.name||'Клиент')+' · '+c.phone}))];const unique=new Set();const filtered=items.filter(x=>{const k=x.label.toLowerCase();if(unique.has(k))return false;unique.add(k);return true;}).slice(0,7);box.innerHTML=filtered.map((x,i)=>'<button type="button" class="suggestion" data-suggestion="'+i+'">'+esc(x.label)+'</button>').join('');window._akkuSuggestions=filtered;box.hidden=!filtered.length;}catch{box.hidden=true;}
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelector('.tab.selected')?.classList.remove('selected');b.classList.add('selected');filter=b.dataset.filter;render();});
$('search').oninput=()=>view==='customers'?renderCustomers():render();$('refresh').onclick=load;
$('add-open').onclick=()=>{editingId=null;$('dialog-title').textContent='Принять автомобиль';$('save-label').textContent='Добавить в очередь';$('new-form').reset();$('service-other-field').hidden=true;$('new-dialog').showModal();};
$('form-close').onclick=()=>$('new-dialog').close();
$('service-select').onchange=()=>{$('service-other-field').hidden=$('service-select').value!=='Другое';};
$('plate-input').addEventListener('input',()=>{clearTimeout(suggestTimer);suggestTimer=setTimeout(searchSuggestions,250);});
$('suggestion-list').onclick=e=>{const b=e.target.closest('[data-suggestion]');if(!b)return;const x=window._akkuSuggestions[Number(b.dataset.suggestion)];fillCustomerSuggestion(x.type==='car'?x.data:{name:x.data.name,phone:x.data.phone});};
$('new-form').onsubmit=async e=>{e.preventDefault();$('form-error').textContent='';const f=e.currentTarget,values=Object.fromEntries(new FormData(f));values.price=Number(values.price||0);try{const wasEditing=Boolean(editingId),saved=await api(wasEditing?'/api/orders/'+editingId:'/api/orders',{method:wasEditing?'PATCH':'POST',body:JSON.stringify(values)});$('new-dialog').close();$('new-form').reset();editingId=null;await load();if(saved.telegramLink){try{await navigator.clipboard.writeText(saved.telegramLink);toast('Ссылка Telegram скопирована — отправьте клиенту.');}catch{window.prompt('Скопируйте ссылку Telegram:',saved.telegramLink);}}else toast('Запись сохранена.');}catch(err){$('form-error').textContent=err.message;}};
$('queue').onchange=async e=>{const s=e.target.closest('[data-status]');if(!s)return;try{await api('/api/orders/'+s.dataset.id+'/status',{method:'PATCH',body:JSON.stringify({status:s.value})});toast('Статус сохранён. Клиенту отправлено обновление Telegram.');await load();}catch(err){toast(err.message);await load();}};
$('queue').onclick=async e=>{
 const suggestion=e.target.closest('[data-suggestion]');if(suggestion)return;
 const edit=e.target.closest('[data-edit]'),cancel=e.target.closest('[data-cancel]'),permanent=e.target.closest('[data-permanent]'),uncancel=e.target.closest('[data-uncancel]'),b=e.target.closest('[data-next],[data-close],[data-restore]');
 if(edit){const o=orders.find(x=>x.id===edit.dataset.edit);if(!o)return;editingId=o.id;$('dialog-title').textContent='Изменить заказ';$('save-label').textContent='Сохранить изменения';for(const [k,v]of Object.entries({plate:o.plate,vehicle:o.vehicle,name:o.customers?.name,phone:o.customers?.phone,service:o.service,service_details:o.service_details,price:o.price,wash_site:o.wash_site||'akku'}))$('new-form').elements[k].value=v??'';$('service-other-field').hidden=o.service!=='Другое';$('new-dialog').showModal();return;}
 if(cancel){cancelId=cancel.dataset.cancel;$('cancel-form').reset();$('cancel-error').textContent='';$('cancel-dialog').showModal();return;}
 if(uncancel){if(role!=='admin')return;try{await api('/api/orders/'+uncancel.dataset.uncancel+'/uncancel',{method:'POST',body:'{}'});toast('Отмена снята, автомобиль возвращён в очередь.');await load();}catch(err){toast(err.message);}return;}
 if(permanent){if(role!=='admin'||!confirm('Удалить отменённый заказ навсегда? Это действие нельзя отменить.'))return;try{await api('/api/orders/'+permanent.dataset.permanent+'/permanent',{method:'DELETE'});toast('Заказ удалён навсегда.');await load();}catch(err){toast(err.message);}return;}
 if(!b)return;try{if(b.dataset.next){await api('/api/orders/'+b.dataset.id+'/status',{method:'PATCH',body:JSON.stringify({status:b.dataset.next})});toast('Этап обновлён, сообщение Telegram заменено.');}else if(b.hasAttribute('data-close')){await api('/api/orders/'+b.dataset.id+'/close',{method:'POST',body:'{}'});toast('Автомобиль выдан и перемещён в архив.');}else if(b.hasAttribute('data-restore')){await api('/api/orders/'+b.dataset.id+'/restore',{method:'POST',body:'{}'});toast('Заказ возвращён в очередь.');}await load();}catch(err){toast(err.message);}
};
$('cancel-close').onclick=()=>$('cancel-dialog').close();
$('cancel-form').onsubmit=async e=>{e.preventDefault();$('cancel-error').textContent='';try{const reason=new FormData(e.currentTarget).get('reason');await api('/api/orders/'+cancelId+'/cancel',{method:'POST',body:JSON.stringify({reason})});$('cancel-dialog').close();await load();toast('Отмена сохранена отдельно.');}catch(err){$('cancel-error').textContent=err.message;}};
$('announce-open').onclick=()=>$('announce-dialog').showModal();$('announce-close').onclick=()=>$('announce-dialog').close();
$('announce-form').onsubmit=async e=>{e.preventDefault();$('announce-error').textContent='';try{const d=await api('/api/announcements',{method:'POST',body:JSON.stringify({text:new FormData(e.currentTarget).get('text')})});$('announce-dialog').close();e.currentTarget.reset();toast('Доставлено: '+d.sent+' из '+d.total+' подписанных клиентов.');}catch(err){$('announce-error').textContent=err.message;}};
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-error').textContent='';try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({password:$('staff-password').value})});role=d.role||'staff';updateRole();$('login-dialog').close();$('staff-password').value='';await load();}catch(err){$('login-error').textContent=err.message;}};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});}finally{location.reload();}};
updateRole();
api('/api/session').then(s=>{if(s.authenticated){role=s.role||'staff';updateRole();load();}else $('login-dialog').showModal();}).catch(()=>{$('login-dialog').showModal();});
setInterval(()=>{if(!$('login-dialog').open)load();},15000);
