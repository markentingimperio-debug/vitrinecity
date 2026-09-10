// Inspect the ZIP envelope before loading Excel in the administrator's browser.
// The workbook contents never go to a third-party parser.
export function validateRetentionXlsx(buffer) {
  const view=new DataView(buffer);let end=-1;
  for(let i=view.byteLength-22;i>=Math.max(0,view.byteLength-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Arquivo Excel inválido. Use .xlsx ou copie as células.');
  const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),size=view.getUint32(end+12,true);
  if(count>300||count===65535||offset+size>end)throw new Error('Planilha muito complexa. Exporte somente os dados dos pedidos.');
  let cursor=offset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>view.byteLength||view.getUint32(cursor,true)!==0x02014b50)throw new Error('Estrutura Excel inválida.');
    const flags=view.getUint16(cursor+8,true),packed=view.getUint32(cursor+20,true),unpacked=view.getUint32(cursor+24,true);
    total+=unpacked;
    if(flags&1||unpacked>16*1024*1024||total>40*1024*1024||unpacked>Math.max(1024*1024,packed*300))throw new Error('Planilha protegida ou muito grande. Divida em lotes menores.');
    cursor+=46+view.getUint16(cursor+28,true)+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);
    if(cursor>offset+size)throw new Error('Estrutura Excel inválida.');
  }
  if(cursor!==offset+size)throw new Error('Formato Excel não suportado. Exporte os dados como CSV.');
  return true;
}
