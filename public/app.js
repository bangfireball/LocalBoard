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
$('#text-dialog').addEventListener('click',(event)=>{if(event.target===$('#text-dialog'))$('[data-text-cancel]',$('#text-dialog')).click();});
$('#confirm-dialog').addEventListener('click',(event)=>{if(event.target===$('#confirm-dialog'))$('[data-confirm-cancel]',$('#confirm-dialog')).click();});

async function load() {
  try {
    state.boards = await api('/boards');
    if (!state.boards.some((board) => board.id === currentBoardId)) currentBoardId = state.boards[0]?.id;
    if (!currentBoardId) throw new Error('No boards available');
    localStorage.setItem('current-board-id', currentBoardId);
    const data = await api(`/state?boardId=${encodeURIComponent(currentBoardId)}`); Object.assign(state, data);
    document.documentElement.style.setProperty('--board', state.board.background || '#0c66e4');
    $('#board-title').textContent = state.board.name; document.title = `${state.board.name} | LocalBoard`;
    render(); populateLists(); renderBoardsSidebar();
  } catch (error) { toast(error.message, true); }
}

function boardLabel(labelId) { return state.board?.labels?.find((label) => label.id === labelId); }
function visibleCards() {
  const query = state.search.toLowerCase();
  return state.cards.filter((card) => !query || [card.title, card.description, ...card.labels.map((id) => boardLabel(id)?.name || '')].join(' ').toLowerCase().includes(query));
}
function dueBadge(card) {
  if (!card.dueDate) return '';
  const doneList = state.lists.find((list) => list.id === card.listId)?.name.toLowerCase() === 'done';
  const overdue = card.dueDate < new Date().toISOString().slice(0, 10) && !doneList;
  const text = new Date(`${card.dueDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `<span class="due ${overdue ? 'overdue' : doneList ? 'complete' : ''}">◷ ${text}</span>`;
}
function cardHtml(card) {
  const completed = card.checklist.filter((item) => item.done).length;
  const labels = card.labels.map(boardLabel).filter(Boolean);
  return `<article class="card" draggable="true" tabindex="0" data-card-id="${card.id}">
    ${card.photos?.length ? `<img class="card-cover" src="${escapeHtml(card.photos[0].url)}" alt="">` : ''}
    ${labels.length ? `<div class="labels">${labels.map((label) => `<span class="label" title="${escapeHtml(label.name || 'Label')}" style="background:${label.color}">${escapeHtml(label.name)}</span>`).join('')}</div>` : ''}
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
  const form = $('#card-form'); form.elements.id.value=card.id; form.elements.title.value=card.title; form.elements.description.value=card.description; form.elements.listId.value=card.listId; form.elements.dueDate.value=card.dueDate;
  form.elements.checklist.value=card.checklist.map((item)=>`${item.done?'[x] ':''}${item.text}`).join('\n');
  renderSelectedLabels(card); renderPhotos(card); $('#card-list-name').textContent=state.lists.find((list)=>list.id===card.listId)?.name || ''; $('#card-dialog').showModal();
}
function renderPhotos(card){
  $('#photo-gallery').innerHTML=(card.photos||[]).map((photo)=>`<figure class="photo-item"><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.name)}"><button type="button" class="remove-photo" data-photo-id="${photo.id}" aria-label="Remove ${escapeHtml(photo.name)}">×</button></figure>`).join('');
  $$('.photo-item img').forEach((image)=>image.addEventListener('click',()=>openFullImage(image.src,image.alt)));
  $$('.remove-photo').forEach((button)=>button.addEventListener('click',async()=>{if(!await askConfirm({title:'Remove photo?',message:'This photo will be permanently removed.'}))return;try{await api(`/cards/${card.id}/photos/${button.dataset.photoId}`,{method:'DELETE'});card.photos=card.photos.filter((photo)=>photo.id!==button.dataset.photoId);renderPhotos(card);render();toast('Photo removed');}catch(error){toast(error.message,true);}}));
}
function renderSelectedLabels(card){
  const labels=card.labels.map(boardLabel).filter(Boolean);
  $('#selected-labels').innerHTML=labels.length?labels.map((label)=>`<span class="selected-label" style="background:${label.color}">${escapeHtml(label.name||'Label')}</span>`).join(''):'<small>No labels</small>';
}
function openFullImage(source,alt=''){const dialog=$('#image-dialog');$('#full-image').src=source;$('#full-image').alt=alt||'Full-size attachment';dialog.showModal();}
function cardFromForm(form) {
  const card=state.cards.find((item)=>item.id===form.elements.id.value);
  return { title:form.elements.title.value, description:form.elements.description.value, listId:form.elements.listId.value, labels:card?.labels||[], dueDate:form.elements.dueDate.value, checklist:form.elements.checklist.value.split('\n').map((line)=>({text:line.replace(/^\[x\]\s*/i,'').trim(),done:/^\[x\]/i.test(line)})).filter((item)=>item.text) };
}

$('#card-form').addEventListener('submit', async (event) => { event.preventDefault(); const form=event.currentTarget; const id=form.elements.id.value; const data=cardFromForm(form); const original=state.cards.find((card)=>card.id===id); try { await api(`/cards/${id}`,{method:'PATCH',body:JSON.stringify(data)}); if(original.listId!==data.listId) await api(`/cards/${id}/move`,{method:'POST',body:JSON.stringify({listId:data.listId,position:999})}); $('#card-dialog').close(); await load(); toast('Card saved'); } catch(error){toast(error.message,true);} });
$('#delete-card').addEventListener('click',async()=>{const id=$('#card-form').elements.id.value;if(!await askConfirm({title:'Delete card?',message:'This card and its photos will be permanently deleted.'}))return;try{await api(`/cards/${id}`,{method:'DELETE'});$('#card-dialog').close();await load();toast('Card deleted');}catch(error){toast(error.message,true);}});
async function uploadPhotos(files, pasted=false){
  const id=$('#card-form').elements.id.value, card=state.cards.find((item)=>item.id===id);
  if(!card||!files.length)return;
  $('#photo-gallery').classList.add('uploading');
  try{
    for(const file of files){const body=new FormData();body.append('photo',file,file.name||`pasted-image-${Date.now()}.png`);const photo=await api(`/cards/${id}/photos`,{method:'POST',body});card.photos.push(photo);}
    renderPhotos(card);render();toast(files.length===1?(pasted?'Pasted image added':'Photo added'):`${files.length} photos added`);
  }catch(error){toast(error.message,true);}finally{$('#photo-gallery').classList.remove('uploading');}
}
$('#photo-input').addEventListener('change',async(event)=>{await uploadPhotos([...event.target.files]);event.target.value='';});
$('#card-form').elements.description.addEventListener('paste',async(event)=>{
  const files=[...(event.clipboardData?.items||[])].filter((item)=>item.kind==='file'&&item.type.startsWith('image/')).map((item)=>item.getAsFile()).filter(Boolean);
  if(!files.length)return;
  event.preventDefault();
  await uploadPhotos(files,true);
});
let editingLabelId=null;
function activeCard(){return state.cards.find((card)=>card.id===$('#card-form').elements.id.value);}
function resetLabelEditor(){editingLabelId=null;$('#label-editor-title').textContent='Create a label';$('#label-name').value='';$('#label-color').value='#4bce97';$('#save-label').textContent='Create';$('#cancel-label-edit').hidden=true;$('#delete-label').hidden=true;}
function renderLabelOptions(){
  const card=activeCard();if(!card)return;
  $('#label-options').innerHTML=state.board.labels.sort((a,b)=>a.position-b.position).map((label)=>`<div class="label-option-row"><input class="label-check" type="checkbox" data-label-id="${label.id}" ${card.labels.includes(label.id)?'checked':''} aria-label="Select ${escapeHtml(label.name||'unnamed label')}"><button type="button" class="label-choice" data-label-id="${label.id}" style="background:${label.color}">${escapeHtml(label.name||'Unnamed label')}</button><button type="button" class="edit-label" data-label-id="${label.id}" aria-label="Edit label">✎</button></div>`).join('');
  $$('.label-check').forEach((checkbox)=>checkbox.addEventListener('change',()=>toggleCardLabel(checkbox.dataset.labelId,checkbox.checked)));
  $$('.label-choice').forEach((button)=>button.addEventListener('click',()=>{const checkbox=$(`.label-check[data-label-id="${button.dataset.labelId}"]`);checkbox.checked=!checkbox.checked;toggleCardLabel(button.dataset.labelId,checkbox.checked);}));
  $$('.edit-label').forEach((button)=>button.addEventListener('click',()=>{const label=boardLabel(button.dataset.labelId);editingLabelId=label.id;$('#label-editor-title').textContent='Edit label';$('#label-name').value=label.name;$('#label-color').value=label.color;$('#save-label').textContent='Save';$('#cancel-label-edit').hidden=false;$('#delete-label').hidden=false;}));
}
async function toggleCardLabel(labelId,selected){
  const card=activeCard();if(!card)return;card.labels=selected?[...new Set([...card.labels,labelId])]:card.labels.filter((id)=>id!==labelId);
  try{await api(`/cards/${card.id}`,{method:'PATCH',body:JSON.stringify({labels:card.labels})});renderSelectedLabels(card);render();}catch(error){toast(error.message,true);}
}
$('#edit-labels').addEventListener('click',()=>{resetLabelEditor();renderLabelOptions();$('#labels-dialog').showModal();});
$$('[data-close-labels]').forEach((button)=>button.addEventListener('click',()=>$('#labels-dialog').close()));
$('#labels-dialog').addEventListener('click',(event)=>{if(event.target===$('#labels-dialog'))$('#labels-dialog').close();});
$('#cancel-label-edit').addEventListener('click',resetLabelEditor);
$('#save-label').addEventListener('click',async()=>{const payload={name:$('#label-name').value,color:$('#label-color').value};try{if(editingLabelId){const updated=await api(`/boards/${currentBoardId}/labels/${editingLabelId}`,{method:'PATCH',body:JSON.stringify(payload)});Object.assign(boardLabel(editingLabelId),updated);}else{state.board.labels.push(await api(`/boards/${currentBoardId}/labels`,{method:'POST',body:JSON.stringify(payload)}));}resetLabelEditor();renderLabelOptions();renderSelectedLabels(activeCard());render();}catch(error){toast(error.message,true);}});
$('#delete-label').addEventListener('click',async()=>{if(!editingLabelId||!await askConfirm({title:'Delete label?',message:'This label will be removed from every card on this board.'}))return;try{await api(`/boards/${currentBoardId}/labels/${editingLabelId}`,{method:'DELETE'});state.board.labels=state.board.labels.filter((label)=>label.id!==editingLabelId);state.cards.forEach((card)=>{card.labels=card.labels.filter((id)=>id!==editingLabelId);});resetLabelEditor();renderLabelOptions();renderSelectedLabels(activeCard());render();}catch(error){toast(error.message,true);}});
$$('[data-close]').forEach((button)=>button.addEventListener('click',()=>$('#card-dialog').close()));
$('#card-dialog').addEventListener('click',(event)=>{if(event.target===$('#card-dialog'))$('#card-dialog').close();});
$$('[data-close-image]').forEach((button)=>button.addEventListener('click',()=>$('#image-dialog').close()));
$('#image-dialog').addEventListener('click',(event)=>{if(event.target===$('#image-dialog'))$('#image-dialog').close();});
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
document.addEventListener('keydown',(event)=>{const nestedOpen=$('#labels-dialog').open||$('#image-dialog').open||$('#text-dialog').open||$('#confirm-dialog').open;if(event.key==='Escape'&&!nestedOpen){if($('#card-dialog').open)$('#card-dialog').close();else closeBoardsSidebar();}if(event.key.toLowerCase()==='b'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('dialog[open]')){event.preventDefault();toggleBoardsSidebar();}});
load();
