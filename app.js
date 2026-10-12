/* Premium Reader PWA — app.js */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const LS='readingApp.v1';
let state=JSON.parse(localStorage.getItem(LS)||'null')||{books:[],settings:{theme:'light',font:'"Pretendard","Noto Serif KR",serif',size:19,spacing:1.85,letter:0}};
let current=null, chapters=[], currentChapter=0, speaking=false;

const save=()=>localStorage.setItem(LS,JSON.stringify(state));
const toast=m=>{const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- theme ---------- */
function applySettings(){
  const s=state.settings, r=document.documentElement;
  r.dataset.theme=s.theme;
  r.style.setProperty('--font',s.font);
  r.style.setProperty('--fs',s.size+'px');
  r.style.setProperty('--lh',s.spacing);
  r.style.setProperty('--ls',s.letter+'px');
}
applySettings();

/* ---------- file decoding ---------- */
async function readTextSmart(file){
  const buf=await file.arrayBuffer();
  for(const enc of ['utf-8','euc-kr','windows-1252']){
    try{
      const txt=new TextDecoder(enc,{fatal:true}).decode(buf);
      if(!txt.includes('\uFFFD')) return txt;
    }catch(e){}
  }
  return new TextDecoder('utf-8').decode(buf);
}

async function extract(file){
  const name=file.name.toLowerCase();
  if(name.endsWith('.txt')||name.endsWith('.md')||name.endsWith('.markdown')) return await readTextSmart(file);
  if(name.endsWith('.docx')){
    const arrayBuffer=await file.arrayBuffer();
    const result=await mammoth.convertToHtml({arrayBuffer});
    return result.value;
  }
  if(name.endsWith('.pdf')){
    const data=await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const pdf=await pdfjsLib.getDocument({data}).promise;
    let out='';
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i), content=await page.getTextContent();
      out+=`<h2>${i}쪽</h2><p>`+content.items.map(x=>x.str).join(' ').replace(/\s+/g,' ').trim()+'</p>';
    }
    return out;
  }
  if(name.endsWith('.epub')){
    const zip=await JSZip.loadAsync(await file.arrayBuffer());
    const opfPath=Object.keys(zip.files).find(p=>p.endsWith('.opf'));
    let order=[];
    if(opfPath){
      const opf=await zip.file(opfPath).async('string');
      const doc=new DOMParser().parseFromString(opf,'application/xml');
      const manifest={}; [...doc.querySelectorAll('manifest > item')].forEach(i=>manifest[i.getAttribute('id')]=i.getAttribute('href'));
      order=[...doc.querySelectorAll('spine > itemref')].map(r=>manifest[r.getAttribute('idref')]);
      const base=opfPath.includes('/')?opfPath.slice(0,opfPath.lastIndexOf('/')+1):'';
      order=order.map(h=>base+h);
    }
    if(!order.length) order=Object.keys(zip.files).filter(p=>/\.x?html?$/i.test(p)).sort();
    let html='';
    for(const path of order){
      const f=zip.file(path); if(!f) continue;
      html+=await f.async('string')+'\n';
    }
    return html;
  }
  if(name.endsWith('.html')||name.endsWith('.htm')) return await file.text();
  throw new Error('지원하지 않는 형식입니다.');
}

/* ---------- TOC ---------- */
function buildTOC(html,title){
  const doc=new DOMParser().parseFromString(html,'text/html');
  let heads=[...doc.querySelectorAll('h1,h2,h3')].map((h,i)=>({id:'ch-'+i,text:h.textContent.trim().slice(0,80),level:+h.tagName[1]}))
    .filter(c=>c.text);
  if(heads.length<2){
    // Korean novel/document heuristics: 프롤로그, 1장, 제1화, Chapter, etc.
    const container=doc.body||doc;
    const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);
    let node, found=[];
    while(node=walker.nextNode()){
      const t=node.textContent.trim();
      if(t && t.length<40 && /^(프롤로그|에필로그|서문|머리말|목차|(제)?\s*[0-9一二三四五六七八九十]+\s*(장|화|부|편)|chapter\s*[0-9]+|epilogue|prologue)$/i.test(t)) found.push(t);
    }
    heads=[...new Set(found)].map((t,i)=>({id:'auto-'+i,text:t,level:2}));
  }
  return heads.length?heads:[{id:'start',text:title||'처음부터',level:1}];
}

/* ---------- library ---------- */
function renderShelf(){
  const shelf=$('#shelf'); shelf.innerHTML='';
  $('#bookCount').textContent=state.books.length;
  $('#emptyShelf').style.display=state.books.length?'none':'block';
  state.books.forEach(b=>{
    const el=document.createElement('article'); el.className='book';
    el.innerHTML=`<button class="del" title="삭제">✕</button><h3>${esc(b.title)}</h3>
      <div class="meta">${b.type.toUpperCase()} · ${b.updated}</div>
      <div class="bar"><i style="width:${b.progress||0}%"></i></div>
      <div class="meta">${b.progress?`읽은 위치: ${b.progress}%`:'아직 읽기 전'}</div>`;
    el.onclick=e=>{
      if(e.target.classList.contains('del')){
        e.stopPropagation();
        if(confirm(`『${b.title}』을 서재에서 삭제할까요?`)){
          state.books=state.books.filter(x=>x.id!==b.id); save(); renderShelf(); toast('삭제했습니다');
        }
        return;
      }
      openBook(b.id,true);
    };
    shelf.appendChild(el);
  });
}

async function addBook(title,html,type){
  const id='b'+Date.now();
  const book={id,title,type,html,updated:new Date().toLocaleDateString('ko-KR'),progress:0,scroll:0,bookmark:null};
  book.toc=buildTOC(html,title);
  state.books.unshift(book); save(); renderShelf(); toast('서재에 추가했습니다');
}

/* ---------- reader ---------- */
function openBook(id,resume){
  current=state.books.find(b=>b.id===id); if(!current) return;
  $('#library').classList.remove('active'); $('#reader').classList.add('active');
  $('#readerTitle').textContent=current.title;
  const clean=DOMPurify.sanitize(current.html,{FORBID_TAGS:['script','style'],ADD_ATTR:['target']});
  $('#page').innerHTML=clean;
  chapters=current.toc;
  requestAnimationFrame(()=>{
    if(resume && current.scroll) $('#page').scrollTop=0, window.scrollTo(0,0), $('#page').parentElement.scrollTop=current.scroll;
    updateProgress();
  });
  history.pushState({reader:true},'');
}

function closeReader(){
  if(current){
    current.scroll=window.scrollY;
    current.progress=Math.min(100,Math.round(window.scrollY/Math.max(1,document.body.scrollHeight-innerHeight)*100));
    current.updated=new Date().toLocaleDateString('ko-KR'); save();
  }
  stopTTS();
  $('#reader').classList.remove('active'); $('#library').classList.add('active');
  renderShelf(); current=null;
}

function updateProgress(){
  const max=Math.max(1,document.body.scrollHeight-innerHeight);
  const p=Math.min(100,Math.round(scrollY/max*100));
  $('#progressBar').style.width=p+'%';
  if(current){current.progress=p;current.scroll=scrollY;save();}
}

addEventListener('scroll',()=>{if($('#reader').classList.contains('active'))updateProgress();},{passive:true});

/* ---------- sheets ---------- */
function openSheet(html){$('#sheetBody').innerHTML=html;$('#sheet').classList.add('open');$('#sheet').setAttribute('aria-hidden','false')}
function closeSheet(){$('#sheet').classList.remove('open');$('#sheet').setAttribute('aria-hidden','true')}
$('#sheet').addEventListener('click',e=>{if(e.target.dataset.close!==undefined)closeSheet()});

function showTOC(){
  if(!current)return;
  const items=chapters.map((c,i)=>`<button class="toc-item" data-ch="${i}">${esc(c.text)}<small>${c.level===1?'주요 구획':'목차 항목'}</small></button>`).join('');
  openSheet(`<h3>목차</h3>${items||'<p class="muted">목차를 찾지 못했습니다.</p>'}`);
  $$('#sheetBody [data-ch]').forEach(btn=>btn.onclick=()=>{
    const c=chapters[+btn.dataset.ch];
    const target=document.getElementById(c.id);
    if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
    closeSheet();
  });
}

function showSettings(){
  const s=state.settings;
  openSheet(`<h3>읽기 설정</h3>
  <div class="setting-row"><div><label>글꼴</label><small>본문 서체</small></div>
    <select id="fontSel">
      <option value='"Pretendard","Noto Serif KR",serif"'>기본 세리프</option>
      <option value='"Pretendard","Apple SD Gothic Neo",sans-serif"'>고딕</option>
      <option value='"Nanum Myeongjo",serif"'>나눔명조</option>
      <option value='"Georgia",serif"'>Georgia</option>
    </select></div>
  <div class="setting-row"><div><label>글자 크기</label><small>${s.size}px</small></div><input id="sizeRange" type="range" min="15" max="28" value="${s.size}"></div>
  <div class="setting-row"><div><label>줄 간격</label><small>${s.spacing}</small></div><input id="lhRange" type="range" min="1.4" max="2.4" step="0.05" value="${s.spacing}"></div>
  <div class="setting-row"><div><label>자간</label><small>${s.letter}px</small></div><input id="lsRange" type="range" min="-1" max="3" step="0.1" value="${s.letter}"></div>
  <div class="setting-row"><div><label>화면 모드</label><small>라이트 / 나이트</small></div>
    <div style="display:flex;gap:8px"><button class="mode ${s.theme==='light'?'on':''}" data-mode="light">라이트</button><button class="mode ${s.theme==='dark'?'on':''}" data-mode="dark">나이트</button></div></div>`);
  $('#fontSel').value=s.font;
  $('#fontSel').onchange=e=>{s.font=e.target.value;save();applySettings()};
  $('#sizeRange').oninput=e=>{s.size=+e.target.value;save();applySettings()};
  $('#lhRange').oninput=e=>{s.spacing=+e.target.value;save();applySettings()};
  $('#lsRange').oninput=e=>{s.letter=+e.target.value;save();applySettings()};
  $$('#sheetBody .mode').forEach(b=>b.onclick=()=>{s.theme=b.dataset.mode;save();applySettings();showSettings()});
}

/* ---------- TTS ---------- */
function stopTTS(){speechSynthesis.cancel();speaking=false;$('#dock [data-act=tts]').classList.remove('on')}
function toggleTTS(){
  if(!current)return;
  if(speaking)return stopTTS();
  const text=($('#page').innerText||'').slice(0,15000);
  if(!text)return toast('읽을 텍스트가 없습니다');
  const u=new SpeechSynthesisUtterance(text);
  u.lang='ko-KR'; u.rate=1; u.onend=stopTTS; u.onerror=stopTTS;
  speechSynthesis.speak(u); speaking=true; $('#dock [data-act=tts]').classList.add('on'); toast('TTS 재생 중');
}

/* ---------- events ---------- */
$('#openBtn').onclick=()=>$('#fileInput').click();
$('#fileInput').onchange=async e=>{
  for(const file of e.target.files){
    try{
      const html=await extract(file);
      const title=file.name.replace(/\.[^.]+$/,'');
      await addBook(title,html,file.name.split('.').pop());
    }catch(err){toast('불러오기 실패: '+err.message)}
  }
  e.target.value='';
};

$('#pasteBtn').onclick=()=>$('#pasteDialog').showModal();
$('#pasteSave').onclick=e=>{
  const title=$('#pasteTitle').value.trim(), text=$('#pasteText').value.trim();
  if(!title||!text){e.preventDefault();return}
  const html=text.split(/\n{2,}/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
  addBook(title,html,'txt');
};

$('#backBtn').onclick=closeReader;
$('#tocBtn').onclick=showTOC;
$('#settingsBtn').onclick=showSettings;
$('#nextBtn').onclick=()=>scrollBy({top:innerHeight*.82,behavior:'smooth'});
$('#prevBtn').onclick=()=>scrollBy({top:-innerHeight*.82,behavior:'smooth'});

$('#dock').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  const act=b.dataset.act;
  if(act==='library')return closeReader();
  if(act==='toc')return showTOC();
  if(act==='settings')return showSettings();
  if(act==='tts')return toggleTTS();
  if(act==='bookmark'){
    if(!current)return;
    current.bookmark={progress:current.progress,scroll:scrollY,date:new Date().toLocaleString('ko-KR')};save();
    toast('책갈피를 저장했습니다');
  }
});

/* auto-hide dock */
let lastY=0;
addEventListener('scroll',()=>{
  const dock=$('#dock');
  if(scrollY>lastY+8&&scrollY>120)dock.classList.add('hide');
  else if(scrollY<lastY-8)dock.classList.remove('hide');
  lastY=scrollY;
},{passive:true});

addEventListener('popstate',()=>{if($('#reader').classList.contains('active'))closeReader()});
addEventListener('keydown',e=>{
  if(e.key==='ArrowRight')$('#nextBtn').click();
  if(e.key==='ArrowLeft')$('#prevBtn').click();
  if(e.key==='Escape')closeSheet();
});

/* service worker */
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');

renderShelf();
