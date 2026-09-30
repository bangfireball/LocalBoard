const state = { boards: [], board: null, lists: [], cards: [], search: '' };
let currentBoardId = localStorage.getItem('current-board-id');
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

async function api(path, options = {}, canPrompt = true) {
  const key = sessionStorage.getItem('board-api-key');
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, { ...options, headers: { ...(!isForm ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'X-API-Key': key } : {}), ...options.headers } });
  if (response.status === 401 && canPrompt) {
    const supplied = await askText({ title: 'API key required', label: 'API key', submit: 'Continue', secret: true });
    if (supplied) { sessionStorage.setItem('board-api-key', supplied); return api(path, options, false); }
  }
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || `Request failed (${response.status})`); }
  return response.status === 204 ? null : response.json();
}

function toast(message, error = false) {
  const element = $('#toast'); element.textContent = message; element.style.background = error ? '#c9372c' : '#172b4d'; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 2200);
}
function askText({ title, label, value = '', help = '', submit = 'Save', secret = false }) {
  return new Promise((resolve) => {
    const dialog=$('#text-dialog'), form=$('#text-dialog-form'), input=$('#text-dialog-input'), controller=new AbortController(); let settled=false;
    $('#text-dialog-title').textContent=title; $('#text-dialog-label').textContent=label; $('#text-dialog-help').textContent=help; $('#text-dialog-submit').textContent=submit; input.type=secret?'password':'text'; input.value=value;
    const finish=(result)=>{if(settled)return;settled=true;controller.abort();if(dialog.open)dialog.close();resolve(result);};
    form.addEventListener('submit',(event)=>{event.preventDefault();finish(input.value.trim()||null);},{signal:controller.signal});
    $$('[data-text-cancel]',dialog).forEach((button)=>button.addEventListener('click',()=>finish(null),{signal:controller.signal}));
    dialog.addEventListener('cancel',(event)=>{event.preventDefault();finish(null);},{signal:controller.signal}); dialog.showModal(); setTimeout(()=>input.focus(),30);
  });
}
function askConfirm({ title='Are you sure?', message, submit='Delete' }) {
  return new Promise((resolve) => {
    const dialog=$('#confirm-dialog'), form=$('#confirm-dialog-form'), controller=new AbortController(); let settled=false;
    $('#confirm-dialog-title').textContent=title; $('#confirm-dialog-message').textContent=message; $('#confirm-dialog-submit').textContent=submit;
    const finish=(result)=>{if(settled)return;settled=true;controller.abort();if(dialog.open)dialog.close();resolve(result);};
    form.addEventListener('submit',(event)=>{event.preventDefault();finish(true);},{signal:controller.signal});
    $$('[data-confirm-cancel]',dialog).forEach((button)=>button.addEventListener('click',()=>finish(false),{signal:controller.signal}));
    dialog.addEventListener('cancel',(event)=>{event.preventDefault();finish(false);},{signal:controller.signal}); dialog.showModal();
  });
}

async function load() {
  try {
    state.boards = await api('/boards');
    if (!state.boards.some((board) => board.id === currentBoardId)) currentBoardId = state.boards[0]?.id;
    if (!currentBoardId) throw new Error('No boards available');
    localStorage.setItem('current-board-id', currentBoardId);
    const data = await api(`/state?boardId=${encodeURIComponent(currentBoardId)}`); Object.assign(state, data);
    document.documentElement.style.setProperty('--board', state.board.background || '#0c66e4');
    $('#board-title').textContent = state.board.name; document.title = state.board.name;
    render(); populateLists(); renderBoardsSidebar();
  } catch (error) { toast(error.message, true); }
}

function visibleCards() {
  const query = state.search.toLowerCase();
  return state.cards.filter((card) => !query || [card.title, card.description, ...card.labels].join(' ').toLowerCase().includes(query));
}

const colors = ['#4bce97','#f5cd47','#fea362','#f87168','#9f8fef','#579dff','#60c6d2','#8590a2'];
function labelColor(label) { return colors[[...label].reduce((sum, character) => sum + character.charCodeAt(0), 0) % colors.length]; }
function dueBadge(card) {
  if (!card.dueDate) return '';
  const doneList = state.lists.find((list) => list.id === card.listId)?.name.toLowerCase() === 'done';
  const overdue = card.dueDate < new Date().toISOString().slice(0, 10) && !doneList;
  const text = new Date(`${card.dueDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `<span class="due ${overdue ? 'overdue' : doneList ? 'complete' : ''}">◷ ${text}</span>`;
}
function cardHtml(card) {
  const completed = card.checklist.filter((item) => item.done).length;
  return `<article class="card" draggable="true" tabindex="0" data-card-id="${card.id}">
    ${card.photos?.length ? `<img class="card-cover" src="${escapeHtml(card.photos[0].url)}" alt="">` : ''}
    ${card.labels.length ? `<div class="labels">${card.labels.map((label) => `<span class="label" title="${escapeHtml(label)}" style="background:${labelColor(label)}"></span>`).join('')}</div>` : ''}
    <div class="card-title">${escapeHtml(card.title)}</div>
    ${(card.description || card.dueDate || card.checklist.length) ? `<div class="card-badges">${card.description ? '<span title="Has description">☷</span>' : ''}${dueBadge(card)}${card.checklist.length ? `<span class="${completed === card.checklist.length ? 'check-complete' : ''}">☑ ${completed}/${card.checklist.length}</span>` : ''}</div>` : ''}
  </article>`;
}
function render() {
  const cards = visibleCards();
  $('#board').innerHTML = [...state.lists].sort((a,b) => a.position-b.position).map((list) => {
    const listCards = cards.filter((card) => card.listId === list.id).sort((a,b) => a.position-b.position);
    return `<section class="list" data-list-id="${list.id}"><header class="list-header"><span class="list-title">${escapeHtml(list.name)}</span><span class="card-count">${listCards.length}</span><button class="list-menu" title="List actions">•••</button></header><div class="cards" data-list-id="${list.id}">${listCards.map(cardHtml).join('')}</div><button class="add-card">＋ Add a card</button></section>`;
  }).join('') + '<button class="add-list">＋ Add another list</button>';
  bindBoardEvents();
}

function bindBoardEvents() {
  $$('.card').forEach((element) => {
    element.addEventListener('click', () => openCard(element.dataset.cardId));
    element.addEventListener('keydown', (event) => { if (event.key === 'Enter') openCard(element.dataset.cardId); });
    element.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', element.dataset.cardId); element.classList.add('dragging'); });
    element.addEventListener('dragend', () => element.classList.remove('dragging'));
  });
  $$('.cards').forEach((list) => {
    list.addEventListener('dragover', (event) => { event.preventDefault(); list.classList.add('drag-over'); });
    list.addEventListener('dragleave', (event) => { if (!list.contains(event.relatedTarget)) list.classList.remove('drag-over'); });
    list.addEventListener('drop', async (event) => {
      event.preventDefault(); list.classList.remove('drag-over');
      const before = event.target.closest('.card');
      const position = before ? [...list.querySelectorAll('.card')].indexOf(before) : 999;
      try { await api(`/cards/${event.dataTransfer.getData('text/plain')}/move`, { method:'POST', body:JSON.stringify({ listId:list.dataset.listId, position }) }); await load(); } catch(error) { toast(error.message,true); }
    });
  });
  $$('.add-card').forEach((button) => button.addEventListener('click', () => showCardComposer(button.closest('.list'))));
  $$('.list-menu').forEach((button) => button.addEventListener('click', () => listActions(button.closest('.list').dataset.listId)));
  $('.add-list').addEventListener('click', showListComposer);
}

function showCardComposer(list) {
  const button = $('.add-card', list);
  button.outerHTML = '<form class="composer"><textarea rows="3" maxlength="160" placeholder="Enter a title for this card…" required></textarea><div class="composer-actions"><button class="add-button">Add card</button><button type="button" class="cancel-composer">×</button></div></form>';
  const form = $('.composer', list); $('textarea', form).focus();
  $('.cancel-composer', form).addEventListener('click', render);
  form.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/cards', { method:'POST', body:JSON.stringify({ title:$('textarea',form).value, listId:list.dataset.listId }) }); await load(); } catch(error) { toast(error.message,true); } });
}
function showListComposer() {
  $('.add-list').outerHTML = '<form class="new-list"><input maxlength="80" placeholder="Enter list title…" required><div class="composer-actions"><button class="add-button">Add list</button><button type="button" class="cancel-composer">×</button></div></form>';
  const form = $('.new-list'); $('input',form).focus(); $('.cancel-composer',form).addEventListener('click',render);
  form.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/lists',{method:'POST',body:JSON.stringify({name:$('input',form).value,boardId:currentBoardId})}); await load(); } catch(error){toast(error.message,true);} });
}
async function listActions(listId) {
  const list = state.lists.find((item) => item.id === listId);
  const choice = await askText({ title:'Edit list', label:'List name', value:list.name, help:'Enter DELETE to remove this list if it is empty.' });
  if (!choice || choice === list.name) return;
  try {
    if (choice === 'DELETE') { if (!await askConfirm({title:'Delete list?',message:`“${list.name}” will be permanently removed. Only empty lists can be deleted.`})) return; await api(`/lists/${listId}`,{method:'DELETE'}); }
    else await api(`/lists/${listId}`,{method:'PATCH',body:JSON.stringify({name:choice})});
    await load();
  } catch(error){toast(error.message,true);}
}
function populateLists() { $('#list-select').innerHTML = state.lists.sort((a,b)=>a.position-b.position).map((list)=>`<option value="${list.id}">${escapeHtml(list.name)}</option>`).join(''); }
function openCard(cardId) {
  const card = state.cards.find((item) => item.id === cardId); if (!card) return;
  const form = $('#card-form'); form.elements.id.value=card.id; form.elements.title.value=card.title; form.elements.description.value=card.description; form.elements.listId.value=card.listId; form.elements.labels.value=card.labels.join(', '); form.elements.dueDate.value=card.dueDate;
  form.elements.checklist.value=card.checklist.map((item)=>`${item.done?'[x] ':''}${item.text}`).join('\n');
  renderPhotos(card); $('#card-list-name').textContent=state.lists.find((list)=>list.id===card.listId)?.name || ''; $('#card-dialog').showModal();
}
function renderPhotos(card){
  $('#photo-gallery').innerHTML=(card.photos||[]).map((photo)=>`<figure class="photo-item"><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.name)}"><button type="button" class="remove-photo" data-photo-id="${photo.id}" aria-label="Remove ${escapeHtml(photo.name)}">×</button></figure>`).join('');
  $$('.remove-photo').forEach((button)=>button.addEventListener('click',async()=>{if(!await askConfirm({title:'Remove photo?',message:'This photo will be permanently removed.'}))return;try{await api(`/cards/${card.id}/photos/${button.dataset.photoId}`,{method:'DELETE'});card.photos=card.photos.filter((photo)=>photo.id!==button.dataset.photoId);renderPhotos(card);render();toast('Photo removed');}catch(error){toast(error.message,true);}}));
}
function cardFromForm(form) {
  return { title:form.elements.title.value, description:form.elements.description.value, listId:form.elements.listId.value, labels:form.elements.labels.value.split(',').map((label)=>label.trim()).filter(Boolean), dueDate:form.elements.dueDate.value, checklist:form.elements.checklist.value.split('\n').map((line)=>({text:line.replace(/^\[x\]\s*/i,'').trim(),done:/^\[x\]/i.test(line)})).filter((item)=>item.text) };
}

$('#card-form').addEventListener('submit', async (event) => { event.preventDefault(); const form=event.currentTarget; const id=form.elements.id.value; const data=cardFromForm(form); const original=state.cards.find((card)=>card.id===id); try { await api(`/cards/${id}`,{method:'PATCH',body:JSON.stringify(data)}); if(original.listId!==data.listId) await api(`/cards/${id}/move`,{method:'POST',body:JSON.stringify({listId:data.listId,position:999})}); $('#card-dialog').close(); await load(); toast('Card saved'); } catch(error){toast(error.message,true);} });
$('#delete-card').addEventListener('click',async()=>{const id=$('#card-form').elements.id.value;if(!await askConfirm({title:'Delete card?',message:'This card and its photos will be permanently deleted.'}))return;try{await api(`/cards/${id}`,{method:'DELETE'});$('#card-dialog').close();await load();toast('Card deleted');}catch(error){toast(error.message,true);}});
$('#photo-input').addEventListener('change',async(event)=>{const id=$('#card-form').elements.id.value;const card=state.cards.find((item)=>item.id===id);const files=[...event.target.files];if(!card||!files.length)return;$('#photo-gallery').classList.add('uploading');try{for(const file of files){const body=new FormData();body.append('photo',file);const photo=await api(`/cards/${id}/photos`,{method:'POST',body});card.photos.push(photo);}renderPhotos(card);render();toast(files.length===1?'Photo added':`${files.length} photos added`);}catch(error){toast(error.message,true);}finally{$('#photo-gallery').classList.remove('uploading');event.target.value='';}});
$$('[data-close]').forEach((button)=>button.addEventListener('click',()=>$('#card-dialog').close()));
$('#search').addEventListener('input',(event)=>{state.search=event.target.value;render();});
$('#board-title').addEventListener('click',async()=>{const name=await askText({title:'Rename board',label:'Board name',value:state.board.name});if(!name||name===state.board.name)return;try{await api(`/boards/${currentBoardId}`,{method:'PATCH',body:JSON.stringify({name})});await load();}catch(error){toast(error.message,true);}});
$('#change-background').addEventListener('click',async()=>{const palette=['#0c66e4','#0e7a5f','#7e57c2','#c9372c','#c25100','#455570'];const next=palette[(palette.indexOf(state.board.background)+1)%palette.length];try{await api(`/boards/${currentBoardId}`,{method:'PATCH',body:JSON.stringify({background:next})});await load();}catch(error){toast(error.message,true);}});

function renderBoardsSidebar(){
  $('#boards-list').innerHTML=state.boards.map((board)=>`<button class="board-option ${board.id===currentBoardId?'active':''}" data-board-id="${board.id}"><span class="board-swatch" style="background:${board.background}"></span><strong>${escapeHtml(board.name)}</strong>${board.id===currentBoardId?'<small>Current</small>':''}</button>`).join('');
  $$('.board-option').forEach((button)=>button.addEventListener('click',async()=>{currentBoardId=button.dataset.boardId;localStorage.setItem('current-board-id',currentBoardId);closeBoardsSidebar();await load();}));
}
function openBoardsSidebar(){ $('#boards-sidebar').classList.add('open'); $('#boards-sidebar').setAttribute('aria-hidden','false'); $('#sidebar-backdrop').hidden=false; }
function closeBoardsSidebar(){ $('#boards-sidebar').classList.remove('open'); $('#boards-sidebar').setAttribute('aria-hidden','true'); $('#sidebar-backdrop').hidden=true; }
function toggleBoardsSidebar(){ $('#boards-sidebar').classList.contains('open')?closeBoardsSidebar():openBoardsSidebar(); }
$('#boards-button').addEventListener('click',toggleBoardsSidebar); $('#close-sidebar').addEventListener('click',closeBoardsSidebar); $('#sidebar-backdrop').addEventListener('click',closeBoardsSidebar);
$('#new-board-form').addEventListener('submit',async(event)=>{event.preventDefault();const input=event.currentTarget.elements.name;try{const board=await api('/boards',{method:'POST',body:JSON.stringify({name:input.value})});currentBoardId=board.id;localStorage.setItem('current-board-id',currentBoardId);input.value='';closeBoardsSidebar();await load();toast('Board created');}catch(error){toast(error.message,true);}});
document.addEventListener('keydown',(event)=>{if(event.key==='Escape'){if($('#card-dialog').open)$('#card-dialog').close();else closeBoardsSidebar();}if(event.key.toLowerCase()==='b'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#card-dialog').open){event.preventDefault();toggleBoardsSidebar();}});
load();
