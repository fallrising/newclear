export async function overflowDiagnostic({page,result}) {
 result.diagnosticOnly=true;
 await page.setViewportSize({width:390,height:844});
 const response=await page.goto('http://127.0.0.1:18765/services/hello');
 if(response.status()!==200)throw new Error('REVIEW_OVERFLOW_STATUS');
 await page.getByRole('heading',{name:'hello',exact:true}).waitFor();
 result.overflowMetrics=await page.evaluate(()=>{
  const safeClass=element=>['table-scroll','visually-hidden','muted'].filter(name=>element?.classList?.contains(name)).join(' ')||'other';
  const measure=element=>{
   const rect=element.getBoundingClientRect(),css=getComputedStyle(element),parent=element.offsetParent;
   return {tag:element.tagName,class:safeClass(element),left:rect.left,right:rect.right,width:rect.width,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,position:css.position,overflowX:css.overflowX,offsetParentTag:parent?.tagName??null,offsetParentClass:parent?safeClass(parent):null};
  };
  return {viewport:innerWidth,document:measure(document.documentElement),body:measure(document.body),main:measure(document.querySelector('main')),wrappers:[...document.querySelectorAll('.table-scroll')].map(measure),tables:[...document.querySelectorAll('table')].map(measure),outside:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,100).map(measure)};
 });
 if(result.overflowMetrics.document.scrollWidth<=390)throw new Error('REVIEW_OVERFLOW_NOT_REPRODUCED');
}
