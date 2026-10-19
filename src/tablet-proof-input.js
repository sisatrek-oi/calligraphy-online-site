// Keep Android handwriting IMEs away from the long, scrolling page textarea.
export function textareaSourceOffset(text, offset) {
  let source=0;
  for(let visible=0;visible<offset && source<text.length;visible++,source++) {
    if(text[source]==='\r' && text[source+1]==='\n')source++;
  }
  return source;
}

export function mountTabletProofInput({app, editor, getText, replace, notice}) {
  const touchDevice = navigator.maxTouchPoints > 0 || matchMedia('(any-pointer: coarse)').matches;
  let protectedMode = touchDevice;
  let anchor = null, composing = false, frame = 0, pointerSelection = null;
  const viewport = window.visualViewport;
  let fullHeight = viewport?.height || innerHeight, fullWidth = innerWidth;
  const toolbar = document.createElement('div');
  toolbar.className = 'tablet-proof-toolbar';
  toolbar.innerHTML = '<button type="button" data-tablet-replace>修改选中字词</button><button type="button" data-tablet-toggle></button><small data-tablet-help></small>';
  app.querySelector('.editor-main').prepend(toolbar);
  const panel = document.createElement('section');
  panel.className = 'tablet-proof-correction';panel.hidden = true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','手写修改选中字词');
  panel.innerHTML = '<strong data-tablet-location></strong><div class="tablet-proof-context" data-tablet-context></div><label>改为<textarea rows="2" data-tablet-value spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="手写替换文字"></textarea></label><p data-tablet-error role="status"></p><div class="tools"><button type="button" data-tablet-apply class="primary">确认替换</button><button type="button" data-tablet-cancel>取消</button></div>';
  app.append(panel);
  const field = panel.querySelector('[data-tablet-value]'), apply = panel.querySelector('[data-tablet-apply]');
  const error = panel.querySelector('[data-tablet-error]');
  function syncMode() {
    editor.readOnly = protectedMode;
    editor.setAttribute('inputmode',protectedMode?'none':'text');
    toolbar.querySelector('[data-tablet-toggle]').textContent=protectedMode?'整页键入':'开启手写校改';
    toolbar.querySelector('[data-tablet-help]').textContent=protectedMode?'长按选中字词，再点“修改选中字词”。手写只在小框内进行。':'整页编辑已开启；系统手写建议使用选中字词校改。';
    toolbar.classList.toggle('protected-input',protectedMode);
  }
  function layout() {
    frame=0;
    const height=viewport?.height || innerHeight, top=viewport?.offsetTop || 0;
    if (Math.abs(innerWidth-fullWidth)>100) {fullWidth=innerWidth;fullHeight=height;}
    else fullHeight=Math.max(fullHeight,height);
    const focused=app.contains(document.activeElement) && document.activeElement.matches('input,textarea');
    const keyboard=Boolean(focused && (touchDevice || anchor) && (viewport?.scale || 1)<1.1 && (fullHeight-height>100 || height<500));
    document.body.classList.toggle('proof-keyboard-open',keyboard);
    document.body.style.setProperty('--proof-visible-height',`${height}px`);
    if (anchor) {
      const rect=app.querySelector('.form-panel').getBoundingClientRect();
      const left=Math.max(8,rect.left+8), width=Math.min(rect.width-16,innerWidth-left-8);
      panel.style.left=`${left}px`;panel.style.width=`${Math.max(120,width)}px`;
      panel.style.top=`${Math.max(top+6,rect.top+6)}px`;
      panel.style.maxHeight=`${Math.max(100,height-16)}px`;
    }
  }
  function scheduleLayout() {if(!frame) frame=requestAnimationFrame(layout);}
  function close() {
    anchor=null;composing=false;panel.hidden=true;
    if(document.activeElement===field)field.blur();
    scheduleLayout();
  }
  function open() {
    const source=editor.value;
    const [start,end]=pointerSelection?.source===source ? pointerSelection.range : [editor.selectionStart,editor.selectionEnd];
    pointerSelection=null;
    if(start===end) {notice('请先在正文中长按选中要修改的字词，再点“修改选中字词”。');return;}
    if(end-start>300) {notice('请一次选中一小段文字（不超过300字），再手写修改。');return;}
    // Capture the whole source as well as offsets: repeated words cannot redirect a later commit.
    anchor={start,end,source,storedSource:getText()};composing=false;apply.disabled=false;error.textContent='';
    const line=source.slice(0,start).split('\n').length;
    panel.querySelector('[data-tablet-location]').textContent=`${editor.getAttribute('aria-label')} · 第 ${line} 行`;
    panel.querySelector('[data-tablet-context]').textContent=`原文：${source.slice(Math.max(0,start-16),start)}【${source.slice(start,end)}】${source.slice(end,end+16)}`;
    field.value=source.slice(start,end);panel.hidden=false;layout();
    field.focus({preventScroll:true});field.select();scheduleLayout();
  }
  function commit() {
    if(!anchor || composing)return;
    const value=field.value;
    if(/[\u0000\uFFFD]/u.test(value) || Array.from(value).some(c=>c.length===1 && /[\uD800-\uDFFF]/u.test(c))) {
      error.textContent='输入中含有异常字符，请在小框中重新输入；正文尚未改动。';return;
    }
    if(anchor.source!==editor.value || anchor.storedSource!==getText() || anchor.storedSource.replace(/\r\n?/g,'\n')!==anchor.source) {error.textContent='正文已发生变化，请取消后重新选择位置；本次输入仍保留在小框中。';return;}
    const start=textareaSourceOffset(anchor.storedSource,anchor.start),end=textareaSourceOffset(anchor.storedSource,anchor.end);
    // Only the confirmed native value is committed. Composition event.data is never spliced in.
    replace(start,end,value);close();
  }
  const onToolbarClick=e=>{if(e.target.closest('[data-tablet-replace]'))open();if(e.target.closest('[data-tablet-toggle]')){close();protectedMode=!protectedMode;syncMode();}};
  toolbar.addEventListener('pointerdown',e=>{if(e.target.closest('[data-tablet-replace]'))pointerSelection={source:editor.value,range:[editor.selectionStart,editor.selectionEnd]};});
  toolbar.addEventListener('click',onToolbarClick);
  panel.querySelector('[data-tablet-cancel]').onclick=close;apply.onclick=commit;
  field.addEventListener('compositionstart',()=>{composing=true;apply.disabled=true;});
  field.addEventListener('compositionend',()=>{composing=false;apply.disabled=false;});
  panel.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229||composing)return;if(e.key==='Escape'){e.preventDefault();close();}});
  const onFocusOut=()=>scheduleLayout();
  app.addEventListener('focusin',scheduleLayout);app.addEventListener('focusout',onFocusOut);
  window.addEventListener('resize',scheduleLayout);viewport?.addEventListener('resize',scheduleLayout);viewport?.addEventListener('scroll',scheduleLayout);
  syncMode();layout();
  return {destroy(){close();cancelAnimationFrame(frame);toolbar.remove();panel.remove();app.removeEventListener('focusin',scheduleLayout);app.removeEventListener('focusout',onFocusOut);window.removeEventListener('resize',scheduleLayout);viewport?.removeEventListener('resize',scheduleLayout);viewport?.removeEventListener('scroll',scheduleLayout);document.body.classList.remove('proof-keyboard-open');document.body.style.removeProperty('--proof-visible-height');}};
}
