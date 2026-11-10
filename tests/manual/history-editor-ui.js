(async()=>{
 if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
 const errors=[];
 const onError=e=>errors.push(e.message||String(e.reason));
 window.addEventListener("error",onError);window.addEventListener("unhandledrejection",onError);
 const p=app.plugins.plugins.vaultbranch;
 const results=[],check=(v,label)=>{if(!v)throw Error(label);results.push(label)};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const name='vaultbranch-fold-menu-test-'+Date.now()+'.md';
 const base=Array.from({length:80},(_,n)=>`line ${n}`).join('\n')+'\n';
 const file=await app.vault.create(name,base);
 const original={collapse:p.settings.collapseUnchanged,autosave:p.settings.diffAutosave};
 let diff, editor;
 try{
  await p.updateSetting('diffAutosave',false);await p.updateSetting('collapseUnchanged',true);
  await p.git.stage([name]);const index=await p.git.run(['show',':'+name]);
  const working=base.replace('line 40','working line 40');await app.vault.modify(file,working);
  diff=await p.openDiff({path:name,index:'A',worktree:'M'},'unstaged');
  const view=diff.view, merge=view.merge;
  merge.b.dispatch({changes:{from:0,to:0,insert:'retained draft\n'},selection:{anchor:7}});
  const text=merge.b.state.doc.toString(),head=merge.b.state.selection.main.head;
  await p.updateSetting('collapseUnchanged',false);await p.updateSetting('collapseUnchanged',true);
  check(view.merge===merge&&merge.b.state.doc.toString()===text&&merge.b.state.selection.main.head===head,'fold setting preserves editable draft, selection and editor');
  merge.b.focus();merge.b.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,bubbles:true}));
  check(merge.b.state.doc.toString()===working,'Ctrl+Z still undoes input after toggling collapse');
  check((await p.git.run(['show',':'+name]))===index,'fold toggling and undo preserve staged content');
  await view.session.reload();await diff.detach();diff=null;
  editor=app.workspace.getLeaf('tab');await editor.openFile(file);await pause(250);
  const root=editor.view.contentEl.querySelector('.cm-content');
  check(root,'test note opens in native markdown editor');
  root.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:250}));await pause(150);
  const historyItems=()=>[...document.querySelectorAll('.menu-item')].filter(e=>/File history|文件历史/.test(e.textContent));
  check(historyItems().length===1,'native editor right-click shows exactly one file history entry');
  document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:10,clientY:10}));await pause(100);
  const explorer=app.workspace.getLeavesOfType('file-explorer')[0]?.view;
  const title=explorer?.containerEl.querySelector(`[data-path="${name}"]`);
  check(title,'test note appears in file explorer');
  title.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:180,clientY:250}));await pause(150);
  check(historyItems().length===1,'native file explorer right-click shows exactly one file history entry');
  document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:10,clientY:10}));
  check(errors.length===0,'no runtime errors');
  return{results,errors:errors};
 }finally{
  window.removeEventListener("error",onError);window.removeEventListener("unhandledrejection",onError);
  if(diff){await diff.view.session?.reload();await diff.detach()}await editor?.detach();
  await p.git.run(['rm','--cached','-f','--',name]);
  if(app.vault.getAbstractFileByPath(name))await app.vault.trash(file,false);
  await p.updateSetting('diffAutosave',original.autosave);await p.updateSetting('collapseUnchanged',original.collapse);await p.refresh();
 }
})()
